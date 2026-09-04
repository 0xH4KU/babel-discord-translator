import express, { type Request, type RequestHandler, type Response } from 'express';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { AppMetrics } from '../../shared/app-metrics.js';
import { getConfig } from '../config/config.js';
import { getReadinessStatus } from '../../shared/health.js';
import { usage } from '../usage/usage.js';
import { createTranslationService } from '../translation/translation-service.js';
import { createDashboardAuth } from './auth/dashboard-auth.js';
import { SQLiteSessionRepository } from './auth/sqlite-session-repository.js';
import { checkVertexAiHealth } from '../../infra/vertex-ai-client.js';
import { checkOpenAiHealth } from '../../infra/openai-client.js';
import { configRepository } from '../config/config-repository.js';
import { store } from '../../persistence/store.js';
import { applyConfigUpdateEffects } from '../config/config-runtime-effects.js';
import { resetTranslationProviderState } from '../translation/translate.js';
import { appLogger } from '../../shared/structured-logger.js';
import { sanitizeError } from '../../shared/errors.js';
import { dashboardMessages } from '../../shared/messages/dashboard-messages.js';
import { getVersionMetadata } from '../../shared/version.js';
import { DiscordUserProfileRepository } from './discord-user-profile-repository.js';
import { resolveDiscordUserProfiles } from './discord-user-profile-resolver.js';
import {
    BABEL_GUILD_PROFILE,
    BABEL_POCKET_PROFILE,
    type AppProfile,
} from '../../apps/app-profile.js';
import {
    buildDashboardCapabilitiesResponse,
    getCombinedDashboardCapabilities,
    getDashboardCapabilities,
    type DashboardCapabilities,
} from './capabilities.js';
import { PendingUserInstallOwnerRepository } from './pending-user-install-owner-repository.js';
import { applyProviderCapabilityResets, validateConfigUpdate } from './config-validation.js';
import { runSetupDoctor } from './setup-doctor.js';
import {
    MAX_GLOSSARY_IMPORT_BYTES,
    parseGlossaryImport,
    sanitizeGlossaryImportRequest,
    sanitizeGlossaryInput,
} from './glossary-input.js';
import {
    budgetRiskForGuilds,
    buildOperationsGuidance,
    providerModeIncludes,
    providerSummary,
} from './operations-summary.js';
import { createEmptyRuntimeSnapshot } from './prometheus-metrics.js';
import { registerHealthRoutes } from './health-dashboard.js';
import { applySecurityHeaders } from './security-headers.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DashboardDeps, GuildGlossaryInput } from '../../shared/types.js';
import {
    resolveBudgetLimits,
    validateBudgetLimits,
    type BudgetLimitOverrides,
} from '../../shared/budget-limits.js';

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

function normalizeGlossarySource(sourceText: string): string {
    return sourceText.trim().toLowerCase();
}

function normalizeGlossaryLanguage(targetLanguage: string): string {
    return targetLanguage.trim().toLowerCase();
}

function normalizeGlossaryKey(sourceText: string, targetLanguage: string): string {
    return `${normalizeGlossarySource(sourceText)}\u0000${normalizeGlossaryLanguage(targetLanguage)}`;
}

function sanitizeUserPreferenceRef(value: unknown): { guildId: string; userId: string } | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const source = value as { guildId?: unknown; userId?: unknown };
    const guildId = String(source.guildId ?? '').trim();
    const userId = String(source.userId ?? '').trim();

    return userId ? { guildId, userId } : null;
}

function parseVisionLimit(value: unknown): number | null {
    if (value === null) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return NaN;
    if (typeof value === 'string' && !value.trim()) return NaN;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : NaN;
}

function applyScopedBudgetUpdate(
    scope: 'guild' | 'user',
    scopeId: string,
    input: unknown,
):
    | {
          ok: true;
          budget?: number | null;
          visionLimit?: number | null;
          limitOverrides?: BudgetLimitOverrides;
      }
    | { ok: false; error: string } {
    const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const hasBudget = Object.hasOwn(body, 'monthlyBudgetUsd');
    const hasVisionLimit = Object.hasOwn(body, 'visionMonthlyImageLimit');
    const hasLimitOverrides = scope === 'guild' && Object.hasOwn(body, 'budgetLimitOverrides');
    if (!hasBudget && !hasVisionLimit && !hasLimitOverrides) {
        return { ok: false, error: 'A budget, budget limit, or Vision limit is required' };
    }

    const budget =
        hasBudget && body.monthlyBudgetUsd !== null && body.monthlyBudgetUsd !== undefined
            ? parseFloat(String(body.monthlyBudgetUsd))
            : null;
    if (hasBudget && budget !== null && (isNaN(budget) || budget < 0)) {
        return { ok: false, error: dashboardMessages.validation.monthlyBudgetUsd };
    }

    const visionLimit = hasVisionLimit ? parseVisionLimit(body.visionMonthlyImageLimit) : null;
    if (hasVisionLimit && Number.isNaN(visionLimit)) {
        return { ok: false, error: 'Vision limit must be a non-negative integer' };
    }

    let limitOverrides: BudgetLimitOverrides | undefined;
    if (hasLimitOverrides) {
        const inputOverrides = body.budgetLimitOverrides;
        if (
            inputOverrides !== null &&
            (!inputOverrides || typeof inputOverrides !== 'object' || Array.isArray(inputOverrides))
        ) {
            return { ok: false, error: 'Budget limit overrides must be an object or null' };
        }
        const allowedKeys = new Set([
            'budgetFiveHourPercent',
            'budgetSevenDayPercent',
            'budgetFairShareMultiplier',
        ]);
        const unknownKey = Object.keys(inputOverrides ?? {}).find((key) => !allowedKeys.has(key));
        if (unknownKey) return { ok: false, error: `Unknown budget limit: ${unknownKey}` };

        limitOverrides = {};
        for (const key of [
            'budgetFiveHourPercent',
            'budgetSevenDayPercent',
            'budgetFairShareMultiplier',
        ] as const) {
            const value = (inputOverrides as Record<string, unknown> | null)?.[key];
            if (value === undefined || value === null || value === '') continue;
            if (typeof value !== 'number' && typeof value !== 'string') {
                return { ok: false, error: `${key} must be a finite number or null` };
            }
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
                return { ok: false, error: `${key} must be a finite number or null` };
            }
            limitOverrides[key] = parsed;
        }
        const defaults = configRepository.getRuntimeConfig();
        const limitError = validateBudgetLimits(resolveBudgetLimits(defaults, limitOverrides));
        if (limitError) return { ok: false, error: limitError };
    }

    if (hasBudget) {
        if (scope === 'guild') {
            if (budget === null) store.clearGuildBudget(scopeId);
            else store.setGuildBudget(scopeId, budget);
        } else if (budget === null) store.clearUserBudget(scopeId);
        else store.setUserBudget(scopeId, budget);
    }
    if (hasVisionLimit) {
        if (visionLimit === null) store.clearVisionScopeLimit(scope, scopeId);
        else store.setVisionScopeLimit(scope, scopeId, visionLimit);
    }
    if (limitOverrides) store.setGuildBudgetLimitOverrides(scopeId, limitOverrides);

    return {
        ok: true,
        ...(hasBudget ? { budget } : {}),
        ...(hasVisionLimit ? { visionLimit } : {}),
        ...(limitOverrides ? { limitOverrides } : {}),
    };
}

type UsageExportRow = ReturnType<typeof usage.getUsageExportRows>[number];

function csvCell(value: string | number): string {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildUsageExportCsv(rows: UsageExportRow[]): string {
    const header = [
        'scope',
        'id',
        'date',
        'requests',
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'costUsd',
    ];
    return [
        header.join(','),
        ...rows.map((row) =>
            [
                row.scope,
                row.id,
                row.date,
                row.requests,
                row.inputTokens,
                row.outputTokens,
                row.totalTokens,
                row.costUsd,
            ]
                .map(csvCell)
                .join(','),
        ),
        '',
    ].join('\n');
}

declare module 'express-serve-static-core' {
    interface Locals {
        disposeDashboardApp?: () => void;
        dashboardScope?: DashboardApiScope;
    }
}

export function createDashboardApp({
    cache,
    ocrCache,
    cooldown,
    cooldowns,
    log,
    client,
    clients,
    metrics = new AppMetrics(),
    runtimeLimiter,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    discordReady,
    sessionRepository,
    userProfileRepository = new DiscordUserProfileRepository(),
    profile = BABEL_GUILD_PROFILE,
    profiles = [profile],
    pendingUserInstallOwnerRepository = new PendingUserInstallOwnerRepository(),
    metricsToken,
    host,
    translationService,
    translationServices,
}: DashboardDeps): express.Express {
    const app = express();
    const isDiscordReady =
        discordReady ??
        (() => {
            const activeClients = clients ? Object.values(clients) : [client];
            return activeClients.every((candidate) => candidate?.isReady());
        });

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
    const dashboardTranslationService =
        translationService ??
        createTranslationService({
            cache,
            cooldown,
            log,
            metrics,
            runtimeLimiter,
            accessMode: profile.accessMode,
            enableGuildGlossary: profile.enableGuildGlossary,
            pendingUserInstallOwnerRepository,
        });
    const getDashboardTranslationService = (scope: DashboardApiScope) => {
        return translationServices?.[scope.profile.id] ?? dashboardTranslationService;
    };
    const auth = createDashboardAuth({
        password: config.dashboardPassword,
        sessionRepository: sessionRepository ?? new SQLiteSessionRepository(),
    });

    app.locals.disposeDashboardApp = () => {
        auth.dispose();
    };

    app.use(applySecurityHeaders);
    app.use(express.json({ limit: MAX_GLOSSARY_IMPORT_BYTES * 2 }));
    app.use(express.static(join(__dirname, '../../public')));

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: { error: dashboardMessages.auth.tooManyLoginAttempts },
        standardHeaders: true,
        legacyHeaders: false,
    });

    const getScope = (res: Response): DashboardApiScope => res.locals.dashboardScope ?? rootScope;
    const api = express.Router();
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

    for (const { prefix, scope } of apiScopes) app.use(prefix, setScope(scope), api);

    api.post('/login', loginLimiter, async (req: Request, res: Response) => {
        const result = await auth.login(req.body.password, req);
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

    registerHealthRoutes(app, {
        cache,
        metrics,
        runtimeLimiter,
        discordReady: isDiscordReady,
        metricsToken,
        host,
    });

    api.get('/setup-status', auth.requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: configRepository.isSetupComplete() });
    });

    api.get('/capabilities', auth.requireAuth, (_req: Request, res: Response) => {
        const scope = getScope(res);
        res.json(buildDashboardCapabilitiesResponse(scope.profile, scope.profiles));
    });

    api.post(
        '/setup-doctor/run',
        auth.requireAuth,
        auth.requireCsrf,
        async (_req: Request, res: Response) => {
            const scope = getScope(res);
            res.json(
                await runSetupDoctor({
                    profile: scope.profile,
                    profiles: scope.profiles,
                    client: scope.client,
                    configStore: configRepository,
                    budgetStore: store,
                    healthCheck,
                    openAiHealthCheck,
                    requireProfileSpecificRegistrationEnv: isCombinedDashboard,
                }),
            );
        },
    );

    api.get('/version', auth.requireAuth, (_req: Request, res: Response) => {
        res.json(getVersionMetadata());
    });

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

    api.get('/stats', auth.requireAuth, async (_req: Request, res: Response) => {
        const scope = getScope(res);
        const scopedClient = scope.client;
        const cacheStats = cache.stats();
        const ocrCacheStats = ocrCache.stats();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const usageStats =
            scope.profile.id === 'babel-pocket'
                ? usage.getPocketStats(runtimeConfig)
                : usage.getStats(runtimeConfig);
        const scopeProfileId = isCombinedDashboard ? scope.appProfileIdForLogs : undefined;
        const metricsSnapshot = metrics.snapshot({ appProfileId: scopeProfileId });
        const memoryUsage = process.memoryUsage();
        const rssMB = (memoryUsage.rss / BYTES_PER_MB).toFixed(1);
        const heapUsedMB = (memoryUsage.heapUsed / BYTES_PER_MB).toFixed(1);
        const externalMB = (memoryUsage.external / BYTES_PER_MB).toFixed(1);
        const runtimeSnapshot = runtimeLimiter?.snapshot() ?? createEmptyRuntimeSnapshot();
        const providerMode = runtimeConfig.translationProvider || 'vertex';
        const translationTotals = {
            total: metricsSnapshot.translationsTotal,
            apiCalls: metricsSnapshot.translationApiCallsTotal,
        };

        const guildIds = scope.capabilities.guildAccess
            ? scopedClient.guilds.cache.map((guild) => guild.id)
            : [];
        const guildBudgetConfigs = store.listGuildBudgets();
        const guildStatsById =
            guildIds.length > 0
                ? usage.getGuildStatsForGuilds(guildIds, guildBudgetConfigs, runtimeConfig)
                : {};
        const guildBudgetList = scope.capabilities.guildAccess
            ? scopedClient.guilds.cache.map((guild) => {
                  const guildCfg = guildBudgetConfigs[guild.id];
                  const hasCustom = Boolean(guildCfg && guildCfg.monthlyBudgetUsd !== undefined);
                  const guildStats = guildStatsById[guild.id];
                  const scopedStats = hasCustom ? guildStats : usageStats;
                  const budget = hasCustom
                      ? (guildCfg?.monthlyBudgetUsd ?? 0)
                      : (scopedStats?.monthlyBudget ?? usageStats.monthlyBudget);
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
        const userBudgetConfigs = store.listUserBudgets();
        const allowedUserIds = new Set(runtimeConfig.allowedUserIds);
        const pendingUserIds = new Set(pendingUserInstallOwnerRepository.listUserIds());
        const userIds = scope.capabilities.userAccess
            ? [
                  ...new Set([
                      ...runtimeConfig.allowedUserIds,
                      ...pendingUserIds,
                      ...Object.keys(userBudgetConfigs),
                  ]),
              ]
            : [];
        const userProfiles = scope.capabilities.userAccess
            ? await resolveDiscordUserProfiles({
                  client: userInstallClient,
                  repository: userProfileRepository,
                  userIds,
              })
            : {};
        const userStatsById =
            userIds.length > 0
                ? usage.getUserStatsForUsers(userIds, userBudgetConfigs, runtimeConfig)
                : {};
        const userBudgetList = scope.capabilities.userAccess
            ? userIds.map((userId) => {
                  const customBudget = userBudgetConfigs[userId];
                  const userStats = userStatsById[userId]!;
                  const budget =
                      customBudget?.monthlyBudgetUsd ?? runtimeConfig.defaultUserMonthlyBudgetUsd;
                  const totalCost = userStats.totalCost ?? 0;
                  return {
                      id: userId,
                      name: userProfiles[userId]?.displayName ?? userId,
                      username: userProfiles[userId]?.username ?? userId,
                      avatar: userProfiles[userId]?.avatarUrl ?? '',
                      budget,
                      isCustom: customBudget !== undefined,
                      allowed: allowedUserIds.has(userId),
                      pending: pendingUserIds.has(userId) && !allowedUserIds.has(userId),
                      totalCost,
                      requests: userStats.requests ?? 0,
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
                total: translationTotals.total,
                apiCalls: translationTotals.apiCalls,
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
            ocrCache: ocrCacheStats,
            usage: usageStats,
            guildBudgets: guildBudgetList,
            userBudgets: userBudgetList,
            errors: log.errorCount,
        });
    });

    api.get('/config', auth.requireAuth, (_req: Request, res: Response) => {
        const scope = getScope(res);
        const cfg = configRepository.getDashboardConfig();
        const visionMonth = new Date().toISOString().slice(0, 7);
        const visionImages = store.getVisionMonthlyUsage(visionMonth);
        res.json({
            ...cfg,
            monthlyBudgetUsd:
                scope.profile.id === 'babel-pocket'
                    ? cfg.pocketGlobalMonthlyBudgetUsd
                    : cfg.monthlyBudgetUsd,
            vertexAiApiKey: cfg.vertexAiApiKey ? '••••' + cfg.vertexAiApiKey.slice(-6) : '',
            hasApiKey: !!cfg.vertexAiApiKey,
            visionApiKey: cfg.visionApiKey ? '••••' + cfg.visionApiKey.slice(-6) : '',
            hasVisionApiKey: !!cfg.visionApiKey,
            openaiApiKey: cfg.openaiApiKey ? '••••' + cfg.openaiApiKey.slice(-6) : '',
            hasOpenaiApiKey: !!cfg.openaiApiKey,
            visionUsage: {
                month: visionMonth,
                images: visionImages,
                limit: cfg.visionMonthlyImageLimit,
                remaining: Math.max(cfg.visionMonthlyImageLimit - visionImages, 0),
            },
        });
    });

    api.post('/config', auth.requireAuth, auth.requireCsrf, (req: Request, res: Response) => {
        const scope = getScope(res);
        const currentConfig = configRepository.getDashboardConfig();
        const submittedConfig = { ...req.body } as Record<string, unknown>;
        if (
            scope.profile.id === 'babel-pocket' &&
            Object.hasOwn(submittedConfig, 'monthlyBudgetUsd')
        ) {
            submittedConfig.pocketGlobalMonthlyBudgetUsd = submittedConfig.monthlyBudgetUsd;
            delete submittedConfig.monthlyBudgetUsd;
        }
        const { valid, error, sanitized } = validateConfigUpdate(submittedConfig, currentConfig);
        if (!valid) {
            res.status(400).json({ error });
            return;
        }

        const budgetLimitKeys = [
            'budgetFiveHourPercent',
            'budgetSevenDayPercent',
            'budgetFairShareMultiplier',
        ] as const;
        if (budgetLimitKeys.some((key) => sanitized[key] !== undefined)) {
            const nextDefaults = resolveBudgetLimits(currentConfig, sanitized);
            for (const [guildId, overrides] of Object.entries(
                store.listGuildBudgetLimitOverrides(),
            )) {
                const guildError = validateBudgetLimits(
                    resolveBudgetLimits(nextDefaults, overrides),
                );
                if (guildError) {
                    res.status(400).json({ error: `Guild ${guildId}: ${guildError}` });
                    return;
                }
            }
        }

        const normalizedUpdates = applyProviderCapabilityResets(currentConfig, sanitized);
        configRepository.updateConfig(normalizedUpdates);

        const effects = applyConfigUpdateEffects(currentConfig, normalizedUpdates, {
            cache,
            cooldown,
            cooldowns: cooldowns ? Object.values(cooldowns) : undefined,
            runtimeLimiter,
            resetProviderState: resetTranslationProviderState,
        });

        res.json({
            ok: true,
            cacheCleared: effects.cacheCleared,
            changedKeys: effects.changedKeys,
            immediateEffects: effects.immediateEffects,
        });
    });

    api.get(
        '/guilds',
        requireDashboardCapability('guildAccess'),
        auth.requireAuth,
        (_req: Request, res: Response) => {
            const scope = getScope(res);
            const guilds = scope.client.guilds.cache.map((g) => ({
                id: g.id,
                name: g.name,
                icon: g.iconURL({ size: 32 }) || '',
                memberCount: g.memberCount,
            }));
            res.json(guilds);
        },
    );

    api.get('/usage/history', auth.requireAuth, (req: Request, res: Response) => {
        const scope = getScope(res);
        const guildId = req.query.guildId as string | undefined;
        if (guildId) {
            if (!scope.capabilities.guildAccess) {
                res.status(400).json({
                    error: 'guildId filter is not available for this dashboard scope',
                });
                return;
            }

            res.json(usage.getGuildHistory(guildId));
        } else if (scope.profile.id === 'babel-guild') {
            const guildIds = scope.client.guilds.cache.map((guild) => guild.id);
            res.json(usage.getGuildHistoryForGuilds(guildIds));
        } else if (scope.profile.id === 'babel-pocket') {
            res.json(usage.getAllUserHistory());
        } else {
            res.json(usage.getHistory());
        }
    });

    api.get('/usage/export.csv', auth.requireAuth, (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="babel-usage-export.csv"');
        res.send(buildUsageExportCsv(usage.getUsageExportRows()));
    });

    api.get(
        '/guild-budgets',
        requireDashboardCapability('guildAccess'),
        auth.requireAuth,
        (_req: Request, res: Response) => {
            const scope = getScope(res);
            const guildBudgets = store.listGuildBudgets();
            const limitOverrides = store.listGuildBudgetLimitOverrides();
            const defaultLimits = configRepository.getRuntimeConfig();
            const visionMonth = new Date().toISOString().slice(0, 7);
            const visionLimits = store.listVisionScopeLimits('guild');
            const visionUsage = store.listVisionMonthlyUsage(visionMonth, 'guild');
            const guilds = scope.client.guilds.cache;
            const guildIds = guilds.map((guild) => guild.id);
            const usageStats = usage.getStats();
            const guildStatsById =
                guildIds.length > 0 ? usage.getGuildStatsForGuilds(guildIds) : {};
            const result: Record<
                string,
                {
                    name: string;
                    budget: number;
                    usage: ReturnType<typeof usage.getGuildStats>;
                    limits: ReturnType<typeof resolveBudgetLimits>;
                    limitOverrides: BudgetLimitOverrides;
                    vision: { month: string; images: number; limit: number | null };
                }
            > = {};

            for (const [id, guild] of guilds) {
                const hasCustom = guildBudgets[id]?.monthlyBudgetUsd !== undefined;
                result[id] = {
                    name: guild.name,
                    budget: guildBudgets[id]?.monthlyBudgetUsd ?? -1,
                    usage: hasCustom ? (guildStatsById[id] ?? usage.getGuildStats(id)) : usageStats,
                    limits: resolveBudgetLimits(defaultLimits, limitOverrides[id]),
                    limitOverrides: limitOverrides[id] ?? {},
                    vision: {
                        month: visionMonth,
                        images: visionUsage[id] ?? 0,
                        limit: visionLimits[id] ?? null,
                    },
                };
            }
            res.json(result);
        },
    );

    api.get(
        '/user-budgets',
        requireDashboardCapability('userAccess'),
        auth.requireAuth,
        async (_req: Request, res: Response) => {
            const userBudgets = store.listUserBudgets();
            const visionMonth = new Date().toISOString().slice(0, 7);
            const visionLimits = store.listVisionScopeLimits('user');
            const visionUsage = store.listVisionMonthlyUsage(visionMonth, 'user');
            const cfg = configRepository.getDashboardConfig();
            const allowedUserIds = new Set(cfg.allowedUserIds);
            const pendingUserIds = new Set(pendingUserInstallOwnerRepository.listUserIds());
            const userIds = [
                ...new Set([
                    ...cfg.allowedUserIds,
                    ...pendingUserIds,
                    ...Object.keys(userBudgets),
                    ...Object.keys(visionLimits),
                ]),
            ];
            const result: Record<
                string,
                {
                    budget: number;
                    isCustom: boolean;
                    allowed: boolean;
                    pending: boolean;
                    vision: { month: string; images: number; limit: number | null };
                }
            > = {};

            for (const userId of userIds) {
                const customBudget = userBudgets[userId];
                result[userId] = {
                    budget: customBudget?.monthlyBudgetUsd ?? cfg.defaultUserMonthlyBudgetUsd,
                    isCustom: customBudget !== undefined,
                    allowed: allowedUserIds.has(userId),
                    pending: pendingUserIds.has(userId) && !allowedUserIds.has(userId),
                    vision: {
                        month: visionMonth,
                        images: visionUsage[userId] ?? 0,
                        limit: visionLimits[userId] ?? null,
                    },
                };
            }

            const profiles = await resolveDiscordUserProfiles({
                client: userInstallClient,
                repository: userProfileRepository,
                userIds: Object.keys(result),
            });

            res.json({ budgets: result, profiles });
        },
    );

    api.post(
        '/user-budgets/:userId',
        requireDashboardCapability('userAccess'),
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const userId = String(req.params.userId ?? '').trim();

            if (!userId) {
                res.status(400).json({ error: 'User id is required' });
                return;
            }

            const result = applyScopedBudgetUpdate('user', userId, req.body);
            if (!result.ok) {
                res.status(400).json({ error: result.error });
                return;
            }
            res.json({
                ok: true,
                ...('budget' in result
                    ? result.budget === null
                        ? { mode: 'default' }
                        : { budget: result.budget }
                    : {}),
            });
        },
    );

    api.post(
        '/guild-budgets/:guildId',
        requireDashboardCapability('guildAccess'),
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const guildId = String(req.params.guildId ?? '').trim();

            if (!guildId) {
                res.status(400).json({ error: 'Guild id is required' });
                return;
            }

            const result = applyScopedBudgetUpdate('guild', guildId, req.body);
            if (!result.ok) {
                res.status(400).json({ error: result.error });
                return;
            }
            res.json({
                ok: true,
                ...('budget' in result
                    ? result.budget === null
                        ? { mode: 'global' }
                        : { budget: result.budget }
                    : {}),
                ...('limitOverrides' in result ? { limitOverrides: result.limitOverrides } : {}),
            });
        },
    );

    api.get(
        '/guild-glossary/:guildId',
        requireDashboardCapability('guildGlossary'),
        auth.requireAuth,
        (req: Request, res: Response) => {
            const guildId = String(req.params.guildId ?? '').trim();
            if (!guildId) {
                res.status(400).json({ error: 'Guild id is required' });
                return;
            }

            const entries = store.listGuildGlossary(guildId);
            res.json({ entries, count: entries.length });
        },
    );

    api.post(
        '/guild-glossary/:guildId',
        requireDashboardCapability('guildGlossary'),
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
                const entry = store.upsertGuildGlossaryEntry(guildId, input.value);
                cache.clear();
                res.json({ ok: true, entry, cacheCleared: true });
            } catch (error) {
                res.status(404).json({ error: (error as Error).message });
            }
        },
    );

    api.post(
        '/guild-glossary/:guildId/import',
        requireDashboardCapability('guildGlossary'),
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const guildId = String(req.params.guildId ?? '').trim();
            if (!guildId) {
                res.status(400).json({ error: 'Guild id is required' });
                return;
            }

            const importRequest = sanitizeGlossaryImportRequest(req.body ?? {});
            if (!importRequest.ok) {
                res.status(400).json({ error: importRequest.error });
                return;
            }

            const parsed = parseGlossaryImport(importRequest.value.text);
            const existingIdsByKey = new Map(
                store
                    .listGuildGlossary(guildId)
                    .map(
                        (entry) =>
                            [
                                normalizeGlossaryKey(entry.sourceText, entry.targetLanguage),
                                entry.id,
                            ] as const,
                    ),
            );
            const pendingIndexesByKey = new Map<string, number>();
            const upserts: GuildGlossaryInput[] = [];
            let created = 0;
            let updated = 0;
            let skipped = 0;

            for (const row of parsed.rows) {
                const normalizedKey = normalizeGlossaryKey(
                    row.input.sourceText,
                    row.input.targetLanguage,
                );
                const existingId = existingIdsByKey.get(normalizedKey);
                const pendingIndex = pendingIndexesByKey.get(normalizedKey);
                const duplicate = existingId !== undefined || pendingIndex !== undefined;

                if (duplicate && importRequest.value.duplicateMode === 'skip') {
                    skipped++;
                    continue;
                }

                const input =
                    existingId === undefined ? row.input : { id: existingId, ...row.input };
                if (pendingIndex === undefined) {
                    pendingIndexesByKey.set(normalizedKey, upserts.length);
                    upserts.push(input);
                } else {
                    upserts[pendingIndex] = input;
                }

                if (duplicate) {
                    updated++;
                    continue;
                }

                created++;
            }

            store.upsertGuildGlossaryEntries(guildId, upserts);

            const failed = parsed.errors?.length ?? 0;
            const changed = created + updated > 0;
            if (changed) {
                cache.clear();
            }

            res.json({
                ok: true,
                created,
                updated,
                skipped,
                failed,
                errors: parsed.errors ?? [],
                cacheCleared: changed,
            });
        },
    );

    api.delete(
        '/guild-glossary/:guildId/:entryId',
        requireDashboardCapability('guildGlossary'),
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

            if (!store.deleteGuildGlossaryEntry(guildId, entryId)) {
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

    api.get('/user-prefs', auth.requireAuth, async (_req: Request, res: Response) => {
        const scope = getScope(res);
        const allPreferences = store.listUserLanguagePreferences();
        const entries = scope.capabilities.guildAccess
            ? (() => {
                  const guildsById = new Map(
                      scope.client.guilds.cache.map((guild) => [
                          guild.id,
                          {
                              id: guild.id,
                              name: guild.name,
                              icon: guild.iconURL({ size: 32 }) || '',
                              memberCount: guild.memberCount,
                          },
                      ]),
                  );

                  return allPreferences
                      .filter((entry) => entry.guildId && guildsById.has(entry.guildId))
                      .map((entry) => ({
                          ...entry,
                          guildName: guildsById.get(entry.guildId)?.name ?? entry.guildId,
                          guildIcon: guildsById.get(entry.guildId)?.icon ?? '',
                          guildMemberCount: guildsById.get(entry.guildId)?.memberCount ?? null,
                      }));
              })()
            : allPreferences.filter((entry) => !entry.guildId);
        const userIds = [...new Set(entries.map((entry) => entry.userId))];
        const profiles = await resolveDiscordUserProfiles({
            client: scope.client,
            repository: userProfileRepository,
            userIds,
        });

        res.json({
            entries,
            count: entries.length,
            profiles,
        });
    });

    api.post(
        '/user-prefs/batch-delete',
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const refs = Array.isArray(req.body.entries)
                ? (req.body.entries as unknown[])
                      .map((entry: unknown) => sanitizeUserPreferenceRef(entry))
                      .filter((entry): entry is { guildId: string; userId: string } => !!entry)
                : [];

            if (refs.length === 0) {
                res.status(400).json({
                    error: 'entries must be a non-empty array of guildId/userId pairs',
                });
                return;
            }

            const deleted: Array<{ guildId: string; userId: string }> = [];
            const notFound: Array<{ guildId: string; userId: string }> = [];
            const seen = new Set<string>();

            for (const ref of refs) {
                const key = `${ref.guildId}\u0000${ref.userId}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                if (store.deleteUserLanguage(ref.guildId, ref.userId)) {
                    deleted.push(ref);
                } else {
                    notFound.push(ref);
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
            const scope = getScope(res);
            const userId = req.params.userId as string;
            const guildId = String(req.query.guildId ?? '').trim();
            if (scope.capabilities.guildAccess && !guildId) {
                res.status(400).json({ error: 'guildId is required' });
                return;
            }

            if (store.deleteUserLanguage(guildId, userId)) {
                res.json({ ok: true, deleted: { guildId, userId } });
            } else {
                res.status(404).json({ error: dashboardMessages.userPreferences.notFound });
            }
        },
    );

    api.post('/cache/clear', auth.requireAuth, auth.requireCsrf, (_req: Request, res: Response) => {
        const before = cache.stats();
        const ocrBefore = ocrCache.stats();
        cache.clear();
        ocrCache.clear();
        res.json({
            ok: true,
            cleared: before.size + ocrBefore.size,
            translationCleared: before.size,
            ocrCleared: ocrBefore.size,
        });
    });

    api.post(
        '/translate/test',
        auth.requireAuth,
        auth.requireCsrf,
        async (req: Request, res: Response) => {
            const scope = getScope(res);
            const scopedTranslationService = getDashboardTranslationService(scope);
            const { text, targetLanguage } = req.body;
            if (!text?.trim()) {
                res.status(400).json({ error: dashboardMessages.translationTest.textRequired });
                return;
            }
            try {
                const start = Date.now();
                const result = await scopedTranslationService.process({
                    command: 'translate',
                    commandLabel: 'dashboard translation test',
                    guildId: null,
                    guildName: 'Dashboard',
                    userId: 'dashboard-admin',
                    userTag: 'Dashboard Admin',
                    locale: undefined,
                    text,
                    targetLanguageOption: targetLanguage || 'auto',
                    bypassAccessControl: true,
                    beforeTranslate: async () => undefined,
                });

                if (result.status === 'blocked') {
                    res.status(400).json({ error: result.message });
                    return;
                }

                if (result.status === 'error') {
                    res.status(500).json({ error: sanitizeError(result.message) });
                    return;
                }

                res.json({
                    ok: true,
                    translation: result.translatedText,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    latencyMs: Date.now() - start,
                    cached: result.cached,
                    provider: result.provider,
                    fallback: result.fallback,
                });
            } catch (err) {
                res.status(500).json({ error: sanitizeError((err as Error).message) });
            }
        },
    );

    api.get('/health', auth.requireAuth, async (_req: Request, res: Response) => {
        const readiness = await getReadinessStatus({ discordReady: isDiscordReady });
        res.status(readiness.ready ? 200 : 503).json({
            healthy: readiness.ready,
            readiness: readiness.status,
            vertexAi: readiness.checks.vertexAi,
            checks: readiness.checks,
        });
    });

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
