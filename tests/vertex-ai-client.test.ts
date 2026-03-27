import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkVertexAiHealth, generateTranslationContent, _test } from '../src/infra/vertex-ai-client.js';

vi.mock('../src/store.js', () => {
    const data: Record<string, unknown> = {
        geminiModel: 'gemini-2.5-flash-lite',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        vertexAiApiKey: 'test-api-key',
    };

    return {
        store: {
            get: vi.fn((key: string) => data[key]),
            _setMock: (key: string, value: unknown) => {
                data[key] = value;
            },
        },
    };
});

import { store } from '../src/store.js';

function geminiResponse(text: string, inputTokens = 10, outputTokens = 5) {
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
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should generate translation content via the shared Vertex AI client', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('你好', 15, 8));

        const result = await generateTranslationContent('Translate me', 512);

        expect(result).toEqual({
            text: '你好',
            inputTokens: 15,
            outputTokens: 8,
        });

        const request = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
        const body = JSON.parse(request.body);
        expect(body.generationConfig.maxOutputTokens).toBe(512);
        expect(request.signal).toBeInstanceOf(AbortSignal);
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

        expect(buildGenerateContentUrl({
            apiKey: 'key',
            project: 'project-1',
            location: 'us-central1',
            model: 'gemini-2.5-flash-lite',
        })).toContain('https://us-central1-aiplatform.googleapis.com');
    });
});
