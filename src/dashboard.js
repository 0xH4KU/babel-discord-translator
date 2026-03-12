import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { store } from './store.js';
import { usage } from './usage.js';
import { translate } from './translate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Session management with expiry ---
/** @type {Map<string, number>} token → expiry timestamp */
const sessions = new Map();
const SESSION_TTL_MS = 86400 * 1000; // 24 hours

/** Clean up expired sessions every 10 minutes. */
const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, expiry] of sessions) {
        if (now > expiry) sessions.delete(token);
    }
}, 10 * 60 * 1000);
sessionCleanupInterval.unref?.(); // Don't keep process alive

/**
 * Hash a password with SHA-256 for timing-safe comparison.
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Compare two strings in constant time to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extract session token from request cookie.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function getSession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    return match ? match[1] : null;
}

/**
 * Express middleware: reject unauthenticated requests.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
    const token = getSession(req);
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // Check expiry
    if (Date.now() > sessions.get(token)) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Session expired' });
    }
    next();
}

/**
 * Validate and sanitize config update payload.
 * @param {Record<string, unknown>} updates
 * @returns {{ valid: boolean, error?: string, sanitized: Record<string, unknown> }}
 */
function validateConfigUpdate(updates) {
    const sanitized = { ...updates };

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
        const v = parseInt(sanitized.cooldownSeconds);
        if (isNaN(v) || v < 1 || v > 300) {
            return { valid: false, error: 'cooldownSeconds must be 1–300', sanitized };
        }
        sanitized.cooldownSeconds = v;
    }
    if (sanitized.cacheMaxSize !== undefined) {
        const v = parseInt(sanitized.cacheMaxSize);
        if (isNaN(v) || v < 10 || v > 100000) {
            return { valid: false, error: 'cacheMaxSize must be 10–100000', sanitized };
        }
        sanitized.cacheMaxSize = v;
    }
    if (sanitized.dailyBudgetUsd !== undefined) {
        const v = parseFloat(sanitized.dailyBudgetUsd);
        if (isNaN(v) || v < 0) {
            return { valid: false, error: 'dailyBudgetUsd must be >= 0', sanitized };
        }
        sanitized.dailyBudgetUsd = v;
    }
    if (sanitized.inputPricePerMillion !== undefined) {
        const v = parseFloat(sanitized.inputPricePerMillion);
        if (isNaN(v) || v < 0) {
            return { valid: false, error: 'inputPricePerMillion must be >= 0', sanitized };
        }
        sanitized.inputPricePerMillion = v;
    }
    if (sanitized.outputPricePerMillion !== undefined) {
        const v = parseFloat(sanitized.outputPricePerMillion);
        if (isNaN(v) || v < 0) {
            return { valid: false, error: 'outputPricePerMillion must be >= 0', sanitized };
        }
        sanitized.outputPricePerMillion = v;
    }

    return { valid: true, sanitized };
}

/**
 * Build the cookie string for session management.
 * @param {string} token - Session token (empty string to clear)
 * @param {number} maxAge - Max age in seconds
 * @returns {string}
 */
function buildSessionCookie(token, maxAge) {
    const parts = [`session=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${maxAge}`];
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    return parts.join('; ');
}

/**
 * Start the dashboard Express server.
 * @param {object} deps - Injected dependencies.
 * @param {import('./cache.js').TranslationCache} deps.cache
 * @param {import('./cooldown.js').CooldownManager} deps.cooldown
 * @param {import('./log.js').TranslationLog} deps.log
 * @param {import('discord.js').Client} deps.client
 * @param {() => { totalTranslations: number, apiCalls: number }} deps.getStats
 * @returns {import('express').Express}
 */
export function startDashboard({ cache, cooldown, log, client, getStats }) {
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

    app.post('/api/login', loginLimiter, (req, res) => {
        const { password } = req.body;
        const inputHash = hashPassword(String(password || ''));
        const expectedHash = hashPassword(config.dashboardPassword);

        if (safeCompare(inputHash, expectedHash)) {
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, Date.now() + SESSION_TTL_MS);
            res.setHeader('Set-Cookie', buildSessionCookie(token, 86400));
            res.json({ ok: true });
        } else {
            res.status(401).json({ error: 'Wrong password' });
        }
    });

    app.get('/api/auth/check', (req, res) => {
        const token = getSession(req);
        const valid = !!(token && sessions.has(token) && Date.now() <= sessions.get(token));
        res.json({ authenticated: valid });
    });

    // --- Logout ---

    app.post('/api/logout', (req, res) => {
        const token = getSession(req);
        if (token) sessions.delete(token);
        res.setHeader('Set-Cookie', buildSessionCookie('', 0));
        res.json({ ok: true });
    });

    // --- Docker / LB health check (public, no auth) ---
    app.get('/healthz', (req, res) => {
        res.json({ status: 'ok' });
    });

    // --- Protected routes ---

    app.get('/api/setup-status', requireAuth, (req, res) => {
        res.json({ complete: store.isSetupComplete() });
    });

    app.get('/api/stats', requireAuth, (req, res) => {
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

    app.get('/api/config', requireAuth, (req, res) => {
        const cfg = store.getAll();
        res.json({
            ...cfg,
            vertexAiApiKey: cfg.vertexAiApiKey
                ? '••••' + cfg.vertexAiApiKey.slice(-6)
                : '',
            hasApiKey: !!cfg.vertexAiApiKey,
        });
    });

    app.post('/api/config', requireAuth, (req, res) => {
        const { valid, error, sanitized } = validateConfigUpdate(req.body);
        if (!valid) {
            return res.status(400).json({ error });
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

    app.get('/api/guilds', requireAuth, (req, res) => {
        const guilds = client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 32 }) || '',
            memberCount: g.memberCount,
        }));
        res.json(guilds);
    });

    // --- Usage history ---

    app.get('/api/usage/history', requireAuth, (req, res) => {
        res.json(usage.getHistory());
    });

    // --- Logs (with optional filter) ---

    app.get('/api/logs', requireAuth, (req, res) => {
        const count = Math.min(parseInt(req.query.count) || 50, 200);
        const filter = req.query.filter; // 'translation', 'error', or undefined
        res.json(log.getRecent(count, filter));
    });

    // --- User language preferences ---

    app.get('/api/user-prefs', requireAuth, (req, res) => {
        const prefs = store.get('userLanguagePrefs') || {};
        res.json({
            prefs,
            count: Object.keys(prefs).length,
        });
    });

    app.delete('/api/user-prefs/:userId', requireAuth, (req, res) => {
        const prefs = store.get('userLanguagePrefs') || {};
        const { userId } = req.params;
        if (prefs[userId]) {
            delete prefs[userId];
            store.set('userLanguagePrefs', prefs);
            res.json({ ok: true, deleted: userId });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    });

    // --- Cache management ---

    app.post('/api/cache/clear', requireAuth, (req, res) => {
        const before = cache.stats();
        cache.clear();
        res.json({ ok: true, cleared: before.size });
    });

    // --- Translation test ---

    app.post('/api/translate/test', requireAuth, async (req, res) => {
        const { text, targetLanguage } = req.body;
        if (!text?.trim()) {
            return res.status(400).json({ error: 'Text is required' });
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
            res.status(500).json({ error: err.message });
        }
    });

    // --- API health check ---

    app.get('/api/health', requireAuth, async (req, res) => {
        const apiKey = store.get('vertexAiApiKey');
        const project = store.get('gcpProject');
        if (!apiKey || !project) {
            return res.json({ healthy: false, error: 'API not configured' });
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
            res.json({ healthy: false, error: err.message });
        }
    });

    app.listen(config.dashboardPort, () => {
        console.log(`📊 Dashboard: http://localhost:${config.dashboardPort}`);
    });

    return app;
}

// Export for testing internals
export const _test = { hashPassword, safeCompare, validateConfigUpdate, buildSessionCookie, sessions };
