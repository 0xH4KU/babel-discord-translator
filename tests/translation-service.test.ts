import { describe, expect, it, vi } from 'vitest';
import { AppMetrics } from '../src/app-metrics.js';
import { TranslationCache } from '../src/cache.js';
import { CooldownManager } from '../src/cooldown.js';
import { TranslationLog } from '../src/log.js';
import { createTranslationService, _test } from '../src/services/translation-service.js';
import { TranslationRuntimeLimiter } from '../src/translation-runtime-limiter.js';
import type { BotStats, StoreData, TranslationResult } from '../src/types.js';

function createStructuredLoggerMock(base: Record<string, unknown> = {}) {
    const entries: Array<Record<string, unknown>> = [];

    const build = (context: Record<string, unknown>) => ({
        info: vi.fn((event: string, fields: Record<string, unknown> = {}) => {
            entries.push({ level: 'info', event, ...context, ...fields });
        }),
        warn: vi.fn((event: string, fields: Record<string, unknown> = {}) => {
            entries.push({ level: 'warn', event, ...context, ...fields });
        }),
        error: vi.fn((event: string, fields: Record<string, unknown> = {}) => {
            entries.push({ level: 'error', event, ...context, ...fields });
        }),
        child(fields: Record<string, unknown> = {}) {
            return build({ ...context, ...fields });
        },
    });

    return {
        logger: build(base),
        entries,
    };
}

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
        getRuntimeConfig: vi.fn(() => ({
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
        })),
        isSetupComplete: vi.fn((): boolean => data.setupComplete),
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
    translator = vi.fn(
        async (): Promise<TranslationResult> => ({
            text: 'こんにちは',
            inputTokens: 12,
            outputTokens: 6,
        }),
    ),
    usageTracker = createUsageMock(),
    loggerState = createStructuredLoggerMock(),
    runtimeLimiter,
}: {
    storeOverrides?: Partial<StoreData>;
    translator?: ReturnType<typeof vi.fn>;
    usageTracker?: ReturnType<typeof createUsageMock>;
    loggerState?: ReturnType<typeof createStructuredLoggerMock>;
    runtimeLimiter?: TranslationRuntimeLimiter;
} = {}) {
    const cache = new TranslationCache(100);
    const cooldown = new CooldownManager(0);
    const log = new TranslationLog(100);
    const stats: BotStats = { totalTranslations: 0, apiCalls: 0 };
    const metrics = new AppMetrics();
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
        metrics,
        runtimeLimiter,
        logger: loggerState.logger as never,
    });

    return {
        service,
        cache,
        cooldown,
        log,
        stats,
        configStore,
        userPreferenceStore,
        usageTracker,
        translator,
        metrics,
        loggerState,
    };
}

describe('TranslationService', () => {
    it('should translate successfully and record usage through the shared service', async () => {
        const beforeTranslate = vi.fn(async () => undefined);
        const { service, usageTracker, translator, log, stats, metrics, loggerState } =
            createService({
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
            requestId: 'req-1',
            beforeTranslate,
        });

        expect(result.status).toBe('success');
        expect(result.status === 'success' ? result.targetLanguage : '').toBe('ja');
        expect(result.status === 'success' ? result.langSource : '').toBe('setlang');
        expect(beforeTranslate).toHaveBeenCalledTimes(1);
        expect(translator).toHaveBeenCalledWith('Hello world', 'ja', {
            logContext: {
                requestId: 'req-1',
                guildId: 'guild-1',
                userId: 'user1',
                command: 'babel',
            },
        });
        expect(usageTracker.record).toHaveBeenCalledWith(12, 6, 'guild-1');
        expect(log.size).toBe(1);
        expect(stats.totalTranslations).toBe(1);
        expect(stats.apiCalls).toBe(1);
        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 1,
            translationApiCallsTotal: 1,
            translationCacheHitsTotal: 0,
            translationFailuresTotal: 0,
        });
        expect(loggerState.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    level: 'info',
                    event: 'translation.request.started',
                    requestId: 'req-1',
                    guildId: 'guild-1',
                    userId: 'user1',
                    command: 'babel',
                }),
                expect.objectContaining({
                    level: 'info',
                    event: 'translation.request.completed',
                    requestId: 'req-1',
                    guildId: 'guild-1',
                    userId: 'user1',
                    command: 'babel',
                    cached: false,
                    targetLanguage: 'ja',
                }),
            ]),
        );
    });

    it('should read runtime config once per request', async () => {
        const { service, configStore } = createService({
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
            requestId: 'req-config-1',
        });

        expect(result.status).toBe('success');
        expect(configStore.getRuntimeConfig).toHaveBeenCalledOnce();
    });

    it('should reuse the same cached translation for identical requests', async () => {
        const translator = vi.fn(
            async (): Promise<TranslationResult> => ({
                text: '안녕하세요',
                inputTokens: 20,
                outputTokens: 10,
            }),
        );
        const { service, metrics } = createService({ translator });

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
        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
            translationCacheHitsTotal: 1,
            translationCacheHitRate: 0.5,
        });
    });

    it('should block requests when the guild budget is exceeded', async () => {
        const usageTracker = createUsageMock();
        usageTracker.isBudgetExceeded.mockReturnValue(true);
        const translator = vi.fn();
        const { service, metrics } = createService({ usageTracker, translator });

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
        expect(metrics.snapshot().budgetExceededTotal).toBe(1);
    });

    it('should return a sanitized error result when translation fails', async () => {
        const translator = vi.fn(async () => {
            throw new Error(
                'Vertex AI 500: https://example.com/projects/test-project/secret-token-value',
            );
        });
        const { service, log, metrics } = createService({ translator });

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
        expect(result.status === 'error' ? result.message : '').not.toContain(
            'https://example.com',
        );
        expect(log.errorCount).toBe(1);
        expect(metrics.snapshot()).toMatchObject({
            translationApiCallsTotal: 1,
            translationFailuresTotal: 1,
            translationFailureRate: 1,
        });
    });

    it('should shed load when the same user already has a runtime-limited translation in flight', async () => {
        let releaseTranslator!: () => void;
        const translator = vi.fn(async (): Promise<TranslationResult> => {
            await new Promise<void>((resolve) => {
                releaseTranslator = resolve;
            });

            return {
                text: 'hola',
                inputTokens: 8,
                outputTokens: 4,
            };
        });
        const runtimeLimiter = new TranslationRuntimeLimiter({
            maxConcurrent: 1,
            maxGlobalQueue: 1,
            maxGuildQueue: 1,
            maxUserOutstanding: 1,
        });
        const { service } = createService({ translator, runtimeLimiter });

        const first = service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
            targetLanguageOption: 'es',
            beforeTranslate: async () => undefined,
        });

        await Promise.resolve();

        const second = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Another message',
            targetLanguageOption: 'es',
        });

        expect(second).toEqual({
            status: 'blocked',
            message: 'You already have a translation in progress. Please wait a moment.',
        });

        releaseTranslator();
        await expect(first).resolves.toMatchObject({
            status: 'success',
        });
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
    const { resolveTargetLanguage, resolveQueueBusyMessage } = _test;

    it('should prioritize explicit target option over preferences and locale', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePrefs: { user1: 'ja' },
        });

        expect(
            resolveTargetLanguage(
                {
                    userId: 'user1',
                    locale: 'ko',
                    targetLanguageOption: 'fr',
                },
                preferenceStore,
            ),
        ).toEqual({
            targetLanguage: 'fr',
            langSource: 'option',
        });
    });

    it('should fall back from user preference to locale and then auto', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePrefs: { user1: 'ja' },
        });

        expect(
            resolveTargetLanguage(
                {
                    userId: 'user1',
                    locale: 'ko',
                },
                preferenceStore,
            ),
        ).toEqual({
            targetLanguage: 'ja',
            langSource: 'setlang',
        });
        expect(
            resolveTargetLanguage(
                {
                    userId: 'user2',
                    locale: 'ko',
                },
                preferenceStore,
            ),
        ).toEqual({
            targetLanguage: 'ko',
            langSource: 'locale',
        });
        expect(
            resolveTargetLanguage(
                {
                    userId: 'user2',
                    locale: 'en-US',
                },
                preferenceStore,
            ),
        ).toEqual({
            targetLanguage: 'auto',
            langSource: 'auto',
        });
    });

    it('should map runtime queue rejection reasons to user-facing messages', () => {
        expect(
            resolveQueueBusyMessage('user_queue_full', {
                userBusy: 'user',
                guildBusy: 'guild',
                serviceBusy: 'service',
            }),
        ).toBe('user');
        expect(
            resolveQueueBusyMessage('guild_queue_full', {
                userBusy: 'user',
                guildBusy: 'guild',
                serviceBusy: 'service',
            }),
        ).toBe('guild');
        expect(
            resolveQueueBusyMessage('global_queue_full', {
                userBusy: 'user',
                guildBusy: 'guild',
                serviceBusy: 'service',
            }),
        ).toBe('service');
    });
});
