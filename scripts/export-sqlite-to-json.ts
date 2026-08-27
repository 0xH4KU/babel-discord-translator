import { ConfigStore } from '../src/persistence/store.js';
import {
    resolveLegacyConfigPath,
    writeLegacyStoreData,
} from '../src/persistence/legacy-json-store.js';
import { resolveDatabasePath } from '../src/persistence/sqlite-database.js';

const dbPath = resolveDatabasePath();
const legacyConfigPath = resolveLegacyConfigPath();

const store = new ConfigStore({
    dbPath,
    autoImportLegacyJson: false,
    legacyConfigPath,
});

try {
    writeLegacyStoreData(store.exportSnapshot(), legacyConfigPath);
    console.log(`[Export] Wrote legacy-compatible data to ${legacyConfigPath} from ${dbPath}`);
    console.warn(
        '[Export] This is not a full backup. Use SQLite .backup to preserve glossary, sessions, and other SQLite-only data.',
    );
} finally {
    store.close();
}
