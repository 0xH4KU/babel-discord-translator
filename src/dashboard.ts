import express, { type Request, type Response } from 'express';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { usage } from './usage.js';
import { translate } from './translate.js';
import { createDashboardAuth } from './auth/dashboard-auth.js';
import { SQLiteSessionRepository } from './auth/sqlite-session-repository.js';
import { checkVertexAiHealth } from './infra/vertex-ai-client.js';
import { configRepository } from './repositories/config-repository.js';
import { guildBudgetRepository } from './repositories/guild-budget-repository.js';
import { userPreferenceRepository } from './repositories/user-preference-repository.js';
import { applyConfigUpdateEffects } from './services/config-runtime-effects.js';
import { appLogger } from './structured-logger.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DashboardDeps, StoreData } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

declare module 'express-serve-static-core' {
    interface Locals {
        disposeDashboardApp?: () => void;
    }
}

function validateConfigUpdate(updates: Record<string, unknown>): { valid: boolean; error?: string; sanitized: Partial<StoreData> } {
    const sanitized: Record<string, unknown> = { ...updates };

    if (!sanitized.vertexAiApiKey || String(sanitized.vertexAiApiKey).startsWith('••••')) {
        delete sanitized.vertexAiApiKey;
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
            return { valid: false, error: 'cooldownSeconds must be 1–300', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.cooldownSeconds = v;
    }
    if (sanitized.cacheMaxSize !== undefined) {
        const v = parseInt(String(sanitized.cacheMaxSize));
        if (isNaN(v) || v < 10 || v > 100000) {
            return { valid: false, error: 'cacheMaxSize must be 10–100000', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.cacheMaxSize = v;
    }
    if (sanitized.maxInputLength !== undefined) {
        const v = parseInt(String(sanitized.maxInputLength));
        if (isNaN(v) || v < 100 || v > 10000) {
            return { valid: false, error: 'maxInputLength must be 100–10000', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.maxInputLength = v;
    }
    if (sanitized.maxOutputTokens !== undefined) {
        const v = parseInt(String(sanitized.maxOutputTokens));
        if (isNaN(v) || v < 100 || v > 8192) {
            return { valid: false, error: 'maxOutputTokens must be 100–8192', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.maxOutputTokens = v;
    }
    if (sanitized.dailyBudgetUsd !== undefined) {
        const v = parseFloat(String(sanitized.dailyBudgetUsd));
        if (isNaN(v) || v < 0) {
            return { valid: false, error: 'dailyBudgetUsd must be >= 0', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.dailyBudgetUsd = v;
    }
    if (sanitized.inputPricePerMillion !== undefined) {
        const v = parseFloat(String(sanitized.inputPricePerMillion));
        if (isNaN(v) || v < 0) {
            return { valid: false, error: 'inputPricePerMillion must be >= 0', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.inputPricePerMillion = v;
    }
    if (sanitized.outputPricePerMillion !== undefined) {
        const v = parseFloat(String(sanitized.outputPricePerMillion));
        if (isNaN(v) || v < 0) {
            return { valid: false, error: 'outputPricePerMillion must be >= 0', sanitized: sanitized as Partial<StoreData> };
        }
        sanitized.outputPricePerMillion = v;
    }

    return { valid: true, sanitized: sanitized as Partial<StoreData> };
}

export function createDashboardApp({
    cache,
    cooldown,
    log,
    client,
    getStats,
    sessionRepository,
}: DashboardDeps): express.Express {
    const app = express();
    const auth = createDashboardAuth({
        password: config.dashboardPassword,
        sessionRepository: sessionRepository ?? new SQLiteSessionRepository(),
    });

    app.locals.disposeDashboardApp = () => {
        auth.dispose();
    };

    app.use(express.json());
    app.use(express.static(join(__dirname, 'public')));

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: { error: 'Too many login attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    app.post('/api/login', loginLimiter, (req: Request, res: Response) => {
        const result = auth.login(req.body.password, req);
        if (!result.ok) {
            res.status(401).json({ error: 'Wrong password' });
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

    app.get('/healthz', (_req: Request, res: Response) => {
        res.json({ status: 'ok' });
    });

    app.get('/api/setup-status', auth.requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: configRepository.isSetupComplete() });
    });

    app.get('/api/stats', auth.requireAuth, (_req: Request, res: Response) => {
        const stats = getStats();
        const cacheStats = cache.stats();
        const usageStats = usage.getStats();

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
                memoryMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
                guilds: client.guilds.cache.size,
            },
            translations: {
                total: stats.totalTranslations,
                apiCalls: stats.apiCalls,
                saved: cacheStats.hits,
            },
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
            vertexAiApiKey: cfg.vertexAiApiKey
                ? '••••' + cfg.vertexAiApiKey.slice(-6)
                : '',
            hasApiKey: !!cfg.vertexAiApiKey,
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
        const result: Record<string, { name: string; budget: number; usage: ReturnType<typeof usage.getGuildStats> }> = {};

        for (const [id, guild] of guilds) {
            result[id] = {
                name: guild.name,
                budget: guildBudgets[id]?.dailyBudgetUsd ?? -1,
                usage: usage.getGuildStats(id),
            };
        }
        res.json(result);
    });

    app.post('/api/guild-budgets/:guildId', auth.requireAuth, auth.requireCsrf, (req: Request, res: Response) => {
        const guildId = req.params.guildId as string;
        const { dailyBudgetUsd } = req.body;

        if (dailyBudgetUsd === null || dailyBudgetUsd === undefined) {
            guildBudgetRepository.clearBudget(guildId);
            res.json({ ok: true, mode: 'global' });
            return;
        }

        const v = parseFloat(String(dailyBudgetUsd));
        if (isNaN(v) || v < 0) {
            res.status(400).json({ error: 'dailyBudgetUsd must be >= 0' });
            return;
        }

        guildBudgetRepository.setBudget(guildId, v);
        res.json({ ok: true, budget: v });
    });

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

    app.delete('/api/user-prefs/:userId', auth.requireAuth, auth.requireCsrf, (req: Request, res: Response) => {
        const userId = req.params.userId as string;
        if (userPreferenceRepository.clearLanguage(userId)) {
            res.json({ ok: true, deleted: userId });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    });

    app.post('/api/cache/clear', auth.requireAuth, auth.requireCsrf, (_req: Request, res: Response) => {
        const before = cache.stats();
        cache.clear();
        res.json({ ok: true, cleared: before.size });
    });

    app.post('/api/translate/test', auth.requireAuth, auth.requireCsrf, async (req: Request, res: Response) => {
        const { text, targetLanguage } = req.body;
        if (!text?.trim()) {
            res.status(400).json({ error: 'Text is required' });
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
    });

    app.get('/api/health', auth.requireAuth, async (_req: Request, res: Response) => {
        res.json(await checkVertexAiHealth());
    });

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
