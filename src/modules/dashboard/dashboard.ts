import express, { type Request, type Response } from 'express';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { createEmptyAppMetricsSnapshot } from '../../shared/app-metrics.js';
import { getConfig } from '../config/config.js';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../shared/health.js';
import { usage } from '../usage/usage.js';
import { DEFAULT_TRANSLATION_RUNTIME_LIMITS } from '../translation/translation-runtime-limiter.js';
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
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DashboardDeps, StoreData } from '../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_CACHE_SIZE = 2000;
const BYTES_PER_MB = 1024 * 1024;

/** Wrap an async Express handler to forward errors to Express error handling (Express 4 compat). */
function asyncHandler(
    fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: import('express').NextFunction) => void {
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
    sessionRepository,
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
            const health = await getReadinessStatus({ healthCheck });
            res.status(health.ready ? 200 : 503).json(health);
        }),
    );

    app.get(
        '/healthz',
        asyncHandler(async (_req: Request, res: Response) => {
            const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
            const health = await getHealthStatus({ healthCheck }, metricsSnapshot);
            res.status(health.live ? 200 : 503).json(health);
        }),
    );

    app.get('/api/setup-status', auth.requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: configRepository.isSetupComplete() });
    });

    app.get('/api/stats', auth.requireAuth, (_req: Request, res: Response) => {
        const stats = getStats();
        const cacheStats = cache.stats();
        const usageStats = usage.getStats();
        const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
        const memoryUsage = process.memoryUsage();
        const rssMB = (memoryUsage.rss / BYTES_PER_MB).toFixed(1);
        const heapUsedMB = (memoryUsage.heapUsed / BYTES_PER_MB).toFixed(1);
        const externalMB = (memoryUsage.external / BYTES_PER_MB).toFixed(1);
        const runtimeSnapshot = runtimeLimiter?.snapshot() ?? {
            inflight: 0,
            queued: 0,
            rejectedTotal: 0,
            rejectionCounts: {
                user_queue_full: 0,
                guild_queue_full: 0,
                global_queue_full: 0,
            },
            limits: DEFAULT_TRANSLATION_RUNTIME_LIMITS,
        };

        const guildBudgetConfigs = guildBudgetRepository.listBudgets();
        const globalBudget = configRepository.getRuntimeConfig().dailyBudgetUsd || 0;
        const guildBudgetList = client.guilds.cache.map((guild) => {
            const guildCfg = guildBudgetConfigs[guild.id];
            const hasCustom = guildCfg && guildCfg.dailyBudgetUsd !== undefined;
            const budget = hasCustom ? guildCfg.dailyBudgetUsd : globalBudget;
            const guildStats = usage.getGuildStats(guild.id);
            return {
                id: guild.id,
                name: guild.name,
                budget,
                isCustom: hasCustom,
                totalCost: guildStats.totalCost,
                requests: guildStats.requests,
                exceeded: budget > 0 && guildStats.totalCost >= budget,
            };
        });

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
        const result: Record<
            string,
            { name: string; budget: number; usage: ReturnType<typeof usage.getGuildStats> }
        > = {};

        for (const [id, guild] of guilds) {
            result[id] = {
                name: guild.name,
                budget: guildBudgets[id]?.dailyBudgetUsd ?? -1,
                usage: usage.getGuildStats(id),
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
        res.json(log.getRecent(count, filter));
    });

    app.get('/api/user-prefs', auth.requireAuth, (_req: Request, res: Response) => {
        const prefs = userPreferenceRepository.listPreferences();
        res.json({
            prefs,
            count: Object.keys(prefs).length,
        });
    });

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
            const readiness = await getReadinessStatus({ healthCheck });
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
