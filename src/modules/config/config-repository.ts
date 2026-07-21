import { store } from '../../persistence/store.js';
import type { StoreData } from '../../shared/types.js';
import { normalizeStoreData } from '../../persistence/store-data-normalizer.js';
import { CONFIG_VALUE_KEYS, type ConfigValueKey } from '../../persistence/store-defaults.js';

export type RuntimeConfig = Pick<StoreData, ConfigValueKey>;

export const configRepository = {
    getRuntimeConfig(): RuntimeConfig {
        return store.getConfigValues(CONFIG_VALUE_KEYS);
    },

    getDashboardConfig(): StoreData {
        return normalizeStoreData(store.getConfigValues(CONFIG_VALUE_KEYS));
    },

    updateConfig(updates: Partial<RuntimeConfig>): void {
        store.updateConfigValues(updates);
    },

    isSetupComplete(): boolean {
        return store.isSetupComplete();
    },
};

export type ConfigRepository = typeof configRepository;
