import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import { TranslationCache } from '../src/modules/translation/cache.js';
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
    detectText: vi.fn(async () => ({
        text: 'Text from image',
        imageWidth: 100,
        imageHeight: 100,
        regions: [{ text: 'Text from image', x: 5, y: 10, width: 80, height: 20 }],
    })),
    renderImage: vi.fn(async () => Buffer.from('rendered-image')),
}));

vi.mock('../src/modules/config/config-repository.js', () => ({
    configRepository: { getRuntimeConfig: mocks.getRuntimeConfig },
}));

vi.mock('../src/persistence/store.js', () => ({
    store: { tryConsumeVisionImage: mocks.tryConsumeVisionImage },
}));

vi.mock('../src/infra/cloud-vision-client.js', () => ({
    detectTextWithCloudVision: mocks.detectText,
}));

vi.mock('../src/modules/translation/lens-image.js', () => ({
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
        mocks.detectText.mockResolvedValue({
            text: 'Text from image',
            imageWidth: 100,
            imageHeight: 100,
            regions: [{ text: 'Text from image', x: 5, y: 10, width: 80, height: 20 }],
        });
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
            process: vi.fn(async (request) => {
                await request.beforeTranslate();
                const originalText = await request.resolveText();
                expect(originalText).toBe('[1] Text from image');
                return {
                    status: 'success',
                    deferred: true,
                    translatedText: '[1] 圖片翻譯',
                    originalText,
                    cached: false,
                    targetLanguage: 'zh-TW',
                    langSource: 'locale',
                    inputTokens: 10,
                    outputTokens: 4,
                };
            }),
        };

        await handleBabelLens(interaction as never, {
            translationService: translationService as never,
            cache: new TranslationCache(20),
        });

        expect(interaction.deferReply).toHaveBeenCalledOnce();
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
            expect.objectContaining({
                regions: [expect.objectContaining({ text: 'Text from image' })],
            }),
        );
        expect(interaction.editReply).toHaveBeenCalledWith({
            files: [{ attachment: Buffer.from('rendered-image'), name: 'babel-lens.jpg' }],
        });
        expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it('should reject messages without a supported image before translation', async () => {
        const interaction = createInteraction(false);
        const translationService = { process: vi.fn() };

        await handleBabelLens(interaction as never, {
            translationService: translationService as never,
            cache: new TranslationCache(20),
        });

        expect(translationService.process).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('PNG, JPEG, or WebP'),
            }),
        );
    });

    it('should reject a guild without Lens access before downloading the image', async () => {
        mocks.getRuntimeConfig.mockReturnValueOnce({
            visionApiKey: 'vision-key',
            visionMonthlyImageLimit: 900,
            lensEnabledGuildIds: [],
        });
        const interaction = createInteraction();
        const translationService = { process: vi.fn() };

        await handleBabelLens(interaction as never, {
            translationService: translationService as never,
            cache: new TranslationCache(20),
        });

        expect(translationService.process).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'Babel Lens is not enabled for this server.' }),
        );
    });

    it('should charge Pocket Lens to the installation owner', async () => {
        const interaction = createInteraction();
        interaction.authorizingIntegrationOwners = { '1': 'owner-1' };
        const translationService = {
            process: vi.fn(async (request) => {
                await request.resolveText();
                return { status: 'blocked', deferred: false, message: 'stop' };
            }),
        };

        await handleBabelLens(interaction as never, {
            translationService: translationService as never,
            cache: new TranslationCache(20),
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
});
