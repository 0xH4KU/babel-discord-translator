import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import rateLimit from 'express-rate-limit';
import {
    type AppMetricsSnapshot,
    createEmptyAppMetricsSnapshot,
    type ProviderMetricsSnapshot,
} from '../../shared/app-metrics.js';
import { getConfig } from '../config/config.js';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../shared/health.js';
import { usage } from '../usage/usage.js';
import {
    DEFAULT_TRANSLATION_RUNTIME_LIMITS,
    type TranslationRuntimeSnapshot,
} from '../translation/translation-runtime-limiter.js';
import { translate } from '../translation/translate.js';
import { createDashboardAuth } from './auth/dashboard-auth.js';
import { SQLiteSessionRepository } from './auth/sqlite-session-repository.js';
import { checkVertexAiHealth } from '../../infra/vertex-ai-client.js';
import { checkOpenAiHealth } from '../../infra/openai-client.js';
import { configRepository } from '../config/config-repository.js';
import { guildBudgetRepository } from '../usage/guild-budget-repository.js';
import { userPreferenceRepository } from '../translation/user-preference-repository.js';
import { applyConfigUpdateEffects } from '../config/config-runtime-effects.js';
import { appLogger } from '../../shared/structured-logger.js';
import { dashboardMessages } from '../../shared/messages/dashboard-messages.js';
import { getVersionMetadata } from '../../shared/version.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DashboardDeps, StoreData, TranslationProviderMode } from '../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_CACHE_SIZE = 2000;
const BYTES_PER_MB = 1024 * 1024;
const BUDGET_WARNING_THRESHOLD = 0.8;
const EMPTY_PROVIDER_METRICS: ProviderMetricsSnapshot = {
    successTotal: 0,
    failureTotal: 0,
    fallbackFromTotal: 0,
    fallbackToTotal: 0,
    lastLatencyMs: null,
    lastErrorType: null,
    lastError: null,
};

type BudgetRiskItem = {
    id: string;
    name: string;
    budget: number;
    totalCost: number;
    usedPercent: number;
};

type OperationsGuidanceItem = {
    area: 'provider' | 'runtime' | 'budget';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    action: string;
};

function providerModeIncludes(
    mode: TranslationProviderMode,
    provider: 'vertex' | 'openai',
): boolean {
    return mode.split('+').includes(provider);
}

function budgetRiskForGuilds(
    guildBudgetList: Array<{
        id: string;
        name: string;
        budget: number;
        totalCost: number;
        exceeded: boolean;
    }>,
): {
    warningCount: number;
    exceededCount: number;
    warnings: BudgetRiskItem[];
    exceeded: BudgetRiskItem[];
} {
    const warnings: BudgetRiskItem[] = [];
    const exceeded: BudgetRiskItem[] = [];

    for (const guildBudget of guildBudgetList) {
        if (guildBudget.budget <= 0) {
            continue;
        }

        const usedPercent = guildBudget.totalCost / guildBudget.budget;
        const item = {
            id: guildBudget.id,
            name: guildBudget.name,
            budget: guildBudget.budget,
            totalCost: guildBudget.totalCost,
            usedPercent,
        };

        if (guildBudget.exceeded) {
            exceeded.push(item);
        } else if (usedPercent >= BUDGET_WARNING_THRESHOLD) {
            warnings.push(item);
        }
    }

    return {
        warningCount: warnings.length,
        exceededCount: exceeded.length,
        warnings,
        exceeded,
    };
}

function providerSummary(
    metrics: Record<string, ProviderMetricsSnapshot>,
    provider: 'vertex' | 'openai',
    options: { enabled: boolean; configured: boolean },
): ProviderMetricsSnapshot & { enabled: boolean; configured: boolean } {
    return {
        enabled: options.enabled,
        configured: options.configured,
        ...(metrics[provider] ?? EMPTY_PROVIDER_METRICS),
    };
}

function buildOperationsGuidance({
    providers,
    runtimePressure,
    budgetRisk,
}: {
    providers: Record<
        'vertex' | 'openai',
        ProviderMetricsSnapshot & { enabled: boolean; configured: boolean }
    >;
    runtimePressure: {
        queued: number;
        rejectedTotal: number;
    };
    budgetRisk: {
        warningCount: number;
        exceededCount: number;
    };
}): OperationsGuidanceItem[] {
    const guidance: OperationsGuidanceItem[] = [];

    for (const [provider, summary] of Object.entries(providers)) {
        if (summary.enabled && !summary.configured) {
            guidance.push({
                area: 'provider',
                severity: 'critical',
                title: `${provider} setup is incomplete`,
                action: 'Open Settings and complete the enabled provider configuration.',
            });
            continue;
        }

        if (summary.enabled && summary.lastErrorType) {
            guidance.push({
                area: 'provider',
                severity: summary.lastErrorType === 'auth' ? 'warning' : 'info',
                title: `${provider} reported ${summary.lastErrorType}`,
                action: 'Review provider credentials, fallback mode, and recent error logs.',
            });
        }
    }

    if (runtimePressure.rejectedTotal > 0) {
        guidance.push({
            area: 'runtime',
            severity: runtimePressure.queued > 0 ? 'warning' : 'info',
            title: 'Translation queue rejected requests',
            action: 'Review runtime pressure and reduce concurrency or raise queue limits.',
        });
    }

    if (budgetRisk.exceededCount > 0) {
        guidance.push({
            area: 'budget',
            severity: 'critical',
            title: 'Server budget exceeded',
            action: 'Raise the affected server budget or wait for the daily reset.',
        });
    } else if (budgetRisk.warningCount > 0) {
        guidance.push({
            area: 'budget',
            severity: 'warning',
            title: 'Server budget nearing limit',
            action: 'Review per-server usage and adjust budgets before translations are blocked.',
        });
    }

    return guidance;
}

function applySecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "connect-src 'self'",
            "img-src 'self' data: https:",
            "font-src 'self' https://fonts.gstatic.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "script-src 'self' 'unsafe-inline'",
        ].join('; '),
    );
    next();
}

function createEmptyRuntimeSnapshot(): TranslationRuntimeSnapshot {
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

function renderPrometheusMetrics({
    metricsSnapshot,
    cacheStats,
    runtimeSnapshot,
}: {
    metricsSnapshot: AppMetricsSnapshot;
    cacheStats: ReturnType<DashboardDeps['cache']['stats']>;
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
        '# HELP babel_runtime_rejections_total Translation runtime rejection count.',
        '# TYPE babel_runtime_rejections_total counter',
        metricLine('babel_runtime_rejections_total', runtimeSnapshot.rejectedTotal),
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

/** Wrap an async Express handler to forward errors to Express error handling (Express 4 compat). */
function asyncHandler(
    fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
        fn(req, res).catch(next);
    };
}

declare module 'express-serve-static-core' {
    interface Locals {
        disposeDashboardApp?: () => void;
    }
}

function validateConfigUpdate(updates: Record<string, unknown>): {
    valid: boolean;
    error?: string;
    sanitized: Partial<StoreData>;
} {
    const sanitized: Record<string, unknown> = { ...updates };

    if (!sanitized.vertexAiApiKey || String(sanitized.vertexAiApiKey).startsWith('••••')) {
        delete sanitized.vertexAiApiKey;
    }

    if (!sanitized.openaiApiKey || String(sanitized.openaiApiKey).startsWith('••••')) {
        delete sanitized.openaiApiKey;
    }

    delete sanitized.tokenUsage;
    delete sanitized.usageHistory;
    delete sanitized.userLanguagePrefs;
    delete sanitized.guildBudgets;
    delete sanitized.guildTokenUsage;
    delete sanitized.guildUsageHistory;

    if (sanitized.cooldownSeconds !== undefined) {
        const v = parseInt(String(sanitized.cooldownSeconds));
        if (isNaN(v) || v < 1 || v > 300) {
            return {
                valid: false,
                error: dashboardMessages.validation.cooldownSeconds,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.cooldownSeconds = v;
    }
    if (sanitized.cacheMaxSize !== undefined) {
        const v = parseInt(String(sanitized.cacheMaxSize));
        if (isNaN(v) || v < 10 || v > MAX_CACHE_SIZE) {
            return {
                valid: false,
                error: dashboardMessages.validation.cacheMaxSize,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.cacheMaxSize = v;
    }
    if (sanitized.maxInputLength !== undefined) {
        const v = parseInt(String(sanitized.maxInputLength));
        if (isNaN(v) || v < 100 || v > 10000) {
            return {
                valid: false,
                error: dashboardMessages.validation.maxInputLength,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.maxInputLength = v;
    }
    if (sanitized.maxOutputTokens !== undefined) {
        const v = parseInt(String(sanitized.maxOutputTokens));
        if (isNaN(v) || v < 100 || v > 8192) {
            return {
                valid: false,
                error: dashboardMessages.validation.maxOutputTokens,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.maxOutputTokens = v;
    }
    if (sanitized.dailyBudgetUsd !== undefined) {
        const v = parseFloat(String(sanitized.dailyBudgetUsd));
        if (isNaN(v) || v < 0) {
            return {
                valid: false,
                error: dashboardMessages.validation.dailyBudgetUsd,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.dailyBudgetUsd = v;
    }
    for (const key of [
        'translationMaxConcurrent',
        'translationMaxGlobalQueue',
        'translationMaxGuildQueue',
        'translationMaxUserOutstanding',
        'translationMaxQueueWaitMs',
    ] as const) {
        if (sanitized[key] !== undefined) {
            const v = parseInt(String(sanitized[key]));
            if (isNaN(v) || v < 1) {
                return {
                    valid: false,
                    error: `${key} must be a positive integer`,
                    sanitized: sanitized as Partial<StoreData>,
                };
            }
            sanitized[key] = v;
        }
    }
    if (sanitized.inputPricePerMillion !== undefined) {
        const v = parseFloat(String(sanitized.inputPricePerMillion));
        if (isNaN(v) || v < 0) {
            return {
                valid: false,
                error: dashboardMessages.validation.inputPricePerMillion,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.inputPricePerMillion = v;
    }
    if (sanitized.outputPricePerMillion !== undefined) {
        const v = parseFloat(String(sanitized.outputPricePerMillion));
        if (isNaN(v) || v < 0) {
            return {
                valid: false,
                error: dashboardMessages.validation.outputPricePerMillion,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.outputPricePerMillion = v;
    }

    if (sanitized.translationProvider !== undefined) {
        const valid = ['vertex', 'openai', 'vertex+openai', 'openai+vertex'];
        if (!valid.includes(String(sanitized.translationProvider))) {
            return {
                valid: false,
                error: dashboardMessages.validation.translationProvider,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
    }

    return { valid: true, sanitized: sanitized as Partial<StoreData> };
}

export function createDashboardApp({
    cache,
    cooldown,
    log,
    client,
    getStats,
    metrics,
    runtimeLimiter,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    sessionRepository,
    healthProbeCacheTtlMs = 5_000,
}: DashboardDeps): express.Express {
    const app = express();
    const config = getConfig();
    const auth = createDashboardAuth({
        password: config.dashboardPassword,
        sessionRepository: sessionRepository ?? new SQLiteSessionRepository(),
    });

    app.locals.disposeDashboardApp = () => {
        auth.dispose();
    };

    app.use(applySecurityHeaders);
    app.use(express.json());
    app.use(express.static(join(__dirname, '../../public')));

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: { error: dashboardMessages.auth.tooManyLoginAttempts },
        standardHeaders: true,
        legacyHeaders: false,
    });

    app.post('/api/login', loginLimiter, (req: Request, res: Response) => {
        const result = auth.login(req.body.password, req);
        if (!result.ok) {
            res.status(401).json({ error: dashboardMessages.auth.wrongPassword });
            return;
        }

        res.setHeader('Set-Cookie', result.cookie);
        res.json({ ok: true, csrfToken: result.csrfToken });
    });

    app.get('/api/auth/check', (req: Request, res: Response) => {
        res.json(auth.check(req));
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        res.setHeader('Set-Cookie', auth.logout(req).cookie);
        res.json({ ok: true });
    });

    app.get('/livez', (_req: Request, res: Response) => {
        const health = getLivenessStatus();
        res.status(health.live ? 200 : 503).json(health);
    });

    app.get(
        '/readyz',
        asyncHandler(async (_req: Request, res: Response) => {
            const health = await getReadinessStatus({
                healthCheck,
                openAiHealthCheck,
                cacheTtlMs: healthProbeCacheTtlMs,
            });
            res.status(health.ready ? 200 : 503).json(health);
        }),
    );

    app.get(
        '/healthz',
        asyncHandler(async (_req: Request, res: Response) => {
            const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
            const health = await getHealthStatus(
                { healthCheck, openAiHealthCheck, cacheTtlMs: healthProbeCacheTtlMs },
                metricsSnapshot,
            );
            res.status(health.live ? 200 : 503).json(health);
        }),
    );

    app.get('/metrics', (_req: Request, res: Response) => {
        const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
        const runtimeSnapshot = runtimeLimiter?.snapshot() ?? createEmptyRuntimeSnapshot();

        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(
            renderPrometheusMetrics({
                metricsSnapshot,
                cacheStats: cache.stats(),
                runtimeSnapshot,
            }),
        );
    });

    app.get('/api/setup-status', auth.requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: configRepository.isSetupComplete() });
    });

    app.get('/api/version', auth.requireAuth, (_req: Request, res: Response) => {
        res.json(getVersionMetadata());
    });

    app.get('/api/sessions', auth.requireAuth, (req: Request, res: Response) => {
        res.json({ sessions: auth.listSessions(req) });
    });

    app.post(
        '/api/sessions/revoke',
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const id = typeof req.body.id === 'string' ? req.body.id.trim() : '';
            if (!id) {
                res.status(400).json({ error: 'Session id is required' });
                return;
            }

            const result = auth.revokeSession(req, id);
            if (!result.revoked) {
                res.status(404).json({ error: 'Session not found' });
                return;
            }

            if (result.current) {
                res.setHeader('Set-Cookie', auth.logout(req).cookie);
            }

            res.json({ ok: true, revoked: true, current: result.current });
        },
    );

    app.get('/api/stats', auth.requireAuth, (_req: Request, res: Response) => {
        const stats = getStats();
        const cacheStats = cache.stats();
        const usageStats = usage.getStats();
        const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
        const memoryUsage = process.memoryUsage();
        const rssMB = (memoryUsage.rss / BYTES_PER_MB).toFixed(1);
        const heapUsedMB = (memoryUsage.heapUsed / BYTES_PER_MB).toFixed(1);
        const externalMB = (memoryUsage.external / BYTES_PER_MB).toFixed(1);
        const runtimeSnapshot = runtimeLimiter?.snapshot() ?? createEmptyRuntimeSnapshot();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const providerMode = runtimeConfig.translationProvider || 'vertex';

        const guildIds = client.guilds.cache.map((guild) => guild.id);
        const guildBudgetConfigs = guildBudgetRepository.listBudgets();
        const guildStatsById = guildIds.length > 0 ? usage.getGuildStatsForGuilds(guildIds) : {};
        const guildBudgetList = client.guilds.cache.map((guild) => {
            const guildCfg = guildBudgetConfigs[guild.id];
            const hasCustom = guildCfg && guildCfg.dailyBudgetUsd !== undefined;
            const guildStats = guildStatsById[guild.id];
            const budget = guildStats?.dailyBudget ?? usageStats.dailyBudget;
            const totalCost = guildStats?.totalCost ?? 0;
            const requests = guildStats?.requests ?? 0;
            return {
                id: guild.id,
                name: guild.name,
                budget,
                isCustom: hasCustom,
                totalCost,
                requests,
                exceeded: budget > 0 && totalCost >= budget,
            };
        });
        const vertexEnabled = providerModeIncludes(providerMode, 'vertex');
        const openAiEnabled = providerModeIncludes(providerMode, 'openai');
        const providers = {
            vertex: providerSummary(metricsSnapshot.providers, 'vertex', {
                enabled: vertexEnabled,
                configured: Boolean(runtimeConfig.vertexAiApiKey && runtimeConfig.gcpProject),
            }),
            openai: providerSummary(metricsSnapshot.providers, 'openai', {
                enabled: openAiEnabled,
                configured: Boolean(
                    runtimeConfig.openaiApiKey &&
                    runtimeConfig.openaiBaseUrl &&
                    runtimeConfig.openaiModel,
                ),
            }),
        };
        const runtimePressure = {
            inflight: runtimeSnapshot.inflight,
            queued: runtimeSnapshot.queued,
            rejectedTotal: runtimeSnapshot.rejectedTotal,
            rejectionCounts: runtimeSnapshot.rejectionCounts,
            limits: runtimeSnapshot.limits,
        };
        const budgetRisk = budgetRiskForGuilds(guildBudgetList);
        const operations = {
            providerMode,
            providers,
            fallbackTotal: metricsSnapshot.providerFallbackTotal,
            lastFallback: metricsSnapshot.lastProviderFallback,
            runtimePressure,
            budgetRisk,
            guidance: buildOperationsGuidance({
                providers,
                runtimePressure,
                budgetRisk,
            }),
        };

        res.json({
            bot: {
                name: client.user?.tag || 'Unknown',
                avatar: client.user?.displayAvatarURL({ size: 64 }) || '',
                uptime: Math.floor(process.uptime()),
                memoryMB: rssMB,
                memory: {
                    rssMB,
                    heapUsedMB,
                    externalMB,
                },
                guilds: client.guilds.cache.size,
            },
            translations: {
                total: stats.totalTranslations,
                apiCalls: stats.apiCalls,
                saved: cacheStats.hits,
                failures: metricsSnapshot.translationFailuresTotal,
                failureRate: metricsSnapshot.translationFailureRate,
                cacheHits: metricsSnapshot.translationCacheHitsTotal,
                cacheHitRate: metricsSnapshot.translationCacheHitRate,
                budgetExceeded: metricsSnapshot.budgetExceededTotal,
                webhookRecreated: metricsSnapshot.webhookRecreateTotal,
            },
            metrics: metricsSnapshot,
            runtime: runtimeSnapshot,
            operations,
            cache: cacheStats,
            usage: usageStats,
            guildBudgets: guildBudgetList,
            errors: log.errorCount,
        });
    });

    app.get('/api/config', auth.requireAuth, (_req: Request, res: Response) => {
        const cfg = configRepository.getDashboardConfig();
        res.json({
            ...cfg,
            vertexAiApiKey: cfg.vertexAiApiKey ? '••••' + cfg.vertexAiApiKey.slice(-6) : '',
            hasApiKey: !!cfg.vertexAiApiKey,
            openaiApiKey: cfg.openaiApiKey ? '••••' + cfg.openaiApiKey.slice(-6) : '',
            hasOpenaiApiKey: !!cfg.openaiApiKey,
        });
    });

    app.post('/api/config', auth.requireAuth, auth.requireCsrf, (req: Request, res: Response) => {
        const { valid, error, sanitized } = validateConfigUpdate(req.body);
        if (!valid) {
            res.status(400).json({ error });
            return;
        }

        const currentConfig = configRepository.getDashboardConfig();
        const effects = applyConfigUpdateEffects(currentConfig, sanitized, { cache, cooldown });

        configRepository.updateConfig(sanitized);

        res.json({
            ok: true,
            cacheCleared: effects.cacheCleared,
            changedKeys: effects.changedKeys,
            immediateEffects: effects.immediateEffects,
        });
    });

    app.get('/api/guilds', auth.requireAuth, (_req: Request, res: Response) => {
        const guilds = client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 32 }) || '',
            memberCount: g.memberCount,
        }));
        res.json(guilds);
    });

    app.get('/api/usage/history', auth.requireAuth, (req: Request, res: Response) => {
        const guildId = req.query.guildId as string | undefined;
        if (guildId) {
            res.json(usage.getGuildHistory(guildId));
        } else {
            res.json(usage.getHistory());
        }
    });

    app.get('/api/guild-budgets', auth.requireAuth, (_req: Request, res: Response) => {
        const guildBudgets = guildBudgetRepository.listBudgets();
        const guilds = client.guilds.cache;
        const guildIds = guilds.map((guild) => guild.id);
        const guildStatsById = guildIds.length > 0 ? usage.getGuildStatsForGuilds(guildIds) : {};
        const result: Record<
            string,
            { name: string; budget: number; usage: ReturnType<typeof usage.getGuildStats> }
        > = {};

        for (const [id, guild] of guilds) {
            result[id] = {
                name: guild.name,
                budget: guildBudgets[id]?.dailyBudgetUsd ?? -1,
                usage: guildStatsById[id] ?? usage.getGuildStats(id),
            };
        }
        res.json(result);
    });

    app.post(
        '/api/guild-budgets/:guildId',
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const guildId = req.params.guildId as string;
            const { dailyBudgetUsd } = req.body;

            if (dailyBudgetUsd === null || dailyBudgetUsd === undefined) {
                guildBudgetRepository.clearBudget(guildId);
                res.json({ ok: true, mode: 'global' });
                return;
            }

            const v = parseFloat(String(dailyBudgetUsd));
            if (isNaN(v) || v < 0) {
                res.status(400).json({ error: dashboardMessages.validation.dailyBudgetUsd });
                return;
            }

            guildBudgetRepository.setBudget(guildId, v);
            res.json({ ok: true, budget: v });
        },
    );

    app.get('/api/logs', auth.requireAuth, (req: Request, res: Response) => {
        const count = Math.min(parseInt(req.query.count as string) || 50, 200);
        const filter = req.query.filter as string | undefined;
        const errorType = req.query.errorType as string | undefined;
        if (errorType) {
            if (filter && filter !== 'error') {
                res.status(400).json({ error: 'errorType filter requires error logs' });
                return;
            }

            const entries = log
                .getRecent(log.size, 'error')
                .filter((entry) => entry.type === 'error' && entry.errorType === errorType)
                .slice(0, count);
            res.json(entries);
            return;
        }

        const entries = log.getRecent(count, filter);
        res.json(entries);
    });

    app.get('/api/user-prefs', auth.requireAuth, (_req: Request, res: Response) => {
        const prefs = userPreferenceRepository.listPreferences();
        res.json({
            prefs,
            count: Object.keys(prefs).length,
        });
    });

    app.post(
        '/api/user-prefs/batch-delete',
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const userIds: string[] = Array.isArray(req.body.userIds)
                ? req.body.userIds
                      .map((userId: unknown) => String(userId).trim())
                      .filter((userId: string) => userId.length > 0)
                : [];

            if (userIds.length === 0) {
                res.status(400).json({ error: 'userIds must be a non-empty array' });
                return;
            }

            const deleted: string[] = [];
            const notFound: string[] = [];

            for (const userId of [...new Set(userIds)]) {
                if (userPreferenceRepository.clearLanguage(userId)) {
                    deleted.push(userId);
                } else {
                    notFound.push(userId);
                }
            }

            res.json({ ok: true, deleted, notFound });
        },
    );

    app.delete(
        '/api/user-prefs/:userId',
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const userId = req.params.userId as string;
            if (userPreferenceRepository.clearLanguage(userId)) {
                res.json({ ok: true, deleted: userId });
            } else {
                res.status(404).json({ error: dashboardMessages.userPreferences.notFound });
            }
        },
    );

    app.post(
        '/api/cache/clear',
        auth.requireAuth,
        auth.requireCsrf,
        (_req: Request, res: Response) => {
            const before = cache.stats();
            cache.clear();
            res.json({ ok: true, cleared: before.size });
        },
    );

    app.post(
        '/api/translate/test',
        auth.requireAuth,
        auth.requireCsrf,
        asyncHandler(async (req: Request, res: Response) => {
            const { text, targetLanguage } = req.body;
            if (!text?.trim()) {
                res.status(400).json({ error: dashboardMessages.translationTest.textRequired });
                return;
            }
            try {
                const start = Date.now();
                const result = await translate(text, targetLanguage || 'auto');
                usage.record(result.inputTokens, result.outputTokens);
                res.json({
                    ok: true,
                    translation: result.text,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    latencyMs: Date.now() - start,
                });
            } catch (err) {
                res.status(500).json({ error: (err as Error).message });
            }
        }),
    );

    app.get(
        '/api/health',
        auth.requireAuth,
        asyncHandler(async (_req: Request, res: Response) => {
            const readiness = await getReadinessStatus({
                healthCheck,
                openAiHealthCheck,
                cacheTtlMs: healthProbeCacheTtlMs,
            });
            res.status(readiness.ready ? 200 : 503).json({
                healthy: readiness.ready,
                readiness: readiness.status,
                vertexAi: readiness.checks.vertexAi,
                checks: readiness.checks,
            });
        }),
    );

    return app;
}

export function startDashboardServer(app: express.Express, port: number): http.Server {
    const logger = appLogger.child({ component: 'dashboard' });
    const server = app.listen(port, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        logger.info('dashboard.server.started', { port: actualPort });
    });

    return server;
}

export function stopDashboardApp(app: express.Express): void {
    app.locals.disposeDashboardApp?.();
}

export const _test = { validateConfigUpdate };
