import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    checkOpenAiHealth,
    createOpenAiProvider,
    generateImageTranslationContent,
    generateTranslationContent,
    isOpenAiConfigured,
    _test,
} from '../src/infra/openai-client.js';

vi.mock('../src/persistence/store.js', () => {
    const data: Record<string, unknown> = {
        openaiApiKey: 'test-openai-key',
        openaiBaseUrl: 'https://api.openai.example',
        openaiModel: 'gpt-test',
        openaiSupportsImages: false,
        allowedGuildIds: [],
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

function chatResponse(
    content: string | null,
    usage?: Record<string, unknown>,
    finishReason?: string,
) {
    return {
        ok: true,
        status: 200,
        json: () =>
            Promise.resolve({
                choices:
                    content === null ? [] : [{ message: { content }, finish_reason: finishReason }],
                ...(usage !== undefined ? { usage } : {}),
            }),
        text: () => Promise.resolve(''),
    };
}

describe('openai-client', () => {
    let originalFetch: typeof globalThis.fetch;
    const mockStore = store as unknown as {
        _setMock: (key: string, value: unknown) => void;
    };

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        mockStore._setMock('openaiApiKey', 'test-openai-key');
        mockStore._setMock('openaiBaseUrl', 'https://api.openai.example');
        mockStore._setMock('openaiModel', 'gpt-test');
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should generate translation content with the configured model and auth header', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(chatResponse(' 你好 ', { prompt_tokens: 12, completion_tokens: 6 }));

        const result = await generateTranslationContent(translationPrompt('Translate me'), 512);

        expect(result).toEqual({ text: '你好', inputTokens: 12, outputTokens: 6 });

        const [url, request] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe('https://api.openai.example/v1/chat/completions');
        expect(request.headers.Authorization).toBe('Bearer test-openai-key');
        const body = JSON.parse(request.body);
        expect(body).toMatchObject({
            model: 'gpt-test',
            messages: [
                { role: 'system', content: 'Translate accurately.' },
                { role: 'user', content: 'Translate me' },
            ],
            max_tokens: 512,
            temperature: 0.1,
        });
        expect(request.signal).toBeInstanceOf(AbortSignal);
    });

    it('should estimate token counts when usage is missing or malformed', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatResponse('hola'));

        const result = await generateTranslationContent(translationPrompt('hi'), 64);

        expect(result).toEqual({ text: 'hola', inputTokens: 6, outputTokens: 1 });

        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(
                chatResponse('hola', { prompt_tokens: -10, completion_tokens: 'many' }),
            );
        await expect(generateTranslationContent(translationPrompt('hi'), 64)).resolves.toEqual({
            text: 'hola',
            inputTokens: 6,
            outputTokens: 1,
        });
    });

    it('should send compatible text and image_url content parts without forcing response format', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(
                chatResponse(JSON.stringify({ has_text: true, translation: 'hola', regions: [] }), {
                    prompt_tokens: 50,
                    completion_tokens: 10,
                }),
            );

        const result = await generateImageTranslationContent(
            {
                image: Buffer.from('image'),
                mimeType: 'image/webp',
                prompt: translationPrompt('Read and translate the image.'),
            },
            512,
        );

        expect(result).toMatchObject({ text: 'hola', inputTokens: 50, outputTokens: 10 });
        const request = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        const body = JSON.parse(request.body);
        expect(body.messages[1].content).toEqual([
            { type: 'text', text: 'Read and translate the image.' },
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/webp;base64,${Buffer.from('image').toString('base64')}`,
                },
            },
        ]);
        expect(body).not.toHaveProperty('response_format');
        expect(body.messages[1].content[1].image_url).not.toHaveProperty('detail');
    });

    it('should report image output truncated by the configured token limit', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(
                chatResponse(
                    '{"has_text":true',
                    { prompt_tokens: 10, completion_tokens: 1000 },
                    'length',
                ),
            );

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

    it('should preserve usage when an image response contains invalid JSON', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(
                chatResponse('not json', { prompt_tokens: 30, completion_tokens: 4 }),
            );

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
            message: 'Invalid Babel Lens JSON response',
            inputTokens: 30,
            outputTokens: 4,
        });
    });

    it('should reject empty completions', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatResponse(null));

        await expect(generateTranslationContent(translationPrompt('hi'), 64)).rejects.toThrow(
            'Empty response from OpenAI',
        );
    });

    it('should throw a configuration error when the provider is not configured', async () => {
        mockStore._setMock('openaiApiKey', '');

        await expect(generateTranslationContent(translationPrompt('hi'), 64)).rejects.toThrow(
            'OpenAI provider not configured',
        );
    });

    it('should retry retryable statuses honoring retry-after and then succeed', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                headers: new Headers({ 'retry-after': '1' }),
                text: () => Promise.resolve('rate limited'),
            })
            .mockResolvedValueOnce(
                chatResponse('done', { prompt_tokens: 1, completion_tokens: 1 }),
            );

        vi.useFakeTimers();
        const promise = generateTranslationContent(translationPrompt('hi'), 64);
        const result = promise.then((value) => value);
        await vi.runAllTimersAsync();

        await expect(result).resolves.toMatchObject({ text: 'done' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should cap retry-after delays, retry 504 responses, and cancel response bodies', async () => {
        const cancel = vi.fn(async () => undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0);
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 504,
                headers: new Headers({ 'retry-after': '3600' }),
                body: { cancel },
            })
            .mockResolvedValueOnce(
                chatResponse('done', { prompt_tokens: 1, completion_tokens: 1 }),
            );

        vi.useFakeTimers();
        const result = generateTranslationContent(translationPrompt('hi'), 64);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toMatchObject({ text: 'done' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledOnce();
    });

    it('should throw a structured provider error for non-retryable failures', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: new Headers(),
            text: () => Promise.resolve('bad key'),
        });

        await expect(generateTranslationContent(translationPrompt('hi'), 64)).rejects.toMatchObject(
            {
                name: 'ProviderHttpError',
                provider: 'openai',
                statusCode: 401,
                message: expect.stringContaining('bad key'),
            },
        );
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry network errors and rethrow after retries are exhausted', async () => {
        const networkError = new TypeError('fetch failed');
        globalThis.fetch = vi.fn().mockRejectedValue(networkError);

        vi.useFakeTimers();
        const caught = generateTranslationContent(translationPrompt('hi'), 64).catch(
            (error: Error) => error,
        );
        await vi.runAllTimersAsync();

        await expect(caught).resolves.toBe(networkError);
        expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });

    it('should report healthy status with latency on success', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatResponse('pong'));

        const result = await checkOpenAiHealth();

        expect(result.healthy).toBe(true);
        expect(result.latencyMs).toBeTypeOf('number');
    });

    it('should report configuration errors through the health check', async () => {
        mockStore._setMock('openaiBaseUrl', '');

        const result = await checkOpenAiHealth();

        expect(result).toEqual({
            healthy: false,
            error: 'OpenAI provider not configured. Please complete setup in the dashboard.',
        });
    });

    it('should report unhealthy status without retrying on request failure', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers(),
            text: () => Promise.resolve(''),
        });

        const result = await checkOpenAiHealth();

        expect(result.healthy).toBe(false);
        expect(result.error).toContain('Service Unavailable');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should detect whether the provider is configured', () => {
        expect(isOpenAiConfigured()).toBe(true);

        mockStore._setMock('openaiModel', '');
        expect(isOpenAiConfigured()).toBe(false);
    });

    it('should expose a provider adapter that delegates translate and isConfigured', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(chatResponse('ok', { prompt_tokens: 2, completion_tokens: 3 }));

        const provider = createOpenAiProvider();

        expect(provider.name).toBe('openai');
        expect(provider.isConfigured()).toBe(true);
        await expect(provider.translate(translationPrompt('hi'), 32)).resolves.toEqual({
            text: 'ok',
            inputTokens: 2,
            outputTokens: 3,
        });
    });

    it('should normalize supported completions base URLs', () => {
        expect(_test.buildChatCompletionsUrl('https://host//')).toBe(
            'https://host/v1/chat/completions',
        );
        expect(_test.buildChatCompletionsUrl('https://host')).toBe(
            'https://host/v1/chat/completions',
        );
        expect(_test.buildChatCompletionsUrl('https://host/v1/')).toBe(
            'https://host/v1/chat/completions',
        );
        expect(_test.buildChatCompletionsUrl('https://host/compat/chat/completions/')).toBe(
            'https://host/compat/chat/completions',
        );
    });

    it('should classify failures by status code, error shape, and message', () => {
        const { classifyOpenAiFailure } = _test;

        expect(classifyOpenAiFailure(429)).toBe('rate_limit');
        expect(classifyOpenAiFailure(401)).toBe('auth');

        const typed = Object.assign(new Error('boom'), { errorType: 'custom_type' });
        expect(classifyOpenAiFailure(typed)).toBe('custom_type');

        const timeout = new Error('timed out');
        timeout.name = 'TimeoutError';
        expect(classifyOpenAiFailure(timeout)).toBe('timeout');

        expect(classifyOpenAiFailure(new Error('OpenAI provider not configured.'))).toBe(
            'configuration',
        );
        expect(classifyOpenAiFailure(new Error('socket hang up'))).toBe('network_error');
    });

    it('should fall back to statusText when the error body is empty', async () => {
        const error = await _test.buildOpenAiError({
            status: 500,
            statusText: 'Internal Server Error',
            headers: new Headers(),
            text: () => Promise.resolve('   '),
        } as unknown as Response);

        expect(error.message).toContain('Internal Server Error');
    });
});
