import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { AppMetrics } from '../src/shared/app-metrics.js';

// --- Mock dependencies ---
vi.mock('dotenv/config', () => ({}));

vi.mock('../src/modules/config/config.js', () => ({
    getConfig: vi.fn(() => ({
        discordToken: 'test-token',
        dashboardPort: 0, // bind to random port
        dashboardPassword: 'test-pass-123',
    })),
}));

vi.mock('../src/persistence/store.js', () => {
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
        allowedUserIds: [],
        cooldownSeconds: 5,
        cacheMaxSize: 2000,
        setupComplete: true,
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        dailyBudgetUsd: 0,
        defaultUserDailyBudgetUsd: 0,
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
        userBudgets: {},
        userTokenUsage: {},
        userUsageHistory: {},
    };
    const glossary: Record<
        string,
        Array<{
            id: number;
            guildId: string;
            sourceText: string;
            targetText: string;
            notes: string;
            createdAt: string;
            updatedAt: string;
        }>
    > = {};
    let glossaryId = 1;
    return {
        store: {
            get: vi.fn((key: string) => data[key]),
            getUserLanguage: vi.fn(
                (userId: string) =>
                    (data.userLanguagePrefs as Record<string, string>)[userId] ?? null,
            ),
            setUserLanguage: vi.fn((userId: string, language: string) => {
                (data.userLanguagePrefs as Record<string, string>)[userId] = language;
            }),
            deleteUserLanguage: vi.fn((userId: string) => {
                const prefs = data.userLanguagePrefs as Record<string, string>;
                if (!(userId in prefs)) {
                    return false;
                }
                delete prefs[userId];
                return true;
            }),
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
            listGuildGlossary: vi.fn((guildId: string) => glossary[guildId] ?? []),
            upsertGuildGlossaryEntry: vi.fn(
                (
                    guildId: string,
                    input: {
                        id?: number;
                        sourceText: string;
                        targetText: string;
                        notes?: string;
                    },
                ) => {
                    const now = '2026-06-01T00:00:00.000Z';
                    glossary[guildId] ??= [];

                    if (input.id !== undefined) {
                        const existing = glossary[guildId].find((entry) => entry.id === input.id);
                        if (!existing) throw new Error('Glossary entry not found');
                        existing.sourceText = input.sourceText.trim();
                        existing.targetText = input.targetText.trim();
                        existing.notes = input.notes?.trim() ?? '';
                        existing.updatedAt = now;
                        return { ...existing };
                    }

                    const entry = {
                        id: glossaryId++,
                        guildId,
                        sourceText: input.sourceText.trim(),
                        targetText: input.targetText.trim(),
                        notes: input.notes?.trim() ?? '',
                        createdAt: now,
                        updatedAt: now,
                    };
                    glossary[guildId].push(entry);
                    return { ...entry };
                },
            ),
            deleteGuildGlossaryEntry: vi.fn((guildId: string, entryId: number) => {
                const entries = glossary[guildId] ?? [];
                const before = entries.length;
                glossary[guildId] = entries.filter((entry) => entry.id !== entryId);
                return glossary[guildId].length < before;
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
    getUserStats: vi.fn((userId: string) => ({
        date: '2025-03-01',
        inputTokens: userId === 'user-1' ? 1000 : 0,
        outputTokens: 0,
        requests: userId === 'user-1' ? 1 : 0,
        inputCost: userId === 'user-1' ? 0.01 : 0,
        outputCost: 0,
        totalCost: userId === 'user-1' ? 0.01 : 0,
        dailyBudget: 0.5,
        budgetUsedPercent: userId === 'user-1' ? 2 : 0,
        budgetExceeded: false,
    })),
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
    resetTranslationProviderState: vi.fn(),
}));

import {
    createDashboardApp,
    startDashboardServer,
    stopDashboardApp,
} from '../src/modules/dashboard/dashboard.js';
import { createHealthDashboardApp } from '../src/modules/dashboard/health-dashboard.js';
import { resolveDashboardMode } from '../src/modules/dashboard/dashboard-mode.js';
import { InMemorySessionRepository } from '../src/modules/dashboard/auth/in-memory-session-repository.js';
import { TranslationCache } from '../src/modules/translation/cache.js';
import { CooldownManager } from '../src/modules/translation/cooldown.js';
import { TranslationLog } from '../src/shared/log.js';
import { TranslationRuntimeLimiter } from '../src/modules/translation/translation-runtime-limiter.js';
import { _test as healthTest } from '../src/shared/health.js';
import { translate as translateMock } from '../src/modules/translation/translate.js';
import { createSqliteDatabase } from '../src/persistence/sqlite-database.js';
import { DiscordUserProfileRepository } from '../src/modules/dashboard/discord-user-profile-repository.js';
import { PendingUserInstallOwnerRepository } from '../src/modules/dashboard/pending-user-install-owner-repository.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import type { Client } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';

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
    {
        cookie,
        csrf,
        bearerToken,
        metricsToken,
    }: { cookie?: string; csrf?: string; bearerToken?: string; metricsToken?: string } = {},
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
        if (bearerToken) {
            (options.headers as Record<string, string>).Authorization = `Bearer ${bearerToken}`;
        }
        if (metricsToken) {
            (options.headers as Record<string, string>)['x-metrics-token'] = metricsToken;
        }

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

function createMinimalClient(): Client {
    return {
        user: null,
        guilds: {
            cache: {
                size: 0,
                map: () => [],
                [Symbol.iterator]: function* () {},
            },
        },
    } as unknown as Client;
}

describe('dashboard mode parsing', () => {
    it('defaults to full dashboard mode', () => {
        expect(resolveDashboardMode(undefined)).toBe('full');
        expect(resolveDashboardMode('')).toBe('full');
    });

    it('accepts full, health-only, and off modes', () => {
        expect(resolveDashboardMode('full')).toBe('full');
        expect(resolveDashboardMode('health-only')).toBe('health-only');
        expect(resolveDashboardMode('off')).toBe('off');
    });

    it('trims and lowercases dashboard mode values', () => {
        expect(resolveDashboardMode(' HEALTH-ONLY ')).toBe('health-only');
    });

    it('falls back to full for unknown dashboard mode values', () => {
        expect(resolveDashboardMode('minimal')).toBe('full');
    });
});

describe('Dashboard API', () => {
    let app: ReturnType<typeof createDashboardApp>;
    let cache: TranslationCache;
    let metrics: AppMetrics;
    let server: http.Server;
    let sessionCookie: string;
    let csrfToken: string;
    let healthCheck: ReturnType<typeof vi.fn>;
    let versionCheck: ReturnType<typeof vi.fn>;
    let runtimeLimiter: TranslationRuntimeLimiter;
    let log: TranslationLog;
    let profileDb: DatabaseSync;
    let userProfileRepository: DiscordUserProfileRepository;
    let pendingOwnerDb: DatabaseSync;
    let pendingUserInstallOwnerRepository: PendingUserInstallOwnerRepository;

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
        versionCheck = vi.fn().mockResolvedValue({
            version: '0.2.0',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
            update: {
                status: 'current',
                latestVersion: '0.2.0',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.2.0',
            },
        });
        const cooldown = new CooldownManager(5);
        log = new TranslationLog(100);
        profileDb = createSqliteDatabase(':memory:');
        userProfileRepository = new DiscordUserProfileRepository({ db: profileDb });
        userProfileRepository.upsertProfile({
            userId: 'user2',
            username: 'haku',
            globalName: 'Haku',
            displayName: 'Haku',
            avatarUrl: 'https://cdn.discordapp.com/avatars/user2/avatar.png',
            fetchedAt: '2026-06-02T10:00:00.000Z',
            lastSeenAt: null,
        });
        userProfileRepository.upsertProfile({
            userId: 'pending-owner',
            username: 'pending-user',
            globalName: 'Pending User',
            displayName: 'Pending User',
            avatarUrl: 'https://cdn.discordapp.com/avatars/pending-owner/avatar.png',
            fetchedAt: '2026-06-02T10:00:00.000Z',
            lastSeenAt: null,
        });
        pendingOwnerDb = createSqliteDatabase(':memory:');
        pendingUserInstallOwnerRepository = new PendingUserInstallOwnerRepository({
            db: pendingOwnerDb,
        });
        pendingUserInstallOwnerRepository.recordSeen('pending-owner');
        const guilds = [
            { id: 'guild-1', name: 'Guild One', iconURL: () => '', memberCount: 10 },
            { id: 'guild-2', name: 'Guild Two', iconURL: () => '', memberCount: 20 },
            { id: 'guild-3', name: 'Guild Three', iconURL: () => '', memberCount: 30 },
        ];
        const mockClient = {
            user: { tag: 'Babel#1234', displayAvatarURL: () => 'https://example.com/avatar.png' },
            guilds: {
                cache: {
                    size: guilds.length,
                    map: (fn: Function) => guilds.map(fn),
                    [Symbol.iterator]: function* () {
                        for (const guild of guilds) {
                            yield [guild.id, guild];
                        }
                    },
                },
            },
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
            versionCheck,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            pendingUserInstallOwnerRepository,
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
        if (profileDb.isOpen) {
            profileDb.close();
        }
        if (pendingOwnerDb.isOpen) {
            pendingOwnerDb.close();
        }
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

    it('should expose health-only dashboard endpoints without full dashboard API routes', async () => {
        const healthOnlyApp = createHealthDashboardApp({
            cache,
            metrics,
            runtimeLimiter,
            healthCheck,
            healthProbeCacheTtlMs: 0,
        });
        const healthOnlyServer = startDashboardServer(healthOnlyApp, 0);

        try {
            const live = await request(healthOnlyServer, 'GET', '/livez');
            expect(live.status).toBe(200);
            expect(live.body!.live).toBe(true);

            const ready = await request(healthOnlyServer, 'GET', '/readyz');
            expect(ready.status).toBe(200);
            expect(ready.body!.ready).toBe(true);

            const health = await request(healthOnlyServer, 'GET', '/healthz');
            expect(health.status).toBe(200);
            expect(health.body!.live).toBe(true);
            expect(health.body!.ready).toBe(true);
            expect(health.body!.strategy).toBeDefined();

            const metricsResponse = await requestText(healthOnlyServer, 'GET', '/metrics');
            expect(metricsResponse.status).toBe(200);
            expect(metricsResponse.text).toContain('babel_translations_total');

            const stats = await requestText(healthOnlyServer, 'GET', '/api/stats');
            expect(stats.status).toBe(404);
        } finally {
            healthOnlyServer.close();
            stopDashboardApp(healthOnlyApp);
        }
    });

    it('should expose health-only metrics and health with optional runtime deps omitted', async () => {
        const fallbackApp = createHealthDashboardApp({
            cache,
            healthCheck,
            healthProbeCacheTtlMs: 0,
        });
        const fallbackServer = startDashboardServer(fallbackApp, 0);

        try {
            const health = await request(fallbackServer, 'GET', '/healthz');
            expect(health.status).toBe(200);
            expect(health.body!.live).toBe(true);
            expect(health.body!.ready).toBe(true);
            expect((health.body!.metrics as Record<string, unknown>).translationFailureRate).toBe(
                0,
            );

            const metricsResponse = await requestText(fallbackServer, 'GET', '/metrics');
            expect(metricsResponse.status).toBe(200);
            expect(metricsResponse.text).toContain('babel_translations_total 0');
            expect(metricsResponse.text).toContain('babel_runtime_queue_depth 0');
        } finally {
            fallbackServer.close();
            stopDashboardApp(fallbackApp);
        }
    });

    it('should bind the dashboard server to the configured host', () => {
        const appListen = vi.fn();
        const appForHost = {
            listen: appListen,
        } as unknown as ReturnType<typeof createDashboardApp>;

        startDashboardServer(appForHost, 3000, '0.0.0.0');

        expect(appListen).toHaveBeenCalledWith(3000, '0.0.0.0', expect.any(Function));
    });

    it('should trust the first reverse proxy for Railway forwarded headers', () => {
        expect(app.get('trust proxy')).toBe(1);
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

    it('should show shared global budget usage for guilds without custom budgets', async () => {
        usageMock.getStats.mockReturnValueOnce({
            date: '2025-03-01',
            inputTokens: 1_000_000,
            outputTokens: 0,
            requests: 10,
            inputCost: 1,
            outputCost: 0,
            totalCost: 1,
            dailyBudget: 1,
            budgetUsedPercent: 100,
            budgetExceeded: true,
        });
        usageMock.getGuildStatsForGuilds.mockReturnValueOnce({
            'guild-1': {
                date: '2025-03-01',
                inputTokens: 600_000,
                outputTokens: 0,
                requests: 6,
                inputCost: 0.6,
                outputCost: 0,
                totalCost: 0.6,
                dailyBudget: 1,
                budgetUsedPercent: 60,
                budgetExceeded: false,
            },
            'guild-2': {
                date: '2025-03-01',
                inputTokens: 400_000,
                outputTokens: 0,
                requests: 4,
                inputCost: 0.4,
                outputCost: 0,
                totalCost: 0.4,
                dailyBudget: 1,
                budgetUsedPercent: 40,
                budgetExceeded: false,
            },
        });

        const res = await request(server, 'GET', '/api/stats', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        const guildBudgets = res.body!.guildBudgets as Array<Record<string, unknown>>;
        const guildOne = guildBudgets.find((guild) => guild.id === 'guild-1');
        const guildTwo = guildBudgets.find((guild) => guild.id === 'guild-2');

        expect(guildOne).toMatchObject({
            isCustom: false,
            budget: 1,
            totalCost: 1,
            requests: 10,
            exceeded: true,
        });
        expect(guildTwo).toMatchObject({
            isCustom: false,
            budget: 1,
            totalCost: 1,
            requests: 10,
            exceeded: true,
        });
    });

    it('should return shared global budget usage from guild budget API', async () => {
        usageMock.getStats.mockReturnValueOnce({
            date: '2025-03-01',
            inputTokens: 1_000_000,
            outputTokens: 0,
            requests: 10,
            inputCost: 1,
            outputCost: 0,
            totalCost: 1,
            dailyBudget: 1,
            budgetUsedPercent: 100,
            budgetExceeded: true,
        });
        usageMock.getGuildStatsForGuilds.mockReturnValueOnce({
            'guild-1': {
                date: '2025-03-01',
                inputTokens: 600_000,
                outputTokens: 0,
                requests: 6,
                inputCost: 0.6,
                outputCost: 0,
                totalCost: 0.6,
                dailyBudget: 1,
                budgetUsedPercent: 60,
                budgetExceeded: false,
            },
        });

        const res = await request(server, 'GET', '/api/guild-budgets', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        const guildOne = (res.body!['guild-1'] as Record<string, unknown>).usage as Record<
            string,
            unknown
        >;

        expect(guildOne).toMatchObject({
            totalCost: 1,
            requests: 10,
            budgetExceeded: true,
        });
    });

    it('should show custom guild budget usage separately from the global budget pool', async () => {
        const { store } = await import('../src/persistence/store.js');
        const previousGuildBudgets = store.get('guildBudgets');

        usageMock.getStats.mockReturnValueOnce({
            date: '2025-03-01',
            inputTokens: 800_000,
            outputTokens: 0,
            requests: 8,
            inputCost: 0.8,
            outputCost: 0,
            totalCost: 0.8,
            dailyBudget: 1,
            budgetUsedPercent: 80,
            budgetExceeded: false,
        });
        usageMock.getGuildStatsForGuilds.mockReturnValueOnce({
            'guild-1': {
                date: '2025-03-01',
                inputTokens: 200_000,
                outputTokens: 0,
                requests: 2,
                inputCost: 0.2,
                outputCost: 0,
                totalCost: 0.2,
                dailyBudget: 2,
                budgetUsedPercent: 10,
                budgetExceeded: false,
            },
        });

        try {
            store.update({ guildBudgets: { 'guild-1': { dailyBudgetUsd: 2 } } });

            const res = await request(server, 'GET', '/api/stats', {
                cookie: sessionCookie,
            });

            expect(res.status).toBe(200);
            const guildBudgets = res.body!.guildBudgets as Array<Record<string, unknown>>;
            const guildOne = guildBudgets.find((guild) => guild.id === 'guild-1');
            const guildTwo = guildBudgets.find((guild) => guild.id === 'guild-2');

            expect(guildOne).toMatchObject({
                isCustom: true,
                budget: 2,
                totalCost: 0.2,
                requests: 2,
                exceeded: false,
            });
            expect(guildTwo).toMatchObject({
                isCustom: false,
                budget: 1,
                totalCost: 0.8,
                requests: 8,
                exceeded: false,
            });
        } finally {
            store.update({ guildBudgets: previousGuildBudgets });
        }
    });

    it('should include allowed and pending user-install owners in user budget access data', async () => {
        const { store } = await import('../src/persistence/store.js');
        const previousAllowedUserIds = store.get('allowedUserIds');
        const previousDefaultUserBudget = store.get('defaultUserDailyBudgetUsd');
        const previousUserBudgets = store.get('userBudgets');
        const pocketApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_POCKET_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            pendingUserInstallOwnerRepository,
        });
        const pocketServer = startDashboardServer(pocketApp, 0);

        try {
            store.update({
                allowedUserIds: ['user-1'],
                defaultUserDailyBudgetUsd: 0.5,
                userBudgets: { 'user-1': { dailyBudgetUsd: 1.25 } },
            });

            const login = await request(pocketServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await request(pocketServer, 'GET', '/api/user-budgets', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                budgets: {
                    'user-1': {
                        budget: 1.25,
                        isCustom: true,
                        allowed: true,
                        pending: false,
                    },
                    'pending-owner': {
                        budget: 0.5,
                        isCustom: false,
                        allowed: false,
                        pending: true,
                    },
                },
                profiles: {
                    'pending-owner': expect.objectContaining({
                        userId: 'pending-owner',
                        displayName: 'Pending User',
                        avatarUrl: 'https://cdn.discordapp.com/avatars/pending-owner/avatar.png',
                    }),
                },
            });
        } finally {
            store.update({
                allowedUserIds: previousAllowedUserIds,
                defaultUserDailyBudgetUsd: previousDefaultUserBudget,
                userBudgets: previousUserBudgets,
            });
            stopDashboardApp(pocketApp);
            pocketServer.close();
        }
    });

    it('should resolve combined user budget profiles with the Pocket Discord client', async () => {
        const { store } = await import('../src/persistence/store.js');
        const previousAllowedUserIds = store.get('allowedUserIds');
        const previousDefaultUserBudget = store.get('defaultUserDailyBudgetUsd');
        const previousUserBudgets = store.get('userBudgets');
        const emptyProfileDb = createSqliteDatabase(':memory:');
        const emptyProfileRepository = new DiscordUserProfileRepository({ db: emptyProfileDb });
        const guildFetch = vi.fn(async () => {
            throw new Error('guild client should not resolve Pocket users');
        });
        const pocketFetch = vi.fn(async (userId: string) => ({
            id: userId,
            username: 'pocket-user',
            globalName: 'Pocket User',
            displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/pending-owner/pocket.png',
        }));
        const guildClient = createMinimalClient();
        const pocketClient = {
            ...createMinimalClient(),
            users: { fetch: pocketFetch },
        } as unknown as Client;
        const combinedApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: guildClient,
            clients: {
                'babel-guild': {
                    ...guildClient,
                    users: { fetch: guildFetch },
                } as unknown as Client,
                'babel-pocket': pocketClient,
            },
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository: emptyProfileRepository,
            pendingUserInstallOwnerRepository,
        });
        const combinedServer = startDashboardServer(combinedApp, 0);

        try {
            store.update({
                allowedUserIds: [],
                defaultUserDailyBudgetUsd: 0.5,
                userBudgets: {},
            });

            const login = await request(combinedServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await request(combinedServer, 'GET', '/api/user-budgets', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(guildFetch).not.toHaveBeenCalled();
            expect(pocketFetch).toHaveBeenCalledWith('pending-owner');
            expect(res.body!.profiles).toEqual({
                'pending-owner': expect.objectContaining({
                    userId: 'pending-owner',
                    displayName: 'Pocket User',
                }),
            });
        } finally {
            store.update({
                allowedUserIds: previousAllowedUserIds,
                defaultUserDailyBudgetUsd: previousDefaultUserBudget,
                userBudgets: previousUserBudgets,
            });
            stopDashboardApp(combinedApp);
            combinedServer.close();
            emptyProfileDb.close();
        }
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
            version: '0.2.0',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
            update: {
                status: 'current',
                latestVersion: '0.2.0',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.2.0',
            },
        });
        expect(versionCheck).toHaveBeenCalled();
    });

    it('should force-refresh release metadata for authenticated admins with CSRF', async () => {
        versionCheck.mockClear();
        versionCheck.mockResolvedValueOnce({
            version: '0.2.0',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
            update: {
                status: 'outdated',
                latestVersion: '0.2.0',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.2.0',
            },
        });

        const res = await request(server, 'POST', '/api/version/refresh', {
            cookie: sessionCookie,
            csrf: csrfToken,
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            version: '0.2.0',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
            update: {
                status: 'outdated',
                latestVersion: '0.2.0',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.2.0',
            },
        });
        expect(versionCheck).toHaveBeenCalledWith({ forceRefresh: true });
    });

    it('should reject release metadata refresh without CSRF', async () => {
        versionCheck.mockClear();

        const res = await request(server, 'POST', '/api/version/refresh', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(403);
        expect(versionCheck).not.toHaveBeenCalled();
    });

    it('should expose Prometheus metrics without dashboard authentication by default', async () => {
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
                'babel_app_version_info{version="0.2.0",repository_url="https://github.com/0xH4KU/babel-discord-translator"} 1',
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

    it('should require a metrics token when one is configured', async () => {
        const protectedApp = createHealthDashboardApp({
            cache,
            metrics,
            runtimeLimiter,
            healthCheck,
            healthProbeCacheTtlMs: 0,
            metricsToken: 'metrics-secret',
        });
        const protectedServer = startDashboardServer(protectedApp, 0);

        try {
            const missing = await requestText(protectedServer, 'GET', '/metrics');
            expect(missing.status).toBe(401);
            expect(missing.text).toBe('Metrics token required\n');

            const wrong = await requestText(protectedServer, 'GET', '/metrics', {
                bearerToken: 'wrong-secret',
            });
            expect(wrong.status).toBe(401);

            const withBearer = await requestText(protectedServer, 'GET', '/metrics', {
                bearerToken: 'metrics-secret',
            });
            expect(withBearer.status).toBe(200);
            expect(withBearer.text).toContain('babel_translations_total');

            const withHeader = await requestText(protectedServer, 'GET', '/metrics', {
                metricsToken: 'metrics-secret',
            });
            expect(withHeader.status).toBe(200);
        } finally {
            protectedServer.close();
            stopDashboardApp(protectedApp);
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

        const { store } = await import('../src/persistence/store.js');
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
        const { store } = await import('../src/persistence/store.js');
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

    it('should sanitize translate test errors before returning them', async () => {
        vi.mocked(translateMock).mockRejectedValueOnce(
            new Error(
                'OpenAI 500 at https://api.openai.com/v1/chat/completions with token abcdefghijklmnopqrstuvwxyz1234567890',
            ),
        );

        const res = await request(server, 'POST', '/api/translate/test', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { text: 'Hello', targetLanguage: 'ja' },
        });

        expect(res.status).toBe(500);
        expect(res.body!.error).toContain('[API endpoint]');
        expect(res.body!.error).toContain('***');
        expect(res.body!.error).not.toContain('api.openai.com');
        expect(res.body!.error).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
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

    it('should include Discord user profiles with user language preferences', async () => {
        const res = await request(server, 'GET', '/api/user-prefs', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                prefs: expect.objectContaining({
                    user2: 'ko',
                }),
                count: expect.any(Number),
                profiles: expect.objectContaining({
                    user2: expect.objectContaining({
                        userId: 'user2',
                        username: 'haku',
                        globalName: 'Haku',
                        displayName: 'Haku',
                        avatarUrl: 'https://cdn.discordapp.com/avatars/user2/avatar.png',
                    }),
                }),
            }),
        );
    });

    it('should manage per-guild glossary entries', async () => {
        const create = await request(server, 'POST', '/api/guild-glossary/guild-1', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                sourceText: 'raid',
                targetText: '團本',
                notes: 'Game term',
            },
        });

        expect(create.status).toBe(200);
        expect(create.body).toMatchObject({
            ok: true,
            entry: {
                id: expect.any(Number),
                guildId: 'guild-1',
                sourceText: 'raid',
                targetText: '團本',
                notes: 'Game term',
            },
        });

        const list = await request(server, 'GET', '/api/guild-glossary/guild-1', {
            cookie: sessionCookie,
        });
        expect(list.status).toBe(200);
        expect(list.body).toMatchObject({
            entries: [
                expect.objectContaining({
                    sourceText: 'raid',
                    targetText: '團本',
                }),
            ],
            count: 1,
        });

        const entryId = (create.body!.entry as Record<string, unknown>).id as number;
        const update = await request(server, 'POST', '/api/guild-glossary/guild-1', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                id: entryId,
                sourceText: 'raid',
                targetText: 'レイド',
                notes: '',
            },
        });
        expect(update.status).toBe(200);
        expect((update.body!.entry as Record<string, unknown>).targetText).toBe('レイド');

        const deleted = await request(server, 'DELETE', `/api/guild-glossary/guild-1/${entryId}`, {
            cookie: sessionCookie,
            csrf: csrfToken,
        });
        expect(deleted.status).toBe(200);
        expect(deleted.body).toEqual({ ok: true, deleted: entryId });
    });

    it('should validate glossary entry input', async () => {
        const res = await request(server, 'POST', '/api/guild-glossary/guild-1', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                sourceText: '',
                targetText: '團本',
            },
        });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Glossary source and target are required' });
    });

    it('should not expose guild glossary routes for Babel Pocket', async () => {
        const pocketApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_POCKET_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const pocketServer = startDashboardServer(pocketApp, 0);

        try {
            const login = await request(pocketServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(pocketServer, 'GET', '/api/guild-glossary/guild-1', {
                cookie,
            });

            expect(res.status).toBe(404);
        } finally {
            stopDashboardApp(pocketApp);
            pocketServer.close();
        }
    });

    it('should not expose the legacy pending user-install owner routes', async () => {
        const createAppForProfile = (profile: typeof BABEL_GUILD_PROFILE) =>
            createDashboardApp({
                cache,
                cooldown: new CooldownManager(5),
                log,
                client: createMinimalClient(),
                getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
                metrics,
                runtimeLimiter,
                profile,
                sessionRepository: new InMemorySessionRepository(),
                userProfileRepository,
            });
        const guildApp = createAppForProfile(BABEL_GUILD_PROFILE);
        const pocketApp = createAppForProfile(BABEL_POCKET_PROFILE);
        const guildServer = startDashboardServer(guildApp, 0);
        const pocketServer = startDashboardServer(pocketApp, 0);

        try {
            for (const appServer of [guildServer, pocketServer]) {
                const login = await request(appServer, 'POST', '/api/login', {
                    body: { password: 'test-pass-123' },
                });
                const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
                const res = await requestText(appServer, 'GET', '/api/access/pending-users', {
                    cookie,
                });

                expect(res.status).toBe(404);
            }
        } finally {
            stopDashboardApp(guildApp);
            stopDashboardApp(pocketApp);
            guildServer.close();
            pocketServer.close();
        }
    });

    it('should not expose user budget access data for Babel Guild', async () => {
        const guildApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const guildServer = startDashboardServer(guildApp, 0);

        try {
            const login = await request(guildServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(guildServer, 'GET', '/api/user-budgets', {
                cookie,
            });

            expect(res.status).toBe(404);
        } finally {
            stopDashboardApp(guildApp);
            guildServer.close();
        }
    });

    it('should expose dashboard capabilities for Babel Guild', async () => {
        const guildApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const guildServer = startDashboardServer(guildApp, 0);

        try {
            const login = await request(guildServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(guildServer, 'GET', '/api/capabilities', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(JSON.parse(res.text)).toEqual({
                profile: {
                    id: 'babel-guild',
                    productName: 'Babel Guild',
                    commandName: 'Babel',
                    accessMode: 'guild',
                },
                profiles: [
                    {
                        id: 'babel-guild',
                        productName: 'Babel Guild',
                        commandName: 'Babel',
                        accessMode: 'guild',
                    },
                ],
                capabilities: {
                    guildAccess: true,
                    userAccess: false,
                    guildGlossary: true,
                    pendingUserInstallOwners: false,
                },
            });
        } finally {
            stopDashboardApp(guildApp);
            guildServer.close();
        }
    });

    it('should expose dashboard capabilities for Babel Pocket', async () => {
        const pocketApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_POCKET_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const pocketServer = startDashboardServer(pocketApp, 0);

        try {
            const login = await request(pocketServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(pocketServer, 'GET', '/api/capabilities', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(JSON.parse(res.text)).toEqual({
                profile: {
                    id: 'babel-pocket',
                    productName: 'Babel Pocket',
                    commandName: 'Babel Pocket',
                    accessMode: 'user-install',
                },
                profiles: [
                    {
                        id: 'babel-pocket',
                        productName: 'Babel Pocket',
                        commandName: 'Babel Pocket',
                        accessMode: 'user-install',
                    },
                ],
                capabilities: {
                    guildAccess: false,
                    userAccess: true,
                    guildGlossary: false,
                    pendingUserInstallOwners: true,
                },
            });
        } finally {
            stopDashboardApp(pocketApp);
            pocketServer.close();
        }
    });

    it('should expose combined dashboard capabilities without losing separate app identities', async () => {
        const combinedApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const combinedServer = startDashboardServer(combinedApp, 0);

        try {
            const login = await request(combinedServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(combinedServer, 'GET', '/api/capabilities', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(JSON.parse(res.text)).toEqual({
                profile: {
                    id: 'babel-guild',
                    productName: 'Babel Guild',
                    commandName: 'Babel',
                    accessMode: 'guild',
                },
                profiles: [
                    {
                        id: 'babel-guild',
                        productName: 'Babel Guild',
                        commandName: 'Babel',
                        accessMode: 'guild',
                    },
                    {
                        id: 'babel-pocket',
                        productName: 'Babel Pocket',
                        commandName: 'Babel Pocket',
                        accessMode: 'user-install',
                    },
                ],
                capabilities: {
                    guildAccess: true,
                    userAccess: true,
                    guildGlossary: true,
                    pendingUserInstallOwners: true,
                },
            });
        } finally {
            stopDashboardApp(combinedApp);
            combinedServer.close();
        }
    });

    it('should expose Guild-scoped capabilities for combined /guild/api/capabilities', async () => {
        const combinedApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const combinedServer = startDashboardServer(combinedApp, 0);

        try {
            const login = await request(combinedServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(combinedServer, 'GET', '/guild/api/capabilities', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(JSON.parse(res.text)).toMatchObject({
                profile: { id: 'babel-guild', productName: 'Babel Guild' },
                capabilities: {
                    guildAccess: true,
                    userAccess: false,
                    guildGlossary: true,
                    pendingUserInstallOwners: false,
                },
            });
        } finally {
            stopDashboardApp(combinedApp);
            combinedServer.close();
        }
    });

    it('should expose Pocket-scoped capabilities for combined /pocket/api/capabilities', async () => {
        const combinedApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const combinedServer = startDashboardServer(combinedApp, 0);

        try {
            const login = await request(combinedServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await requestText(combinedServer, 'GET', '/pocket/api/capabilities', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(JSON.parse(res.text)).toMatchObject({
                profile: { id: 'babel-pocket', productName: 'Babel Pocket' },
                capabilities: {
                    guildAccess: false,
                    userAccess: true,
                    guildGlossary: false,
                    pendingUserInstallOwners: true,
                },
            });
        } finally {
            stopDashboardApp(combinedApp);
            combinedServer.close();
        }
    });

    it('should serve dashboard shell for combined /guild and /pocket paths', async () => {
        const combinedApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
        });
        const combinedServer = startDashboardServer(combinedApp, 0);

        try {
            for (const path of ['/guild', '/pocket']) {
                const res = await requestText(combinedServer, 'GET', path);

                expect(res.status).toBe(200);
                expect(res.text).toContain('id="login-view"');
                expect(res.text).toContain('id="profile-select-view"');
            }
        } finally {
            stopDashboardApp(combinedApp);
            combinedServer.close();
        }
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
