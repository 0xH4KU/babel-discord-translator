import { ConfigStore } from '../src/store.js';
import { readLegacyStoreData, resolveLegacyConfigPath } from '../src/persistence/legacy-json-store.js';
import { createSqliteDatabase, isSqliteStoreEmpty, resolveDatabasePath } from '../src/persistence/sqlite-database.js';

const legacyConfigPath = resolveLegacyConfigPath();
const dbPath = resolveDatabasePath();
const force = process.argv.includes('--force');

const legacyData = readLegacyStoreData(legacyConfigPath);
if (!legacyData) {
    console.error(`[Migrate] No legacy JSON data found at ${legacyConfigPath}`);
    process.exit(1);
}

const db = createSqliteDatabase(dbPath);
try {
    if (!force && !isSqliteStoreEmpty(db)) {
        console.error(`[Migrate] Refusing to overwrite existing SQLite data at ${dbPath}. Re-run with --force if this is intentional.`);
        process.exit(1);
    }
} finally {
    db.close();
}

const store = new ConfigStore({
    dbPath,
    autoImportLegacyJson: false,
    legacyConfigPath,
});

try {
    store.update(legacyData);
    console.log(`[Migrate] Imported ${legacyConfigPath} into ${dbPath}`);
} finally {
    store.close();
}
