import { store } from '../store.js';
import type { StoreData } from '../types.js';
import { normalizeStoreData } from './store-data-normalizer.js';

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

export interface ConfigRepository {
    getRuntimeConfig(): RuntimeConfig;
    getDashboardConfig(): StoreData;
    updateConfig(updates: Partial<StoreData>): void;
    isSetupComplete(): boolean;
}

class StoreBackedConfigRepository implements ConfigRepository {
    getRuntimeConfig(): RuntimeConfig {
        const config = normalizeStoreData(store.getAll() as Partial<StoreData>);
        return {
            vertexAiApiKey: config.vertexAiApiKey,
            gcpProject: config.gcpProject,
            gcpLocation: config.gcpLocation,
            geminiModel: config.geminiModel,
            allowedGuildIds: [...config.allowedGuildIds],
            cooldownSeconds: config.cooldownSeconds,
            cacheMaxSize: config.cacheMaxSize,
            setupComplete: config.setupComplete,
            inputPricePerMillion: config.inputPricePerMillion,
            outputPricePerMillion: config.outputPricePerMillion,
            dailyBudgetUsd: config.dailyBudgetUsd,
            translationPrompt: config.translationPrompt,
            maxInputLength: config.maxInputLength,
            maxOutputTokens: config.maxOutputTokens,
        };
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
