import express, {
    type NextFunction,
    type Request,
    type RequestHandler,
    type Response,
} from 'express';
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
import { resetTranslationProviderState } from '../translation/translate.js';
import { appLogger } from '../../shared/structured-logger.js';
import { sanitizeError } from '../../shared/errors.js';
import { dashboardMessages } from '../../shared/messages/dashboard-messages.js';
import { getVersionMetadataWithUpdate } from '../../shared/version.js';
import { DiscordUserProfileRepository } from './discord-user-profile-repository.js';
import { resolveDiscordUserProfiles } from './discord-user-profile-resolver.js';
import {
    BABEL_GUILD_PROFILE,
    BABEL_POCKET_PROFILE,
    type AppProfile,
} from '../../apps/app-profile.js';
import {
    getCombinedDashboardCapabilities,
    getDashboardCapabilities,
    type DashboardCapabilities,
} from './capabilities.js';
import { PendingUserInstallOwnerRepository } from './pending-user-install-owner-repository.js';
import { validateConfigUpdate } from './config-validation.js';
import { sanitizeGlossaryInput } from './glossary-input.js';
import {
    budgetRiskForGuilds,
    buildOperationsGuidance,
    providerModeIncludes,
    providerSummary,
} from './operations-summary.js';
import { createMetricsAuthMiddleware } from './metrics-auth.js';
import { createEmptyRuntimeSnapshot, renderPrometheusMetrics } from './prometheus-metrics.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DashboardDeps } from '../../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BYTES_PER_MB = 1024 * 1024;

interface DashboardApiScope {
    profile: AppProfile;
    profiles: AppProfile[];
    capabilities: DashboardCapabilities;
    client: DashboardDeps['client'];
    appProfileIdForLogs?: AppProfile['id'];
}

type DashboardCapabilityName = keyof DashboardCapabilities;

function serializeProfile(profile: NonNullable<DashboardDeps['profile']>): {
    id: string;
    productName: string;
    commandName: string;
    accessMode: string;
} {
    return {
        id: profile.id,
        productName: profile.productName,
        commandName: profile.commandName,
        accessMode: profile.accessMode,
    };
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
        dashboardScope?: DashboardApiScope;
    }
}

export function createDashboardApp({
    cache,
    cooldown,
    cooldowns,
    log,
    client,
    clients,
    getStats,
    metrics,
    runtimeLimiter,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    versionCheck = getVersionMetadataWithUpdate,
    sessionRepository,
    userProfileRepository = new DiscordUserProfileRepository(),
    profile = BABEL_GUILD_PROFILE,
    profiles = [profile],
    pendingUserInstallOwnerRepository = new PendingUserInstallOwnerRepository(),
    healthProbeCacheTtlMs = 5_000,
    metricsToken,
}: DashboardDeps): express.Express {
    const app = express();
    app.set('trust proxy', 1);

    const guildClient = clients?.['babel-guild'] ?? client;
    const userInstallClient = clients?.['babel-pocket'] ?? client;
    const capabilities = getCombinedDashboardCapabilities(profiles);
    const hasGuildProfile = profiles.some((candidate) => candidate.id === 'babel-guild');
    const hasPocketProfile = profiles.some((candidate) => candidate.id === 'babel-pocket');
    const isCombinedDashboard = hasGuildProfile && hasPocketProfile;
    const rootScope: DashboardApiScope = {
        profile,
        profiles,
        capabilities,
        client: profile.id === 'babel-pocket' ? userInstallClient : guildClient,
    };
    const guildScope: DashboardApiScope = {
        profile:
            profiles.find((candidate) => candidate.id === 'babel-guild') ?? BABEL_GUILD_PROFILE,
        profiles: [BABEL_GUILD_PROFILE],
        capabilities: getDashboardCapabilities(BABEL_GUILD_PROFILE),
        client: guildClient,
        appProfileIdForLogs: 'babel-guild',
    };
    const pocketScope: DashboardApiScope = {
        profile:
            profiles.find((candidate) => candidate.id === 'babel-pocket') ?? BABEL_POCKET_PROFILE,
        profiles: [BABEL_POCKET_PROFILE],
        capabilities: getDashboardCapabilities(BABEL_POCKET_PROFILE),
        client: userInstallClient,
        appProfileIdForLogs: 'babel-pocket',
    };
    const apiScopes = isCombinedDashboard
        ? [
              { prefix: '/api', scope: rootScope },
              { prefix: '/guild/api', scope: guildScope },
              { prefix: '/pocket/api', scope: pocketScope },
          ]
        : [{ prefix: '/api', scope: rootScope }];
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

    const getScope = (res: Response): DashboardApiScope => res.locals.dashboardScope ?? rootScope;
    const setScope =
        (scope: DashboardApiScope): RequestHandler =>
        (_req, res, next) => {
            res.locals.dashboardScope = scope;
            next();
        };
    const requireDashboardCapability =
        (capability: DashboardCapabilityName): RequestHandler =>
        (_req, res, next) => {
            if (!getScope(res).capabilities[capability]) {
                res.status(404).json({ error: 'Not found' });
                return;
            }

            next();
        };
    const registerApiRoute = (
        method: 'get' | 'post' | 'delete',
        path: string,
        handlers: RequestHandler[],
    ): void => {
        for (const { prefix, scope } of apiScopes) {
            app[method](prefix + path, setScope(scope), ...handlers);
        }
    };
    const api = {
        get(path: string, ...handlers: RequestHandler[]): void {
            registerApiRoute('get', path, handlers);
        },
        post(path: string, ...handlers: RequestHandler[]): void {
            registerApiRoute('post', path, handlers);
        },
        delete(path: string, ...handlers: RequestHandler[]): void {
            registerApiRoute('delete', path, handlers);
        },
        getIf(capability: DashboardCapabilityName, path: string, ...handlers: RequestHandler[]) {
            registerApiRoute('get', path, [requireDashboardCapability(capability), ...handlers]);
        },
        postIf(capability: DashboardCapabilityName, path: string, ...handlers: RequestHandler[]) {
            registerApiRoute('post', path, [requireDashboardCapability(capability), ...handlers]);
        },
        deleteIf(capability: DashboardCapabilityName, path: string, ...handlers: RequestHandler[]) {
            registerApiRoute('delete', path, [requireDashboardCapability(capability), ...handlers]);
        },
    };

    api.post('/login', loginLimiter, (req: Request, res: Response) => {
        const result = auth.login(req.body.password, req);
        if (!result.ok) {
            res.status(401).json({ error: dashboardMessages.auth.wrongPassword });
            return;
        }

        res.setHeader('Set-Cookie', result.cookie);
        res.json({ ok: true, csrfToken: result.csrfToken });
    });

    api.get('/auth/check', (req: Request, res: Response) => {
        res.json(auth.check(req));
    });

    api.post('/logout', (req: Request, res: Response) => {
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

    app.get(
        '/metrics',
        createMetricsAuthMiddleware(metricsToken),
        (_req: Request, res: Response) => {
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
        },
    );

    api.get('/setup-status', auth.requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: configRepository.isSetupComplete() });
    });

    api.get('/capabilities', auth.requireAuth, (_req: Request, res: Response) => {
        const scope = getScope(res);
        res.json({
            profile: serializeProfile(scope.profile),
            profiles: scope.profiles.map(serializeProfile),
            capabilities: scope.capabilities,
        });
    });

    api.get(
        '/version',
        auth.requireAuth,
        asyncHandler(async (_req: Request, res: Response) => {
            res.json(await versionCheck());
        }),
    );

    api.post(
        '/version/refresh',
        auth.requireAuth,
        auth.requireCsrf,
        asyncHandler(async (_req: Request, res: Response) => {
            res.json(await versionCheck({ forceRefresh: true }));
        }),
    );

    api.get('/sessions', auth.requireAuth, (req: Request, res: Response) => {
        res.json({ sessions: auth.listSessions(req) });
    });

    api.post(
        '/sessions/revoke',
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

    api.get('/stats', auth.requireAuth, (_req: Request, res: Response) => {
        const scope = getScope(res);
        const scopedClient = scope.client;
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

        const guildIds = scope.capabilities.guildAccess
            ? scopedClient.guilds.cache.map((guild) => guild.id)
            : [];
        const guildBudgetConfigs = guildBudgetRepository.listBudgets();
        const guildStatsById = guildIds.length > 0 ? usage.getGuildStatsForGuilds(guildIds) : {};
        const guildBudgetList = scope.capabilities.guildAccess
            ? scopedClient.guilds.cache.map((guild) => {
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
              })
            : [];
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
                name: scopedClient.user?.tag || client.user?.tag || 'Unknown',
                avatar:
                    scopedClient.user?.displayAvatarURL({ size: 64 }) ||
                    client.user?.displayAvatarURL({ size: 64 }) ||
                    '',
                uptime: Math.floor(process.uptime()),
                memoryMB: rssMB,
                memory: {
                    rssMB,
                    heapUsedMB,
                    externalMB,
                },
                guilds: scope.capabilities.guildAccess ? scopedClient.guilds.cache.size : 0,
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

    api.get('/config', auth.requireAuth, (_req: Request, res: Response) => {
        const cfg = configRepository.getDashboardConfig();
        res.json({
            ...cfg,
            vertexAiApiKey: cfg.vertexAiApiKey ? '••••' + cfg.vertexAiApiKey.slice(-6) : '',
            hasApiKey: !!cfg.vertexAiApiKey,
            openaiApiKey: cfg.openaiApiKey ? '••••' + cfg.openaiApiKey.slice(-6) : '',
            hasOpenaiApiKey: !!cfg.openaiApiKey,
        });
    });

    api.post('/config', auth.requireAuth, auth.requireCsrf, (req: Request, res: Response) => {
        const { valid, error, sanitized } = validateConfigUpdate(req.body);
        if (!valid) {
            res.status(400).json({ error });
            return;
        }

        const currentConfig = configRepository.getDashboardConfig();
        const effects = applyConfigUpdateEffects(currentConfig, sanitized, {
            cache,
            cooldown,
            cooldowns: cooldowns ? Object.values(cooldowns) : undefined,
            resetProviderState: resetTranslationProviderState,
        });

        configRepository.updateConfig(sanitized);

        res.json({
            ok: true,
            cacheCleared: effects.cacheCleared,
            changedKeys: effects.changedKeys,
            immediateEffects: effects.immediateEffects,
        });
    });

    api.getIf('guildAccess', '/guilds', auth.requireAuth, (_req: Request, res: Response) => {
        const scope = getScope(res);
        const guilds = scope.client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 32 }) || '',
            memberCount: g.memberCount,
        }));
        res.json(guilds);
    });

    api.get('/usage/history', auth.requireAuth, (req: Request, res: Response) => {
        const guildId = req.query.guildId as string | undefined;
        if (guildId) {
            res.json(usage.getGuildHistory(guildId));
        } else {
            res.json(usage.getHistory());
        }
    });

    api.getIf('guildAccess', '/guild-budgets', auth.requireAuth, (_req: Request, res: Response) => {
        const scope = getScope(res);
        const guildBudgets = guildBudgetRepository.listBudgets();
        const guilds = scope.client.guilds.cache;
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

    api.getIf(
        'userAccess',
        '/user-budgets',
        auth.requireAuth,
        asyncHandler(async (_req: Request, res: Response) => {
            const userBudgets = userBudgetRepository.listBudgets();
            const cfg = configRepository.getDashboardConfig();
            const allowedUserIds = new Set(cfg.allowedUserIds);
            const pendingUserIds = new Set(pendingUserInstallOwnerRepository.listUserIds());
            const userIds = [
                ...new Set([...cfg.allowedUserIds, ...pendingUserIds, ...Object.keys(userBudgets)]),
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
                client: userInstallClient,
                repository: userProfileRepository,
                userIds: Object.keys(result),
            });

            res.json({ budgets: result, profiles });
        }),
    );

    api.postIf(
        'userAccess',
        '/user-budgets/:userId',
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

    api.postIf(
        'guildAccess',
        '/guild-budgets/:guildId',
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

    api.getIf(
        'guildGlossary',
        '/guild-glossary/:guildId',
        auth.requireAuth,
        (req: Request, res: Response) => {
            const guildId = String(req.params.guildId ?? '').trim();
            if (!guildId) {
                res.status(400).json({ error: 'Guild id is required' });
                return;
            }

            const entries = guildGlossaryRepository.listEntries(guildId);
            res.json({ entries, count: entries.length });
        },
    );

    api.postIf(
        'guildGlossary',
        '/guild-glossary/:guildId',
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

    api.deleteIf(
        'guildGlossary',
        '/guild-glossary/:guildId/:entryId',
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

    api.get('/logs', auth.requireAuth, (req: Request, res: Response) => {
        const scope = getScope(res);
        const scopeProfileId = isCombinedDashboard ? scope.appProfileIdForLogs : undefined;
        const count = Math.min(parseInt(req.query.count as string) || 50, 200);
        const filter = req.query.filter as string | undefined;
        const errorType = req.query.errorType as string | undefined;
        if (errorType) {
            if (filter && filter !== 'error') {
                res.status(400).json({ error: 'errorType filter requires error logs' });
                return;
            }

            const errorEntries = scopeProfileId
                ? log.getRecentForProfile(scopeProfileId, log.size, 'error')
                : log.getRecent(log.size, 'error');
            const entries = errorEntries
                .filter((entry) => entry.type === 'error' && entry.errorType === errorType)
                .slice(0, count);
            res.json(entries);
            return;
        }

        const entries = scopeProfileId
            ? log.getRecentForProfile(scopeProfileId, count, filter)
            : log.getRecent(count, filter);
        res.json(entries);
    });

    api.get(
        '/user-prefs',
        auth.requireAuth,
        asyncHandler(async (_req: Request, res: Response) => {
            const scope = getScope(res);
            const prefs = userPreferenceRepository.listPreferences();
            const profiles = await resolveDiscordUserProfiles({
                client: scope.client,
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

    api.post(
        '/user-prefs/batch-delete',
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

    api.delete(
        '/user-prefs/:userId',
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

    api.post('/cache/clear', auth.requireAuth, auth.requireCsrf, (_req: Request, res: Response) => {
        const before = cache.stats();
        cache.clear();
        res.json({ ok: true, cleared: before.size });
    });

    api.post(
        '/translate/test',
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
                res.status(500).json({ error: sanitizeError((err as Error).message) });
            }
        }),
    );

    api.get(
        '/health',
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

    app.get(['/guild', '/guild/', '/pocket', '/pocket/'], (_req: Request, res: Response) => {
        res.sendFile(join(__dirname, '../../public/index.html'));
    });

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
