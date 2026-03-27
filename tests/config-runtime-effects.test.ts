import { describe, expect, it, vi } from 'vitest';
import { TranslationCache } from '../src/cache.js';
import { CooldownManager } from '../src/cooldown.js';
import { applyConfigUpdateEffects } from '../src/services/config-runtime-effects.js';
import type { StoreData } from '../src/types.js';

function createConfig(overrides: Partial<StoreData> = {}): StoreData {
    return {
        vertexAiApiKey: 'key',
        gcpProject: 'project',
        gcpLocation: 'global',
        geminiModel: 'gemini-2.5-flash-lite',
        allowedGuildIds: [],
        cooldownSeconds: 5,
        cacheMaxSize: 2000,
        setupComplete: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        dailyBudgetUsd: 0,
        tokenUsage: null,
        usageHistory: [],
        translationPrompt: '',
        userLanguagePrefs: {},
        maxInputLength: 2000,
        maxOutputTokens: 1000,
        guildBudgets: {},
        guildTokenUsage: {},
        guildUsageHistory: {},
        ...overrides,
    };
}

describe('applyConfigUpdateEffects', () => {
    it('should update cooldown and cache capacity immediately', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const currentConfig = createConfig();

        const result = applyConfigUpdateEffects(currentConfig, {
            cooldownSeconds: 15,
            cacheMaxSize: 500,
        }, { cache, cooldown });

        expect(cooldown.seconds).toBe(15);
        expect(cache.maxSize).toBe(500);
        expect(result.cacheCleared).toBe(false);
        expect(result.changedKeys).toEqual(['cooldownSeconds', 'cacheMaxSize']);
    });

    it('should clear the cache once when model, prompt, or output token settings change', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const clearSpy = vi.spyOn(cache, 'clear');

        const result = applyConfigUpdateEffects(createConfig(), {
            geminiModel: 'gemini-2.5-pro',
            translationPrompt: 'Translate politely',
            maxOutputTokens: 1500,
        }, { cache, cooldown });

        expect(result.cacheCleared).toBe(true);
        expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('should treat input length and daily budget as read-on-demand settings', () => {
        const cache = new TranslationCache(100);
        const cooldown = new CooldownManager(5);
        const clearSpy = vi.spyOn(cache, 'clear');

        const result = applyConfigUpdateEffects(createConfig(), {
            maxInputLength: 4000,
            dailyBudgetUsd: 12.5,
        }, { cache, cooldown });

        expect(result.cacheCleared).toBe(false);
        expect(clearSpy).not.toHaveBeenCalled();
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

        const result = applyConfigUpdateEffects(currentConfig, {
            cooldownSeconds: currentConfig.cooldownSeconds,
            geminiModel: currentConfig.geminiModel,
        }, { cache, cooldown });

        expect(result.changedKeys).toEqual([]);
        expect(result.immediateEffects).toEqual([]);
        expect(clearSpy).not.toHaveBeenCalled();
        expect(cooldown.seconds).toBe(5);
    });
});
