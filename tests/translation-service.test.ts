import { describe, expect, it, vi } from 'vitest';
import { TranslationCache } from '../src/cache.js';
import { CooldownManager } from '../src/cooldown.js';
import { TranslationLog } from '../src/log.js';
import { createTranslationService, _test } from '../src/services/translation-service.js';
import type { BotStats, StoreData, TranslationResult } from '../src/types.js';

function createStoreMock(overrides: Partial<StoreData> = {}) {
    const data: StoreData = {
        vertexAiApiKey: 'test-key',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        geminiModel: 'gemini-2.5-flash-lite',
        allowedGuildIds: ['guild-1'],
        cooldownSeconds: 0,
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

    return {
        data,
        getRuntimeConfig() {
            return {
                vertexAiApiKey: data.vertexAiApiKey,
                gcpProject: data.gcpProject,
                gcpLocation: data.gcpLocation,
                geminiModel: data.geminiModel,
                allowedGuildIds: [...data.allowedGuildIds],
                cooldownSeconds: data.cooldownSeconds,
                cacheMaxSize: data.cacheMaxSize,
                setupComplete: data.setupComplete,
                inputPricePerMillion: data.inputPricePerMillion,
                outputPricePerMillion: data.outputPricePerMillion,
                dailyBudgetUsd: data.dailyBudgetUsd,
                translationPrompt: data.translationPrompt,
                maxInputLength: data.maxInputLength,
                maxOutputTokens: data.maxOutputTokens,
            };
        },
        isSetupComplete(): boolean {
            return data.setupComplete;
        },
    };
}

function createUserPreferenceStoreMock(overrides: Partial<StoreData> = {}) {
    const configStore = createStoreMock(overrides);
    return {
        getLanguage(userId: string): string | null {
            return configStore.data.userLanguagePrefs[userId] ?? null;
        },
    };
}

function createUsageMock() {
    return {
        isBudgetExceeded: vi.fn(() => false),
        record: vi.fn(),
    };
}

function createService({
    storeOverrides,
    translator = vi.fn(async (): Promise<TranslationResult> => ({
        text: 'こんにちは',
        inputTokens: 12,
        outputTokens: 6,
    })),
    usageTracker = createUsageMock(),
}: {
    storeOverrides?: Partial<StoreData>;
    translator?: ReturnType<typeof vi.fn>;
    usageTracker?: ReturnType<typeof createUsageMock>;
} = {}) {
    const cache = new TranslationCache(100);
    const cooldown = new CooldownManager(0);
    const log = new TranslationLog(100);
    const stats: BotStats = { totalTranslations: 0, apiCalls: 0 };
    const configStore = createStoreMock(storeOverrides);
    const userPreferenceStore = createUserPreferenceStoreMock(storeOverrides);

    const service = createTranslationService({
        cache,
        cooldown,
        log,
        stats,
        configStore,
        userPreferenceStore,
        usageTracker,
        translator,
    });

    return { service, cache, cooldown, log, stats, configStore, userPreferenceStore, usageTracker, translator };
}

describe('TranslationService', () => {
    it('should translate successfully and record usage through the shared service', async () => {
        const beforeTranslate = vi.fn(async () => undefined);
        const { service, usageTracker, translator, log, stats } = createService({
            storeOverrides: {
                userLanguagePrefs: { user1: 'ja' },
            },
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel (context menu)',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
            beforeTranslate,
        });

        expect(result.status).toBe('success');
        expect(result.status === 'success' ? result.targetLanguage : '').toBe('ja');
        expect(result.status === 'success' ? result.langSource : '').toBe('setlang');
        expect(beforeTranslate).toHaveBeenCalledTimes(1);
        expect(translator).toHaveBeenCalledWith('Hello world', 'ja');
        expect(usageTracker.record).toHaveBeenCalledWith(12, 6, 'guild-1');
        expect(log.size).toBe(1);
        expect(stats.totalTranslations).toBe(1);
        expect(stats.apiCalls).toBe(1);
    });

    it('should reuse the same cached translation for identical requests', async () => {
        const translator = vi.fn(async (): Promise<TranslationResult> => ({
            text: '안녕하세요',
            inputTokens: 20,
            outputTokens: 10,
        }));
        const { service } = createService({ translator });

        const first = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'ko',
            text: 'Hello world',
            targetLanguageOption: 'ko',
        });
        const second = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user2',
            userTag: 'user#0002',
            locale: 'ko',
            text: 'Hello world',
            targetLanguageOption: 'ko',
        });

        expect(first.status).toBe('success');
        expect(second.status).toBe('success');
        expect(second.status === 'success' ? second.cached : false).toBe(true);
        expect(translator).toHaveBeenCalledTimes(1);
    });

    it('should block requests when the guild budget is exceeded', async () => {
        const usageTracker = createUsageMock();
        usageTracker.isBudgetExceeded.mockReturnValue(true);
        const translator = vi.fn();
        const { service } = createService({ usageTracker, translator });

        const result = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
        });

        expect(result).toEqual({
            status: 'blocked',
            message: 'Daily budget exceeded',
        });
        expect(translator).not.toHaveBeenCalled();
    });

    it('should return a sanitized error result when translation fails', async () => {
        const translator = vi.fn(async () => {
            throw new Error('Vertex AI 500: https://example.com/projects/test-project/secret-token-value');
        });
        const { service, log } = createService({ translator });

        const result = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
            beforeTranslate: async () => undefined,
        });

        expect(result.status).toBe('error');
        expect(result.status === 'error' ? result.message : '').toContain('Translation failed');
        expect(result.status === 'error' ? result.message : '').not.toContain('https://example.com');
        expect(log.errorCount).toBe(1);
    });

    it('should block same-language translations before deferring', async () => {
        const beforeTranslate = vi.fn(async () => undefined);
        const { service } = createService({
            storeOverrides: {
                userLanguagePrefs: { user1: 'ja' },
            },
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel (context menu)',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'ja',
            text: 'こんにちは',
            beforeTranslate,
        });

        expect(result).toEqual({
            status: 'blocked',
            message: 'This message is already in your language!',
        });
        expect(beforeTranslate).not.toHaveBeenCalled();
    });
});

describe('resolveTargetLanguage', () => {
    const { resolveTargetLanguage } = _test;

    it('should prioritize explicit target option over preferences and locale', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePrefs: { user1: 'ja' },
        });

        expect(resolveTargetLanguage({
            userId: 'user1',
            locale: 'ko',
            targetLanguageOption: 'fr',
        }, preferenceStore)).toEqual({
            targetLanguage: 'fr',
            langSource: 'option',
        });
    });

    it('should fall back from user preference to locale and then auto', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePrefs: { user1: 'ja' },
        });

        expect(resolveTargetLanguage({
            userId: 'user1',
            locale: 'ko',
        }, preferenceStore)).toEqual({
            targetLanguage: 'ja',
            langSource: 'setlang',
        });
        expect(resolveTargetLanguage({
            userId: 'user2',
            locale: 'ko',
        }, preferenceStore)).toEqual({
            targetLanguage: 'ko',
            langSource: 'locale',
        });
        expect(resolveTargetLanguage({
            userId: 'user2',
            locale: 'en-US',
        }, preferenceStore)).toEqual({
            targetLanguage: 'auto',
            langSource: 'auto',
        });
    });
});
