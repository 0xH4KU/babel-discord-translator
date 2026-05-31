import { describe, expect, it, vi } from 'vitest';
import {
    createProviderOrchestrator,
    type TranslationProvider,
} from '../src/infra/provider-orchestrator.js';
import { AppMetrics } from '../src/shared/app-metrics.js';

function provider(name: string, behavior: 'ok' | 'fail'): TranslationProvider {
    return {
        name,
        isConfigured: () => true,
        translate: vi.fn(async () => {
            if (behavior === 'fail') throw new Error(`${name} failed`);
            return { text: `${name} result`, inputTokens: 1, outputTokens: 1 };
        }),
    };
}

describe('ProviderOrchestrator diagnostics', () => {
    it('records primary provider success', async () => {
        const metrics = new AppMetrics();
        const orchestrator = createProviderOrchestrator(
            'vertex',
            new Map([['vertex', provider('vertex', 'ok')]]),
            { metrics },
        );

        await orchestrator.translate('prompt', 100);

        expect(metrics.snapshot().providers.vertex.successTotal).toBe(1);
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

        const result = await orchestrator.translate('prompt', 100);

        expect(result.provider).toBe('openai');
        expect(result.fallback).toBe(true);
        expect(metrics.snapshot().providers.vertex.failureTotal).toBe(1);
        expect(metrics.snapshot().providers.vertex.fallbackFromTotal).toBe(1);
        expect(metrics.snapshot().providers.openai.fallbackToTotal).toBe(1);
        expect(metrics.snapshot().providerFallbackTotal).toBe(1);
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

        await expect(orchestrator.translate('prompt', 100)).rejects.toThrow('openai failed');

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
            await orchestrator.translate('prompt', 100);
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

        await orchestrator.translate('prompt', 100);
        await orchestrator.translate('prompt', 100);

        expect(vertex.translate).toHaveBeenCalledTimes(1);
        expect(openai.translate).toHaveBeenCalledTimes(2);
        expect(metrics.snapshot().providers.vertex.failureTotal).toBe(1);
    });
});
