import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AppMetrics } from '../src/app-metrics.js';

// --- Mock dependencies ---
vi.mock('dotenv/config', () => ({}));

vi.mock('../src/modules/config/config.js', () => ({
    config: {
        discordToken: 'test-token',
        dashboardPort: 0, // bind to random port
        dashboardPassword: 'test-pass-123',
    },
}));

vi.mock('../src/store.js', () => {
    const data: Record<string, unknown> = {
        vertexAiApiKey: 'sk-abcdef123456',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        geminiModel: 'gemini-2.5-flash-lite',
        allowedGuildIds: [],
        cooldownSeconds: 5,
        cacheMaxSize: 2000,
        setupComplete: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        dailyBudgetUsd: 0,
        translationPrompt: '',
        userLanguagePrefs: { user1: 'ja', user2: 'ko' },
        maxInputLength: 2000,
        maxOutputTokens: 1000,
        tokenUsage: null,
        usageHistory: [],
        guildBudgets: {},
        guildTokenUsage: {},
        guildUsageHistory: {},
    };
    return {
        store: {
            get: vi.fn((key: string) => data[key]),
            set: vi.fn((key: string, val: unknown) => {
                data[key] = val;
            }),
            update: vi.fn((obj: Record<string, unknown>) => Object.assign(data, obj)),
            getAll: vi.fn(() => ({ ...data })),
            getConfigValues: vi.fn((keys: readonly string[]) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const value = data[key];
                        return [key, Array.isArray(value) ? [...value] : value];
                    }),
                ),
            ),
            isSetupComplete: vi.fn(() => data.setupComplete),
        },
    };
});

vi.mock('../src/modules/usage/usage.js', () => ({
    usage: {
        getStats: vi.fn(() => ({
            date: '2025-03-01',
            inputTokens: 1000,
            outputTokens: 500,
            requests: 10,
            inputCost: 0.001,
            outputCost: 0.001,
            totalCost: 0.002,
            dailyBudget: 1.0,
            budgetUsedPercent: 0.2,
            budgetExceeded: false,
        })),
        getHistory: vi.fn(() => []),
        record: vi.fn(),
    },
}));

vi.mock('../src/modules/translation/translate.js', () => ({
    translate: vi.fn(async (text: string) => ({
        text: `translated: ${text}`,
        inputTokens: 10,
        outputTokens: 5,
    })),
}));

import { createDashboardApp, startDashboardServer, stopDashboardApp } from '../src/dashboard.js';
import { InMemorySessionRepository } from '../src/auth/in-memory-session-repository.js';
import { TranslationCache } from '../src/cache.js';
import { CooldownManager } from '../src/cooldown.js';
import { TranslationLog } from '../src/log.js';
import { TranslationRuntimeLimiter } from '../src/translation-runtime-limiter.js';
import type { Client } from 'discord.js';

interface TestResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown> | null;
    rawHeaders: http.IncomingHttpHeaders;
}

// --- Helper: make HTTP requests to the test server ---
function request(
    server: http.Server,
    method: string,
    path: string,
    { body, cookie, csrf }: { body?: Record<string, unknown>; cookie?: string; csrf?: string } = {},
): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
        const addr = server.address() as { port: number };
        const options: http.RequestOptions = {
            hostname: '127.0.0.1',
            port: addr.port,
            path,
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (cookie) (options.headers as Record<string, string>)['Cookie'] = cookie;
        if (csrf) (options.headers as Record<string, string>)['x-csrf-token'] = csrf;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    status: res.statusCode!,
                    headers: res.headers,
                    body: data ? JSON.parse(data) : null,
                    rawHeaders: res.headers,
                });
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

describe('Dashboard API', () => {
    let app: ReturnType<typeof createDashboardApp>;
    let cache: TranslationCache;
    let metrics: AppMetrics;
    let server: http.Server;
    let sessionCookie: string;
    let csrfToken: string;
    let healthCheck: ReturnType<typeof vi.fn>;
    let runtimeLimiter: TranslationRuntimeLimiter;

    beforeAll(async () => {
        cache = new TranslationCache(100);
        metrics = new AppMetrics();
        runtimeLimiter = new TranslationRuntimeLimiter({
            maxConcurrent: 2,
            maxGlobalQueue: 6,
            maxGuildQueue: 3,
            maxUserOutstanding: 1,
        });
        healthCheck = vi.fn().mockResolvedValue({ healthy: true, latencyMs: 24 });
        const cooldown = new CooldownManager(5);
        const log = new TranslationLog(100);
        const mockClient = {
            user: { tag: 'Babel#1234', displayAvatarURL: () => 'https://example.com/avatar.png' },
            guilds: { cache: { size: 3, map: (_fn: Function) => [] } },
        } as unknown as Client;

        app = createDashboardApp({
            cache,
            cooldown,
            log,
            client: mockClient,
            getStats: () => ({ totalTranslations: 42, apiCalls: 30 }),
            metrics,
            runtimeLimiter,
            healthCheck,
            sessionRepository: new InMemorySessionRepository(),
        });

        server = startDashboardServer(app, 0);
    });

    afterAll(() => {
        stopDashboardApp(app);
        server?.close();
    });

    // --- Auth tests ---

    it('should reject login with wrong password', async () => {
        const res = await request(server, 'POST', '/api/login', {
            body: { password: 'wrong' },
        });
        expect(res.status).toBe(401);
        expect(res.body!.error).toBe('Wrong password');
    });

    it('should accept login with correct password', async () => {
        const res = await request(server, 'POST', '/api/login', {
            body: { password: 'test-pass-123' },
        });
        expect(res.status).toBe(200);
        expect(res.body!.ok).toBe(true);

        // Extract session cookie for subsequent requests
        const setCookie = res.rawHeaders['set-cookie'];
        expect(setCookie).toBeDefined();
        sessionCookie = setCookie![0].split(';')[0]; // 'session=xxx'
    });

    it('should report authenticated after login', async () => {
        const res = await request(server, 'GET', '/api/auth/check', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(res.body!.authenticated).toBe(true);
        expect(res.body!.csrfToken).toBeDefined();
        csrfToken = res.body!.csrfToken as string;
    });

    it('should report unauthenticated without cookie', async () => {
        const res = await request(server, 'GET', '/api/auth/check');
        expect(res.body!.authenticated).toBe(false);
    });

    // --- Protected route access ---

    it('should reject unauthenticated requests to protected routes', async () => {
        const res = await request(server, 'GET', '/api/stats');
        expect(res.status).toBe(401);
    });

    it('should expose liveness, readiness, and composite health endpoints', async () => {
        healthCheck.mockResolvedValue({ healthy: true, latencyMs: 18 });

        const live = await request(server, 'GET', '/livez');
        expect(live.status).toBe(200);
        expect(live.body!.live).toBe(true);
        expect(live.body!.status).toBe('ok');

        const ready = await request(server, 'GET', '/readyz');
        expect(ready.status).toBe(200);
        expect(ready.body!.ready).toBe(true);
        expect((ready.body!.checks as Record<string, unknown>).vertexAi).toBeDefined();

        const health = await request(server, 'GET', '/healthz');
        expect(health.status).toBe(200);
        expect(health.body!.live).toBe(true);
        expect(health.body!.ready).toBe(true);
        expect(health.body!.strategy).toBeDefined();
    });

    it('should report degraded health when Vertex AI readiness fails', async () => {
        healthCheck.mockResolvedValue({ healthy: false, error: 'upstream unavailable' });

        const ready = await request(server, 'GET', '/readyz');
        expect(ready.status).toBe(503);
        expect(ready.body!.ready).toBe(false);

        const health = await request(server, 'GET', '/healthz');
        expect(health.status).toBe(200);
        expect(health.body!.status).toBe('degraded');
        expect(
            (health.body!.checks as Record<string, Record<string, unknown>>).vertexAi.error,
        ).toBe('upstream unavailable');
    });

    it('should return stats for authenticated user', async () => {
        metrics.recordTranslationSuccess({ cached: true });
        metrics.recordTranslationApiCall();
        metrics.recordTranslationFailure();
        metrics.recordBudgetExceeded();
        metrics.recordWebhookRecreate();
        const res = await request(server, 'GET', '/api/stats', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect((res.body!.bot as Record<string, unknown>).name).toBe('Babel#1234');
        expect((res.body!.translations as Record<string, unknown>).total).toBe(42);
        expect((res.body!.metrics as Record<string, unknown>).translationFailuresTotal).toBe(1);
        expect((res.body!.translations as Record<string, unknown>).webhookRecreated).toBe(1);
        expect(
            (res.body!.runtime as Record<string, Record<string, unknown>>).limits.maxConcurrent,
        ).toBe(2);
        expect((res.body!.bot as Record<string, unknown>).memory).toBeDefined();
    });

    it('should expose readiness details on the authenticated health endpoint', async () => {
        healthCheck.mockResolvedValue({ healthy: true, latencyMs: 12 });

        const res = await request(server, 'GET', '/api/health', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(res.body!.healthy).toBe(true);
        expect((res.body!.vertexAi as Record<string, unknown>).latencyMs).toBe(12);
        expect((res.body!.checks as Record<string, unknown>).configuration).toBeDefined();
    });

    // --- Config masking ---

    it('should mask API key in config response', async () => {
        const res = await request(server, 'GET', '/api/config', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(res.body!.vertexAiApiKey as string).toMatch(/^••••/);
        expect(res.body!.hasApiKey).toBe(true);
        // Should NOT expose the real key
        expect(res.body!.vertexAiApiKey as string).not.toContain('sk-abcdef');
    });

    // --- CSRF protection ---

    it('should reject mutation without CSRF token', async () => {
        const res = await request(server, 'POST', '/api/config', {
            cookie: sessionCookie,
            body: { cooldownSeconds: 10 },
        });
        expect(res.status).toBe(403);
        expect(res.body!.error).toBe('Invalid CSRF token');
    });

    // --- Config update protection ---

    it('should not overwrite protected fields via POST /api/config', async () => {
        const { store } = await import('../src/store.js');
        const res = await request(server, 'POST', '/api/config', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                tokenUsage: { hacked: true },
                usageHistory: [{ hacked: true }],
                userLanguagePrefs: { hacked: true },
                cooldownSeconds: 10,
            },
        });
        expect(res.status).toBe(200);

        // store.update should have been called without the protected fields
        const lastCall = (store.update as ReturnType<typeof vi.fn>).mock.calls[
            (store.update as ReturnType<typeof vi.fn>).mock.calls.length - 1
        ][0];
        expect(lastCall).not.toHaveProperty('tokenUsage');
        expect(lastCall).not.toHaveProperty('usageHistory');
        expect(lastCall).not.toHaveProperty('userLanguagePrefs');
        expect(lastCall.cooldownSeconds).toBe(10);
    });

    it('should clear the translation cache when prompt, model, or output token settings change', async () => {
        const clearSpy = vi.spyOn(cache, 'clear');
        const res = await request(server, 'POST', '/api/config', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                geminiModel: 'gemini-2.5-pro',
            },
        });

        expect(res.status).toBe(200);
        expect(res.body!.cacheCleared).toBe(true);
        expect(res.body!.changedKeys).toContain('geminiModel');
        expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    // --- Translate test endpoint ---

    it('should reject translate test with empty text', async () => {
        const res = await request(server, 'POST', '/api/translate/test', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { text: '' },
        });
        expect(res.status).toBe(400);
    });

    it('should translate test text successfully', async () => {
        const res = await request(server, 'POST', '/api/translate/test', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { text: 'Hello', targetLanguage: 'ja' },
        });
        expect(res.status).toBe(200);
        expect(res.body!.ok).toBe(true);
        expect(res.body!.translation).toBe('translated: Hello');
    });

    // --- Logs ---

    it('should return logs with count limit', async () => {
        const res = await request(server, 'GET', '/api/logs?count=5', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    // --- Logout ---

    it('should logout and clear session', async () => {
        const res = await request(server, 'POST', '/api/logout', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(res.body!.ok).toBe(true);

        // Subsequent request should fail
        const check = await request(server, 'GET', '/api/stats', {
            cookie: sessionCookie,
        });
        expect(check.status).toBe(401);
    });
});
