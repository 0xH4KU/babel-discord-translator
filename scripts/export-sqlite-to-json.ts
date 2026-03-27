import { ConfigStore } from '../src/store.js';
import { resolveLegacyConfigPath, writeLegacyStoreData } from '../src/persistence/legacy-json-store.js';
import { resolveDatabasePath } from '../src/persistence/sqlite-database.js';

const dbPath = resolveDatabasePath();
const legacyConfigPath = resolveLegacyConfigPath();

const store = new ConfigStore({
    dbPath,
    autoImportLegacyJson: false,
    legacyConfigPath,
});

try {
    writeLegacyStoreData(store.getAll(), legacyConfigPath);
    console.log(`[Export] Wrote ${legacyConfigPath} from ${dbPath}`);
} finally {
    store.close();
}
