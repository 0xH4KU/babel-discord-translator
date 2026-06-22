import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translate, _test } from '../src/modules/translation/translate.js';
import { fetchWithRetry } from '../src/infra/vertex-ai-client.js';

const {
    getLanguageName,
    buildTargetedPrompt,
    LOCALE_MAP,
    DEFAULT_PROMPT,
    buildGlossaryPromptSection,
} = _test;

// --- Mock store ---
vi.mock('../src/persistence/store.js', () => {
    const data: Record<string, unknown> = {
        geminiModel: 'gemini-2.5-flash-lite',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        vertexAiApiKey: 'test-api-key',
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
        openaiApiKey: '',
        openaiBaseUrl: '',
        openaiModel: '',
        translationProvider: 'vertex',
    };
    return {
        store: {
            get: vi.fn((key: string) => data[key]),
            getAll: vi.fn(() => ({ ...data })),
            getConfigValues: vi.fn((keys: readonly string[]) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const value = data[key];
                        return [key, Array.isArray(value) ? [...value] : value];
                    }),
                ),
            ),
            _setMock: (key: string, val: unknown) => {
                data[key] = val;
            },
        },
    };
});

// Import mocked store for manipulation
import { store } from '../src/persistence/store.js';

// --- Helper: build a valid Gemini response ---
function geminiResponse(text: string, inputTokens = 10, outputTokens = 5) {
    return {
        ok: true,
        status: 200,
        json: () =>
            Promise.resolve({
                candidates: [{ content: { parts: [{ text }] } }],
                usageMetadata: {
                    promptTokenCount: inputTokens,
                    candidatesTokenCount: outputTokens,
                },
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

describe('buildGlossaryPromptSection', () => {
    it('should render glossary rules with notes', () => {
        const section = buildGlossaryPromptSection(
            [
                {
                    sourceText: 'OpenAI',
                    targetLanguage: 'auto',
                    targetText: 'OpenAI',
                    notes: 'Preserve brand name',
                },
                { sourceText: 'raid', targetLanguage: 'zh-TW', targetText: '團本', notes: '' },
            ],
            'zh-TW',
        );

        expect(section).toContain('Server glossary');
        expect(section).toContain('- OpenAI => OpenAI (Preserve brand name)');
        expect(section).toContain('- raid => 團本');
        expect(section).not.toContain('[zh-TW]');
    });

    it('should label language-specific rules when target language is auto', () => {
        const section = buildGlossaryPromptSection(
            [
                { sourceText: 'raid', targetLanguage: 'zh-TW', targetText: '團本', notes: '' },
                {
                    sourceText: 'raid',
                    targetLanguage: 'ja',
                    targetText: 'レイド',
                    notes: 'Game term',
                },
            ],
            'auto',
        );

        expect(section).toContain('- raid [zh-TW] => 團本');
        expect(section).toContain('- raid [ja] => レイド (Game term)');
    });

    it('should omit the glossary section when there are no entries', () => {
        expect(buildGlossaryPromptSection([])).toBe('');
    });
});

describe('fetchWithRetry', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should return immediately on success', async () => {
        const mockResponse = { ok: true, status: 200 } as Response;
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

        const result = await fetchWithRetry('https://example.com', {}, 3);
        expect(result).toBe(mockResponse);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 400 (non-retryable status)', async () => {
        const mockResponse = { ok: false, status: 400 } as Response;
        globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

        const result = await fetchWithRetry('https://example.com', {}, 3);
        expect(result.status).toBe(400);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 and eventually succeed', async () => {
        const fail = { ok: false, status: 429 } as Response;
        const success = { ok: true, status: 200 } as Response;
        globalThis.fetch = vi.fn().mockResolvedValueOnce(fail).mockResolvedValueOnce(success);

        vi.useFakeTimers();
        const promise = fetchWithRetry('https://example.com', {}, 3);
        await vi.runAllTimersAsync();
        const result = await promise;
        vi.useRealTimers();

        expect(result).toBe(success);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should honor Retry-After before retrying retryable responses', async () => {
        const fail = {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '2' }),
        } as Response;
        const success = { ok: true, status: 200 } as Response;
        globalThis.fetch = vi.fn().mockResolvedValueOnce(fail).mockResolvedValueOnce(success);

        vi.useFakeTimers();
        const promise = fetchWithRetry('https://example.com', {}, 1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        const result = await promise;
        vi.useRealTimers();

        expect(result).toBe(success);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on network error and eventually succeed', async () => {
        const success = { ok: true, status: 200 } as Response;
        globalThis.fetch = vi
            .fn()
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
        const caught = promise.catch((e: Error) => e);
        await vi.runAllTimersAsync();
        vi.useRealTimers();

        const error = await caught;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Network down');
    });
});

describe('translate', () => {
    let originalFetch: typeof globalThis.fetch;
    const mockStore = store as unknown as {
        _setMock: (key: string, val: unknown) => void;
        get: ReturnType<typeof vi.fn>;
        getConfigValues: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        mockStore._setMock('gcpProject', 'test-project');
        mockStore._setMock('vertexAiApiKey', 'test-key');
        mockStore._setMock('gcpLocation', 'global');
        mockStore._setMock('geminiModel', 'gemini-2.5-flash-lite');
        mockStore._setMock('translationPrompt', '');
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

    it('uses runtime config from options without reading the repository again', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('こんにちは', 12, 6));
        mockStore.getConfigValues.mockClear();

        const result = await translate('Hello', 'ja', {
            runtimeConfig: {
                vertexAiApiKey: 'test-key',
                gcpProject: 'test-project',
                gcpLocation: 'global',
                geminiModel: 'gemini-2.5-flash-lite',
                allowedGuildIds: [],
                allowedUserIds: [],
                cooldownSeconds: 0,
                cacheMaxSize: 2000,
                setupComplete: true,
                inputPricePerMillion: 0,
                outputPricePerMillion: 0,
                dailyBudgetUsd: 0,
                defaultUserDailyBudgetUsd: 0,
                translationPrompt: '',
                maxInputLength: 2000,
                maxOutputTokens: 321,
                translationMaxConcurrent: 4,
                translationMaxGlobalQueue: 25,
                translationMaxGuildQueue: 5,
                translationMaxUserOutstanding: 1,
                translationMaxQueueWaitMs: 30000,
                openaiApiKey: '',
                openaiBaseUrl: '',
                openaiModel: '',
                translationProvider: 'vertex',
            },
        });

        expect(result.text).toBe('こんにちは');
        expect(mockStore.getConfigValues).not.toHaveBeenCalled();
    });

    it('should throw when API is not configured', async () => {
        mockStore._setMock('gcpProject', '');
        mockStore._setMock('vertexAiApiKey', '');

        await expect(translate('Hello')).rejects.toThrow('No translation provider is configured');
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
        mockStore._setMock('translationPrompt', 'Custom: translate to Pirate English');
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('Ahoy!'));

        await translate('Hello');

        const body = JSON.parse(
            (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
        );
        expect(body.contents[0].parts[0].text).toContain('Custom: translate to Pirate English');
    });

    it('should append glossary entries to provider prompts', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('團本'));

        await translate('raid tonight', 'zh-TW', {
            glossaryEntries: [
                {
                    sourceText: 'raid',
                    targetText: '團本',
                    notes: 'Game term',
                },
            ],
        });

        const body = JSON.parse(
            (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
        );
        expect(body.contents[0].parts[0].text).toContain('Server glossary');
        expect(body.contents[0].parts[0].text).toContain('- raid => 團本 (Game term)');
    });

    it('should use targeted prompt for specific language', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('こんにちは'));

        await translate('Hello', 'ja');

        const body = JSON.parse(
            (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
        );
        expect(body.contents[0].parts[0].text).toContain('Japanese');
    });

    it('should use default prompt for "auto" target', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('你好'));

        await translate('Hello', 'auto');

        const body = JSON.parse(
            (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
        );
        expect(body.contents[0].parts[0].text).toContain('If the text is Chinese');
    });

    it('should use regional URL for non-global location', async () => {
        mockStore._setMock('gcpLocation', 'us-central1');
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('Hello'));

        await translate('你好');

        const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(url).toContain('us-central1-aiplatform.googleapis.com');
    });

    it('should use global URL for global location', async () => {
        mockStore._setMock('gcpLocation', 'global');
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('Hello'));

        await translate('你好');

        const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(url).toContain('aiplatform.googleapis.com');
        expect(url).not.toContain('global-aiplatform');
    });
});
