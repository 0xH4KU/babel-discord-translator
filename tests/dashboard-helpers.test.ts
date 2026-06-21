import { describe, expect, it } from 'vitest';
import { createEmptyAppMetricsSnapshot } from '../src/shared/app-metrics.js';
import { validateConfigUpdate } from '../src/modules/dashboard/config-validation.js';
import {
    parseGlossaryImport,
    sanitizeGlossaryImportRequest,
    sanitizeGlossaryInput,
} from '../src/modules/dashboard/glossary-input.js';
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

    it('parses glossary CSV and TSV imports with optional headers', () => {
        expect(
            parseGlossaryImport(
                'sourceText,targetText,notes\nOpenAI,OpenAI,Preserve brand\n"raid, boss",團本,"Game, term"',
            ),
        ).toEqual({
            ok: true,
            rows: [
                {
                    line: 2,
                    input: {
                        sourceText: 'OpenAI',
                        targetText: 'OpenAI',
                        notes: 'Preserve brand',
                    },
                },
                {
                    line: 3,
                    input: {
                        sourceText: 'raid, boss',
                        targetText: '團本',
                        notes: 'Game, term',
                    },
                },
            ],
        });

        expect(parseGlossaryImport('OpenAI\tOpenAI\nraid\t團本\tGame term')).toEqual({
            ok: true,
            rows: [
                {
                    line: 1,
                    input: { sourceText: 'OpenAI', targetText: 'OpenAI', notes: '' },
                },
                {
                    line: 2,
                    input: { sourceText: 'raid', targetText: '團本', notes: 'Game term' },
                },
            ],
        });
    });

    it('returns row-level errors for invalid glossary import rows', () => {
        expect(parseGlossaryImport('source,target,notes\n,團本\nraid,,Game term')).toEqual({
            ok: true,
            rows: [],
            errors: [
                { line: 2, error: 'Glossary source and target are required' },
                { line: 3, error: 'Glossary source and target are required' },
            ],
        });
    });

    it('rejects malformed or oversized glossary import requests', () => {
        expect(
            sanitizeGlossaryImportRequest({
                text: 'source,target\nOpenAI,OpenAI',
                duplicateMode: 'skip',
            }),
        ).toEqual({
            ok: true,
            value: {
                text: 'source,target\nOpenAI,OpenAI',
                duplicateMode: 'skip',
            },
        });

        expect(
            sanitizeGlossaryImportRequest({
                text: 'source,target\nOpenAI,OpenAI',
                duplicateMode: 'replace',
            }),
        ).toEqual({ ok: false, error: 'Glossary import duplicate mode must be skip or overwrite' });

        expect(sanitizeGlossaryImportRequest({ text: '', duplicateMode: 'skip' })).toEqual({
            ok: false,
            error: 'Glossary import text is required',
        });

        expect(parseGlossaryImport('"unterminated,OpenAI')).toEqual({
            ok: true,
            rows: [],
            errors: [{ line: 1, error: 'Malformed CSV row' }],
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
                rejectedTotal: 2,
                rejectionCounts: {
                    ...runtimeSnapshot.rejectionCounts,
                    user_queue_full: 2,
                },
            },
        });

        expect(text).toContain('babel_app_version_info');
        expect(text).toContain(
            'babel_provider_requests_total{provider="vertex",result="success"} 1',
        );
        expect(text).toContain('babel_runtime_queue_depth 1');
        expect(text).toContain('babel_runtime_rejections_all_total 2');
        expect(text).toContain('babel_runtime_rejections_total{reason="user_queue_full"} 2');
        expect(text).not.toContain('\nbabel_runtime_rejections_total 2\n');
        expect(text).toContain('babel_cache_hits_total 3');
    });
});
