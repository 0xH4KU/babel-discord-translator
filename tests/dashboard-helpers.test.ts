import { describe, expect, it } from 'vitest';
import { createEmptyAppMetricsSnapshot } from '../src/shared/app-metrics.js';
import { validateConfigUpdate } from '../src/modules/dashboard/config-validation.js';
import { sanitizeGlossaryInput } from '../src/modules/dashboard/glossary-input.js';
import {
    budgetRiskForGuilds,
    buildOperationsGuidance,
    providerModeIncludes,
    providerSummary,
} from '../src/modules/dashboard/operations-summary.js';
import {
    createEmptyRuntimeSnapshot,
    renderPrometheusMetrics,
} from '../src/modules/dashboard/prometheus-metrics.js';

describe('dashboard helper modules', () => {
    it('sanitizes dashboard config updates without allowing protected fields', () => {
        const result = validateConfigUpdate({
            vertexAiApiKey: '••••123456',
            openaiApiKey: '',
            tokenUsage: { hacked: true },
            usageHistory: [{ hacked: true }],
            userLanguagePrefs: { hacked: true },
            cooldownSeconds: '10',
            cacheMaxSize: '500',
            translationProvider: 'vertex+openai',
        });

        expect(result).toEqual({
            valid: true,
            sanitized: {
                cooldownSeconds: 10,
                cacheMaxSize: 500,
                translationProvider: 'vertex+openai',
            },
        });
    });

    it('rejects invalid config and glossary inputs with existing dashboard messages', () => {
        expect(validateConfigUpdate({ cooldownSeconds: 0 })).toMatchObject({
            valid: false,
            error: 'cooldownSeconds must be 1–300',
        });
        expect(sanitizeGlossaryInput({ sourceText: '', targetText: '團本' })).toEqual({
            ok: false,
            error: 'Glossary source and target are required',
        });
        expect(
            sanitizeGlossaryInput({
                id: '2',
                sourceText: ' raid ',
                targetText: ' 團本 ',
                notes: ' Game term ',
            }),
        ).toEqual({
            ok: true,
            value: {
                id: 2,
                sourceText: 'raid',
                targetText: '團本',
                notes: 'Game term',
            },
        });
    });

    it('builds operations summaries from provider, queue, and budget inputs', () => {
        expect(providerModeIncludes('openai+vertex', 'vertex')).toBe(true);
        expect(providerModeIncludes('openai', 'vertex')).toBe(false);

        const providers = {
            vertex: providerSummary(
                {
                    vertex: {
                        successTotal: 1,
                        failureTotal: 0,
                        fallbackFromTotal: 0,
                        fallbackToTotal: 0,
                        lastLatencyMs: 42,
                        lastErrorType: null,
                        lastError: null,
                    },
                },
                'vertex',
                { enabled: true, configured: true },
            ),
            openai: providerSummary({}, 'openai', { enabled: true, configured: false }),
        };
        const budgetRisk = budgetRiskForGuilds([
            {
                id: 'guild-1',
                name: 'Guild One',
                budget: 1,
                totalCost: 0.9,
                exceeded: false,
            },
            {
                id: 'guild-2',
                name: 'Guild Two',
                budget: 2,
                totalCost: 2,
                exceeded: true,
            },
        ]);

        expect(budgetRisk.warningCount).toBe(1);
        expect(budgetRisk.exceededCount).toBe(1);
        expect(
            buildOperationsGuidance({
                providers,
                runtimePressure: { queued: 0, rejectedTotal: 1 },
                budgetRisk,
            }),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ area: 'provider', severity: 'critical' }),
                expect.objectContaining({ area: 'runtime' }),
                expect.objectContaining({ area: 'budget', severity: 'critical' }),
            ]),
        );
    });

    it('renders Prometheus metrics from compact snapshots', () => {
        const metricsSnapshot = createEmptyAppMetricsSnapshot();
        const runtimeSnapshot = createEmptyRuntimeSnapshot();

        const text = renderPrometheusMetrics({
            metricsSnapshot: {
                ...metricsSnapshot,
                providers: {
                    vertex: {
                        successTotal: 1,
                        failureTotal: 0,
                        fallbackFromTotal: 0,
                        fallbackToTotal: 0,
                        lastLatencyMs: 25,
                        lastErrorType: null,
                        lastError: null,
                    },
                },
            },
            cacheStats: {
                hits: 3,
                misses: 2,
                size: 1,
                maxSize: 100,
            },
            runtimeSnapshot: {
                ...runtimeSnapshot,
                queued: 1,
            },
        });

        expect(text).toContain('babel_app_version_info');
        expect(text).toContain(
            'babel_provider_requests_total{provider="vertex",result="success"} 1',
        );
        expect(text).toContain('babel_runtime_queue_depth 1');
        expect(text).toContain('babel_cache_hits_total 3');
    });
});
