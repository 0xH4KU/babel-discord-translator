import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translate, _test } from '../src/translate.js';

const { getLanguageName, buildTargetedPrompt, fetchWithRetry, LOCALE_MAP, DEFAULT_PROMPT } = _test;

// --- Mock store ---
vi.mock('../src/store.js', () => {
    const data = {
        geminiModel: 'gemini-2.5-flash-lite',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        vertexAiApiKey: 'test-api-key',
        translationPrompt: '',
    };
    return {
        store: {
            get: vi.fn((key) => data[key]),
            _setMock: (key, val) => { data[key] = val; },
        },
    };
});

// Import mocked store for manipulation
import { store } from '../src/store.js';

// --- Helper: build a valid Gemini response ---
function geminiResponse(text, inputTokens = 10, outputTokens = 5) {
    return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text }] } }],
            usageMetadata: { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens },
        }),
        text: () => Promise.resolve(''),
    };
}

describe('getLanguageName', () => {
    it('should return null for null, undefined, or "auto"', () => {
        expect(getLanguageName(null)).toBeNull();
        expect(getLanguageName(undefined)).toBeNull();
        expect(getLanguageName('auto')).toBeNull();
    });

    it('should return known language names', () => {
        expect(getLanguageName('zh-TW')).toBe('Traditional Chinese (繁體中文)');
        expect(getLanguageName('ja')).toBe('Japanese (日本語)');
        expect(getLanguageName('ko')).toBe('Korean (한국어)');
        expect(getLanguageName('en-US')).toBe('English');
    });

    it('should fall back to base code if full code not found', () => {
        // 'es-419' is in the map, but 'es-MX' is not → falls back to 'es'
        expect(getLanguageName('es-419')).toBe('Spanish (Español)');
    });

    it('should return the raw code if not in the map', () => {
        expect(getLanguageName('xx')).toBe('xx');
    });
});

describe('buildTargetedPrompt', () => {
    it('should include the language name in the prompt', () => {
        const prompt = buildTargetedPrompt('ja');
        expect(prompt).toContain('Japanese (日本語)');
        expect(prompt).toContain('Translate the text to');
    });

    it('should contain fallback instructions', () => {
        const prompt = buildTargetedPrompt('ko');
        expect(prompt).toContain('already in');
        expect(prompt).toContain('English instead');
    });
});

describe('fetchWithRetry', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should return immediately on success', async () => {
        const mockResponse = { ok: true, status: 200 };
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

        const result = await fetchWithRetry('https://example.com', {}, 3);
        expect(result).toBe(mockResponse);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 400 (non-retryable status)', async () => {
        const mockResponse = { ok: false, status: 400 };
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

        const result = await fetchWithRetry('https://example.com', {}, 3);
        expect(result.status).toBe(400);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 and eventually succeed', async () => {
        const fail = { ok: false, status: 429 };
        const success = { ok: true, status: 200 };
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce(fail)
            .mockResolvedValueOnce(success);

        // Use 0 retries-worth of delay by mocking setTimeout
        vi.useFakeTimers();
        const promise = fetchWithRetry('https://example.com', {}, 3);
        // Fast-forward past all delays
        await vi.runAllTimersAsync();
        const result = await promise;
        vi.useRealTimers();

        expect(result).toBe(success);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on network error and eventually succeed', async () => {
        const success = { ok: true, status: 200 };
        globalThis.fetch = vi.fn()
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce(success);

        vi.useFakeTimers();
        const promise = fetchWithRetry('https://example.com', {}, 3);
        await vi.runAllTimersAsync();
        const result = await promise;
        vi.useRealTimers();

        expect(result).toBe(success);
    });

    it('should throw after all retries on persistent network error', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'));

        vi.useFakeTimers();
        const promise = fetchWithRetry('https://example.com', {}, 1);
        // Wrap in a catch handler early to prevent unhandled rejection warning
        const caught = promise.catch((e) => e);
        await vi.runAllTimersAsync();
        vi.useRealTimers();

        const error = await caught;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Network down');
    });
});

describe('translate', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        // Reset mock store data
        store._setMock('gcpProject', 'test-project');
        store._setMock('vertexAiApiKey', 'test-key');
        store._setMock('gcpLocation', 'global');
        store._setMock('geminiModel', 'gemini-2.5-flash-lite');
        store._setMock('translationPrompt', '');
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should return translated text with token counts', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('你好世界', 15, 8));

        const result = await translate('Hello world');
        expect(result.text).toBe('你好世界');
        expect(result.inputTokens).toBe(15);
        expect(result.outputTokens).toBe(8);
    });

    it('should throw when API is not configured', async () => {
        store._setMock('gcpProject', '');
        store._setMock('vertexAiApiKey', '');

        await expect(translate('Hello')).rejects.toThrow('API not configured');
    });

    it('should throw on API error response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            text: () => Promise.resolve('Forbidden'),
        });

        await expect(translate('Hello')).rejects.toThrow('Vertex AI 403');
    });

    it('should throw on empty response from Gemini', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
        });

        await expect(translate('Hello')).rejects.toThrow('Empty response');
    });

    it('should use custom prompt when set', async () => {
        store._setMock('translationPrompt', 'Custom: translate to Pirate English');
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('Ahoy!'));

        await translate('Hello');

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.contents[0].parts[0].text).toContain('Custom: translate to Pirate English');
    });

    it('should use targeted prompt for specific language', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('こんにちは'));

        await translate('Hello', 'ja');

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.contents[0].parts[0].text).toContain('Japanese');
    });

    it('should use default prompt for "auto" target', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('你好'));

        await translate('Hello', 'auto');

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.contents[0].parts[0].text).toContain('If the text is Chinese');
    });

    it('should use regional URL for non-global location', async () => {
        store._setMock('gcpLocation', 'us-central1');
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('Hello'));

        await translate('你好');

        const url = globalThis.fetch.mock.calls[0][0];
        expect(url).toContain('us-central1-aiplatform.googleapis.com');
    });

    it('should use global URL for global location', async () => {
        store._setMock('gcpLocation', 'global');
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('Hello'));

        await translate('你好');

        const url = globalThis.fetch.mock.calls[0][0];
        expect(url).toContain('aiplatform.googleapis.com');
        expect(url).not.toContain('global-aiplatform');
    });
});
