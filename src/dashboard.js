import express from 'express';
import crypto from 'crypto';
import { config } from './config.js';
import { store } from './store.js';
import { usage } from './usage.js';
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

export function startDashboard({ cache, cooldown, client, getStats }) {
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

        // Don't let dashboard overwrite tokenUsage
        delete updates.tokenUsage;

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

    app.listen(config.dashboardPort, () => {
        console.log(`📊 Dashboard: http://localhost:${config.dashboardPort}`);
    });
}
