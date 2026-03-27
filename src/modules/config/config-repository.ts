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

export interface ConfigRepository {
    getRuntimeConfig(): RuntimeConfig;
    getDashboardConfig(): StoreData;
    updateConfig(updates: Partial<StoreData>): void;
    isSetupComplete(): boolean;
}

class StoreBackedConfigRepository implements ConfigRepository {
    getRuntimeConfig(): RuntimeConfig {
        return {
            vertexAiApiKey: store.get('vertexAiApiKey'),
            gcpProject: store.get('gcpProject'),
            gcpLocation: store.get('gcpLocation'),
            geminiModel: store.get('geminiModel'),
            allowedGuildIds: [...store.get('allowedGuildIds')],
            cooldownSeconds: store.get('cooldownSeconds'),
            cacheMaxSize: store.get('cacheMaxSize'),
            setupComplete: store.get('setupComplete'),
            inputPricePerMillion: store.get('inputPricePerMillion'),
            outputPricePerMillion: store.get('outputPricePerMillion'),
            dailyBudgetUsd: store.get('dailyBudgetUsd'),
            translationPrompt: store.get('translationPrompt'),
            maxInputLength: store.get('maxInputLength'),
            maxOutputTokens: store.get('maxOutputTokens'),
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
