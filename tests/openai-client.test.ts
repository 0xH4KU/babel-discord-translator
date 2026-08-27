import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    checkOpenAiHealth,
    createOpenAiProvider,
    generateTranslationContent,
    isOpenAiConfigured,
    _test,
} from '../src/infra/openai-client.js';

vi.mock('../src/persistence/store.js', () => {
    const data: Record<string, unknown> = {
        openaiApiKey: 'test-openai-key',
        openaiBaseUrl: 'https://api.openai.example',
        openaiModel: 'gpt-test',
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

function chatResponse(content: string | null, usage?: Record<string, number>) {
    return {
        ok: true,
        status: 200,
        json: () =>
            Promise.resolve({
                choices: content === null ? [] : [{ message: { content } }],
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

    it('should default token counts to zero when usage is missing', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(chatResponse('hola'));

        const result = await generateTranslationContent(translationPrompt('hi'), 64);

        expect(result).toEqual({ text: 'hola', inputTokens: 0, outputTokens: 0 });
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

    it('should throw a structured provider error for non-retryable failures', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: new Headers(),
            text: () => Promise.resolve('bad key'),
        });

        await expect(
            generateTranslationContent(translationPrompt('hi'), 64),
        ).rejects.toMatchObject({
            name: 'ProviderHttpError',
            provider: 'openai',
            statusCode: 401,
            message: expect.stringContaining('bad key'),
        });
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

    it('should strip trailing slashes when building the completions URL', () => {
        expect(_test.buildChatCompletionsUrl('https://host//')).toBe(
            'https://host/v1/chat/completions',
        );
        expect(_test.buildChatCompletionsUrl('https://host')).toBe(
            'https://host/v1/chat/completions',
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
