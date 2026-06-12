import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { createEmptyAppMetricsSnapshot } from '../../shared/app-metrics.js';
import { getConfig } from '../config/config.js';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../shared/health.js';
import { usage } from '../usage/usage.js';
import { translate } from '../translation/translate.js';
import { createDashboardAuth } from './auth/dashboard-auth.js';
import { SQLiteSessionRepository } from './auth/sqlite-session-repository.js';
import { checkVertexAiHealth } from '../../infra/vertex-ai-client.js';
import { checkOpenAiHealth } from '../../infra/openai-client.js';
import { configRepository } from '../config/config-repository.js';
import { guildBudgetRepository } from '../usage/guild-budget-repository.js';
import { userBudgetRepository } from '../usage/user-budget-repository.js';
import { userPreferenceRepository } from '../translation/user-preference-repository.js';
import { guildGlossaryRepository } from '../translation/guild-glossary-repository.js';
import { applyConfigUpdateEffects } from '../config/config-runtime-effects.js';
import { appLogger } from '../../shared/structured-logger.js';
import { dashboardMessages } from '../../shared/messages/dashboard-messages.js';
import { getVersionMetadataWithUpdate } from '../../shared/version.js';
import { DiscordUserProfileRepository } from './discord-user-profile-repository.js';
import { resolveDiscordUserProfiles } from './discord-user-profile-resolver.js';
import { BABEL_GUILD_PROFILE } from '../../apps/app-profile.js';
import { getDashboardCapabilities } from './capabilities.js';
import { PendingUserInstallOwnerRepository } from './pending-user-install-owner-repository.js';
import { validateConfigUpdate } from './config-validation.js';
import { sanitizeGlossaryInput } from './glossary-input.js';
import {
    budgetRiskForGuilds,
    buildOperationsGuidance,
    providerModeIncludes,
    providerSummary,
} from './operations-summary.js';
import { createEmptyRuntimeSnapshot, renderPrometheusMetrics } from './prometheus-metrics.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DashboardDeps } from '../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BYTES_PER_MB = 1024 * 1024;

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
    versionCheck = getVersionMetadataWithUpdate,
    sessionRepository,
    userProfileRepository = new DiscordUserProfileRepository(),
    profile = BABEL_GUILD_PROFILE,
    pendingUserInstallOwnerRepository = new PendingUserInstallOwnerRepository(),
    healthProbeCacheTtlMs = 5_000,
}: DashboardDeps): express.Express {
    const app = express();
    app.set('trust proxy', 1);

    const capabilities = getDashboardCapabilities(profile);
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

    app.get('/api/capabilities', auth.requireAuth, (_req: Request, res: Response) => {
        res.json({
            profile: {
                id: profile.id,
                productName: profile.productName,
                commandName: profile.commandName,
                accessMode: profile.accessMode,
            },
            capabilities,
        });
    });

    app.get(
        '/api/version',
        auth.requireAuth,
        asyncHandler(async (_req: Request, res: Response) => {
            res.json(await versionCheck());
        }),
    );

    app.post(
        '/api/version/refresh',
        auth.requireAuth,
        auth.requireCsrf,
        asyncHandler(async (_req: Request, res: Response) => {
            res.json(await versionCheck({ forceRefresh: true }));
        }),
    );

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
            const hasCustom = Boolean(guildCfg && guildCfg.dailyBudgetUsd !== undefined);
            const guildStats = guildStatsById[guild.id];
            const scopedStats = hasCustom ? guildStats : usageStats;
            const budget = hasCustom
                ? (guildCfg?.dailyBudgetUsd ?? 0)
                : (scopedStats?.dailyBudget ?? usageStats.dailyBudget);
            const totalCost = scopedStats?.totalCost ?? 0;
            const requests = scopedStats?.requests ?? 0;
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
        const usageStats = usage.getStats();
        const guildStatsById = guildIds.length > 0 ? usage.getGuildStatsForGuilds(guildIds) : {};
        const result: Record<
            string,
            { name: string; budget: number; usage: ReturnType<typeof usage.getGuildStats> }
        > = {};

        for (const [id, guild] of guilds) {
            const hasCustom = guildBudgets[id]?.dailyBudgetUsd !== undefined;
            result[id] = {
                name: guild.name,
                budget: guildBudgets[id]?.dailyBudgetUsd ?? -1,
                usage: hasCustom ? (guildStatsById[id] ?? usage.getGuildStats(id)) : usageStats,
            };
        }
        res.json(result);
    });

    if (capabilities.userAccess) {
        app.get(
            '/api/user-budgets',
            auth.requireAuth,
            asyncHandler(async (_req: Request, res: Response) => {
                const userBudgets = userBudgetRepository.listBudgets();
                const cfg = configRepository.getDashboardConfig();
                const allowedUserIds = new Set(cfg.allowedUserIds);
                const pendingUserIds = new Set(pendingUserInstallOwnerRepository.listUserIds());
                const userIds = [
                    ...new Set([
                        ...cfg.allowedUserIds,
                        ...pendingUserIds,
                        ...Object.keys(userBudgets),
                    ]),
                ];
                const result: Record<
                    string,
                    { budget: number; isCustom: boolean; allowed: boolean; pending: boolean }
                > = {};

                for (const userId of userIds) {
                    const customBudget = userBudgets[userId];
                    result[userId] = {
                        budget: customBudget?.dailyBudgetUsd ?? cfg.defaultUserDailyBudgetUsd,
                        isCustom: customBudget !== undefined,
                        allowed: allowedUserIds.has(userId),
                        pending: pendingUserIds.has(userId) && !allowedUserIds.has(userId),
                    };
                }

                const profiles = await resolveDiscordUserProfiles({
                    client,
                    repository: userProfileRepository,
                    userIds: Object.keys(result),
                });

                res.json({ budgets: result, profiles });
            }),
        );

        app.post(
            '/api/user-budgets/:userId',
            auth.requireAuth,
            auth.requireCsrf,
            (req: Request, res: Response) => {
                const userId = String(req.params.userId ?? '').trim();
                const { dailyBudgetUsd } = req.body;

                if (!userId) {
                    res.status(400).json({ error: 'User id is required' });
                    return;
                }

                if (dailyBudgetUsd === null || dailyBudgetUsd === undefined) {
                    userBudgetRepository.clearBudget(userId);
                    res.json({ ok: true, mode: 'default' });
                    return;
                }

                const v = parseFloat(String(dailyBudgetUsd));
                if (isNaN(v) || v < 0) {
                    res.status(400).json({ error: dashboardMessages.validation.dailyBudgetUsd });
                    return;
                }

                userBudgetRepository.setBudget(userId, v);
                res.json({ ok: true, budget: v });
            },
        );
    }

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

    if (capabilities.guildGlossary) {
        app.get('/api/guild-glossary/:guildId', auth.requireAuth, (req: Request, res: Response) => {
            const guildId = String(req.params.guildId ?? '').trim();
            if (!guildId) {
                res.status(400).json({ error: 'Guild id is required' });
                return;
            }

            const entries = guildGlossaryRepository.listEntries(guildId);
            res.json({ entries, count: entries.length });
        });

        app.post(
            '/api/guild-glossary/:guildId',
            auth.requireAuth,
            auth.requireCsrf,
            (req: Request, res: Response) => {
                const guildId = String(req.params.guildId ?? '').trim();
                if (!guildId) {
                    res.status(400).json({ error: 'Guild id is required' });
                    return;
                }

                const input = sanitizeGlossaryInput(req.body ?? {});
                if (!input.ok) {
                    res.status(400).json({ error: input.error });
                    return;
                }

                try {
                    const entry = guildGlossaryRepository.upsertEntry(guildId, input.value);
                    cache.clear();
                    res.json({ ok: true, entry, cacheCleared: true });
                } catch (error) {
                    res.status(404).json({ error: (error as Error).message });
                }
            },
        );

        app.delete(
            '/api/guild-glossary/:guildId/:entryId',
            auth.requireAuth,
            auth.requireCsrf,
            (req: Request, res: Response) => {
                const guildId = String(req.params.guildId ?? '').trim();
                const entryId = Number.parseInt(String(req.params.entryId ?? ''), 10);

                if (!guildId || !Number.isInteger(entryId) || entryId < 1) {
                    res.status(400).json({
                        error: 'Valid guild id and glossary entry id are required',
                    });
                    return;
                }

                if (!guildGlossaryRepository.deleteEntry(guildId, entryId)) {
                    res.status(404).json({ error: 'Glossary entry not found' });
                    return;
                }

                cache.clear();
                res.json({ ok: true, deleted: entryId });
            },
        );
    }

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

    app.get(
        '/api/user-prefs',
        auth.requireAuth,
        asyncHandler(async (_req: Request, res: Response) => {
            const prefs = userPreferenceRepository.listPreferences();
            const profiles = await resolveDiscordUserProfiles({
                client,
                repository: userProfileRepository,
                userIds: Object.keys(prefs),
            });

            res.json({
                prefs,
                count: Object.keys(prefs).length,
                profiles,
            });
        }),
    );

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

export function startDashboardServer(
    app: express.Express,
    port: number,
    host?: string,
): http.Server {
    const logger = appLogger.child({ component: 'dashboard' });
    const onListening = () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        const actualHost = typeof address === 'object' && address ? address.address : host;
        logger.info('dashboard.server.started', { port: actualPort, host: actualHost });
    };
    const server = host ? app.listen(port, host, onListening) : app.listen(port, onListening);

    return server;
}

export function stopDashboardApp(app: express.Express): void {
    app.locals.disposeDashboardApp?.();
}

export const _test = { validateConfigUpdate };
