import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { store } from './store.js';
import { usage } from './usage.js';
import { translate } from './translate.js';
import { checkVertexAiHealth } from './infra/vertex-ai-client.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { SessionData, DashboardDeps, StoreData } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_TTL_MS = 86400 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

declare module 'express-serve-static-core' {
    interface Request {
        csrfToken?: string;
    }

    interface Locals {
        disposeDashboardApp?: () => void;
    }
}

interface SessionState {
    token: string;
    session: SessionData;
}

interface SessionManager {
    createSession: () => SessionState;
    deleteSession: (token: string) => void;
    getSessionState: (req: Request) => SessionState | null;
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
    dispose: () => void;
}

function createSessionManager(): SessionManager {
    const sessions = new Map<string, SessionData>();

    const cleanupExpiredSessions = (): void => {
        const now = Date.now();
        for (const [token, session] of sessions) {
            if (now > session.expiry) {
                sessions.delete(token);
            }
        }
    };

    const sessionCleanupInterval = setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);
    sessionCleanupInterval.unref?.();

    const getSessionState = (req: Request): SessionState | null => {
        const cookie = req.headers.cookie || '';
        const match = cookie.match(/session=([^;]+)/);
        const token = match?.[1];

        if (!token) {
            return null;
        }

        const session = sessions.get(token);
        if (!session) {
            return null;
        }

        if (Date.now() > session.expiry) {
            sessions.delete(token);
            return null;
        }

        return { token, session };
    };

    const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
        const state = getSessionState(req);
        if (!state) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        req.csrfToken = state.session.csrf;
        next();
    };

    const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
        const headerToken = req.headers['x-csrf-token'] as string | undefined;
        if (!headerToken || !req.csrfToken || !safeCompare(headerToken, req.csrfToken)) {
            res.status(403).json({ error: 'Invalid CSRF token' });
            return;
        }

        next();
    };

    return {
        createSession: () => {
            const token = crypto.randomBytes(32).toString('hex');
            const csrf = crypto.randomBytes(32).toString('hex');
            const session = { expiry: Date.now() + SESSION_TTL_MS, csrf };
            sessions.set(token, session);
            return { token, session };
        },
        deleteSession: (token: string) => {
            sessions.delete(token);
        },
        getSessionState,
        requireAuth,
        requireCsrf,
        dispose: () => {
            clearInterval(sessionCleanupInterval);
            sessions.clear();
        },
    };
}

function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function safeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
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

function buildSessionCookie(token: string, maxAge: number, req?: Request): string {
    const parts = [`session=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${maxAge}`];
    const isSecure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
    if (isSecure) parts.push('Secure');
    return parts.join('; ');
}

export function createDashboardApp({ cache, cooldown, log, client, getStats }: DashboardDeps): express.Express {
    const app = express();
    const sessionManager = createSessionManager();

    app.locals.disposeDashboardApp = () => {
        sessionManager.dispose();
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
        const { password } = req.body;
        if (password && safeCompare(hashPassword(password), hashPassword(config.dashboardPassword))) {
            const { token, session } = sessionManager.createSession();
            res.setHeader('Set-Cookie', buildSessionCookie(token, 86400, req));
            res.json({ ok: true, csrfToken: session.csrf });
        } else {
            res.status(401).json({ error: 'Wrong password' });
        }
    });

    app.get('/api/auth/check', (req: Request, res: Response) => {
        const state = sessionManager.getSessionState(req);
        res.json({
            authenticated: !!state,
            csrfToken: state?.session.csrf,
        });
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const state = sessionManager.getSessionState(req);
        if (state) {
            sessionManager.deleteSession(state.token);
        }
        res.setHeader('Set-Cookie', buildSessionCookie('', 0, req));
        res.json({ ok: true });
    });

    app.get('/healthz', (_req: Request, res: Response) => {
        res.json({ status: 'ok' });
    });

    app.get('/api/setup-status', sessionManager.requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: store.isSetupComplete() });
    });

    app.get('/api/stats', sessionManager.requireAuth, (_req: Request, res: Response) => {
        const stats = getStats();
        const cacheStats = cache.stats();
        const usageStats = usage.getStats();

        const guildBudgetConfigs = store.get('guildBudgets') || {};
        const globalBudget = store.get('dailyBudgetUsd') || 0;
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

    app.get('/api/config', sessionManager.requireAuth, (_req: Request, res: Response) => {
        const cfg = store.getAll();
        res.json({
            ...cfg,
            vertexAiApiKey: cfg.vertexAiApiKey
                ? '••••' + cfg.vertexAiApiKey.slice(-6)
                : '',
            hasApiKey: !!cfg.vertexAiApiKey,
        });
    });

    app.post('/api/config', sessionManager.requireAuth, sessionManager.requireCsrf, (req: Request, res: Response) => {
        const { valid, error, sanitized } = validateConfigUpdate(req.body);
        if (!valid) {
            res.status(400).json({ error });
            return;
        }

        const currentConfig = store.getAll();
        const shouldInvalidateTranslationCache = (
            (sanitized.geminiModel !== undefined && sanitized.geminiModel !== currentConfig.geminiModel) ||
            (sanitized.translationPrompt !== undefined && sanitized.translationPrompt !== currentConfig.translationPrompt) ||
            (sanitized.maxOutputTokens !== undefined && sanitized.maxOutputTokens !== currentConfig.maxOutputTokens)
        );

        store.update(sanitized);

        if (sanitized.cooldownSeconds !== undefined) {
            cooldown.seconds = sanitized.cooldownSeconds;
        }
        if (sanitized.cacheMaxSize !== undefined) {
            cache.maxSize = sanitized.cacheMaxSize;
        }
        if (shouldInvalidateTranslationCache) {
            cache.clear();
        }

        res.json({ ok: true, cacheCleared: shouldInvalidateTranslationCache });
    });

    app.get('/api/guilds', sessionManager.requireAuth, (_req: Request, res: Response) => {
        const guilds = client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 32 }) || '',
            memberCount: g.memberCount,
        }));
        res.json(guilds);
    });

    app.get('/api/usage/history', sessionManager.requireAuth, (req: Request, res: Response) => {
        const guildId = req.query.guildId as string | undefined;
        if (guildId) {
            res.json(usage.getGuildHistory(guildId));
        } else {
            res.json(usage.getHistory());
        }
    });

    app.get('/api/guild-budgets', sessionManager.requireAuth, (_req: Request, res: Response) => {
        const guildBudgets = store.get('guildBudgets') || {};
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

    app.post('/api/guild-budgets/:guildId', sessionManager.requireAuth, sessionManager.requireCsrf, (req: Request, res: Response) => {
        const guildId = req.params.guildId as string;
        const { dailyBudgetUsd } = req.body;

        if (dailyBudgetUsd === null || dailyBudgetUsd === undefined) {
            const guildBudgets = store.get('guildBudgets') || {};
            delete guildBudgets[guildId];
            store.set('guildBudgets', guildBudgets);
            res.json({ ok: true, mode: 'global' });
            return;
        }

        const v = parseFloat(String(dailyBudgetUsd));
        if (isNaN(v) || v < 0) {
            res.status(400).json({ error: 'dailyBudgetUsd must be >= 0' });
            return;
        }

        const guildBudgets = store.get('guildBudgets') || {};
        guildBudgets[guildId] = { dailyBudgetUsd: v };
        store.set('guildBudgets', guildBudgets);
        res.json({ ok: true, budget: v });
    });

    app.get('/api/logs', sessionManager.requireAuth, (req: Request, res: Response) => {
        const count = Math.min(parseInt(req.query.count as string) || 50, 200);
        const filter = req.query.filter as string | undefined;
        res.json(log.getRecent(count, filter));
    });

    app.get('/api/user-prefs', sessionManager.requireAuth, (_req: Request, res: Response) => {
        const prefs = store.get('userLanguagePrefs') || {};
        res.json({
            prefs,
            count: Object.keys(prefs).length,
        });
    });

    app.delete('/api/user-prefs/:userId', sessionManager.requireAuth, sessionManager.requireCsrf, (req: Request, res: Response) => {
        const prefs = store.get('userLanguagePrefs') || {};
        const userId = req.params.userId as string;
        if (prefs[userId]) {
            delete prefs[userId];
            store.set('userLanguagePrefs', prefs);
            res.json({ ok: true, deleted: userId });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    });

    app.post('/api/cache/clear', sessionManager.requireAuth, sessionManager.requireCsrf, (_req: Request, res: Response) => {
        const before = cache.stats();
        cache.clear();
        res.json({ ok: true, cleared: before.size });
    });

    app.post('/api/translate/test', sessionManager.requireAuth, sessionManager.requireCsrf, async (req: Request, res: Response) => {
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

    app.get('/api/health', sessionManager.requireAuth, async (_req: Request, res: Response) => {
        res.json(await checkVertexAiHealth());
    });

    return app;
}

export function startDashboardServer(app: express.Express, port: number): http.Server {
    const server = app.listen(port, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        console.log(`📊 Dashboard: http://localhost:${actualPort}`);
    });

    return server;
}

export function stopDashboardApp(app: express.Express): void {
    app.locals.disposeDashboardApp?.();
}

export const _test = { hashPassword, safeCompare, validateConfigUpdate, buildSessionCookie };
