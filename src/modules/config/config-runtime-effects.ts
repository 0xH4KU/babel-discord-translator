import type { TranslationCache } from '../translation/cache.js';
import type { CooldownManager } from '../translation/cooldown.js';
import type { StoreData } from '../../types.js';

export const MANAGED_RUNTIME_CONFIG_KEYS = [
    'cooldownSeconds',
    'cacheMaxSize',
    'geminiModel',
    'translationPrompt',
    'maxInputLength',
    'maxOutputTokens',
    'dailyBudgetUsd',
] as const;

export type ManagedRuntimeConfigKey = typeof MANAGED_RUNTIME_CONFIG_KEYS[number];

export interface ConfigRuntimeDependencies {
    cache: TranslationCache;
    cooldown: CooldownManager;
}

export interface ConfigUpdateEffectsResult {
    cacheCleared: boolean;
    changedKeys: ManagedRuntimeConfigKey[];
    immediateEffects: string[];
}

type RuntimeConfigUpdate = Partial<Pick<StoreData, ManagedRuntimeConfigKey>>;

const CONFIG_EFFECT_DESCRIPTIONS: Record<ManagedRuntimeConfigKey, string> = {
    cooldownSeconds: 'Update the in-memory cooldown window immediately.',
    cacheMaxSize: 'Update the in-memory translation cache capacity immediately.',
    geminiModel: 'Clear the translation cache so future requests use the new model.',
    translationPrompt: 'Clear the translation cache so future requests use the new prompt.',
    maxInputLength: 'No in-memory sync required; request validation reads the persisted value on each call.',
    maxOutputTokens: 'Clear the translation cache so future requests use the new output token limit.',
    dailyBudgetUsd: 'No in-memory sync required; budget checks read the persisted value on each call.',
};

export function applyConfigUpdateEffects(
    currentConfig: StoreData,
    updates: RuntimeConfigUpdate,
    { cache, cooldown }: ConfigRuntimeDependencies,
): ConfigUpdateEffectsResult {
    const changedKeys = MANAGED_RUNTIME_CONFIG_KEYS.filter((key) => updates[key] !== undefined && updates[key] !== currentConfig[key]);
    let cacheCleared = false;

    for (const key of changedKeys) {
        switch (key) {
            case 'cooldownSeconds':
                cooldown.seconds = updates.cooldownSeconds!;
                break;
            case 'cacheMaxSize':
                cache.maxSize = updates.cacheMaxSize!;
                break;
            case 'geminiModel':
            case 'translationPrompt':
            case 'maxOutputTokens':
                if (!cacheCleared) {
                    cache.clear();
                    cacheCleared = true;
                }
                break;
            case 'maxInputLength':
            case 'dailyBudgetUsd':
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
