import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { AppMetrics } from '../src/app-metrics.js';

// --- Mock dependencies ---
vi.mock('dotenv/config', () => ({}));

vi.mock('../src/modules/config/config.js', () => ({
    getConfig: vi.fn(() => ({
        discordToken: 'test-token',
        dashboardPort: 0, // bind to random port
        dashboardPassword: 'test-pass-123',
    })),
}));

vi.mock('../src/store.js', () => {
    const data: Record<string, unknown> = {
        vertexAiApiKey: 'sk-abcdef123456',
        gcpProject: 'test-project',
        gcpLocation: 'global',
        geminiModel: 'gemini-2.5-flash-lite',
        openaiApiKey: '',
        openaiBaseUrl: '',
        openaiModel: '',
        translationProvider: 'vertex',
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
        translationMaxConcurrent: 4,
        translationMaxGlobalQueue: 25,
        translationMaxGuildQueue: 5,
        translationMaxUserOutstanding: 1,
        translationMaxQueueWaitMs: 30000,
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
            getGuildBudget: vi.fn((guildId: string) => {
                const budgets = data.guildBudgets as Record<string, unknown>;
                return budgets[guildId] ?? null;
            }),
            setGuildBudget: vi.fn((guildId: string, dailyBudgetUsd: number) => {
                const budgets = data.guildBudgets as Record<string, unknown>;
                budgets[guildId] = { dailyBudgetUsd };
            }),
            clearGuildBudget: vi.fn((guildId: string) => {
                const budgets = data.guildBudgets as Record<string, unknown>;
                if (!(guildId in budgets)) return false;
                delete budgets[guildId];
                return true;
            }),
            isSetupComplete: vi.fn(() => data.setupComplete),
        },
    };
});

const usageMock = vi.hoisted(() => ({
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
    getGuildStatsForGuilds: vi.fn(() => ({})),
    getHistory: vi.fn(() => []),
    record: vi.fn(),
}));

vi.mock('../src/modules/usage/usage.js', () => ({
    usage: usageMock,
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
import { _test as healthTest } from '../src/shared/health.js';
import type { Client } from 'discord.js';

interface TestResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown> | null;
    rawHeaders: http.IncomingHttpHeaders;
}

interface TextTestResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    text: string;
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

function requestText(
    server: http.Server,
    method: string,
    path: string,
    { cookie, csrf }: { cookie?: string; csrf?: string } = {},
): Promise<TextTestResponse> {
    return new Promise((resolve, reject) => {
        const addr = server.address() as { port: number };
        const options: http.RequestOptions = {
            hostname: '127.0.0.1',
            port: addr.port,
            path,
            method,
            headers: {},
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
                    text: data,
                });
            });
        });

        req.on('error', reject);
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
    let log: TranslationLog;

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
        log = new TranslationLog(100);
        const guilds = [
            { id: 'guild-1', name: 'Guild One', iconURL: () => '', memberCount: 10 },
            { id: 'guild-2', name: 'Guild Two', iconURL: () => '', memberCount: 20 },
            { id: 'guild-3', name: 'Guild Three', iconURL: () => '', memberCount: 30 },
        ];
        const mockClient = {
            user: { tag: 'Babel#1234', displayAvatarURL: () => 'https://example.com/avatar.png' },
            guilds: { cache: { size: guilds.length, map: (fn: Function) => guilds.map(fn) } },
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

    beforeEach(() => {
        healthTest.resetReadinessCache();
        healthCheck?.mockClear();
        healthCheck?.mockResolvedValue({ healthy: true, latencyMs: 24 });
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

    it('should attach security headers to dashboard responses', async () => {
        const res = await request(server, 'GET', '/api/auth/check');

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
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
        expect(usageMock.getGuildStatsForGuilds).toHaveBeenCalledOnce();
        expect((res.body!.bot as Record<string, unknown>).name).toBe('Babel#1234');
        expect((res.body!.translations as Record<string, unknown>).total).toBe(42);
        expect((res.body!.metrics as Record<string, unknown>).translationFailuresTotal).toBe(1);
        expect((res.body!.translations as Record<string, unknown>).webhookRecreated).toBe(1);
        expect(
            (res.body!.runtime as Record<string, Record<string, unknown>>).limits.maxConcurrent,
        ).toBe(2);
        expect((res.body!.bot as Record<string, unknown>).memory).toBeDefined();
    });

    it('should cache readiness probes within the configured health TTL', async () => {
        healthTest.resetReadinessCache();
        healthCheck.mockClear();
        healthCheck.mockResolvedValue({ healthy: true, latencyMs: 21 });

        const first = await request(server, 'GET', '/readyz');
        const second = await request(server, 'GET', '/readyz');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(healthCheck).toHaveBeenCalledTimes(1);
    });

    it('should expose release version metadata to authenticated users', async () => {
        const res = await request(server, 'GET', '/api/version', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            version: '0.1.0',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
        });
    });

    it('should expose Prometheus metrics without dashboard authentication', async () => {
        metrics.recordTranslationSuccess({ cached: true });
        metrics.recordTranslationFailure();
        metrics.recordBudgetExceeded();
        metrics.recordProviderSuccess('vertex', { latencyMs: 25 });
        metrics.recordProviderFailure('openai', {
            errorType: 'rate_limit',
            error: 'OpenAI 429',
        });
        cache.set('metrics-cache-key', 'bonjour');
        cache.get('metrics-cache-key');

        const first = runtimeLimiter.acquire({
            guildId: 'metrics-guild',
            userId: 'metrics-user-1',
        });
        const second = runtimeLimiter.acquire({
            guildId: 'metrics-guild',
            userId: 'metrics-user-2',
        });
        const queued = runtimeLimiter.acquire({
            guildId: 'metrics-guild',
            userId: 'metrics-user-3',
        });

        try {
            expect(first.accepted).toBe(true);
            expect(second.accepted).toBe(true);
            expect(queued.accepted).toBe(true);

            const res = await requestText(server, 'GET', '/metrics');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('text/plain');
            expect(res.text).toContain(
                'babel_app_version_info{version="0.1.0",repository_url="https://github.com/0xH4KU/babel-discord-translator"} 1',
            );
            expect(res.text).toContain('babel_translations_total');
            expect(res.text).toContain('babel_translation_failures_total');
            expect(res.text).toContain('babel_translation_cache_hits_total');
            expect(res.text).toContain('babel_cache_hits_total');
            expect(res.text).toContain(
                'babel_provider_requests_total{provider="vertex",result="success"}',
            );
            expect(res.text).toContain(
                'babel_provider_requests_total{provider="openai",result="failure"}',
            );
            expect(res.text).toContain('babel_runtime_queue_depth 1');
            expect(res.text).toContain('babel_budget_blocks_total');
        } finally {
            if (queued.accepted) queued.reservation.cancel();
            if (second.accepted) second.reservation.cancel();
            if (first.accepted) first.reservation.cancel();
        }
    });

    it('should include operations summary in stats', async () => {
        metrics.recordProviderSuccess('vertex', { latencyMs: 42 });
        metrics.recordProviderFailure('openai', {
            errorType: 'configuration',
            error: 'OpenAI provider is not configured',
        });

        const res = await request(server, 'GET', '/api/stats', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);

        const operations = res.body!.operations as Record<string, unknown>;
        expect(operations.providerMode).toBe('vertex');

        const providers = operations.providers as Record<string, Record<string, unknown>>;
        expect(providers.vertex.enabled).toBe(true);
        expect(providers.vertex.configured).toBe(true);
        expect(providers.vertex.successTotal).toEqual(expect.any(Number));
        expect(providers.vertex.failureTotal).toEqual(expect.any(Number));
        expect(providers.openai.enabled).toBe(false);
        expect(providers.openai.configured).toBe(false);
        expect(providers.openai.failureTotal).toEqual(expect.any(Number));

        const { store } = await import('../src/store.js');
        const previousGcpProject = store.get('gcpProject');
        try {
            store.update({ gcpProject: '' });
            const missingProjectRes = await request(server, 'GET', '/api/stats', {
                cookie: sessionCookie,
            });
            const missingProjectOperations = missingProjectRes.body!.operations as Record<
                string,
                unknown
            >;
            const missingProjectProviders = missingProjectOperations.providers as Record<
                string,
                Record<string, unknown>
            >;
            expect(missingProjectProviders.vertex.configured).toBe(false);
        } finally {
            store.update({ gcpProject: previousGcpProject });
        }

        const runtimePressure = operations.runtimePressure as Record<string, unknown>;
        expect(runtimePressure.inflight).toEqual(expect.any(Number));
        expect(runtimePressure.queued).toEqual(expect.any(Number));
        expect(runtimePressure.rejectedTotal).toEqual(expect.any(Number));

        const budgetRisk = operations.budgetRisk as Record<string, unknown>;
        expect(budgetRisk.warningCount).toEqual(expect.any(Number));
        expect(budgetRisk.exceededCount).toEqual(expect.any(Number));
    });

    it('should include actionable operations guidance in stats', async () => {
        metrics.recordProviderFailure('vertex', {
            errorType: 'auth',
            error: 'Vertex AI 403',
        });

        const res = await request(server, 'GET', '/api/stats', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        const operations = res.body!.operations as Record<string, unknown>;
        const guidance = operations.guidance as Array<Record<string, unknown>>;

        expect(guidance).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    area: 'provider',
                    severity: 'warning',
                    action: expect.stringContaining('provider'),
                }),
            ]),
        );
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

    it('should accept runtime limiter settings through dashboard config', async () => {
        const res = await request(server, 'POST', '/api/config', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                translationMaxConcurrent: 6,
                translationMaxGlobalQueue: 40,
                translationMaxGuildQueue: 8,
                translationMaxUserOutstanding: 2,
                translationMaxQueueWaitMs: 15000,
            },
        });

        expect(res.status).toBe(200);
        expect(res.body!.changedKeys).toEqual(
            expect.arrayContaining([
                'translationMaxConcurrent',
                'translationMaxGlobalQueue',
                'translationMaxGuildQueue',
                'translationMaxUserOutstanding',
                'translationMaxQueueWaitMs',
            ]),
        );
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

    it('should list active dashboard sessions without exposing raw tokens', async () => {
        const secondLogin = await request(server, 'POST', '/api/login', {
            body: { password: 'test-pass-123' },
        });
        const secondCookie = secondLogin.rawHeaders['set-cookie']![0].split(';')[0];

        const res = await request(server, 'GET', '/api/sessions', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        const sessions = res.body!.sessions as Array<Record<string, unknown>>;
        expect(sessions.length).toBeGreaterThanOrEqual(2);
        expect(sessions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: expect.any(String),
                    current: true,
                    expiresAt: expect.any(String),
                    expiresInMs: expect.any(Number),
                }),
                expect.objectContaining({
                    id: expect.any(String),
                    current: false,
                }),
            ]),
        );

        const rawCurrentToken = sessionCookie.replace(/^session=/, '');
        const rawSecondToken = secondCookie.replace(/^session=/, '');
        const serialized = JSON.stringify(sessions);
        expect(serialized).not.toContain(rawCurrentToken);
        expect(serialized).not.toContain(rawSecondToken);
    });

    it('should require CSRF when revoking dashboard sessions', async () => {
        const res = await request(server, 'POST', '/api/sessions/revoke', {
            cookie: sessionCookie,
            body: { id: 'missing-session-id' },
        });

        expect(res.status).toBe(403);
    });

    it('should revoke a selected dashboard session', async () => {
        const secondLogin = await request(server, 'POST', '/api/login', {
            body: { password: 'test-pass-123' },
        });
        const secondCookie = secondLogin.rawHeaders['set-cookie']![0].split(';')[0];

        const list = await request(server, 'GET', '/api/sessions', {
            cookie: sessionCookie,
        });
        const sessions = list.body!.sessions as Array<Record<string, unknown>>;
        const target = sessions
            .filter((session) => session.current === false)
            .sort((a, b) => Date.parse(String(b.expiresAt)) - Date.parse(String(a.expiresAt)))[0];

        expect(target?.id).toEqual(expect.any(String));

        const revoke = await request(server, 'POST', '/api/sessions/revoke', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { id: target!.id },
        });

        expect(revoke.status).toBe(200);
        expect(revoke.body).toEqual({
            ok: true,
            revoked: true,
            current: false,
        });

        const rejected = await request(server, 'GET', '/api/stats', {
            cookie: secondCookie,
        });
        expect(rejected.status).toBe(401);
    });

    // --- Logs ---

    it('should return logs with count limit', async () => {
        const res = await request(server, 'GET', '/api/logs?count=5', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('should filter error logs by error type before applying count', async () => {
        const rateLimitError = 'unique-rate-limit-before-count';
        const authError = 'unique-auth-before-count';
        log.addError({
            guildId: 'guild-1',
            userId: 'user-1',
            error: rateLimitError,
            command: 'translate',
            errorType: 'rate_limit',
        });
        log.addError({
            guildId: 'guild-1',
            userId: 'user-1',
            error: authError,
            command: 'translate',
            errorType: 'auth',
        });
        log.add({
            guildId: 'guild-1',
            userId: 'user-1',
            userTag: 'User#0001',
            contentPreview: 'hello',
        });

        const res = await request(
            server,
            'GET',
            '/api/logs?count=1&filter=error&errorType=rate_limit',
            {
                cookie: sessionCookie,
            },
        );

        expect(res.status).toBe(200);
        const entries = res.body as Array<Record<string, unknown>>;
        expect(entries.length).toBeGreaterThan(0);
        expect(entries.every((entry) => entry.type === 'error')).toBe(true);
        expect(entries.every((entry) => entry.errorType === 'rate_limit')).toBe(true);
        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    error: rateLimitError,
                    errorType: 'rate_limit',
                }),
            ]),
        );
        expect(entries).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    error: authError,
                }),
            ]),
        );
    });

    it('should filter error logs by error type when filter is omitted', async () => {
        const rateLimitError = 'unique-rate-limit-without-filter';
        const authError = 'unique-auth-without-filter';
        log.addError({
            guildId: 'guild-1',
            userId: 'user-1',
            error: rateLimitError,
            command: 'translate',
            errorType: 'rate_limit',
        });
        log.addError({
            guildId: 'guild-1',
            userId: 'user-1',
            error: authError,
            command: 'translate',
            errorType: 'auth',
        });

        const res = await request(server, 'GET', '/api/logs?errorType=rate_limit', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        const entries = res.body as Array<Record<string, unknown>>;
        expect(entries.length).toBeGreaterThan(0);
        expect(entries.every((entry) => entry.type === 'error')).toBe(true);
        expect(entries.every((entry) => entry.errorType === 'rate_limit')).toBe(true);
        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    error: rateLimitError,
                }),
            ]),
        );
        expect(entries).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    error: authError,
                }),
            ]),
        );
    });

    it('should reject contradictory log type and error type filters', async () => {
        const res = await request(
            server,
            'GET',
            '/api/logs?filter=translation&errorType=rate_limit',
            {
                cookie: sessionCookie,
            },
        );

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'errorType filter requires error logs' });
    });

    it('should batch delete user language preferences', async () => {
        const res = await request(server, 'POST', '/api/user-prefs/batch-delete', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { userIds: ['user1', 'missing-user'] },
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            ok: true,
            deleted: ['user1'],
            notFound: ['missing-user'],
        });

        const prefsRes = await request(server, 'GET', '/api/user-prefs', {
            cookie: sessionCookie,
        });
        expect((prefsRes.body!.prefs as Record<string, string>).user1).toBeUndefined();
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
