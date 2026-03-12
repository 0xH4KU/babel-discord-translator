import express from 'express';
import crypto from 'crypto';
import { config } from './config.js';
import { store } from './store.js';
import { usage } from './usage.js';
import { translate } from './translate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sessions = new Set();

function getSession(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    return match ? match[1] : null;
}

function requireAuth(req, res, next) {
    const token = getSession(req);
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

export function startDashboard({ cache, cooldown, log, client, getStats }) {
    const app = express();

    app.use(express.json());
    app.use(express.static(join(__dirname, 'public')));

    // --- Public routes ---

    app.post('/api/login', (req, res) => {
        const { password } = req.body;
        if (password === config.dashboardPassword) {
            const token = crypto.randomBytes(32).toString('hex');
            sessions.add(token);
            res.setHeader(
                'Set-Cookie',
                `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`,
            );
            res.json({ ok: true });
        } else {
            res.status(401).json({ error: 'Wrong password' });
        }
    });

    app.get('/api/auth/check', (req, res) => {
        const token = getSession(req);
        res.json({ authenticated: !!(token && sessions.has(token)) });
    });

    // --- Logout ---

    app.post('/api/logout', (req, res) => {
        const token = getSession(req);
        if (token) sessions.delete(token);
        res.setHeader(
            'Set-Cookie',
            'session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0',
        );
        res.json({ ok: true });
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
        const updates = req.body;

        if (!updates.vertexAiApiKey || updates.vertexAiApiKey.startsWith('••••')) {
            delete updates.vertexAiApiKey;
        }

        // Don't let dashboard overwrite these
        delete updates.tokenUsage;
        delete updates.usageHistory;
        delete updates.userLanguagePrefs;

        store.update(updates);

        if (updates.cooldownSeconds !== undefined) {
            cooldown.seconds = parseInt(updates.cooldownSeconds);
        }
        if (updates.cacheMaxSize !== undefined) {
            cache.maxSize = parseInt(updates.cacheMaxSize);
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
}
