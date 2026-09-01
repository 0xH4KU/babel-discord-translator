import type { TranslationCache } from '../translation/cache.js';
import type { CooldownManager } from '../translation/cooldown.js';
import type { TranslationRuntimeLimiter } from '../translation/translation-runtime-limiter.js';
import type { StoreData } from '../../shared/types.js';

export const MANAGED_RUNTIME_CONFIG_KEYS = [
    'vertexAiApiKey',
    'visionApiKey',
    'gcpProject',
    'gcpLocation',
    'cooldownSeconds',
    'cacheMaxSize',
    'geminiModel',
    'vertexAiSupportsImages',
    'geminiMediaResolution',
    'translationPrompt',
    'maxInputLength',
    'maxOutputTokens',
    'dailyBudgetUsd',
    'visionMonthlyImageLimit',
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'openaiSupportsImages',
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
    runtimeLimiter?: TranslationRuntimeLimiter;
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
    visionApiKey:
        'No in-memory sync required; Babel Lens reads the persisted Vision credentials on each call.',
    gcpProject:
        'Clear translation cache and reset provider state so future requests use the updated Vertex AI project.',
    gcpLocation:
        'Clear translation cache and reset provider state so future requests use the updated Vertex AI location.',
    cooldownSeconds: 'Update the in-memory cooldown window immediately.',
    cacheMaxSize:
        'Update the in-memory translation cache capacity immediately and trim overflow entries.',
    geminiModel:
        'Clear translation cache and reset provider state so future requests use the new Vertex AI model.',
    vertexAiSupportsImages:
        'Clear translation cache so Babel Lens uses the confirmed Vertex AI image capability.',
    geminiMediaResolution:
        'Clear translation cache so Babel Lens uses the updated Gemini media resolution.',
    translationPrompt: 'Clear the translation cache so future requests use the new prompt.',
    maxInputLength:
        'No in-memory sync required; request validation reads the persisted value on each call.',
    maxOutputTokens:
        'Clear the translation cache so future requests use the new output token limit.',
    dailyBudgetUsd:
        'No in-memory sync required; budget checks read the persisted value on each call.',
    visionMonthlyImageLimit:
        'No in-memory sync required; Babel Lens reads the persisted monthly limit on each call.',
    openaiApiKey:
        'Clear translation cache and reset provider state so future requests use the updated OpenAI-compatible credentials.',
    openaiBaseUrl:
        'Clear translation cache and reset provider state so future requests use the updated OpenAI-compatible endpoint.',
    openaiModel:
        'Clear translation cache and reset provider state so future requests use the updated OpenAI-compatible model.',
    openaiSupportsImages:
        'Clear translation cache so Babel Lens uses the confirmed OpenAI-compatible image capability.',
    translationProvider:
        'Clear translation cache and reset provider state so future requests use the new provider.',
    translationMaxConcurrent: 'Update the runtime translation concurrency limit immediately.',
    translationMaxGlobalQueue: 'Update the runtime global queue limit immediately.',
    translationMaxGuildQueue: 'Update the runtime per-server queue limit immediately.',
    translationMaxUserOutstanding:
        'Update the runtime per-user outstanding request limit immediately.',
    translationMaxQueueWaitMs: 'Update the runtime queue wait timeout immediately.',
};

export function applyConfigUpdateEffects(
    currentConfig: StoreData,
    updates: RuntimeConfigUpdate,
    {
        cache,
        cooldown,
        cooldowns = [cooldown],
        runtimeLimiter,
        resetProviderState,
    }: ConfigRuntimeDependencies,
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
            case 'vertexAiSupportsImages':
            case 'geminiMediaResolution':
            case 'openaiSupportsImages':
                clearCache();
                break;
            case 'maxInputLength':
            case 'dailyBudgetUsd':
            case 'visionApiKey':
            case 'visionMonthlyImageLimit':
                break;
            case 'translationMaxConcurrent':
                runtimeLimiter?.updateLimits({ maxConcurrent: updates.translationMaxConcurrent! });
                break;
            case 'translationMaxGlobalQueue':
                runtimeLimiter?.updateLimits({
                    maxGlobalQueue: updates.translationMaxGlobalQueue!,
                });
                break;
            case 'translationMaxGuildQueue':
                runtimeLimiter?.updateLimits({ maxGuildQueue: updates.translationMaxGuildQueue! });
                break;
            case 'translationMaxUserOutstanding':
                runtimeLimiter?.updateLimits({
                    maxUserOutstanding: updates.translationMaxUserOutstanding!,
                });
                break;
            case 'translationMaxQueueWaitMs':
                runtimeLimiter?.updateLimits({
                    maxQueueWaitMs: updates.translationMaxQueueWaitMs!,
                });
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
