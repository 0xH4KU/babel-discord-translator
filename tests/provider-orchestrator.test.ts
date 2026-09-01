import { describe, expect, it, vi } from 'vitest';
import {
    createProviderOrchestrator,
    type TranslationProvider,
} from '../src/infra/provider-orchestrator.js';
import { AppMetrics } from '../src/shared/app-metrics.js';

const TRANSLATION_PROMPT = { system: 'Translate accurately.', user: 'prompt' };

function provider(
    name: string,
    behavior: 'ok' | 'fail',
    supportsImages = false,
): TranslationProvider {
    return {
        name,
        isConfigured: () => true,
        supportsImageInput: () => supportsImages,
        translate: vi.fn(async () => {
            if (behavior === 'fail') throw new Error(`${name} failed`);
            return { text: `${name} result`, inputTokens: 1, outputTokens: 1 };
        }),
        translateImage: vi.fn(async () => {
            if (behavior === 'fail') throw new Error(`${name} failed`);
            return {
                text: `${name} image result`,
                hasText: true,
                regions: [],
                inputTokens: 2,
                outputTokens: 1,
            };
        }),
    };
}

const IMAGE_REQUEST = {
    image: Buffer.from('image'),
    mimeType: 'image/png' as const,
    prompt: TRANSLATION_PROMPT,
};

describe('ProviderOrchestrator diagnostics', () => {
    it('records primary provider success', async () => {
        const metrics = new AppMetrics();
        const orchestrator = createProviderOrchestrator(
            'vertex',
            new Map([['vertex', provider('vertex', 'ok')]]),
            { metrics },
        );

        await orchestrator.translate(TRANSLATION_PROMPT, 100);

        expect(metrics.snapshot().providers.vertex.successTotal).toBe(1);
        expect(metrics.snapshot().providers.vertex.lastLatencyMs).toBeTypeOf('number');
        expect(metrics.snapshot().providerFallbackTotal).toBe(0);
    });

    it('records fallback after primary failure', async () => {
        const metrics = new AppMetrics();
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', provider('vertex', 'fail')],
                ['openai', provider('openai', 'ok')],
            ]),
            { metrics },
        );

        const result = await orchestrator.translate(TRANSLATION_PROMPT, 100);

        expect(result.provider).toBe('openai');
        expect(result.fallback).toBe(true);
        expect(metrics.snapshot().providers.vertex.failureTotal).toBe(1);
        expect(metrics.snapshot().providers.vertex.fallbackFromTotal).toBe(1);
        expect(metrics.snapshot().providers.openai.fallbackToTotal).toBe(1);
        expect(metrics.snapshot().providerFallbackTotal).toBe(1);
    });

    it('shares one timeout signal across fallback providers', async () => {
        const vertex = provider('vertex', 'fail');
        const openai = provider('openai', 'ok');
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', vertex],
                ['openai', openai],
            ]),
        );

        await orchestrator.translate(TRANSLATION_PROMPT, 100);

        const vertexSignal = vi.mocked(vertex.translate).mock.calls[0]?.[2]?.signal;
        const openAiSignal = vi.mocked(openai.translate).mock.calls[0]?.[2]?.signal;
        expect(vertexSignal).toBeInstanceOf(AbortSignal);
        expect(openAiSignal).toBe(vertexSignal);
    });

    it('does not start a fallback after the shared signal expires', async () => {
        const controller = new AbortController();
        const vertex = provider('vertex', 'fail');
        const openai = provider('openai', 'ok');
        vi.mocked(vertex.translate).mockImplementationOnce(async () => {
            controller.abort(new DOMException('Provider deadline exceeded', 'TimeoutError'));
            throw controller.signal.reason;
        });
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', vertex],
                ['openai', openai],
            ]),
        );

        await expect(
            orchestrator.translate(TRANSLATION_PROMPT, 100, { signal: controller.signal }),
        ).rejects.toMatchObject({ errorType: 'timeout' });
        expect(openai.translate).not.toHaveBeenCalled();
    });

    it('records all provider failures', async () => {
        const metrics = new AppMetrics();
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', provider('vertex', 'fail')],
                ['openai', provider('openai', 'fail')],
            ]),
            { metrics },
        );

        await expect(orchestrator.translate(TRANSLATION_PROMPT, 100)).rejects.toThrow(
            'openai failed',
        );

        expect(metrics.snapshot().providers.vertex.failureTotal).toBe(1);
        expect(metrics.snapshot().providers.openai.failureTotal).toBe(1);
        expect(metrics.snapshot().providerFallbackTotal).toBe(1);
    });

    it('throws the last provider diagnostic when all providers fail', async () => {
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', provider('vertex', 'fail')],
                ['openai', provider('openai', 'fail')],
            ]),
        );

        let thrown: unknown;
        try {
            await orchestrator.translate(TRANSLATION_PROMPT, 100);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).toMatchObject({
            name: 'ProviderOrchestratorError',
            message: 'openai failed',
            provider: 'openai',
            errorType: 'unknown',
        });
    });

    it('opens a circuit breaker after repeated provider failures and uses fallback', async () => {
        const metrics = new AppMetrics();
        const vertex = provider('vertex', 'fail');
        const openai = provider('openai', 'ok');
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', vertex],
                ['openai', openai],
            ]),
            {
                metrics,
                circuitBreaker: {
                    failureThreshold: 1,
                    cooldownMs: 60_000,
                    now: () => 1_000,
                },
            },
        );

        const first = await orchestrator.translate(TRANSLATION_PROMPT, 100);
        const second = await orchestrator.translate(TRANSLATION_PROMPT, 100);

        expect(first.fallback).toBe(true);
        expect(second.fallback).toBe(true);
        expect(vertex.translate).toHaveBeenCalledTimes(1);
        expect(openai.translate).toHaveBeenCalledTimes(2);
        expect(metrics.snapshot().providers.vertex.failureTotal).toBe(1);
        expect(metrics.snapshot().providerFallbackTotal).toBe(2);
        expect(metrics.snapshot().lastProviderFallback).toMatchObject({
            from: 'vertex',
            to: 'openai',
            errorType: 'circuit_open',
        });
    });

    it('routes each image attempt by that provider image capability', async () => {
        const vertex = provider('vertex', 'fail', true);
        const openai = provider('openai', 'ok', false);
        const resolveVision = vi.fn(async () => ({
            hasText: true,
            prompt: TRANSLATION_PROMPT,
            boxes: [[0, 0, 100, 100] as [number, number, number, number]],
        }));
        vi.mocked(openai.translate).mockResolvedValueOnce({
            text: '[[BABEL_REGION_1]] translated',
            inputTokens: 3,
            outputTokens: 2,
        });
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', vertex],
                ['openai', openai],
            ]),
        );

        const result = await orchestrator.translateImage(
            { ...IMAGE_REQUEST, resolveVision },
            100,
        );

        expect(vertex.translateImage).toHaveBeenCalledOnce();
        expect(vertex.translate).not.toHaveBeenCalled();
        expect(openai.translateImage).not.toHaveBeenCalled();
        expect(openai.translate).toHaveBeenCalledOnce();
        expect(resolveVision).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            text: '[1] translated',
            provider: 'openai',
            fallback: true,
            route: 'vision',
            regions: [{ translation: 'translated', box_2d: [0, 0, 100, 100] }],
        });
    });

    it('resolves Cloud Vision only once across text-only provider fallbacks', async () => {
        const vertex = provider('vertex', 'fail');
        const openai = provider('openai', 'ok');
        const resolveVision = vi.fn(async () => ({ hasText: true, prompt: TRANSLATION_PROMPT }));
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', vertex],
                ['openai', openai],
            ]),
        );

        const result = await orchestrator.translateImage(
            { ...IMAGE_REQUEST, resolveVision },
            100,
        );

        expect(resolveVision).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ provider: 'openai', route: 'vision', fallback: true });
    });

    it('does not count Vision resolution errors as provider failures or open its circuit', async () => {
        const metrics = new AppMetrics();
        const vertex = provider('vertex', 'ok');
        const openai = provider('openai', 'ok', true);
        const orchestrator = createProviderOrchestrator(
            'vertex+openai',
            new Map([
                ['vertex', vertex],
                ['openai', openai],
            ]),
            { metrics, circuitBreaker: { failureThreshold: 1 } },
        );
        const resolveVision = vi.fn(async () => {
            throw new Error('Vision unavailable');
        });

        await orchestrator.translateImage({ ...IMAGE_REQUEST, resolveVision }, 100);
        await orchestrator.translateImage({ ...IMAGE_REQUEST, resolveVision }, 100);

        expect(resolveVision).toHaveBeenCalledTimes(2);
        expect(metrics.snapshot().providers.vertex.failureTotal).toBe(0);
        expect(vertex.translate).not.toHaveBeenCalled();
        expect(openai.translateImage).toHaveBeenCalledTimes(2);
    });

    it('returns Vision no-text without calling or failing an AI provider', async () => {
        const metrics = new AppMetrics();
        const vertex = provider('vertex', 'ok');
        const orchestrator = createProviderOrchestrator(
            'vertex',
            new Map([['vertex', vertex]]),
            { metrics },
        );

        const result = await orchestrator.translateImage(
            {
                ...IMAGE_REQUEST,
                resolveVision: async () => ({ hasText: false }),
            },
            100,
        );

        expect(result).toMatchObject({
            hasText: false,
            route: 'vision',
            inputTokens: 0,
            outputTokens: 0,
        });
        expect(vertex.translate).not.toHaveBeenCalled();
        expect(metrics.snapshot().providers.vertex).toBeUndefined();
    });
});
