import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ProviderHttpError,
    checkVertexAiHealth,
    generateImageTranslationContent,
    generateTranslationContent,
    _test,
} from '../src/infra/vertex-ai-client.js';

vi.mock('../src/persistence/store.js', () => {
    const data: Record<string, unknown> = {
        geminiModel: 'gemini-2.5-flash-lite',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        vertexAiApiKey: 'test-api-key',
        vertexAiSupportsImages: false,
        geminiMediaResolution: 'default',
        allowedGuildIds: [],
        cooldownSeconds: 5,
        cacheMaxSize: 2000,
        setupComplete: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        dailyBudgetUsd: 0,
        translationPrompt: '',
        maxInputLength: 2000,
        maxOutputTokens: 1000,
    };

    return {
        store: {
            getConfigValues: vi.fn((keys: readonly string[]) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const value = data[key];
                        return [key, Array.isArray(value) ? [...value] : value];
                    }),
                ),
            ),
            _setMock: (key: string, value: unknown) => {
                data[key] = value;
            },
        },
    };
});

import { store } from '../src/persistence/store.js';

const translationPrompt = (user: string) => ({ system: 'Translate accurately.', user });

function geminiResponse(text: string, inputTokens = 10, outputTokens = 5, finishReason?: string) {
    return {
        ok: true,
        status: 200,
        json: () =>
            Promise.resolve({
                candidates: [{ content: { parts: [{ text }] }, finishReason }],
                usageMetadata: {
                    promptTokenCount: inputTokens,
                    candidatesTokenCount: outputTokens,
                },
            }),
        text: () => Promise.resolve(''),
    };
}

describe('vertex-ai-client', () => {
    let originalFetch: typeof globalThis.fetch;
    const mockStore = store as unknown as {
        _setMock: (key: string, value: unknown) => void;
    };

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        mockStore._setMock('gcpProject', 'test-project');
        mockStore._setMock('vertexAiApiKey', 'test-key');
        mockStore._setMock('gcpLocation', 'global');
        mockStore._setMock('geminiModel', 'gemini-2.5-flash-lite');
        mockStore._setMock('geminiMediaResolution', 'default');
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should generate translation content via the shared Vertex AI client', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('你好', 15, 8));

        const result = await generateTranslationContent(translationPrompt('Translate me'), 512);

        expect(result).toEqual({
            text: '你好',
            inputTokens: 15,
            outputTokens: 8,
        });

        const request = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        const body = JSON.parse(request.body);
        expect(body.systemInstruction).toEqual({
            parts: [{ text: 'Translate accurately.' }],
        });
        expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Translate me' }] }]);
        expect(body.generationConfig.maxOutputTokens).toBe(512);
        expect(request.signal).toBeInstanceOf(AbortSignal);
    });

    it('should estimate token counts when usage metadata is missing or malformed', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: '你好' }] } }],
                usageMetadata: { promptTokenCount: 'unknown', candidatesTokenCount: -1 },
            }),
        });

        const result = await generateTranslationContent(translationPrompt('hi'), 64);

        expect(result).toEqual({ text: '你好', inputTokens: 6, outputTokens: 1 });
    });

    it('should send inline image data with JSON schema and optional media resolution', async () => {
        mockStore._setMock('geminiMediaResolution', 'high');
        globalThis.fetch = vi.fn().mockResolvedValue(
            geminiResponse(
                JSON.stringify({
                    has_text: true,
                    translation: '你好',
                    regions: [[10, 20, 30, 40]],
                }),
                120,
                20,
            ),
        );

        const result = await generateImageTranslationContent(
            {
                image: Buffer.from('image'),
                mimeType: 'image/png',
                prompt: translationPrompt('Read and translate the image.'),
            },
            512,
        );

        expect(result).toMatchObject({ text: '你好', inputTokens: 120, outputTokens: 20 });
        const request = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        const body = JSON.parse(request.body);
        expect(body.contents[0].parts).toEqual([
            { text: 'Read and translate the image.' },
            {
                inlineData: {
                    data: Buffer.from('image').toString('base64'),
                    mimeType: 'image/png',
                },
                mediaResolution: { level: 'MEDIA_RESOLUTION_HIGH' },
            },
        ]);
        expect(body.generationConfig).toMatchObject({
            responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', required: ['has_text', 'translation', 'regions'] },
        });
        expect(body.generationConfig.responseSchema.properties.regions.items).toEqual({
            type: 'ARRAY',
            minItems: 4,
            maxItems: 4,
            items: { type: 'NUMBER', minimum: 0, maximum: 1000 },
        });

        mockStore._setMock('geminiMediaResolution', 'default');
        await generateImageTranslationContent(
            {
                image: Buffer.from('image'),
                mimeType: 'image/jpeg',
                prompt: translationPrompt('Read it.'),
            },
            128,
        );
        const defaultBody = JSON.parse(
            (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
        );
        expect(defaultBody.contents[0].parts[1]).not.toHaveProperty('mediaResolution');
    });

    it('should report image output truncated by the configured token limit', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(geminiResponse('{"has_text":true', 10, 1000, 'MAX_TOKENS'));

        await expect(
            generateImageTranslationContent(
                {
                    image: Buffer.from('image'),
                    mimeType: 'image/png',
                    prompt: translationPrompt('Read it.'),
                },
                1000,
            ),
        ).rejects.toMatchObject({
            name: 'ProviderResponseError',
            message: expect.stringContaining('truncated by Max Output Tokens'),
            inputTokens: 10,
            outputTokens: 1000,
        });
    });

    it('should return healthy status for a successful health check', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('hi'));

        const result = await checkVertexAiHealth();

        expect(result.healthy).toBe(true);
        expect(result.latencyMs).toBeTypeOf('number');
    });

    it('should report configuration errors through the shared health check', async () => {
        mockStore._setMock('gcpProject', '');
        mockStore._setMock('vertexAiApiKey', '');

        const result = await checkVertexAiHealth();

        expect(result).toEqual({
            healthy: false,
            error: 'API not configured. Please complete setup in the dashboard.',
        });
    });

    it('should build the correct regional endpoint URL', () => {
        const { buildGenerateContentUrl } = _test;

        expect(
            buildGenerateContentUrl({
                apiKey: 'key',
                project: 'project-1',
                location: 'us-central1',
                model: 'gemini-2.5-flash-lite',
            }),
        ).toContain('https://us-central1-aiplatform.googleapis.com');
    });

    it('should throw structured provider errors for failed Vertex AI responses', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'retry-after': '3' }),
            text: () => Promise.resolve('rate limited'),
        });

        vi.useFakeTimers();
        const promise = generateTranslationContent(translationPrompt('Translate me'), 512);
        const caught = promise.catch((error: Error) => error);
        await vi.runAllTimersAsync();
        vi.useRealTimers();

        await expect(caught).resolves.toMatchObject({
            name: 'ProviderHttpError',
            provider: 'vertex',
            errorType: 'rate_limit',
            statusCode: 429,
            retryAfterMs: 3000,
        });
    });

    it('should expose structured provider error details directly', () => {
        const error = new ProviderHttpError('vertex', 403, 'forbidden', 1200);

        expect(error).toMatchObject({
            name: 'ProviderHttpError',
            provider: 'vertex',
            errorType: 'auth',
            statusCode: 403,
            retryAfterMs: 1200,
        });
    });
});
