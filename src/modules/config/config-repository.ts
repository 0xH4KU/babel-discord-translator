import { store } from '../../store.js';
import type { StoreData } from '../../types.js';
import { normalizeStoreData } from '../../repositories/store-data-normalizer.js';

export type RuntimeConfig = Pick<
    StoreData,
    | 'vertexAiApiKey'
    | 'gcpProject'
    | 'gcpLocation'
    | 'geminiModel'
    | 'allowedGuildIds'
    | 'cooldownSeconds'
    | 'cacheMaxSize'
    | 'setupComplete'
    | 'inputPricePerMillion'
    | 'outputPricePerMillion'
    | 'dailyBudgetUsd'
    | 'translationPrompt'
    | 'maxInputLength'
    | 'maxOutputTokens'
>;

const RUNTIME_CONFIG_KEYS: (keyof RuntimeConfig)[] = [
    'vertexAiApiKey',
    'gcpProject',
    'gcpLocation',
    'geminiModel',
    'allowedGuildIds',
    'cooldownSeconds',
    'cacheMaxSize',
    'setupComplete',
    'inputPricePerMillion',
    'outputPricePerMillion',
    'dailyBudgetUsd',
    'translationPrompt',
    'maxInputLength',
    'maxOutputTokens',
];

export interface ConfigRepository {
    getRuntimeConfig(): RuntimeConfig;
    getDashboardConfig(): StoreData;
    updateConfig(updates: Partial<StoreData>): void;
    isSetupComplete(): boolean;
}

class StoreBackedConfigRepository implements ConfigRepository {
    /**
     * Get runtime configuration in a single batch read from the store.
     * Uses store.getAll() instead of N individual store.get() calls.
     */
    getRuntimeConfig(): RuntimeConfig {
        const all = store.getAll();
        const result = {} as Record<string, unknown>;
        for (const key of RUNTIME_CONFIG_KEYS) {
            const value = all[key];
            // Deep copy arrays to prevent mutation of store state
            result[key] = Array.isArray(value) ? [...value] : value;
        }
        return result as RuntimeConfig;
    }

    getDashboardConfig(): StoreData {
        return normalizeStoreData(store.getAll() as Partial<StoreData>);
    }

    updateConfig(updates: Partial<StoreData>): void {
        store.update(updates);
    }

    isSetupComplete(): boolean {
        return store.isSetupComplete();
    }
}

export const configRepository = new StoreBackedConfigRepository();
