import { describe, expect, it, vi } from 'vitest';
import { TranslationCache } from '../src/modules/translation/cache.js';
import { CooldownManager } from '../src/modules/translation/cooldown.js';
import { TranslationRuntimeLimiter } from '../src/modules/translation/translation-runtime-limiter.js';
import { applyConfigUpdateEffects } from '../src/modules/config/config-runtime-effects.js';
import { DEFAULT_STORE_DATA } from '../src/persistence/store-defaults.js';
import type { StoreData } from '../src/shared/types.js';

function createConfig(overrides: Partial<StoreData> = {}): StoreData {
    return {
        ...DEFAULT_STORE_DATA,
        vertexAiApiKey: 'key',
        gcpProject: 'project',
        setupComplete: true,
        ...overrides,
    };
}

describe('applyConfigUpdateEffects', () => {
    it('should update cooldown and cache capacity immediately', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const currentConfig = createConfig();
        cache.set('a', '1');
        cache.set('b', '2');
        cache.set('c', '3');

        const result = applyConfigUpdateEffects(
            currentConfig,
            {
                cooldownSeconds: 15,
                cacheMaxSize: 2,
            },
            { cache, cooldown },
        );

        expect(cooldown.seconds).toBe(15);
        expect(cache.maxSize).toBe(2);
        expect(cache.stats().size).toBe(2);
        expect(result.cacheCleared).toBe(false);
        expect(result.changedKeys).toEqual(['cooldownSeconds', 'cacheMaxSize']);
    });

    it('should clear the cache once when model, prompt, or output token settings change', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const clearSpy = vi.spyOn(cache, 'clear');

        const result = applyConfigUpdateEffects(
            createConfig(),
            {
                geminiModel: 'gemini-2.5-pro',
                translationPrompt: 'Translate politely',
                maxOutputTokens: 1500,
            },
            { cache, cooldown },
        );

        expect(result.cacheCleared).toBe(true);
        expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('should clear cache and reset provider state when provider connection settings change', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const clearSpy = vi.spyOn(cache, 'clear');
        const resetProviderState = vi.fn();

        const result = applyConfigUpdateEffects(
            createConfig({
                openaiBaseUrl: 'https://old-openai.example',
                openaiModel: 'gpt-old',
            }),
            {
                openaiBaseUrl: 'https://new-openai.example',
                openaiModel: 'gpt-new',
            },
            { cache, cooldown, resetProviderState },
        );

        expect(result.cacheCleared).toBe(true);
        expect(clearSpy).toHaveBeenCalledTimes(1);
        expect(resetProviderState).toHaveBeenCalledTimes(1);
        expect(result.changedKeys).toEqual(['openaiBaseUrl', 'openaiModel']);
    });

    it('should treat input length and daily budget as read-on-demand settings', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const runtimeLimiter = new TranslationRuntimeLimiter({
            maxConcurrent: 4,
            maxGlobalQueue: 25,
            maxGuildQueue: 5,
            maxUserOutstanding: 1,
            maxQueueWaitMs: 30000,
        });
        const clearSpy = vi.spyOn(cache, 'clear');

        const result = applyConfigUpdateEffects(
            createConfig(),
            {
                maxInputLength: 4000,
                dailyBudgetUsd: 12.5,
            },
            { cache, cooldown, runtimeLimiter },
        );

        expect(result.cacheCleared).toBe(false);
        expect(clearSpy).not.toHaveBeenCalled();
        expect(runtimeLimiter.snapshot().limits.maxConcurrent).toBe(4);
        expect(result.immediateEffects).toEqual([
            'No in-memory sync required; request validation reads the persisted value on each call.',
            'No in-memory sync required; budget checks read the persisted value on each call.',
        ]);
    });

    it('should not apply effects for unchanged config values', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const currentConfig = createConfig();
        const clearSpy = vi.spyOn(cache, 'clear');

        const result = applyConfigUpdateEffects(
            currentConfig,
            {
                cooldownSeconds: currentConfig.cooldownSeconds,
                geminiModel: currentConfig.geminiModel,
            },
            { cache, cooldown },
        );

        expect(result.changedKeys).toEqual([]);
        expect(result.immediateEffects).toEqual([]);
        expect(clearSpy).not.toHaveBeenCalled();
        expect(cooldown.seconds).toBe(5);
    });

    it('should update runtime limiter limits immediately', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const runtimeLimiter = new TranslationRuntimeLimiter({
            maxConcurrent: 4,
            maxGlobalQueue: 25,
            maxGuildQueue: 5,
            maxUserOutstanding: 1,
            maxQueueWaitMs: 30000,
        });

        const result = applyConfigUpdateEffects(
            createConfig(),
            {
                translationMaxConcurrent: 8,
                translationMaxGlobalQueue: 50,
                translationMaxGuildQueue: 10,
                translationMaxUserOutstanding: 2,
                translationMaxQueueWaitMs: 15000,
            },
            { cache, cooldown, runtimeLimiter },
        );

        expect(result.cacheCleared).toBe(false);
        expect(runtimeLimiter.snapshot().limits).toEqual({
            maxConcurrent: 8,
            maxGlobalQueue: 50,
            maxGuildQueue: 10,
            maxUserOutstanding: 2,
            maxQueueWaitMs: 15000,
        });
        expect(result.changedKeys).toEqual([
            'translationMaxConcurrent',
            'translationMaxGlobalQueue',
            'translationMaxGuildQueue',
            'translationMaxUserOutstanding',
            'translationMaxQueueWaitMs',
        ]);
    });
});
