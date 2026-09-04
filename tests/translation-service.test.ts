import { describe, expect, it, vi } from 'vitest';
import { AppMetrics } from '../src/shared/app-metrics.js';
import { TranslationCache } from '../src/modules/translation/cache.js';
import { CooldownManager } from '../src/modules/translation/cooldown.js';
import { ProviderOrchestratorError } from '../src/infra/provider-orchestrator.js';
import { TranslationLog } from '../src/shared/log.js';
import {
    createTranslationService,
    type TranslationServiceImageRequest,
    _test,
} from '../src/modules/translation/translation-service.js';
import { TranslationRuntimeLimiter } from '../src/modules/translation/translation-runtime-limiter.js';
import type { AccessMode } from '../src/apps/app-profile.js';
import type { ImageTranslationResult, StoreData, TranslationResult } from '../src/shared/types.js';

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

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createStoreMock(overrides: Partial<StoreData> = {}) {
    const data: StoreData = {
        vertexAiApiKey: 'test-key',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        geminiModel: 'gemini-2.5-flash-lite',
        vertexAiSupportsImages: false,
        geminiMediaResolution: 'default',
        visionApiKey: 'vision-key',
        allowedGuildIds: ['guild-1'],
        lensEnabledGuildIds: ['guild-1'],
        allowedUserIds: [],
        cooldownSeconds: 0,
        cacheMaxSize: 2000,
        setupComplete: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        dailyBudgetUsd: 0,
        visionMonthlyImageLimit: 900,
        defaultUserDailyBudgetUsd: 0,
        tokenUsage: null,
        usageHistory: [],
        translationPrompt: '',
        userLanguagePrefs: {},
        userLanguagePreferenceEntries: [],
        maxInputLength: 2000,
        maxOutputTokens: 1000,
        translationMaxConcurrent: 4,
        translationMaxGlobalQueue: 25,
        translationMaxGuildQueue: 5,
        translationMaxUserOutstanding: 1,
        translationMaxQueueWaitMs: 30000,
        openaiApiKey: '',
        openaiBaseUrl: '',
        openaiModel: '',
        openaiSupportsImages: false,
        translationProvider: 'vertex',
        guildBudgets: {},
        guildVisionLimits: {},
        guildTokenUsage: {},
        guildUsageHistory: {},
        userBudgets: {},
        userVisionLimits: {},
        userTokenUsage: {},
        userUsageHistory: {},
        ...overrides,
    };

    return {
        data,
        getRuntimeConfig: vi.fn(() => ({
            vertexAiApiKey: data.vertexAiApiKey,
            gcpProject: data.gcpProject,
            gcpLocation: data.gcpLocation,
            geminiModel: data.geminiModel,
            vertexAiSupportsImages: data.vertexAiSupportsImages,
            geminiMediaResolution: data.geminiMediaResolution,
            visionApiKey: data.visionApiKey,
            allowedGuildIds: [...data.allowedGuildIds],
            lensEnabledGuildIds: [...data.lensEnabledGuildIds],
            allowedUserIds: [...data.allowedUserIds],
            cooldownSeconds: data.cooldownSeconds,
            cacheMaxSize: data.cacheMaxSize,
            setupComplete: data.setupComplete,
            inputPricePerMillion: data.inputPricePerMillion,
            outputPricePerMillion: data.outputPricePerMillion,
            dailyBudgetUsd: data.dailyBudgetUsd,
            visionMonthlyImageLimit: data.visionMonthlyImageLimit,
            defaultUserDailyBudgetUsd: data.defaultUserDailyBudgetUsd,
            translationPrompt: data.translationPrompt,
            maxInputLength: data.maxInputLength,
            maxOutputTokens: data.maxOutputTokens,
            translationMaxConcurrent: data.translationMaxConcurrent,
            translationMaxGlobalQueue: data.translationMaxGlobalQueue,
            translationMaxGuildQueue: data.translationMaxGuildQueue,
            translationMaxUserOutstanding: data.translationMaxUserOutstanding,
            translationMaxQueueWaitMs: data.translationMaxQueueWaitMs,
            openaiApiKey: data.openaiApiKey,
            openaiBaseUrl: data.openaiBaseUrl,
            openaiModel: data.openaiModel,
            openaiSupportsImages: data.openaiSupportsImages,
            translationProvider: data.translationProvider,
        })),
        isSetupComplete: vi.fn((): boolean => data.setupComplete),
    };
}

function createUserPreferenceStoreMock(overrides: Partial<StoreData> = {}) {
    const configStore = createStoreMock(overrides);
    return {
        getUserLanguage(guildId: string, userId: string): string | null {
            return (
                (configStore.data.userLanguagePreferenceEntries ?? []).find(
                    (entry) => entry.guildId === guildId && entry.userId === userId,
                )?.language ?? null
            );
        },
    };
}

function createUsageMock() {
    const record = vi.fn();
    return {
        record,
        tryReserveBudget: vi.fn(
            ({ guildId, userId }: { guildId?: string | null; userId?: string | null }) => ({
                settle: vi.fn((inputTokens: number, outputTokens: number) =>
                    record(inputTokens, outputTokens, { guildId, userId }),
                ),
                release: vi.fn(),
            }),
        ),
    };
}

function createGlossaryRepositoryMock(
    entries: Record<
        string,
        Array<{
            id: number;
            guildId: string;
            sourceText: string;
            targetLanguage: string;
            targetText: string;
            notes: string;
            createdAt: string;
            updatedAt: string;
        }>
    > = {},
) {
    return {
        listGuildGlossary: vi.fn((guildId: string) => entries[guildId] ?? []),
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
    imageTranslator = vi.fn(
        async (): Promise<ImageTranslationResult> => ({
            text: '圖片翻譯',
            hasText: true,
            regions: [{ translation: '圖片翻譯', box_2d: [100, 100, 300, 900] }],
            route: 'direct',
            inputTokens: 120,
            outputTokens: 20,
        }),
    ),
    usageTracker = createUsageMock(),
    glossaryRepository = createGlossaryRepositoryMock(),
    loggerState = createStructuredLoggerMock(),
    runtimeLimiter,
    accessMode,
    pendingUserInstallOwnerRepository,
    enableGuildGlossary,
    appProfileId,
}: {
    storeOverrides?: Partial<StoreData>;
    translator?: ReturnType<typeof vi.fn>;
    imageTranslator?: ReturnType<typeof vi.fn>;
    usageTracker?: ReturnType<typeof createUsageMock>;
    glossaryRepository?: ReturnType<typeof createGlossaryRepositoryMock>;
    loggerState?: ReturnType<typeof createStructuredLoggerMock>;
    runtimeLimiter?: TranslationRuntimeLimiter;
    accessMode?: AccessMode;
    pendingUserInstallOwnerRepository?: { recordSeen: ReturnType<typeof vi.fn> };
    enableGuildGlossary?: boolean;
    appProfileId?: 'babel-guild' | 'babel-pocket';
} = {}) {
    const cache = new TranslationCache(100);
    const cooldown = new CooldownManager(0);
    const log = new TranslationLog(100);
    const metrics = new AppMetrics();
    const configStore = createStoreMock(storeOverrides);
    const userPreferenceStore = createUserPreferenceStoreMock(storeOverrides);

    const service = createTranslationService({
        cache,
        cooldown,
        log,
        configStore,
        userPreferenceStore,
        usageTracker,
        glossaryRepository,
        translator,
        imageTranslator,
        metrics,
        runtimeLimiter,
        appProfileId,
        accessMode,
        enableGuildGlossary,
        pendingUserInstallOwnerRepository,
        logger: loggerState.logger as never,
    });

    return {
        service,
        cache,
        cooldown,
        log,
        configStore,
        userPreferenceStore,
        usageTracker,
        glossaryRepository,
        translator,
        imageTranslator,
        metrics,
        loggerState,
    };
}

function createImageRequest(
    overrides: Partial<TranslationServiceImageRequest> = {},
): TranslationServiceImageRequest {
    return {
        command: 'babel',
        commandLabel: 'Babel Lens (context menu)',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        userId: 'user1',
        userTag: 'user#0001',
        locale: 'zh-TW',
        requestId: 'lens-request',
        resolveImage: vi.fn(async () => ({
            image: Buffer.from('normalized-image'),
            mimeType: 'image/png',
            width: 100,
            height: 50,
            hash: 'image-hash',
        })),
        resolveVision: vi.fn(async () => ({
            text: 'Text from image',
            imageWidth: 100,
            imageHeight: 50,
            regions: [{ text: 'Text from image', x: 10, y: 5, width: 80, height: 20 }],
        })),
        ...overrides,
    };
}

describe('TranslationService', () => {
    it('should reserve image budget, settle actual direct usage, and cache the result', async () => {
        const resolveVision = vi.fn(async () => {
            throw new Error('Vision must not run for a direct route');
        });
        const { service, imageTranslator, usageTracker } = createService({
            storeOverrides: { visionMonthlyImageLimit: 0, vertexAiSupportsImages: true },
        });

        const first = await service.processImage(createImageRequest({ resolveVision }));
        const second = await service.processImage(
            createImageRequest({ userId: 'user2', requestId: 'lens-request-2', resolveVision }),
        );

        expect(first).toMatchObject({
            status: 'success',
            route: 'direct',
            cached: false,
            inputTokens: 120,
            outputTokens: 20,
        });
        expect(second).toMatchObject({ status: 'success', cached: true, inputTokens: 0 });
        expect(usageTracker.tryReserveBudget).toHaveBeenCalledOnce();
        expect(usageTracker.tryReserveBudget).toHaveBeenCalledWith({
            estimatedInputTokens: 4096,
            estimatedOutputTokens: 1000,
            guildId: 'guild-1',
            userId: null,
        });
        expect(usageTracker.record).toHaveBeenCalledWith(120, 20, {
            guildId: 'guild-1',
            userId: null,
        });
        expect(imageTranslator).toHaveBeenCalledOnce();
        expect(resolveVision).not.toHaveBeenCalled();
    });

    it('should block on translation budget before resolving Vision', async () => {
        const usageTracker = createUsageMock();
        usageTracker.tryReserveBudget.mockReturnValueOnce(null as never);
        const resolveVision = vi.fn();
        const { service, imageTranslator } = createService({ usageTracker });

        const result = await service.processImage(createImageRequest({ resolveVision }));

        expect(result.status).toBe('blocked');
        expect(imageTranslator).not.toHaveBeenCalled();
        expect(resolveVision).not.toHaveBeenCalled();
    });

    it('should release model budget when Vision finds no text', async () => {
        const usageTracker = createUsageMock();
        const imageTranslator = vi.fn(async (_image, _mime, _target, resolveVision) => {
            expect(await resolveVision()).toEqual({ hasText: false });
            return {
                text: '',
                hasText: false,
                regions: [],
                route: 'vision' as const,
                inputTokens: 0,
                outputTokens: 0,
            };
        });
        const { service } = createService({ usageTracker, imageTranslator });

        const result = await service.processImage(
            createImageRequest({
                resolveVision: vi.fn(async () => ({
                    text: '',
                    imageWidth: 100,
                    imageHeight: 50,
                    regions: [],
                })),
            }),
        );

        expect(result).toMatchObject({ status: 'success', hasText: false, route: 'vision' });
        const reservation = usageTracker.tryReserveBudget.mock.results[0]?.value;
        expect(reservation.release).toHaveBeenCalledOnce();
        expect(reservation.settle).not.toHaveBeenCalled();
        expect(usageTracker.record).not.toHaveBeenCalled();
    });

    it('should give Vision the normalized image, marker prompt, and normalized boxes once', async () => {
        const resolveVision = vi.fn(async (image: Buffer) => {
            expect(image).toEqual(Buffer.from('normalized-image'));
            return {
                text: 'Text from image',
                imageWidth: 100,
                imageHeight: 50,
                regions: [{ text: 'Text from image', x: 10, y: 5, width: 80, height: 20 }],
            };
        });
        const imageTranslator = vi.fn(async (_image, _mime, _target, resolve) => {
            const vision = await resolve();
            expect(vision.prompt?.user).toBe('[[BABEL_REGION_1]] Text from image');
            expect(vision.boxes).toEqual([[100, 100, 500, 900]]);
            return {
                text: '[1] 圖片翻譯',
                hasText: true,
                regions: [{ translation: '圖片翻譯', box_2d: vision.boxes![0]! }],
                route: 'vision' as const,
                inputTokens: 20,
                outputTokens: 5,
            };
        });
        const { service } = createService({ imageTranslator });

        await service.processImage(createImageRequest({ resolveVision }));
        await service.processImage(
            createImageRequest({ userId: 'user2', requestId: 'lens-request-2', resolveVision }),
        );

        expect(resolveVision).toHaveBeenCalledOnce();
        expect(imageTranslator).toHaveBeenCalledOnce();
    });

    it('should settle tokens for a direct no-text result', async () => {
        const imageTranslator = vi.fn(async () => ({
            text: '',
            hasText: false,
            regions: [],
            route: 'direct' as const,
            inputTokens: 80,
            outputTokens: 4,
        }));
        const { service, usageTracker } = createService({ imageTranslator });

        const result = await service.processImage(createImageRequest());

        expect(result).toMatchObject({ status: 'success', hasText: false, route: 'direct' });
        expect(usageTracker.record).toHaveBeenCalledWith(80, 4, {
            guildId: 'guild-1',
            userId: null,
        });
    });

    it('should settle billed token usage when image translation fails', async () => {
        const imageTranslator = vi.fn(async () => {
            throw new ProviderOrchestratorError('Invalid Babel Lens JSON response', {
                provider: 'vertex',
                errorType: 'unknown',
                inputTokens: 90,
                outputTokens: 12,
            });
        });
        const { service, usageTracker, metrics } = createService({ imageTranslator });

        const result = await service.processImage(createImageRequest());

        expect(result.status).toBe('error');
        expect(usageTracker.record).toHaveBeenCalledWith(90, 12, {
            guildId: 'guild-1',
            userId: null,
        });
        const reservation = usageTracker.tryReserveBudget.mock.results[0]?.value;
        expect(reservation.release).not.toHaveBeenCalled();
        expect(metrics.snapshot().translationApiCallsTotal).toBe(1);
    });

    it('should not cache fallback image results', async () => {
        const imageTranslator = vi.fn(
            async (): Promise<ImageTranslationResult> => ({
                text: 'fallback translation',
                hasText: true,
                regions: [],
                route: 'direct',
                provider: 'openai',
                fallback: true,
                inputTokens: 20,
                outputTokens: 5,
            }),
        );
        const { service } = createService({ imageTranslator });

        const first = await service.processImage(createImageRequest());
        const second = await service.processImage(
            createImageRequest({ userId: 'user2', requestId: 'lens-request-2' }),
        );

        expect(first).toMatchObject({ status: 'success', cached: false, fallback: true });
        expect(second).toMatchObject({ status: 'success', cached: false, fallback: true });
        expect(imageTranslator).toHaveBeenCalledTimes(2);
    });

    it('should not cache fallback text results', async () => {
        const translator = vi.fn(
            async (): Promise<TranslationResult> => ({
                text: 'fallback translation',
                provider: 'openai',
                fallback: true,
                inputTokens: 8,
                outputTokens: 3,
            }),
        );
        const { service } = createService({ translator });
        const request = {
            command: 'translate' as const,
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            text: 'Hello',
            targetLanguageOption: 'ja',
        };

        const first = await service.process(request);
        const second = await service.process({
            ...request,
            userId: 'user2',
            userTag: 'user#0002',
        });

        expect(first).toMatchObject({ status: 'success', cached: false, fallback: true });
        expect(second).toMatchObject({ status: 'success', cached: false, fallback: true });
        expect(translator).toHaveBeenCalledTimes(2);
    });

    it('should translate successfully and record usage through the shared service', async () => {
        const beforeTranslate = vi.fn(async () => undefined);
        const { service, usageTracker, translator, log, metrics, loggerState } = createService({
            storeOverrides: {
                userLanguagePreferenceEntries: [
                    { guildId: 'guild-1', userId: 'user1', language: 'ja' },
                ],
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
        expect(result.status === 'success' ? result.inputTokens : 0).toBe(12);
        expect(result.status === 'success' ? result.outputTokens : 0).toBe(6);
        expect(beforeTranslate).toHaveBeenCalledTimes(1);
        expect(translator).toHaveBeenCalledWith(
            'Hello world',
            'ja',
            expect.objectContaining({
                logContext: {
                    requestId: 'req-1',
                    guildId: 'guild-1',
                    userId: 'user1',
                    command: 'babel',
                },
            }),
        );
        const translatorOptions = translator.mock.calls[0]?.[2];
        expect(Object.keys(translatorOptions ?? {})).toEqual(
            expect.arrayContaining(['logContext', 'metrics']),
        );
        expect(Object.prototype.propertyIsEnumerable.call(translatorOptions, 'metrics')).toBe(true);
        expect(translatorOptions?.metrics).toBe(metrics);
        expect(translatorOptions?.runtimeConfig).toMatchObject({
            geminiModel: 'gemini-2.5-flash-lite',
            maxOutputTokens: 1000,
        });
        expect(usageTracker.record).toHaveBeenCalledWith(12, 6, {
            guildId: 'guild-1',
            userId: null,
        });
        expect(log.size).toBe(1);
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

    it('should resolve Lens text after access checks and defer only once', async () => {
        const resolveText = vi.fn(async () => 'Text from image');
        const beforeTranslate = vi.fn(async () => undefined);
        const { service, translator, log, loggerState } = createService();

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            preserveNumberedMarkers: true,
            resolveText,
            beforeTranslate,
        });

        expect(result.status).toBe('success');
        expect(resolveText).toHaveBeenCalledOnce();
        expect(beforeTranslate).toHaveBeenCalledOnce();
        expect(translator).toHaveBeenCalledWith(
            'Text from image',
            expect.any(String),
            expect.objectContaining({ preserveNumberedMarkers: true }),
        );
        expect(log.getRecent(1)[0]).toMatchObject({
            type: 'translation',
            command: 'Babel Lens (context menu)',
        });
        expect(loggerState.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    event: 'translation.request.completed',
                    commandLabel: 'Babel Lens (context menu)',
                }),
            ]),
        );

        const blockedResolver = vi.fn(async () => 'should not run');
        const { service: blockedService } = createService({
            storeOverrides: { allowedGuildIds: [] },
        });
        await blockedService.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            resolveText: blockedResolver,
        });
        expect(blockedResolver).not.toHaveBeenCalled();

        const { service: failedService, log: failedLog } = createService();
        const failedResult = await failedService.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            requestId: 'req-lens-ocr-failed',
            resolveText: async () => {
                throw new Error('Cloud Vision request failed (500)');
            },
        });
        expect(failedResult.status).toBe('error');
        expect(failedLog.getRecent(1)[0]).toMatchObject({
            type: 'error',
            command: 'Babel Lens (context menu)',
            requestId: 'req-lens-ocr-failed',
            errorType: 'server_error',
        });
    });

    it('should preserve deferred state when Lens translation is blocked after OCR', async () => {
        const beforeTranslate = vi.fn(async () => undefined);
        const usageTracker = createUsageMock();
        usageTracker.tryReserveBudget.mockReturnValueOnce(null as never);
        const { service } = createService({ usageTracker });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            resolveText: async () => 'Text from image',
            beforeTranslate,
        });

        expect(beforeTranslate).toHaveBeenCalledOnce();
        expect(result).toEqual({
            status: 'blocked',
            message: 'Daily budget exceeded, try again tomorrow!',
            deferred: true,
        });
    });

    it('should preserve deferred state when Lens translation cannot re-enter the runtime', async () => {
        const run = vi.fn(async (task) =>
            task({
                queued: false,
                waitMs: 0,
                snapshot: {},
            }),
        );
        const runtimeLimiter = {
            acquire: vi
                .fn()
                .mockReturnValueOnce({
                    accepted: true,
                    reservation: { queued: false, run, cancel: vi.fn() },
                })
                .mockReturnValueOnce({
                    accepted: false,
                    reason: 'global_queue_full',
                    snapshot: {},
                }),
            snapshot: vi.fn(() => ({})),
        };
        const { service } = createService({ runtimeLimiter: runtimeLimiter as never });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            resolveText: async () => 'Text from image',
            beforeTranslate: async () => undefined,
        });

        expect(result).toEqual({
            status: 'blocked',
            message: 'Translation service is busy right now. Please try again in a moment.',
            deferred: true,
        });
    });

    it('should keep Lens translations separate from the plain translation cache', async () => {
        const { service, translator } = createService();
        const request = {
            command: 'babel' as const,
            guildId: 'guild-1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: '[1] Hello',
        };

        const plain = await service.process({
            ...request,
            commandLabel: 'Babel (context menu)',
            userId: 'user1',
        });
        const lens = await service.process({
            ...request,
            commandLabel: 'Babel Lens (context menu)',
            userId: 'user2',
            preserveNumberedMarkers: true,
        });

        expect(plain.status).toBe('success');
        expect(lens.status).toBe('success');
        expect(translator).toHaveBeenCalledTimes(2);
        expect(translator.mock.calls[0]?.[2]).toMatchObject({
            preserveNumberedMarkers: false,
        });
        expect(translator.mock.calls[1]?.[2]).toMatchObject({
            preserveNumberedMarkers: true,
        });
    });

    it('should reserve runtime capacity before resolving Lens text', async () => {
        const pending = deferred<void>();
        const firstResolver = vi.fn(async () => {
            await pending.promise;
            return 'Text from first image';
        });
        const secondResolver = vi.fn(async () => 'Text from second image');
        const runtimeLimiter = new TranslationRuntimeLimiter({
            maxConcurrent: 1,
            maxGlobalQueue: 1,
            maxGuildQueue: 1,
            maxUserOutstanding: 1,
        });
        const { service } = createService({ runtimeLimiter });

        const first = service.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            resolveText: firstResolver,
            beforeTranslate: async () => undefined,
        });
        await vi.waitFor(() => expect(firstResolver).toHaveBeenCalledOnce());

        const second = await service.process({
            command: 'babel',
            commandLabel: 'Babel Lens (context menu)',
            guildId: 'guild-1',
            userId: 'user1',
            userTag: 'user#0001',
            resolveText: secondResolver,
        });

        expect(second).toEqual({
            status: 'blocked',
            message: 'You already have a translation in progress. Please wait a moment.',
        });
        expect(secondResolver).not.toHaveBeenCalled();

        pending.resolve();
        await expect(first).resolves.toMatchObject({ status: 'success' });
    });

    it('should read runtime config once per request', async () => {
        const { service, configStore } = createService({
            storeOverrides: {
                userLanguagePreferenceEntries: [
                    { guildId: 'guild-1', userId: 'user1', language: 'ja' },
                ],
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

    it('should tag successful translation logs with the app profile id', async () => {
        const { service, log } = createService({
            appProfileId: 'babel-pocket',
            accessMode: 'user-install',
            storeOverrides: {
                allowedUserIds: ['user1'],
            },
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: null,
            guildName: 'Direct Message',
            userId: 'user1',
            userTag: 'user#0001',
            text: 'Hello world',
            requestId: 'req-pocket-log',
        });

        expect(result.status).toBe('success');
        expect(log.getRecent(1)[0]).toMatchObject({
            type: 'translation',
            appProfileId: 'babel-pocket',
            contentPreview: 'Hello world',
        });
    });

    it('should record translation metrics into the selected app profile bucket', async () => {
        const { service, metrics } = createService({
            appProfileId: 'babel-pocket',
            accessMode: 'user-install',
            enableGuildGlossary: false,
            storeOverrides: {
                allowedUserIds: ['user1'],
                userLanguagePreferenceEntries: [{ guildId: '', userId: 'user1', language: 'ja' }],
            },
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket',
            guildId: null,
            guildName: 'Direct Message',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
        });

        expect(result.status).toBe('success');
        expect(metrics.snapshot({ appProfileId: 'babel-guild' })).toMatchObject({
            translationsTotal: 0,
            translationApiCallsTotal: 0,
        });
        expect(metrics.snapshot({ appProfileId: 'babel-pocket' })).toMatchObject({
            translationsTotal: 1,
            translationApiCallsTotal: 1,
            translationFailuresTotal: 0,
        });
        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 1,
            translationApiCallsTotal: 1,
        });
    });

    it('should use global user preferences for Babel Pocket translations', async () => {
        const { service } = createService({
            accessMode: 'user-install',
            storeOverrides: {
                allowedUserIds: ['user1'],
                userLanguagePreferenceEntries: [
                    { guildId: '', userId: 'user1', language: 'ko' },
                    { guildId: 'guild-1', userId: 'user1', language: 'ja' },
                ],
            },
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: 'guild-1',
            guildName: 'Shared Friend Server',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
            requestId: 'req-pocket-pref',
        });

        expect(result.status).toBe('success');
        expect(result.status === 'success' ? result.targetLanguage : '').toBe('ko');
        expect(result.status === 'success' ? result.langSource : '').toBe('setlang');
    });

    it('should reuse the same cached translation for identical requests', async () => {
        const translator = vi.fn(
            async (): Promise<TranslationResult> => ({
                text: '안녕하세요',
                inputTokens: 20,
                outputTokens: 10,
            }),
        );
        const { service, metrics, usageTracker } = createService({ translator });

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
        usageTracker.tryReserveBudget.mockClear();
        usageTracker.tryReserveBudget.mockReturnValue(null);
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
        expect(usageTracker.tryReserveBudget).not.toHaveBeenCalled();
        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
            translationCacheHitsTotal: 1,
            translationCacheHitRate: 0.5,
        });
    });

    it('should join an in-flight translation for identical concurrent requests', async () => {
        const gate = deferred<TranslationResult>();
        const translator = vi.fn(() => gate.promise);
        const { service, usageTracker, metrics } = createService({ translator });

        const first = service.process({
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
        const second = service.process({
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

        await Promise.resolve();
        expect(translator).toHaveBeenCalledTimes(1);

        gate.resolve({
            text: '안녕하세요',
            inputTokens: 20,
            outputTokens: 10,
        });

        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult.status).toBe('success');
        expect(secondResult.status).toBe('success');
        expect(secondResult.status === 'success' ? secondResult.cached : false).toBe(true);
        expect(usageTracker.tryReserveBudget).toHaveBeenCalledTimes(1);
        expect(usageTracker.record).toHaveBeenCalledTimes(1);
        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
        });
    });

    it('should join in-flight translations while the leader is awaiting beforeTranslate', async () => {
        const deferGate = deferred<void>();
        const providerGate = deferred<TranslationResult>();
        const translator = vi.fn(() => providerGate.promise);
        const beforeTranslate = vi.fn(() => deferGate.promise);
        const { service, usageTracker, metrics } = createService({ translator });

        const first = service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'ko',
            text: 'Hello world',
            targetLanguageOption: 'ko',
            beforeTranslate,
        });

        await Promise.resolve();

        const second = service.process({
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

        await Promise.resolve();
        expect(translator).not.toHaveBeenCalled();

        deferGate.resolve();
        await Promise.resolve();
        expect(translator).toHaveBeenCalledTimes(1);

        providerGate.resolve({
            text: '안녕하세요',
            inputTokens: 20,
            outputTokens: 10,
        });

        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult.status).toBe('success');
        expect(secondResult.status).toBe('success');
        expect(firstResult.status === 'success' ? firstResult.deferred : false).toBe(true);
        expect(secondResult.status === 'success' ? secondResult.cached : false).toBe(true);
        expect(beforeTranslate).toHaveBeenCalledTimes(1);
        expect(usageTracker.record).toHaveBeenCalledTimes(1);
        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
        });
    });

    it('should clear failed in-flight translations so a later retry can call the provider', async () => {
        const translator = vi
            .fn()
            .mockRejectedValueOnce(new Error('provider timeout'))
            .mockResolvedValueOnce({
                text: '再試行成功',
                inputTokens: 18,
                outputTokens: 9,
            });
        const { service } = createService({ translator });
        const request = {
            command: 'translate' as const,
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'ja',
            text: 'Hello retry',
            targetLanguageOption: 'ja',
        };

        const failed = await service.process(request);
        const retried = await service.process({
            ...request,
            userId: 'user2',
            userTag: 'user#0002',
        });

        expect(failed.status).toBe('error');
        expect(retried.status).toBe('success');
        expect(translator).toHaveBeenCalledTimes(2);
    });

    it('should not join in-flight translations for different cache keys', async () => {
        const gate = deferred<TranslationResult>();
        const translator = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce({
            text: '違う翻訳',
            inputTokens: 22,
            outputTokens: 11,
        });
        const { service } = createService({ translator });

        const first = service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'ja',
            text: 'Hello world',
            targetLanguageOption: 'ja',
        });
        const second = service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user2',
            userTag: 'user#0002',
            locale: 'zh-TW',
            text: 'Hello world',
            targetLanguageOption: 'zh-TW',
        });

        await Promise.resolve();
        expect(translator).toHaveBeenCalledTimes(2);

        gate.resolve({
            text: 'こんにちは',
            inputTokens: 20,
            outputTokens: 10,
        });

        await expect(first).resolves.toMatchObject({ status: 'success' });
        await expect(second).resolves.toMatchObject({ status: 'success' });
    });

    it('should separate cached translations by provider connection fingerprint', async () => {
        const translator = vi
            .fn()
            .mockResolvedValueOnce({
                text: 'first model translation',
                inputTokens: 20,
                outputTokens: 10,
            })
            .mockResolvedValueOnce({
                text: 'second model translation',
                inputTokens: 22,
                outputTokens: 11,
            });
        const { service, configStore } = createService({
            translator,
            storeOverrides: {
                translationProvider: 'openai',
                openaiBaseUrl: 'https://openai.example',
                openaiModel: 'gpt-first',
            },
        });

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
        configStore.data.openaiModel = 'gpt-second';
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
        expect(second.status === 'success' ? second.cached : true).toBe(false);
        expect(translator).toHaveBeenCalledTimes(2);
    });

    it('should include per-guild glossary entries in translator options and cache keys', async () => {
        const translator = vi
            .fn()
            .mockResolvedValueOnce({
                text: 'Keep OpenAI and translate raid as 團本',
                inputTokens: 20,
                outputTokens: 10,
            })
            .mockResolvedValueOnce({
                text: 'Keep OpenAI and translate raid as レイド',
                inputTokens: 22,
                outputTokens: 11,
            });
        const glossaryRepository = createGlossaryRepositoryMock({
            'guild-1': [
                {
                    id: 1,
                    guildId: 'guild-1',
                    sourceText: 'OpenAI',
                    targetLanguage: 'auto',
                    targetText: 'OpenAI',
                    notes: 'Preserve brand name',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-01T00:00:00.000Z',
                },
                {
                    id: 2,
                    guildId: 'guild-1',
                    sourceText: 'raid',
                    targetLanguage: 'auto',
                    targetText: 'legacy raid',
                    notes: 'Legacy term',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-01T00:00:00.000Z',
                },
                {
                    id: 3,
                    guildId: 'guild-1',
                    sourceText: 'raid',
                    targetLanguage: 'zh-TW',
                    targetText: '團本',
                    notes: '',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-01T00:00:00.000Z',
                },
            ],
        });
        const { service } = createService({ translator, glossaryRepository });

        const first = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'zh-TW',
            text: 'OpenAI raid tonight',
            targetLanguageOption: 'zh-TW',
        });
        const second = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user2',
            userTag: 'user#0002',
            locale: 'zh-TW',
            text: 'OpenAI raid tonight',
            targetLanguageOption: 'zh-TW',
        });

        glossaryRepository.listGuildGlossary.mockReturnValueOnce([
            {
                id: 1,
                guildId: 'guild-1',
                sourceText: 'OpenAI',
                targetLanguage: 'auto',
                targetText: 'OpenAI',
                notes: 'Preserve brand name',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            },
            {
                id: 2,
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'auto',
                targetText: 'legacy raid',
                notes: 'Legacy term',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            },
            {
                id: 3,
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'ja',
                targetText: 'レイド',
                notes: '',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:10:00.000Z',
            },
        ]);

        const third = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user3',
            userTag: 'user#0003',
            locale: 'en-US',
            text: 'OpenAI raid tonight',
            targetLanguageOption: 'ja',
        });

        expect(first.status).toBe('success');
        expect(second.status).toBe('success');
        expect(third.status).toBe('success');
        expect(second.status === 'success' ? second.cached : false).toBe(true);
        expect(third.status === 'success' ? third.cached : true).toBe(false);
        expect(translator).toHaveBeenCalledTimes(2);
        expect(translator.mock.calls[0]?.[2]).toMatchObject({
            glossaryEntries: [
                { sourceText: 'raid', targetLanguage: 'zh-TW', targetText: '團本', notes: '' },
                {
                    sourceText: 'OpenAI',
                    targetLanguage: 'auto',
                    targetText: 'OpenAI',
                    notes: 'Preserve brand name',
                },
            ],
        });
        expect(translator.mock.calls[1]?.[2]).toMatchObject({
            glossaryEntries: [
                { sourceText: 'raid', targetLanguage: 'ja', targetText: 'レイド', notes: '' },
                {
                    sourceText: 'OpenAI',
                    targetLanguage: 'auto',
                    targetText: 'OpenAI',
                    notes: 'Preserve brand name',
                },
            ],
        });
    });

    it('should ignore guild glossary entries when guild glossary is disabled', async () => {
        const translator = vi.fn(
            async (): Promise<TranslationResult> => ({
                text: 'こんにちは',
                inputTokens: 12,
                outputTokens: 6,
            }),
        );
        const glossaryRepository = createGlossaryRepositoryMock({
            'guild-1': [
                {
                    id: 1,
                    guildId: 'guild-1',
                    sourceText: 'OpenAI',
                    targetLanguage: 'auto',
                    targetText: 'OpenAI',
                    notes: 'Preserve brand name',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-01T00:00:00.000Z',
                },
            ],
        });
        const { service } = createService({
            storeOverrides: {
                allowedGuildIds: [],
                allowedUserIds: ['user-owner'],
                userLanguagePrefs: { 'user-owner': 'ja' },
            },
            translator,
            glossaryRepository,
            accessMode: 'user-install',
            enableGuildGlossary: false,
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'actor',
            billingUserId: 'user-owner',
            userTag: 'actor#0001',
            locale: 'en-US',
            text: 'Hello OpenAI',
        });

        expect(result.status).toBe('success');
        expect(glossaryRepository.listGuildGlossary).not.toHaveBeenCalled();
        expect(translator.mock.calls[0]?.[2]).not.toHaveProperty('glossaryEntries');
    });

    it('should block requests when the guild budget is exceeded', async () => {
        const usageTracker = createUsageMock();
        usageTracker.tryReserveBudget.mockReturnValue(null);
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

    it('should release reserved budget when the provider fails', async () => {
        const usageTracker = createUsageMock();
        const translator = vi.fn(async () => {
            throw new Error('provider unavailable');
        });
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

        const reservation = usageTracker.tryReserveBudget.mock.results[0]?.value;
        expect(result.status).toBe('error');
        expect(reservation?.release).toHaveBeenCalledOnce();
        expect(usageTracker.record).not.toHaveBeenCalled();
    });

    it('should allow whitelisted user-install owners without a guild id', async () => {
        const { service, usageTracker } = createService({
            storeOverrides: {
                allowedGuildIds: [],
                allowedUserIds: ['user-owner'],
                userLanguagePrefs: { 'user-owner': 'ja' },
            },
            accessMode: 'user-install',
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: null,
            userId: 'user-owner',
            billingUserId: 'user-owner',
            userTag: 'owner#0001',
            locale: 'en-US',
            text: 'Hello',
        });

        expect(result.status).toBe('success');
        expect(usageTracker.record).toHaveBeenCalledWith(12, 6, {
            guildId: null,
            userId: 'user-owner',
        });
    });

    it('should keep user-install usage out of guild usage buckets when invoked in a guild', async () => {
        const { service, usageTracker } = createService({
            storeOverrides: {
                allowedGuildIds: [],
                allowedUserIds: ['user-owner'],
                userLanguagePrefs: { 'user-owner': 'ja' },
            },
            accessMode: 'user-install',
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: 'guild-1',
            guildName: 'Guild One',
            userId: 'actor',
            billingUserId: 'user-owner',
            userTag: 'actor#0001',
            locale: 'en-US',
            text: 'Hello',
        });

        expect(result.status).toBe('success');
        expect(usageTracker.record).toHaveBeenCalledWith(12, 6, {
            guildId: null,
            userId: 'user-owner',
        });
    });

    it('should bill the actor user when a user-install request has no explicit billing owner', async () => {
        const { service, usageTracker } = createService({
            storeOverrides: {
                allowedGuildIds: [],
                allowedUserIds: ['actor'],
                userLanguagePrefs: { actor: 'ja' },
            },
            accessMode: 'user-install',
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: null,
            userId: 'actor',
            userTag: 'actor#0001',
            locale: 'en-US',
            text: 'Hello',
        });

        expect(result.status).toBe('success');
        expect(usageTracker.record).toHaveBeenCalledWith(12, 6, {
            guildId: null,
            userId: 'actor',
        });
    });

    it('records unauthorized user-install owners as pending access users', async () => {
        const pendingUserInstallOwnerRepository = {
            recordSeen: vi.fn(),
        };
        const { service } = createService({
            storeOverrides: {
                allowedGuildIds: [],
                allowedUserIds: ['user-allowed'],
            },
            accessMode: 'user-install',
            pendingUserInstallOwnerRepository,
        });

        const result = await service.process({
            command: 'babel',
            commandLabel: 'Babel Pocket (context menu)',
            guildId: null,
            userId: 'interaction-user',
            billingUserId: 'install-owner',
            userTag: 'actor#0001',
            locale: 'en-US',
            text: 'Hello',
        });

        expect(result).toEqual({
            status: 'blocked',
            message: 'This user is not authorized.',
        });
        expect(pendingUserInstallOwnerRepository.recordSeen).toHaveBeenCalledWith('install-owner');
    });

    it('should return a sanitized error result and diagnostic log when translation fails', async () => {
        const translator = vi.fn(async () => {
            throw new Error(
                'Vertex AI 429 rate limit: https://example.com/projects/test-project/secret-token-value',
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
            requestId: 'req-failure-1',
            beforeTranslate: async () => undefined,
        });

        expect(result.status).toBe('error');
        expect(result.status === 'error' ? result.message : '').toContain('Translation failed');
        expect(result.status === 'error' ? result.message : '').not.toContain(
            'https://example.com',
        );
        expect(log.errorCount).toBe(1);
        const errorEntry = log.getRecent(1)[0];
        expect(errorEntry).toMatchObject({
            type: 'error',
            requestId: 'req-failure-1',
            errorType: 'rate_limit',
            suggestedAction:
                'Provider rate limit reached. Try fallback mode or reduce concurrency.',
        });
        expect(errorEntry.type === 'error' ? errorEntry.error : '').not.toContain(
            'https://example.com',
        );
        expect(errorEntry.type === 'error' ? errorEntry.error : '').not.toContain(
            'secret-token-value',
        );
        expect(metrics.snapshot()).toMatchObject({
            translationApiCallsTotal: 1,
            translationFailuresTotal: 1,
            translationFailureRate: 1,
        });
    });

    it('should record provider diagnostics from orchestrator failures', async () => {
        const translator = vi.fn(async () => {
            throw new ProviderOrchestratorError('OpenAI 500 server error', {
                provider: 'openai',
                errorType: 'server_error',
            });
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
            requestId: 'req-provider-failure-1',
            beforeTranslate: async () => undefined,
        });

        const errorEntry = log.getRecent(1)[0];

        expect(result.status).toBe('error');
        expect(errorEntry).toMatchObject({
            type: 'error',
            requestId: 'req-provider-failure-1',
            provider: 'openai',
            errorType: 'server_error',
        });
    });

    it('should tag error logs with the app profile id', async () => {
        const translator = vi.fn(async () => {
            throw new Error('OpenAI 429 rate limit');
        });
        const { service, log } = createService({
            translator,
            appProfileId: 'babel-guild',
        });

        const result = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: 'en-US',
            text: 'Hello world',
            requestId: 'req-guild-error-log',
            beforeTranslate: async () => undefined,
        });

        expect(result.status).toBe('error');
        expect(log.getRecent(1)[0]).toMatchObject({
            type: 'error',
            appProfileId: 'babel-guild',
            requestId: 'req-guild-error-log',
            errorType: 'rate_limit',
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

    it('should count one cache miss for an immediately admitted translation', async () => {
        const runtimeLimiter = new TranslationRuntimeLimiter({
            maxConcurrent: 1,
            maxGlobalQueue: 1,
            maxGuildQueue: 1,
            maxUserOutstanding: 1,
        });
        const { service, cache } = createService({ runtimeLimiter });

        const result = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            text: 'Hello world',
            targetLanguageOption: 'es',
        });

        expect(result.status).toBe('success');
        expect(cache.stats().misses).toBe(1);
    });

    it.each([
        ['mixed Chinese and English', 'Hello 你好', 'zh-TW'],
        ['simplified Chinese to traditional Chinese', '简体中文', 'zh-TW'],
        ['Japanese to an explicit Japanese target', 'こんにちは', 'ja'],
    ])('should send %s through the provider', async (_name, text, targetLanguage) => {
        const beforeTranslate = vi.fn(async () => undefined);
        const { service, translator } = createService();

        const result = await service.process({
            command: 'translate',
            commandLabel: '/translate',
            guildId: 'guild-1',
            guildName: 'Test Guild',
            userId: 'user1',
            userTag: 'user#0001',
            locale: targetLanguage,
            text,
            targetLanguageOption: targetLanguage,
            beforeTranslate,
        });

        expect(result.status).toBe('success');
        expect(translator).toHaveBeenCalledWith(text, targetLanguage, expect.any(Object));
        expect(beforeTranslate).toHaveBeenCalledOnce();
    });
});

describe('resolveTargetLanguage', () => {
    const { resolveTargetLanguage, resolveQueueBusyMessage } = _test;

    it('should prioritize explicit target option over preferences and locale', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePreferenceEntries: [
                { guildId: 'guild-1', userId: 'user1', language: 'ja' },
            ],
        });

        expect(
            resolveTargetLanguage(
                {
                    guildId: 'guild-1',
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

    it('should fall back from guild user preference to locale and then auto', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePreferenceEntries: [
                { guildId: 'guild-1', userId: 'user1', language: 'ja' },
                { guildId: 'guild-2', userId: 'user1', language: 'ko' },
            ],
        });

        expect(
            resolveTargetLanguage(
                {
                    guildId: 'guild-1',
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
                    guildId: 'guild-2',
                    userId: 'user1',
                    locale: 'ja',
                },
                preferenceStore,
            ),
        ).toEqual({
            targetLanguage: 'ko',
            langSource: 'setlang',
        });
        expect(
            resolveTargetLanguage(
                {
                    guildId: 'guild-3',
                    userId: 'user1',
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
                    guildId: null,
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

    it('should resolve user-install preferences from global user scope', () => {
        const preferenceStore = createUserPreferenceStoreMock({
            userLanguagePreferenceEntries: [
                { guildId: '', userId: 'user1', language: 'ko' },
                { guildId: 'guild-1', userId: 'user1', language: 'ja' },
            ],
        });

        expect(
            resolveTargetLanguage(
                {
                    guildId: 'guild-1',
                    userId: 'user1',
                    locale: 'en-US',
                },
                preferenceStore,
                { accessMode: 'user-install' },
            ),
        ).toEqual({
            targetLanguage: 'ko',
            langSource: 'setlang',
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
