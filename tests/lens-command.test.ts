import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import { TranslationCache } from '../src/modules/translation/cache.js';
import { TranslationRuntimeLimiter } from '../src/modules/translation/translation-runtime-limiter.js';
import type { VisionQuotaResult } from '../src/persistence/store.js';

const mocks = vi.hoisted(() => ({
    getRuntimeConfig: vi.fn(() => ({
        visionApiKey: 'vision-key',
        visionMonthlyImageLimit: 900,
        lensEnabledGuildIds: ['guild-1'],
    })),
    tryConsumeVisionImage: vi.fn(
        (): VisionQuotaResult => ({ consumed: true, globalUsed: 1, scopeUsed: 1 }),
    ),
    getVisionScopeLimit: vi.fn((): number | null => null),
    detectText: vi.fn(async () => ({
        text: 'Text from image',
        imageWidth: 100,
        imageHeight: 100,
        regions: [{ text: 'Text from image', x: 5, y: 10, width: 80, height: 20 }],
    })),
    normalizeImage: vi.fn(async (image: Buffer) => ({
        image,
        mimeType: 'image/png' as const,
        width: 100,
        height: 100,
        hash: 'normalized-image-hash',
    })),
    renderImage: vi.fn(async () => Buffer.from('rendered-image')),
}));

vi.mock('../src/modules/config/config-repository.js', () => ({
    configRepository: { getRuntimeConfig: mocks.getRuntimeConfig },
}));

vi.mock('../src/persistence/store.js', () => ({
    store: {
        tryConsumeVisionImage: mocks.tryConsumeVisionImage,
        getVisionScopeLimit: mocks.getVisionScopeLimit,
    },
}));

vi.mock('../src/infra/cloud-vision-client.js', () => ({
    detectTextWithCloudVision: mocks.detectText,
}));

vi.mock('../src/modules/translation/lens-image.js', () => ({
    normalizeLensImage: mocks.normalizeImage,
    renderLensImage: mocks.renderImage,
}));

import { _test, handleBabelLens } from '../src/commands/lens.js';

function createInteraction(withImage = true) {
    const attachment = {
        contentType: 'image/png',
        size: 5,
        url: 'https://cdn.discordapp.com/attachments/1/2/meme.png',
        width: 100,
        height: 100,
        name: 'meme.png',
    };

    return {
        authorizingIntegrationOwners: undefined,
        guildId: 'guild-1',
        guild: { name: 'Test Guild' },
        user: { id: 'user-1', tag: 'user#0001' },
        locale: 'zh-TW',
        targetMessage: {
            attachments: {
                find: (predicate: (value: unknown) => boolean) =>
                    withImage && predicate(attachment) ? attachment : undefined,
            },
        },
        reply: vi.fn(),
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
    };
}

function createCommandDeps(translationService: unknown) {
    return {
        translationService: translationService as never,
        ocrCache: new TranslationCache(20),
        renderLimiter: new TranslationRuntimeLimiter({ maxConcurrent: 1 }),
    };
}

describe('Babel Lens command', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRuntimeConfig.mockReturnValue({
            visionApiKey: 'vision-key',
            visionMonthlyImageLimit: 950,
            lensEnabledGuildIds: ['guild-1'],
        });
        mocks.tryConsumeVisionImage.mockReturnValue({
            consumed: true,
            globalUsed: 1,
            scopeUsed: 1,
        });
        mocks.getVisionScopeLimit.mockReturnValue(null);
        mocks.detectText.mockResolvedValue({
            text: 'Text from image',
            imageWidth: 100,
            imageHeight: 100,
            regions: [{ text: 'Text from image', x: 5, y: 10, width: 80, height: 20 }],
        });
        mocks.normalizeImage.mockImplementation(async (image: Buffer) => ({
            image,
            mimeType: 'image/png',
            width: 100,
            height: 100,
            hash: 'normalized-image-hash',
        }));
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(Buffer.from('image'), { status: 200 })),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should OCR, translate, render, and return an ephemeral image', async () => {
        const interaction = createInteraction();
        const translationService = {
            processImage: vi.fn(async (request) => {
                await request.beforeTranslate();
                const normalized = await request.resolveImage();
                await request.resolveVision(normalized.image);
                return {
                    status: 'success',
                    deferred: true,
                    translatedText: '[1] 圖片翻譯',
                    hasText: true,
                    regions: [{ translation: '圖片翻譯', box_2d: [100, 50, 300, 850] }],
                    route: 'vision',
                    cached: false,
                    targetLanguage: 'zh-TW',
                    langSource: 'locale',
                    inputTokens: 10,
                    outputTokens: 4,
                };
            }),
        };

        await handleBabelLens(interaction as never, createCommandDeps(translationService));

        expect(interaction.deferReply).toHaveBeenCalledOnce();
        expect(translationService.processImage).toHaveBeenCalledWith(
            expect.objectContaining({
                resolveImage: expect.any(Function),
                resolveVision: expect.any(Function),
            }),
        );
        expect(mocks.tryConsumeVisionImage).toHaveBeenCalledWith(
            new Date().toISOString().slice(0, 7),
            950,
            { scope: 'guild', scopeId: 'guild-1' },
        );
        expect(mocks.detectText).toHaveBeenCalledOnce();
        expect(mocks.detectText).toHaveBeenCalledWith(expect.any(Buffer), {
            apiKey: 'vision-key',
        });
        expect(mocks.renderImage).toHaveBeenCalledWith(
            expect.any(Buffer),
            '[1] 圖片翻譯',
            [{ translation: '圖片翻譯', box_2d: [100, 50, 300, 850] }],
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            files: [{ attachment: Buffer.from('rendered-image'), name: 'babel-lens.jpg' }],
        });
        expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it('should allow a direct no-text route when Vision is disabled', async () => {
        mocks.getRuntimeConfig.mockReturnValue({
            visionApiKey: '',
            visionMonthlyImageLimit: 0,
            lensEnabledGuildIds: ['guild-1'],
        });
        const interaction = createInteraction();
        const translationService = {
            processImage: vi.fn(async (request) => {
                await request.beforeTranslate();
                await request.resolveImage();
                return {
                    status: 'success',
                    deferred: true,
                    translatedText: '',
                    hasText: false,
                    regions: [],
                    route: 'direct',
                    cached: false,
                    targetLanguage: 'zh-TW',
                    langSource: 'locale',
                    inputTokens: 20,
                    outputTokens: 2,
                };
            }),
        };

        await handleBabelLens(interaction as never, createCommandDeps(translationService));

        expect(mocks.tryConsumeVisionImage).not.toHaveBeenCalled();
        expect(mocks.detectText).not.toHaveBeenCalled();
        expect(mocks.renderImage).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('no meaningful text') }),
        );
    });

    it('should reject messages without a supported image before translation', async () => {
        const interaction = createInteraction(false);
        const translationService = { processImage: vi.fn() };

        await handleBabelLens(interaction as never, createCommandDeps(translationService));

        expect(translationService.processImage).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('PNG, JPEG, or WebP'),
            }),
        );
    });

    it('should omit region boxes when translated markers do not match', async () => {
        const interaction = createInteraction();
        const translationService = {
            processImage: vi.fn(async (request) => {
                await request.resolveImage();
                return {
                    status: 'success',
                    deferred: false,
                    translatedText: '圖片翻譯',
                    hasText: true,
                    regions: [],
                    route: 'direct',
                    cached: false,
                    targetLanguage: 'zh-TW',
                    langSource: 'locale',
                    inputTokens: 10,
                    outputTokens: 4,
                };
            }),
        };

        await handleBabelLens(interaction as never, createCommandDeps(translationService));

        expect(mocks.renderImage).toHaveBeenCalledWith(expect.any(Buffer), '圖片翻譯', []);
    });

    it('should return translated text when render capacity is full', async () => {
        const interaction = createInteraction();
        const translationService = {
            processImage: vi.fn(async (request) => {
                await request.resolveImage();
                return {
                    status: 'success',
                    deferred: true,
                    translatedText: '[1] 圖片翻譯',
                    hasText: true,
                    regions: [{ translation: '圖片翻譯', box_2d: [100, 50, 300, 850] }],
                    route: 'direct',
                    cached: false,
                    targetLanguage: 'zh-TW',
                    langSource: 'locale',
                    inputTokens: 10,
                    outputTokens: 4,
                };
            }),
        };
        const renderLimiter = {
            acquire: vi.fn(() => ({
                accepted: false,
                reason: 'global_queue_full',
                snapshot: {},
            })),
        };

        await handleBabelLens(interaction as never, {
            ...createCommandDeps(translationService),
            renderLimiter: renderLimiter as never,
        });

        expect(mocks.renderImage).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('[1] 圖片翻譯') }),
        );
    });

    it('should reject a guild without Lens access before downloading the image', async () => {
        mocks.getRuntimeConfig.mockReturnValueOnce({
            visionApiKey: 'vision-key',
            visionMonthlyImageLimit: 900,
            lensEnabledGuildIds: [],
        });
        const interaction = createInteraction();
        const translationService = { processImage: vi.fn() };

        await handleBabelLens(interaction as never, createCommandDeps(translationService));

        expect(translationService.processImage).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'Babel Lens is not enabled for this server.' }),
        );
    });

    it('should charge Pocket Lens to the installation owner', async () => {
        const interaction = createInteraction();
        interaction.authorizingIntegrationOwners = { '1': 'owner-1' };
        const translationService = {
            processImage: vi.fn(async (request) => {
                const normalized = await request.resolveImage();
                await request.resolveVision(normalized.image);
                return { status: 'blocked', deferred: false, message: 'stop' };
            }),
        };

        await handleBabelLens(interaction as never, {
            ...createCommandDeps(translationService),
            profile: BABEL_POCKET_PROFILE,
        });

        expect(mocks.tryConsumeVisionImage).toHaveBeenCalledWith(
            new Date().toISOString().slice(0, 7),
            950,
            { scope: 'user', scopeId: 'owner-1' },
        );
    });

    it('should report a scoped Vision quota without calling Cloud Vision', async () => {
        mocks.tryConsumeVisionImage.mockReturnValue({
            consumed: false,
            blockedBy: 'guild',
            used: 2,
            limit: 2,
        });

        await expect(
            _test.detectTextWithBudget(
                Buffer.from('quota-image'),
                new TranslationCache(20),
                'request-1',
                { scope: 'guild', scopeId: 'guild-1' },
            ),
        ).rejects.toThrow("This server's Babel Lens monthly image limit reached (2/2).");
        expect(mocks.detectText).not.toHaveBeenCalled();
    });

    it('should enforce global disable before serving a cached OCR result', async () => {
        const cache = new TranslationCache(20);
        const image = Buffer.from('same-image');
        await _test.detectTextWithBudget(image, cache, 'request-1');
        mocks.getRuntimeConfig.mockReturnValue({
            visionApiKey: 'vision-key',
            visionMonthlyImageLimit: 0,
            lensEnabledGuildIds: ['guild-1'],
        });

        await expect(_test.detectTextWithBudget(image, cache, 'request-2')).rejects.toThrow(
            'disabled in Settings',
        );
        expect(mocks.detectText).toHaveBeenCalledOnce();
        expect(mocks.tryConsumeVisionImage).toHaveBeenCalledOnce();
    });

    it('should enforce scoped disable before cached or in-flight OCR reuse', async () => {
        const cache = new TranslationCache(20);
        const cachedImage = Buffer.from('cached-scope-image');
        await _test.detectTextWithBudget(cachedImage, cache, 'request-1', {
            scope: 'guild',
            scopeId: 'allowed-guild',
        });
        mocks.getVisionScopeLimit.mockImplementation((_scope, scopeId) =>
            scopeId === 'disabled-guild' ? 0 : null,
        );

        await expect(
            _test.detectTextWithBudget(cachedImage, cache, 'request-2', {
                scope: 'guild',
                scopeId: 'disabled-guild',
            }),
        ).rejects.toThrow("This server's Babel Lens is disabled.");

        let finishDetection!: (value: Awaited<ReturnType<typeof mocks.detectText>>) => void;
        mocks.detectText.mockImplementationOnce(
            () => new Promise((resolve) => (finishDetection = resolve)),
        );
        const inFlightImage = Buffer.from('in-flight-scope-image');
        const allowed = _test.detectTextWithBudget(inFlightImage, cache, 'request-3', {
            scope: 'guild',
            scopeId: 'allowed-guild',
        });
        const disabled = _test.detectTextWithBudget(inFlightImage, cache, 'request-4', {
            scope: 'guild',
            scopeId: 'disabled-guild',
        });

        await expect(disabled).rejects.toThrow("This server's Babel Lens is disabled.");
        finishDetection({
            text: 'Text from image',
            imageWidth: 100,
            imageHeight: 100,
            regions: [],
        });
        await expect(allowed).resolves.toMatchObject({ text: 'Text from image' });
        expect(mocks.tryConsumeVisionImage).toHaveBeenCalledTimes(2);
        expect(mocks.detectText).toHaveBeenCalledTimes(2);
    });

    it('should cache OCR without changing translation cache statistics', async () => {
        const translationCache = new TranslationCache(20);
        const ocrCache = new TranslationCache(20);
        const image = Buffer.from('ocr-cache-image');

        await _test.detectTextWithBudget(image, ocrCache, 'request-1');
        await _test.detectTextWithBudget(image, ocrCache, 'request-2');

        expect(translationCache.stats()).toMatchObject({ size: 0, hits: 0, misses: 0 });
        expect(ocrCache.stats()).toMatchObject({ size: 1, hits: 1, misses: 1 });
        expect(mocks.detectText).toHaveBeenCalledOnce();
    });
});
