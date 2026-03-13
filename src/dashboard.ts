import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { store } from './store.js';
import { usage } from './usage.js';
import { translate } from './translate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { SessionData, DashboardDeps, StoreData } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Extend Express Request to include csrfToken
declare module 'express-serve-static-core' {
    interface Request {
        csrfToken?: string;
    }
}

// --- Session management with expiry ---
const sessions = new Map<string, SessionData>();
const SESSION_TTL_MS = 86400 * 1000; // 24 hours

/** Clean up expired sessions every 10 minutes. */
const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now > session.expiry) sessions.delete(token);
    }
}, 10 * 60 * 1000);
sessionCleanupInterval.unref?.(); // Don't keep process alive

/** Hash a password with SHA-256 for timing-safe comparison. */
function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/** Compare two strings in constant time to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/** Extract session token from request cookie. */
function getSession(req: Request): string | null {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    return match?.[1] ?? null;
}

/** Express middleware: reject unauthenticated requests. */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = getSession(req);
    if (!token || !sessions.has(token)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    // Check expiry
    const session = sessions.get(token)!;
    if (Date.now() > session.expiry) {
        sessions.delete(token);
        res.status(401).json({ error: 'Session expired' });
        return;
    }
    req.csrfToken = session.csrf;
    next();
}

/** Express middleware: reject requests without a valid CSRF token. */
function requireCsrf(req: Request, res: Response, next: NextFunction): void {
    const headerToken = req.headers['x-csrf-token'] as string | undefined;
    if (!headerToken || !req.csrfToken || !safeCompare(headerToken, req.csrfToken)) {
        res.status(403).json({ error: 'Invalid CSRF token' });
        return;
    }
    next();
}

/**
 * Validate and sanitize config update payload.
 */
function validateConfigUpdate(updates: Record<string, unknown>): { valid: boolean; error?: string; sanitized: Partial<StoreData> } {
    const sanitized: Record<string, unknown> = { ...updates };

    // Strip masked or empty API key
    if (!sanitized.vertexAiApiKey || String(sanitized.vertexAiApiKey).startsWith('••••')) {
        delete sanitized.vertexAiApiKey;
    }

    // Never allow overwriting internal state
    delete sanitized.tokenUsage;
    delete sanitized.usageHistory;
    delete sanitized.userLanguagePrefs;

    // Validate numeric fields
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

/** Build the cookie string for session management. */
function buildSessionCookie(token: string, maxAge: number, req?: Request): string {
    const parts = [`session=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${maxAge}`];
    const isSecure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
    if (isSecure) parts.push('Secure');
    return parts.join('; ');
}

/** Start the dashboard Express server. */
export function startDashboard({ cache, cooldown, log, client, getStats }: DashboardDeps): express.Express {
    const app = express();

    app.use(express.json());
    app.use(express.static(join(__dirname, 'public')));

    // --- Login rate limiting: 5 attempts per 15 minutes per IP ---
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: { error: 'Too many login attempts, please try again later' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // --- Public routes ---

    app.post('/api/login', loginLimiter, (req: Request, res: Response) => {
        const { password } = req.body;
        if (password && safeCompare(hashPassword(password), hashPassword(config.dashboardPassword))) {
            const token = crypto.randomBytes(32).toString('hex');
            const csrf = crypto.randomBytes(32).toString('hex');
            sessions.set(token, { expiry: Date.now() + SESSION_TTL_MS, csrf });
            res.setHeader('Set-Cookie', buildSessionCookie(token, 86400, req));
            res.json({ ok: true });
        } else {
            res.status(401).json({ error: 'Wrong password' });
        }
    });

    app.get('/api/auth/check', (req: Request, res: Response) => {
        const token = getSession(req);
        const session = token ? sessions.get(token) : null;
        const valid = !!(session && Date.now() <= session.expiry);
        res.json({ authenticated: valid, csrfToken: valid ? session!.csrf : undefined });
    });

    // --- Logout ---

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = getSession(req);
        if (token) sessions.delete(token);
        res.setHeader('Set-Cookie', buildSessionCookie('', 0, req));
        res.json({ ok: true });
    });

    // --- Docker / LB health check (public, no auth) ---
    app.get('/healthz', (_req: Request, res: Response) => {
        res.json({ status: 'ok' });
    });

    // --- Protected routes ---

    app.get('/api/setup-status', requireAuth, (_req: Request, res: Response) => {
        res.json({ complete: store.isSetupComplete() });
    });

    app.get('/api/stats', requireAuth, (_req: Request, res: Response) => {
        const stats = getStats();
        const cacheStats = cache.stats();
        const usageStats = usage.getStats();

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
            errors: log.errorCount,
        });
    });

    app.get('/api/config', requireAuth, (_req: Request, res: Response) => {
        const cfg = store.getAll();
        res.json({
            ...cfg,
            vertexAiApiKey: cfg.vertexAiApiKey
                ? '••••' + cfg.vertexAiApiKey.slice(-6)
                : '',
            hasApiKey: !!cfg.vertexAiApiKey,
        });
    });

    app.post('/api/config', requireAuth, requireCsrf, (req: Request, res: Response) => {
        const { valid, error, sanitized } = validateConfigUpdate(req.body);
        if (!valid) {
            res.status(400).json({ error });
            return;
        }

        store.update(sanitized);

        if (sanitized.cooldownSeconds !== undefined) {
            cooldown.seconds = sanitized.cooldownSeconds;
        }
        if (sanitized.cacheMaxSize !== undefined) {
            cache.maxSize = sanitized.cacheMaxSize;
        }

        res.json({ ok: true });
    });

    app.get('/api/guilds', requireAuth, (_req: Request, res: Response) => {
        const guilds = client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 32 }) || '',
            memberCount: g.memberCount,
        }));
        res.json(guilds);
    });

    // --- Usage history ---

    app.get('/api/usage/history', requireAuth, (_req: Request, res: Response) => {
        res.json(usage.getHistory());
    });

    // --- Logs (with optional filter) ---

    app.get('/api/logs', requireAuth, (req: Request, res: Response) => {
        const count = Math.min(parseInt(req.query.count as string) || 50, 200);
        const filter = req.query.filter as string | undefined;
        res.json(log.getRecent(count, filter));
    });

    // --- User language preferences ---

    app.get('/api/user-prefs', requireAuth, (_req: Request, res: Response) => {
        const prefs = store.get('userLanguagePrefs') || {};
        res.json({
            prefs,
            count: Object.keys(prefs).length,
        });
    });

    app.delete('/api/user-prefs/:userId', requireAuth, requireCsrf, (req: Request, res: Response) => {
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

    // --- Cache management ---

    app.post('/api/cache/clear', requireAuth, requireCsrf, (_req: Request, res: Response) => {
        const before = cache.stats();
        cache.clear();
        res.json({ ok: true, cleared: before.size });
    });

    // --- Translation test ---

    app.post('/api/translate/test', requireAuth, requireCsrf, async (req: Request, res: Response) => {
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

    // --- API health check ---

    app.get('/api/health', requireAuth, async (_req: Request, res: Response) => {
        const apiKey = store.get('vertexAiApiKey');
        const project = store.get('gcpProject');
        if (!apiKey || !project) {
            res.json({ healthy: false, error: 'API not configured' });
            return;
        }
        try {
            const start = Date.now();
            const location = store.get('gcpLocation') || 'global';
            const model = store.get('geminiModel');
            const baseUrl =
                location === 'global'
                    ? 'https://aiplatform.googleapis.com'
                    : `https://${location}-aiplatform.googleapis.com`;
            const url = `${baseUrl}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey,
                },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
                    generationConfig: { maxOutputTokens: 5 },
                }),
                signal: AbortSignal.timeout(10000),
            });

            if (response.ok) {
                res.json({ healthy: true, latencyMs: Date.now() - start });
            } else {
                const err = await response.text();
                res.json({ healthy: false, error: `${response.status}: ${err.slice(0, 200)}` });
            }
        } catch (err) {
            res.json({ healthy: false, error: (err as Error).message });
        }
    });

    app.listen(config.dashboardPort, () => {
        console.log(`📊 Dashboard: http://localhost:${config.dashboardPort}`);
    });

    return app;
}

// Export for testing internals
export const _test = { hashPassword, safeCompare, validateConfigUpdate, buildSessionCookie, sessions, requireCsrf };
