import { type AppMetricsSnapshot, type ProviderMetricsSnapshot } from '../../shared/app-metrics.js';
import { getVersionMetadata } from '../../shared/version.js';
import {
    DEFAULT_TRANSLATION_RUNTIME_LIMITS,
    type TranslationRuntimeSnapshot,
} from '../translation/translation-runtime-limiter.js';

const EMPTY_PROVIDER_METRICS: ProviderMetricsSnapshot = {
    successTotal: 0,
    failureTotal: 0,
    fallbackFromTotal: 0,
    fallbackToTotal: 0,
    lastLatencyMs: null,
    lastErrorType: null,
    lastError: null,
};

interface CacheStatsSnapshot {
    hits: number;
    misses: number;
    size: number;
    maxSize: number;
}

export function createEmptyRuntimeSnapshot(): TranslationRuntimeSnapshot {
    return {
        inflight: 0,
        queued: 0,
        rejectedTotal: 0,
        rejectionCounts: {
            user_queue_full: 0,
            guild_queue_full: 0,
            global_queue_full: 0,
            queue_wait_timeout: 0,
        },
        limits: { ...DEFAULT_TRANSLATION_RUNTIME_LIMITS },
    };
}

function escapePrometheusLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function metricValue(value: number): string {
    return Number.isFinite(value) ? String(value) : '0';
}

function metricLine(
    name: string,
    value: number,
    labels: Record<string, string | number | boolean> = {},
): string {
    const labelEntries = Object.entries(labels);
    const labelText =
        labelEntries.length > 0
            ? `{${labelEntries
                  .map(
                      ([key, labelValue]) =>
                          `${key}="${escapePrometheusLabel(String(labelValue))}"`,
                  )
                  .join(',')}}`
            : '';

    return `${name}${labelText} ${metricValue(value)}`;
}

export function renderPrometheusMetrics({
    metricsSnapshot,
    cacheStats,
    runtimeSnapshot,
}: {
    metricsSnapshot: AppMetricsSnapshot;
    cacheStats: CacheStatsSnapshot;
    runtimeSnapshot: TranslationRuntimeSnapshot;
}): string {
    const version = getVersionMetadata();
    const providerNames = new Set(['vertex', 'openai', ...Object.keys(metricsSnapshot.providers)]);
    const lines: string[] = [
        '# HELP babel_app_version_info Babel application version metadata.',
        '# TYPE babel_app_version_info gauge',
        metricLine('babel_app_version_info', 1, {
            version: version.version,
            repository_url: version.repositoryUrl,
        }),
        '# HELP babel_translations_total Successful translation count.',
        '# TYPE babel_translations_total counter',
        metricLine('babel_translations_total', metricsSnapshot.translationsTotal),
        '# HELP babel_translation_api_calls_total Provider API call count.',
        '# TYPE babel_translation_api_calls_total counter',
        metricLine('babel_translation_api_calls_total', metricsSnapshot.translationApiCallsTotal),
        '# HELP babel_translation_cache_hits_total Translation cache hits recorded by workflow.',
        '# TYPE babel_translation_cache_hits_total counter',
        metricLine('babel_translation_cache_hits_total', metricsSnapshot.translationCacheHitsTotal),
        '# HELP babel_translation_failures_total Failed translation count.',
        '# TYPE babel_translation_failures_total counter',
        metricLine('babel_translation_failures_total', metricsSnapshot.translationFailuresTotal),
        '# HELP babel_budget_blocks_total Requests blocked by daily budget guard.',
        '# TYPE babel_budget_blocks_total counter',
        metricLine('babel_budget_blocks_total', metricsSnapshot.budgetExceededTotal),
        '# HELP babel_webhook_recreate_total Webhook recovery count.',
        '# TYPE babel_webhook_recreate_total counter',
        metricLine('babel_webhook_recreate_total', metricsSnapshot.webhookRecreateTotal),
        '# HELP babel_cache_hits_total Raw translation cache hit count.',
        '# TYPE babel_cache_hits_total counter',
        metricLine('babel_cache_hits_total', cacheStats.hits),
        '# HELP babel_cache_misses_total Raw translation cache miss count.',
        '# TYPE babel_cache_misses_total counter',
        metricLine('babel_cache_misses_total', cacheStats.misses),
        '# HELP babel_cache_entries Current translation cache entry count.',
        '# TYPE babel_cache_entries gauge',
        metricLine('babel_cache_entries', cacheStats.size),
        '# HELP babel_cache_max_entries Translation cache capacity.',
        '# TYPE babel_cache_max_entries gauge',
        metricLine('babel_cache_max_entries', cacheStats.maxSize),
        '# HELP babel_provider_requests_total Provider request result counters.',
        '# TYPE babel_provider_requests_total counter',
    ];

    for (const provider of Array.from(providerNames).sort()) {
        const providerMetrics = metricsSnapshot.providers[provider] ?? EMPTY_PROVIDER_METRICS;
        lines.push(
            metricLine('babel_provider_requests_total', providerMetrics.successTotal, {
                provider,
                result: 'success',
            }),
            metricLine('babel_provider_requests_total', providerMetrics.failureTotal, {
                provider,
                result: 'failure',
            }),
            metricLine('babel_provider_fallback_from_total', providerMetrics.fallbackFromTotal, {
                provider,
            }),
            metricLine('babel_provider_fallback_to_total', providerMetrics.fallbackToTotal, {
                provider,
            }),
        );

        if (providerMetrics.lastLatencyMs !== null) {
            lines.push(
                metricLine('babel_provider_last_latency_ms', providerMetrics.lastLatencyMs, {
                    provider,
                }),
            );
        }
    }

    lines.push(
        '# HELP babel_provider_fallback_total Provider fallback count.',
        '# TYPE babel_provider_fallback_total counter',
        metricLine('babel_provider_fallback_total', metricsSnapshot.providerFallbackTotal),
        '# HELP babel_runtime_inflight Current active translation requests.',
        '# TYPE babel_runtime_inflight gauge',
        metricLine('babel_runtime_inflight', runtimeSnapshot.inflight),
        '# HELP babel_runtime_queue_depth Current queued translation requests.',
        '# TYPE babel_runtime_queue_depth gauge',
        metricLine('babel_runtime_queue_depth', runtimeSnapshot.queued),
        '# HELP babel_runtime_rejections_all_total Total translation runtime rejection count.',
        '# TYPE babel_runtime_rejections_all_total counter',
        metricLine('babel_runtime_rejections_all_total', runtimeSnapshot.rejectedTotal),
        '# HELP babel_runtime_rejections_total Translation runtime rejection count by reason.',
        '# TYPE babel_runtime_rejections_total counter',
    );

    for (const [reason, count] of Object.entries(runtimeSnapshot.rejectionCounts)) {
        lines.push(metricLine('babel_runtime_rejections_total', count, { reason }));
    }

    lines.push(
        '# HELP babel_runtime_limit Runtime limiter configured limits.',
        '# TYPE babel_runtime_limit gauge',
        metricLine('babel_runtime_limit', runtimeSnapshot.limits.maxConcurrent, {
            limit: 'max_concurrent',
        }),
        metricLine('babel_runtime_limit', runtimeSnapshot.limits.maxGlobalQueue, {
            limit: 'max_global_queue',
        }),
        metricLine('babel_runtime_limit', runtimeSnapshot.limits.maxGuildQueue, {
            limit: 'max_guild_queue',
        }),
        metricLine('babel_runtime_limit', runtimeSnapshot.limits.maxUserOutstanding, {
            limit: 'max_user_outstanding',
        }),
        metricLine('babel_runtime_limit', runtimeSnapshot.limits.maxQueueWaitMs, {
            limit: 'max_queue_wait_ms',
        }),
    );

    return `${lines.join('\n')}\n`;
}
