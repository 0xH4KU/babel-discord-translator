import type { TranslationCache } from '../translation/cache.js';
import type { CooldownManager } from '../translation/cooldown.js';
import type { StoreData } from '../../shared/types.js';

export const MANAGED_RUNTIME_CONFIG_KEYS = [
    'vertexAiApiKey',
    'gcpProject',
    'gcpLocation',
    'cooldownSeconds',
    'cacheMaxSize',
    'geminiModel',
    'translationPrompt',
    'maxInputLength',
    'maxOutputTokens',
    'dailyBudgetUsd',
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'translationProvider',
    'translationMaxConcurrent',
    'translationMaxGlobalQueue',
    'translationMaxGuildQueue',
    'translationMaxUserOutstanding',
    'translationMaxQueueWaitMs',
] as const;

export type ManagedRuntimeConfigKey = (typeof MANAGED_RUNTIME_CONFIG_KEYS)[number];

export interface ConfigRuntimeDependencies {
    cache: TranslationCache;
    cooldown: CooldownManager;
    cooldowns?: CooldownManager[];
    resetProviderState?: () => void;
}

export interface ConfigUpdateEffectsResult {
    cacheCleared: boolean;
    changedKeys: ManagedRuntimeConfigKey[];
    immediateEffects: string[];
}

type RuntimeConfigUpdate = Partial<Pick<StoreData, ManagedRuntimeConfigKey>>;

const CONFIG_EFFECT_DESCRIPTIONS: Record<ManagedRuntimeConfigKey, string> = {
    vertexAiApiKey:
        'Clear translation cache and reset provider state so future requests use the updated Vertex AI credentials.',
    gcpProject:
        'Clear translation cache and reset provider state so future requests use the updated Vertex AI project.',
    gcpLocation:
        'Clear translation cache and reset provider state so future requests use the updated Vertex AI location.',
    cooldownSeconds: 'Update the in-memory cooldown window immediately.',
    cacheMaxSize:
        'Update the in-memory translation cache capacity immediately and trim overflow entries.',
    geminiModel:
        'Clear translation cache and reset provider state so future requests use the new Vertex AI model.',
    translationPrompt: 'Clear the translation cache so future requests use the new prompt.',
    maxInputLength:
        'No in-memory sync required; request validation reads the persisted value on each call.',
    maxOutputTokens:
        'Clear the translation cache so future requests use the new output token limit.',
    dailyBudgetUsd:
        'No in-memory sync required; budget checks read the persisted value on each call.',
    openaiApiKey:
        'Clear translation cache and reset provider state so future requests use the updated OpenAI-compatible credentials.',
    openaiBaseUrl:
        'Clear translation cache and reset provider state so future requests use the updated OpenAI-compatible endpoint.',
    openaiModel:
        'Clear translation cache and reset provider state so future requests use the updated OpenAI-compatible model.',
    translationProvider:
        'Clear translation cache and reset provider state so future requests use the new provider.',
    translationMaxConcurrent:
        'Runtime limiter changes are read when the limiter is constructed on the next process start.',
    translationMaxGlobalQueue:
        'Runtime limiter changes are read when the limiter is constructed on the next process start.',
    translationMaxGuildQueue:
        'Runtime limiter changes are read when the limiter is constructed on the next process start.',
    translationMaxUserOutstanding:
        'Runtime limiter changes are read when the limiter is constructed on the next process start.',
    translationMaxQueueWaitMs:
        'Runtime limiter changes are read when the limiter is constructed on the next process start.',
};

export function applyConfigUpdateEffects(
    currentConfig: StoreData,
    updates: RuntimeConfigUpdate,
    { cache, cooldown, cooldowns = [cooldown], resetProviderState }: ConfigRuntimeDependencies,
): ConfigUpdateEffectsResult {
    const changedKeys = MANAGED_RUNTIME_CONFIG_KEYS.filter(
        (key) => updates[key] !== undefined && updates[key] !== currentConfig[key],
    );
    let cacheCleared = false;
    let providerStateReset = false;

    const clearCache = (): void => {
        if (!cacheCleared) {
            cache.clear();
            cacheCleared = true;
        }
    };

    const resetProviders = (): void => {
        if (!providerStateReset) {
            resetProviderState?.();
            providerStateReset = true;
        }
    };

    for (const key of changedKeys) {
        switch (key) {
            case 'vertexAiApiKey':
            case 'gcpProject':
            case 'gcpLocation':
            case 'geminiModel':
            case 'openaiApiKey':
            case 'openaiBaseUrl':
            case 'openaiModel':
            case 'translationProvider':
                clearCache();
                resetProviders();
                break;
            case 'cooldownSeconds':
                for (const manager of [...new Set(cooldowns)]) {
                    manager.seconds = updates.cooldownSeconds!;
                }
                break;
            case 'cacheMaxSize':
                cache.setMaxSize(updates.cacheMaxSize!);
                break;
            case 'translationPrompt':
            case 'maxOutputTokens':
                clearCache();
                break;
            case 'maxInputLength':
            case 'dailyBudgetUsd':
            case 'translationMaxConcurrent':
            case 'translationMaxGlobalQueue':
            case 'translationMaxGuildQueue':
            case 'translationMaxUserOutstanding':
            case 'translationMaxQueueWaitMs':
                break;
        }
    }

    return {
        cacheCleared,
        changedKeys,
        immediateEffects: changedKeys.map((key) => CONFIG_EFFECT_DESCRIPTIONS[key]),
    };
}

export const _test = { CONFIG_EFFECT_DESCRIPTIONS };
