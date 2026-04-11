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
    | 'openaiApiKey'
    | 'openaiBaseUrl'
    | 'openaiModel'
    | 'translationProvider'
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
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'translationProvider',
];

export interface ConfigRepository {
    getRuntimeConfig(): RuntimeConfig;
    getDashboardConfig(): StoreData;
    updateConfig(updates: Partial<StoreData>): void;
    isSetupComplete(): boolean;
}

class StoreBackedConfigRepository implements ConfigRepository {
    getRuntimeConfig(): RuntimeConfig {
        return store.getConfigValues(RUNTIME_CONFIG_KEYS) as RuntimeConfig;
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
