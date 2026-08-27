import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { AppMetrics } from '../src/shared/app-metrics.js';

// --- Mock dependencies ---
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
        userLanguagePrefs: { legacyUser: 'en' },
        userLanguagePreferenceEntries: [
            { guildId: '', userId: 'legacyUser', language: 'en' },
            { guildId: 'guild-1', userId: 'user1', language: 'ja' },
            { guildId: 'guild-2', userId: 'user1', language: 'ko' },
            { guildId: 'guild-1', userId: 'user2', language: 'zh-TW' },
        ],
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
            targetLanguage: string;
            targetText: string;
            notes: string;
            createdAt: string;
            updatedAt: string;
        }>
    > = {};
    let glossaryId = 1;
    type GlossaryInput = {
        id?: number;
        sourceText: string;
        targetLanguage?: string;
        targetText: string;
        notes?: string;
    };
    const upsertGlossaryEntry = (guildId: string, input: GlossaryInput) => {
        const now = '2026-06-01T00:00:00.000Z';
        glossary[guildId] ??= [];

        if (input.id !== undefined) {
            const existing = glossary[guildId].find((entry) => entry.id === input.id);
            if (!existing) throw new Error('Glossary entry not found');
            existing.sourceText = input.sourceText.trim();
            existing.targetLanguage = input.targetLanguage?.trim() || 'auto';
            existing.targetText = input.targetText.trim();
            existing.notes = input.notes?.trim() ?? '';
            existing.updatedAt = now;
            return { ...existing };
        }

        const entry = {
            id: glossaryId++,
            guildId,
            sourceText: input.sourceText.trim(),
            targetLanguage: input.targetLanguage?.trim() || 'auto',
            targetText: input.targetText.trim(),
            notes: input.notes?.trim() ?? '',
            createdAt: now,
            updatedAt: now,
        };
        glossary[guildId].push(entry);
        return { ...entry };
    };
    return {
        store: {
            getUserLanguage: vi.fn((guildId: string, userId: string) => {
                const prefs = data.userLanguagePreferenceEntries as Array<{
                    guildId: string;
                    userId: string;
                    language: string;
                }>;
                return (
                    prefs.find((entry) => entry.guildId === guildId && entry.userId === userId)
                        ?.language ?? null
                );
            }),
            setUserLanguage: vi.fn((guildId: string, userId: string, language: string) => {
                const prefs = data.userLanguagePreferenceEntries as Array<{
                    guildId: string;
                    userId: string;
                    language: string;
                }>;
                const existing = prefs.find(
                    (entry) => entry.guildId === guildId && entry.userId === userId,
                );
                if (existing) {
                    existing.language = language;
                } else {
                    prefs.push({ guildId, userId, language });
                }
            }),
            deleteUserLanguage: vi.fn((guildId: string, userId: string) => {
                const prefs = data.userLanguagePreferenceEntries as Array<{
                    guildId: string;
                    userId: string;
                    language: string;
                }>;
                const index = prefs.findIndex(
                    (entry) => entry.guildId === guildId && entry.userId === userId,
                );
                if (index < 0) {
                    return false;
                }
                prefs.splice(index, 1);
                return true;
            }),
            getConfigValues: vi.fn((keys: readonly string[]) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const value = data[key];
                        return [key, Array.isArray(value) ? [...value] : value];
                    }),
                ),
            ),
            updateConfigValues: vi.fn((updates: Record<string, unknown>) =>
                Object.assign(data, updates),
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
            getUserBudget: vi.fn((userId: string) => {
                const budgets = data.userBudgets as Record<string, unknown>;
                return budgets[userId] ?? null;
            }),
            setUserBudget: vi.fn((userId: string, dailyBudgetUsd: number) => {
                const budgets = data.userBudgets as Record<string, unknown>;
                budgets[userId] = { dailyBudgetUsd };
            }),
            clearUserBudget: vi.fn((userId: string) => {
                const budgets = data.userBudgets as Record<string, unknown>;
                if (!(userId in budgets)) return false;
                delete budgets[userId];
                return true;
            }),
            listGuildGlossary: vi.fn((guildId: string) => glossary[guildId] ?? []),
            upsertGuildGlossaryEntry: vi.fn(upsertGlossaryEntry),
            upsertGuildGlossaryEntries: vi.fn((guildId: string, inputs: readonly GlossaryInput[]) =>
                inputs.map((input) => upsertGlossaryEntry(guildId, input)),
            ),
            deleteGuildGlossaryEntry: vi.fn((guildId: string, entryId: number) => {
                const entries = glossary[guildId] ?? [];
                const before = entries.length;
                glossary[guildId] = entries.filter((entry) => entry.id !== entryId);
                return glossary[guildId].length < before;
            }),
            listGuildBudgets: vi.fn(() => ({ ...(data.guildBudgets as object) })),
            listUserBudgets: vi.fn(() => ({ ...(data.userBudgets as object) })),
            listUserLanguagePreferences: vi.fn(() => [
                ...(data.userLanguagePreferenceEntries as unknown[]),
            ]),
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
    getGuildHistory: vi.fn(() => []),
    getUserHistory: vi.fn(() => []),
    getGuildHistoryForGuilds: vi.fn(() => []),
    getAllUserHistory: vi.fn(() => []),
    getUsageExportRows: vi.fn(() => []),
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
import { translate as translateMock } from '../src/modules/translation/translate.js';
import { createSqliteDatabase } from '../src/persistence/sqlite-database.js';
import { DiscordUserProfileRepository } from '../src/modules/dashboard/discord-user-profile-repository.js';
import { PendingUserInstallOwnerRepository } from '../src/modules/dashboard/pending-user-install-owner-repository.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import type { Client } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';
import type {
    TranslationService,
    TranslationServiceRequest,
} from '../src/modules/translation/translation-service.js';

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
    {
        body,
        cookie,
        csrf,
        headers,
    }: {
        body?: Record<string, unknown>;
        cookie?: string;
        csrf?: string;
        headers?: Record<string, string>;
    } = {},
): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
        const addr = server.address() as { port: number };
        const options: http.RequestOptions = {
            hostname: '127.0.0.1',
            port: addr.port,
            path,
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
        };
        if (cookie) (options.headers as Record<string, string>)['Cookie'] = cookie;
        if (csrf) (options.headers as Record<string, string>)['x-csrf-token'] = csrf;

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
                data += chunk;
            });
            res.on('end', () => {
                const contentType = String(res.headers['content-type'] ?? '');
                resolve({
                    status: res.statusCode!,
                    headers: res.headers,
                    body:
                        data && contentType.includes('application/json') ? JSON.parse(data) : null,
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

type BudgetMap = Record<string, { dailyBudgetUsd: number }>;

function replaceBudgets(
    current: BudgetMap,
    next: BudgetMap,
    clear: (id: string) => unknown,
    set: (id: string, dailyBudgetUsd: number) => unknown,
): void {
    for (const id of Object.keys(current)) clear(id);
    for (const [id, budget] of Object.entries(next)) set(id, budget.dailyBudgetUsd);
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
    let runtimeLimiter: TranslationRuntimeLimiter;
    let log: TranslationLog;
    let profileDb: DatabaseSync;
    let userProfileRepository: DiscordUserProfileRepository;
    let pendingOwnerDb: DatabaseSync;
    let pendingUserInstallOwnerRepository: PendingUserInstallOwnerRepository;
    let dashboardTranslationRequests: TranslationServiceRequest[];
    let dashboardTranslationService: TranslationService;

    function startProfileDashboard(
        profile = BABEL_GUILD_PROFILE,
        overrides: Partial<Parameters<typeof createDashboardApp>[0]> = {},
    ) {
        const testApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            metrics,
            runtimeLimiter,
            profile,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            ...overrides,
        });
        const testServer = startDashboardServer(testApp, 0);
        return {
            app: testApp,
            server: testServer,
            close() {
                stopDashboardApp(testApp);
                testServer.close();
            },
        };
    }

    function startCombinedDashboard(
        overrides: Partial<Parameters<typeof createDashboardApp>[0]> = {},
    ) {
        return startProfileDashboard(BABEL_GUILD_PROFILE, {
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            ...overrides,
        });
    }

    async function loginDashboard(testServer: http.Server) {
        const login = await request(testServer, 'POST', '/api/login', {
            body: { password: 'test-pass-123' },
        });
        return {
            cookie: login.rawHeaders['set-cookie']![0].split(';')[0],
            csrf: login.body!.csrfToken as string,
        };
    }

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
        dashboardTranslationRequests = [];
        dashboardTranslationService = {
            process: vi.fn(async (request: TranslationServiceRequest) => {
                dashboardTranslationRequests.push(request);
                return {
                    status: 'success',
                    deferred: false,
                    translatedText: `service translated: ${request.text}`,
                    originalText: request.text,
                    cached: false,
                    targetLanguage: request.targetLanguageOption || 'auto',
                    langSource: request.targetLanguageOption ? 'option' : 'auto',
                    inputTokens: 12,
                    outputTokens: 6,
                    provider: 'vertex',
                };
            }),
        };
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

        const dashboardDeps: Parameters<typeof createDashboardApp>[0] & {
            translationService: TranslationService;
        } = {
            cache,
            cooldown,
            log,
            client: mockClient,
            metrics,
            runtimeLimiter,
            discordReady: () => true,
            healthCheck,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            pendingUserInstallOwnerRepository,
            translationService: dashboardTranslationService,
        };
        app = createDashboardApp(dashboardDeps);

        server = startDashboardServer(app, 0);
    });

    beforeEach(() => {
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

    it('serves the dashboard with a CSP that does not allow inline scripts', async () => {
        const res = await requestText(server, 'GET', '/');
        const csp = String(res.headers['content-security-policy'] ?? '');

        expect(res.status).toBe(200);
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("style-src 'self' https://fonts.googleapis.com");
        expect(csp).toContain("img-src 'self' data: https:");
        expect(csp).not.toContain("'unsafe-inline'");
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
        expect(healthCheck).not.toHaveBeenCalled();
    });

    it('should not expose local database errors from public health endpoints', async () => {
        const { store } = await import('../src/persistence/store.js');
        const getConfigValues = store.getConfigValues as ReturnType<typeof vi.fn>;
        getConfigValues.mockImplementationOnce(() => {
            throw new Error('/srv/private/babel.sqlite is unreadable');
        });

        const live = await request(server, 'GET', '/livez');

        expect(live.status).toBe(503);
        expect(JSON.stringify(live.body)).not.toContain('/srv/private/babel.sqlite');
    });

    it('should expose health-only dashboard endpoints without full dashboard API routes', async () => {
        const healthOnlyApp = createHealthDashboardApp({
            cache,
            metrics,
            runtimeLimiter,
            discordReady: () => true,
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

    it('should not trust spoofed forwarded client addresses by default', async () => {
        app.get('/test/client-ip', (req, res) => res.json({ ip: req.ip }));

        const response = await request(server, 'GET', '/test/client-ip', {
            headers: { 'X-Forwarded-For': '203.0.113.10' },
        });

        expect(app.get('trust proxy')).toBe(false);
        expect(response.body!.ip).not.toBe('203.0.113.10');
    });

    it('should report degraded health while Discord is disconnected', async () => {
        const disconnectedApp = createHealthDashboardApp({
            cache,
            discordReady: () => false,
        });
        const disconnectedServer = startDashboardServer(disconnectedApp, 0);

        try {
            const ready = await request(disconnectedServer, 'GET', '/readyz');
            expect(ready.status).toBe(503);
            expect(ready.body!.ready).toBe(false);

            const health = await request(disconnectedServer, 'GET', '/healthz');
            expect(health.status).toBe(200);
            expect(health.body!.status).toBe('degraded');
            expect(
                (health.body!.checks as Record<string, Record<string, unknown>>).discord,
            ).toMatchObject({ status: 'fail', detail: 'Discord client is not connected' });
            expect(healthCheck).not.toHaveBeenCalled();
        } finally {
            disconnectedServer.close();
            stopDashboardApp(disconnectedApp);
        }
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
        expect((res.body!.translations as Record<string, unknown>).total).toBe(1);
        expect((res.body!.metrics as Record<string, unknown>).translationFailuresTotal).toBe(1);
        expect((res.body!.translations as Record<string, unknown>).webhookRecreated).toBe(1);
        expect(
            (res.body!.runtime as Record<string, Record<string, unknown>>).limits.maxConcurrent,
        ).toBe(2);
        expect((res.body!.bot as Record<string, unknown>).memory).toBeDefined();
    });

    it('should export usage history as CSV with guild and user rows', async () => {
        usageMock.getUsageExportRows.mockReturnValueOnce([
            {
                scope: 'global',
                id: '',
                date: '2025-01-01',
                requests: 2,
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                costUsd: 0.0015,
            },
            {
                scope: 'guild',
                id: 'guild,1',
                date: '2025-01-01',
                requests: 1,
                inputTokens: 80,
                outputTokens: 40,
                totalTokens: 120,
                costUsd: 0.0012,
            },
            {
                scope: 'user',
                id: 'user-1',
                date: '2025-01-01',
                requests: 1,
                inputTokens: 20,
                outputTokens: 10,
                totalTokens: 30,
                costUsd: 0.0003,
            },
        ]);

        const res = await requestText(server, 'GET', '/api/usage/export.csv', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('babel-usage-export.csv');
        expect(res.text).toBe(
            [
                'scope,id,date,requests,inputTokens,outputTokens,totalTokens,costUsd',
                'global,,2025-01-01,2,100,50,150,0.0015',
                'guild,"guild,1",2025-01-01,1,80,40,120,0.0012',
                'user,user-1,2025-01-01,1,20,10,30,0.0003',
                '',
            ].join('\n'),
        );
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
        const previousGuildBudgets = store.listGuildBudgets();

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
            replaceBudgets(
                store.listGuildBudgets(),
                { 'guild-1': { dailyBudgetUsd: 2 } },
                (id) => store.clearGuildBudget(id),
                (id, budget) => store.setGuildBudget(id, budget),
            );

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
            replaceBudgets(
                store.listGuildBudgets(),
                previousGuildBudgets,
                (id) => store.clearGuildBudget(id),
                (id, budget) => store.setGuildBudget(id, budget),
            );
        }
    });

    it('should include allowed and pending user-install owners in user budget access data', async () => {
        const { store } = await import('../src/persistence/store.js');
        const previousConfig = store.getConfigValues([
            'allowedUserIds',
            'defaultUserDailyBudgetUsd',
        ]);
        const previousUserBudgets = store.listUserBudgets();
        const pocketApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            metrics,
            runtimeLimiter,
            profile: BABEL_POCKET_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            pendingUserInstallOwnerRepository,
        });
        const pocketServer = startDashboardServer(pocketApp, 0);

        try {
            store.updateConfigValues({
                allowedUserIds: ['user-1'],
                defaultUserDailyBudgetUsd: 0.5,
            });
            replaceBudgets(
                store.listUserBudgets(),
                { 'user-1': { dailyBudgetUsd: 1.25 } },
                (id) => store.clearUserBudget(id),
                (id, budget) => store.setUserBudget(id, budget),
            );

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
            store.updateConfigValues(previousConfig);
            replaceBudgets(
                store.listUserBudgets(),
                previousUserBudgets,
                (id) => store.clearUserBudget(id),
                (id, budget) => store.setUserBudget(id, budget),
            );
            stopDashboardApp(pocketApp);
            pocketServer.close();
        }
    });

    it('should include user budget overview data in Babel Pocket stats', async () => {
        const { store } = await import('../src/persistence/store.js');
        const previousConfig = store.getConfigValues([
            'allowedUserIds',
            'defaultUserDailyBudgetUsd',
        ]);
        const previousUserBudgets = store.listUserBudgets();
        const pocketApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            metrics,
            runtimeLimiter,
            profile: BABEL_POCKET_PROFILE,
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            pendingUserInstallOwnerRepository,
        });
        const pocketServer = startDashboardServer(pocketApp, 0);

        try {
            store.updateConfigValues({
                allowedUserIds: ['user-1', 'user-2'],
                defaultUserDailyBudgetUsd: 0.5,
            });
            replaceBudgets(
                store.listUserBudgets(),
                { 'user-1': { dailyBudgetUsd: 1.25 } },
                (id) => store.clearUserBudget(id),
                (id, budget) => store.setUserBudget(id, budget),
            );
            usageMock.getUserStats.mockClear();

            const login = await request(pocketServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const res = await request(pocketServer, 'GET', '/api/stats', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(res.body!.guildBudgets).toEqual([]);
            expect(res.body!.userBudgets).toEqual([
                expect.objectContaining({
                    id: 'user-1',
                    budget: 1.25,
                    isCustom: true,
                    allowed: true,
                    pending: false,
                    totalCost: 0.01,
                    requests: 1,
                    exceeded: false,
                }),
                expect.objectContaining({
                    id: 'user-2',
                    budget: 0.5,
                    isCustom: false,
                    allowed: true,
                    pending: false,
                    totalCost: 0,
                    requests: 0,
                    exceeded: false,
                }),
                expect.objectContaining({
                    id: 'pending-owner',
                    budget: 0.5,
                    isCustom: false,
                    allowed: false,
                    pending: true,
                }),
            ]);
            expect(usageMock.getUserStats).toHaveBeenCalledWith('user-1');
            expect(usageMock.getUserStats).toHaveBeenCalledWith('user-2');
            expect(usageMock.getUserStats).toHaveBeenCalledWith('pending-owner');
        } finally {
            store.updateConfigValues(previousConfig);
            replaceBudgets(
                store.listUserBudgets(),
                previousUserBudgets,
                (id) => store.clearUserBudget(id),
                (id, budget) => store.setUserBudget(id, budget),
            );
            stopDashboardApp(pocketApp);
            pocketServer.close();
        }
    });

    it('should resolve combined user budget profiles with the Pocket Discord client', async () => {
        const { store } = await import('../src/persistence/store.js');
        const previousConfig = store.getConfigValues([
            'allowedUserIds',
            'defaultUserDailyBudgetUsd',
        ]);
        const previousUserBudgets = store.listUserBudgets();
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
            store.updateConfigValues({
                allowedUserIds: [],
                defaultUserDailyBudgetUsd: 0.5,
            });
            replaceBudgets(
                store.listUserBudgets(),
                {},
                (id) => store.clearUserBudget(id),
                (id, budget) => store.setUserBudget(id, budget),
            );

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
            store.updateConfigValues(previousConfig);
            replaceBudgets(
                store.listUserBudgets(),
                previousUserBudgets,
                (id) => store.clearUserBudget(id),
                (id, budget) => store.setUserBudget(id, budget),
            );
            stopDashboardApp(combinedApp);
            combinedServer.close();
            emptyProfileDb.close();
        }
    });

    it('should not call generation probes from public readiness endpoints', async () => {
        healthCheck.mockClear();

        const first = await request(server, 'GET', '/readyz');
        const second = await request(server, 'GET', '/readyz');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(healthCheck).not.toHaveBeenCalled();
    });

    it('should expose package version metadata to authenticated users', async () => {
        const res = await request(server, 'GET', '/api/version', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            version: '0.2.2',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases',
        });
    });

    it('should expose Prometheus metrics without dashboard authentication by default in local test mode', async () => {
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
                'babel_app_version_info{version="0.2.2",repository_url="https://github.com/0xH4KU/babel-discord-translator/releases"} 1',
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

    it('should require a metrics token by default for production public health dashboards', async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        const previousMetricsToken = process.env.BABEL_METRICS_TOKEN;
        process.env.NODE_ENV = 'production';
        delete process.env.BABEL_METRICS_TOKEN;

        const healthDeps: Parameters<typeof createHealthDashboardApp>[0] & { host: string } = {
            cache,
            metrics,
            runtimeLimiter,
            host: '0.0.0.0',
        };
        const protectedApp = createHealthDashboardApp(healthDeps);
        const protectedServer = startDashboardServer(protectedApp, 0);

        try {
            const missing = await requestText(protectedServer, 'GET', '/metrics');
            expect(missing.status).toBe(401);
            expect(missing.text).toBe('Metrics token required\n');
        } finally {
            protectedServer.close();
            stopDashboardApp(protectedApp);
            if (previousNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = previousNodeEnv;
            }
            if (previousMetricsToken === undefined) {
                delete process.env.BABEL_METRICS_TOKEN;
            } else {
                process.env.BABEL_METRICS_TOKEN = previousMetricsToken;
            }
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
        const previousGcpProject = store.getConfigValues(['gcpProject']).gcpProject;
        try {
            store.updateConfigValues({ gcpProject: '' });
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
            store.updateConfigValues({ gcpProject: previousGcpProject });
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
        const res = await request(server, 'GET', '/api/health', {
            cookie: sessionCookie,
        });
        expect(res.status).toBe(200);
        expect(res.body!.healthy).toBe(true);
        expect((res.body!.vertexAi as Record<string, unknown>).status).toBe('pass');
        expect((res.body!.checks as Record<string, unknown>).configuration).toBeDefined();
        expect(healthCheck).not.toHaveBeenCalled();
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

    it('should reject setup doctor runs without CSRF token', async () => {
        const res = await request(server, 'POST', '/api/setup-doctor/run', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(403);
    });

    it('should run setup doctor from the authenticated dashboard', async () => {
        const registrationEnvKeys = [
            'DISCORD_APP_ID',
            'DISCORD_TOKEN',
            'DISCORD_BOT_TOKEN',
            'BABEL_GUILD_DISCORD_APP_ID',
            'BABEL_GUILD_DISCORD_TOKEN',
            'BABEL_GUILD_DISCORD_BOT_TOKEN',
            'BABEL_POCKET_DISCORD_APP_ID',
            'BABEL_POCKET_DISCORD_TOKEN',
            'BABEL_POCKET_DISCORD_BOT_TOKEN',
        ] as const;
        const originalRegistrationEnv = new Map(
            registrationEnvKeys.map((key) => [key, process.env[key]]),
        );

        for (const key of registrationEnvKeys) {
            delete process.env[key];
        }

        try {
            const res = await request(server, 'POST', '/api/setup-doctor/run', {
                cookie: sessionCookie,
                csrf: csrfToken,
            });

            expect(res.status).toBe(200);
            expect(res.body!.timestamp).toEqual(expect.any(String));
            expect(res.body!.checks).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'discord' }),
                    expect.objectContaining({ id: 'commands', status: 'skipped' }),
                    expect.objectContaining({ id: 'provider-vertex' }),
                    expect.objectContaining({ id: 'sqlite' }),
                    expect.objectContaining({ id: 'budget' }),
                    expect.objectContaining({ id: 'webhook' }),
                ]),
            );
        } finally {
            for (const key of registrationEnvKeys) {
                const value = originalRegistrationEnv.get(key);
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
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

        const updateConfigValues = store.updateConfigValues as ReturnType<typeof vi.fn>;
        const lastCall = updateConfigValues.mock.calls[updateConfigValues.mock.calls.length - 1][0];
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

    it('should not apply runtime effects when config persistence fails', async () => {
        const { store } = await import('../src/persistence/store.js');
        const updateConfigValues = store.updateConfigValues as ReturnType<typeof vi.fn>;
        const before = runtimeLimiter.snapshot().limits;
        updateConfigValues.mockImplementationOnce(() => {
            throw new Error('sqlite write failed');
        });

        const res = await request(server, 'POST', '/api/config', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { translationMaxConcurrent: before.maxConcurrent + 1 },
        });

        expect(res.status).toBe(500);
        expect(runtimeLimiter.snapshot().limits).toEqual(before);
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
        vi.mocked(translateMock).mockClear();

        const res = await request(server, 'POST', '/api/translate/test', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { text: 'Hello', targetLanguage: 'ja' },
        });
        expect(res.status).toBe(200);
        expect(res.body!.ok).toBe(true);
        expect(res.body!.translation).toBe('service translated: Hello');
        expect(dashboardTranslationService.process).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'translate',
                commandLabel: 'dashboard translation test',
                userId: 'dashboard-admin',
                userTag: 'Dashboard Admin',
                text: 'Hello',
                targetLanguageOption: 'ja',
                bypassAccessControl: true,
            }),
        );
        expect(dashboardTranslationRequests.at(-1)?.beforeTranslate).toEqual(expect.any(Function));
        expect(translateMock).not.toHaveBeenCalledWith('Hello', 'ja');
    });

    it('should route combined translate tests through product-scoped services', async () => {
        const guildTranslationService: TranslationService = {
            process: vi.fn(async (request: TranslationServiceRequest) => ({
                status: 'success',
                deferred: false,
                translatedText: `guild translated: ${request.text}`,
                originalText: request.text,
                cached: false,
                targetLanguage: request.targetLanguageOption || 'auto',
                langSource: request.targetLanguageOption ? 'option' : 'auto',
                inputTokens: 10,
                outputTokens: 5,
                provider: 'vertex',
            })),
        };
        const pocketTranslationService: TranslationService = {
            process: vi.fn(async (request: TranslationServiceRequest) => ({
                status: 'success',
                deferred: false,
                translatedText: `pocket translated: ${request.text}`,
                originalText: request.text,
                cached: false,
                targetLanguage: request.targetLanguageOption || 'auto',
                langSource: request.targetLanguageOption ? 'option' : 'auto',
                inputTokens: 12,
                outputTokens: 6,
                provider: 'openai',
            })),
        };
        const combinedApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
            metrics,
            runtimeLimiter,
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            sessionRepository: new InMemorySessionRepository(),
            userProfileRepository,
            translationService: guildTranslationService,
            translationServices: {
                'babel-guild': guildTranslationService,
                'babel-pocket': pocketTranslationService,
            },
        });
        const combinedServer = startDashboardServer(combinedApp, 0);

        try {
            const login = await request(combinedServer, 'POST', '/api/login', {
                body: { password: 'test-pass-123' },
            });
            const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
            const csrf = String(login.body!.csrfToken);

            const guildRes = await request(combinedServer, 'POST', '/guild/api/translate/test', {
                cookie,
                csrf,
                body: { text: 'Hello Guild', targetLanguage: 'ja' },
            });
            const pocketRes = await request(combinedServer, 'POST', '/pocket/api/translate/test', {
                cookie,
                csrf,
                body: { text: 'Hello Pocket', targetLanguage: 'ko' },
            });

            expect(guildRes.status).toBe(200);
            expect(pocketRes.status).toBe(200);
            expect(guildRes.body!.translation).toBe('guild translated: Hello Guild');
            expect(pocketRes.body!.translation).toBe('pocket translated: Hello Pocket');
            expect(guildTranslationService.process).toHaveBeenCalledTimes(1);
            expect(pocketTranslationService.process).toHaveBeenCalledTimes(1);
        } finally {
            stopDashboardApp(combinedApp);
            combinedServer.close();
        }
    });

    it('should sanitize translate test errors before returning them', async () => {
        vi.mocked(dashboardTranslationService.process).mockResolvedValueOnce({
            status: 'error',
            deferred: false,
            message: 'Translation failed: OpenAI 500 at [API endpoint] with token ***',
        });

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
            body: {
                entries: [
                    { guildId: 'guild-1', userId: 'user1' },
                    { guildId: 'guild-3', userId: 'missing-user' },
                ],
            },
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            ok: true,
            deleted: [{ guildId: 'guild-1', userId: 'user1' }],
            notFound: [{ guildId: 'guild-3', userId: 'missing-user' }],
        });

        const prefsRes = await request(server, 'GET', '/api/user-prefs', {
            cookie: sessionCookie,
        });
        expect(prefsRes.body!.entries).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ guildId: 'guild-1', userId: 'user1' }),
            ]),
        );
        expect(prefsRes.body!.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ guildId: 'guild-2', userId: 'user1' }),
            ]),
        );
    });

    it('should include Discord user profiles and guild metadata with user language preferences', async () => {
        const res = await request(server, 'GET', '/api/user-prefs', {
            cookie: sessionCookie,
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                entries: expect.arrayContaining([
                    expect.objectContaining({
                        guildId: 'guild-1',
                        guildName: 'Guild One',
                        userId: 'user2',
                        language: 'zh-TW',
                    }),
                ]),
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

    it('should delete one guild-scoped user language preference', async () => {
        const res = await request(server, 'DELETE', '/api/user-prefs/user1?guildId=guild-2', {
            cookie: sessionCookie,
            csrf: csrfToken,
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            ok: true,
            deleted: { guildId: 'guild-2', userId: 'user1' },
        });

        const prefsRes = await request(server, 'GET', '/api/user-prefs', {
            cookie: sessionCookie,
        });
        expect(prefsRes.body!.entries).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ guildId: 'guild-2', userId: 'user1' }),
            ]),
        );
    });

    it('should expose global user language preferences for Babel Pocket', async () => {
        const pocketApp = createDashboardApp({
            cache,
            cooldown: new CooldownManager(5),
            log,
            client: createMinimalClient(),
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
            const res = await request(pocketServer, 'GET', '/api/user-prefs', {
                cookie,
            });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                entries: [
                    {
                        guildId: '',
                        userId: 'legacyUser',
                        language: 'en',
                    },
                ],
                count: 1,
            });
        } finally {
            stopDashboardApp(pocketApp);
            pocketServer.close();
        }
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
                targetLanguage: 'auto',
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
                    targetLanguage: 'auto',
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
                targetLanguage: 'ja',
                targetText: 'レイド',
                notes: '',
            },
        });
        expect(update.status).toBe(200);
        expect((update.body!.entry as Record<string, unknown>).targetLanguage).toBe('ja');
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

    it('should import glossary entries with case-insensitive skip and overwrite modes', async () => {
        cache.set('glossary-cache-key', 'cached translation');

        const initial = await request(server, 'POST', '/api/guild-glossary/guild-import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                sourceText: 'OpenAI',
                targetLanguage: 'auto',
                targetText: 'OpenAI',
                notes: 'Original brand note',
            },
        });
        expect(initial.status).toBe(200);
        cache.set('glossary-cache-key', 'cached translation');

        const skip = await request(server, 'POST', '/api/guild-glossary/guild-import/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'skip',
                text: [
                    'sourceText,targetLanguage,targetText,notes',
                    'openai,ja,オープンAI,Japanese brand',
                    'openai,auto,Open AI,Changed note',
                    'raid,zh-TW,團本,Game term',
                ].join('\n'),
            },
        });

        expect(skip.status).toBe(200);
        expect(skip.body).toMatchObject({
            ok: true,
            created: 2,
            updated: 0,
            skipped: 1,
            failed: 0,
            cacheCleared: true,
        });
        expect(cache.stats().size).toBe(0);

        const afterSkip = await request(server, 'GET', '/api/guild-glossary/guild-import', {
            cookie: sessionCookie,
        });
        expect(afterSkip.body!.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sourceText: 'OpenAI',
                    targetLanguage: 'auto',
                    targetText: 'OpenAI',
                    notes: 'Original brand note',
                }),
                expect.objectContaining({
                    sourceText: 'openai',
                    targetLanguage: 'ja',
                    targetText: 'オープンAI',
                    notes: 'Japanese brand',
                }),
                expect.objectContaining({
                    sourceText: 'raid',
                    targetLanguage: 'zh-TW',
                    targetText: '團本',
                    notes: 'Game term',
                }),
            ]),
        );

        cache.set('glossary-cache-key', 'cached translation');
        const overwrite = await request(server, 'POST', '/api/guild-glossary/guild-import/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'overwrite',
                text: [
                    'source,targetLanguage,target,notes',
                    'openai,auto,Open AI,Changed note',
                    'RAID,ja,レイド,JP term',
                    'raid,JA,レイド二,Updated JP term',
                    'raid,zh-TW,團本二,Changed TW',
                ].join('\n'),
            },
        });

        expect(overwrite.status).toBe(200);
        expect(overwrite.body).toMatchObject({
            ok: true,
            created: 1,
            updated: 3,
            skipped: 0,
            failed: 0,
            cacheCleared: true,
        });
        expect(cache.stats().size).toBe(0);

        const afterOverwrite = await request(server, 'GET', '/api/guild-glossary/guild-import', {
            cookie: sessionCookie,
        });
        expect(afterOverwrite.body!.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sourceText: 'openai',
                    targetLanguage: 'auto',
                    targetText: 'Open AI',
                    notes: 'Changed note',
                }),
                expect.objectContaining({
                    sourceText: 'openai',
                    targetLanguage: 'ja',
                    targetText: 'オープンAI',
                    notes: 'Japanese brand',
                }),
                expect.objectContaining({
                    sourceText: 'raid',
                    targetLanguage: 'JA',
                    targetText: 'レイド二',
                    notes: 'Updated JP term',
                }),
                expect.objectContaining({
                    sourceText: 'raid',
                    targetLanguage: 'zh-TW',
                    targetText: '團本二',
                    notes: 'Changed TW',
                }),
            ]),
        );
    });

    it('should report glossary import row errors and avoid cache clearing when nothing changes', async () => {
        cache.set('unchanged-cache-key', 'cached translation');

        const res = await request(
            server,
            'POST',
            '/api/guild-glossary/guild-import-errors/import',
            {
                cookie: sessionCookie,
                csrf: csrfToken,
                body: {
                    duplicateMode: 'skip',
                    text: 'source,target\n,團本\nraid,',
                },
            },
        );

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            ok: true,
            created: 0,
            updated: 0,
            skipped: 0,
            failed: 2,
            errors: [
                { line: 2, error: 'Glossary source and target are required' },
                { line: 3, error: 'Glossary source and target are required' },
            ],
            cacheCleared: false,
        });
        expect(cache.stats().size).toBe(1);
    });

    it('should validate glossary import requests', async () => {
        const res = await request(server, 'POST', '/api/guild-glossary/guild-1/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'replace',
                text: 'source,target\nOpenAI,OpenAI',
            },
        });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            error: 'Glossary import duplicate mode must be skip or overwrite',
        });
    });

    it('should accept glossary imports larger than the default JSON parser limit', async () => {
        const text = Array.from(
            { length: 500 },
            (_, index) => `term-${index},ja,target-${index},${'x'.repeat(190)}`,
        ).join('\n');
        expect(Buffer.byteLength(text)).toBeGreaterThan(100 * 1024);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(128 * 1024);

        const res = await request(server, 'POST', '/api/guild-glossary/guild-large/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: { duplicateMode: 'skip', text },
        });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ created: 500, failed: 0 });
    });

    it('should not expose guild glossary routes for Babel Pocket', async () => {
        const dashboard = startProfileDashboard(BABEL_POCKET_PROFILE);

        try {
            const { cookie, csrf } = await loginDashboard(dashboard.server);
            const res = await requestText(dashboard.server, 'GET', '/api/guild-glossary/guild-1', {
                cookie,
            });

            expect(res.status).toBe(404);

            const importRes = await requestText(
                dashboard.server,
                'POST',
                '/api/guild-glossary/guild-1/import',
                { cookie, csrf },
            );
            expect(importRes.status).toBe(404);
        } finally {
            dashboard.close();
        }
    });

    it('should not expose the legacy pending user-install owner routes', async () => {
        const dashboards = [
            startProfileDashboard(BABEL_GUILD_PROFILE),
            startProfileDashboard(BABEL_POCKET_PROFILE),
        ];

        try {
            for (const dashboard of dashboards) {
                const { cookie } = await loginDashboard(dashboard.server);
                const res = await requestText(
                    dashboard.server,
                    'GET',
                    '/api/access/pending-users',
                    {
                        cookie,
                    },
                );

                expect(res.status).toBe(404);
            }
        } finally {
            dashboards.forEach((dashboard) => dashboard.close());
        }
    });

    it('should not expose user budget access data for Babel Guild', async () => {
        const dashboard = startProfileDashboard();

        try {
            const { cookie } = await loginDashboard(dashboard.server);
            const res = await requestText(dashboard.server, 'GET', '/api/user-budgets', {
                cookie,
            });

            expect(res.status).toBe(404);
        } finally {
            dashboard.close();
        }
    });

    it.each([
        {
            profile: BABEL_GUILD_PROFILE,
            capabilities: {
                guildAccess: true,
                userAccess: false,
                guildGlossary: true,
                pendingUserInstallOwners: false,
            },
        },
        {
            profile: BABEL_POCKET_PROFILE,
            capabilities: {
                guildAccess: false,
                userAccess: true,
                guildGlossary: false,
                pendingUserInstallOwners: true,
            },
        },
    ])(
        'should expose dashboard capabilities for $profile.productName',
        async ({ profile, capabilities }) => {
            const dashboard = startProfileDashboard(profile);

            try {
                const { cookie } = await loginDashboard(dashboard.server);
                const res = await requestText(dashboard.server, 'GET', '/api/capabilities', {
                    cookie,
                });
                const serializedProfile = {
                    id: profile.id,
                    productName: profile.productName,
                    commandName: profile.commandName,
                    accessMode: profile.accessMode,
                };

                expect(res.status).toBe(200);
                expect(JSON.parse(res.text)).toEqual({
                    profile: serializedProfile,
                    profiles: [serializedProfile],
                    capabilities,
                });
            } finally {
                dashboard.close();
            }
        },
    );

    it('should expose combined dashboard capabilities without losing separate app identities', async () => {
        const dashboard = startCombinedDashboard();

        try {
            const { cookie } = await loginDashboard(dashboard.server);
            const res = await requestText(dashboard.server, 'GET', '/api/capabilities', {
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
            dashboard.close();
        }
    });

    it.each([
        {
            path: '/guild/api/capabilities',
            profile: BABEL_GUILD_PROFILE,
            capabilities: {
                guildAccess: true,
                userAccess: false,
                guildGlossary: true,
                pendingUserInstallOwners: false,
            },
        },
        {
            path: '/pocket/api/capabilities',
            profile: BABEL_POCKET_PROFILE,
            capabilities: {
                guildAccess: false,
                userAccess: true,
                guildGlossary: false,
                pendingUserInstallOwners: true,
            },
        },
    ])(
        'should expose $profile.productName capabilities at $path',
        async ({ path, profile, capabilities }) => {
            const dashboard = startCombinedDashboard();

            try {
                const { cookie } = await loginDashboard(dashboard.server);
                const res = await requestText(dashboard.server, 'GET', path, { cookie });

                expect(res.status).toBe(200);
                expect(JSON.parse(res.text)).toMatchObject({
                    profile: { id: profile.id, productName: profile.productName },
                    capabilities,
                });
            } finally {
                dashboard.close();
            }
        },
    );

    it('should serve dashboard shell for combined /guild and /pocket paths', async () => {
        const dashboard = startCombinedDashboard();

        try {
            for (const path of ['/guild', '/pocket']) {
                const res = await requestText(dashboard.server, 'GET', path);

                expect(res.status).toBe(200);
                expect(res.text).toContain('id="login-view"');
                expect(res.text).toContain('id="profile-select-view"');
            }
        } finally {
            dashboard.close();
        }
    });

    it('should return product-scoped logs for combined dashboard API paths', async () => {
        const scopedLog = new TranslationLog(10);
        scopedLog.add({
            appProfileId: 'babel-guild',
            guildId: 'guild-1',
            guildName: 'Guild Server',
            userId: 'guild-user',
            userTag: 'GuildUser#0001',
            contentPreview: 'guild log',
        });
        scopedLog.add({
            appProfileId: 'babel-pocket',
            guildId: null,
            guildName: 'Direct Message',
            userId: 'pocket-user',
            userTag: 'PocketUser#0001',
            contentPreview: 'pocket log',
        });
        const dashboard = startCombinedDashboard({ log: scopedLog });

        try {
            const { cookie } = await loginDashboard(dashboard.server);

            const guildRes = await request(dashboard.server, 'GET', '/guild/api/logs', {
                cookie,
            });
            const pocketRes = await request(dashboard.server, 'GET', '/pocket/api/logs', {
                cookie,
            });

            expect(guildRes.status).toBe(200);
            expect(pocketRes.status).toBe(200);
            expect(guildRes.body).toEqual([
                expect.objectContaining({
                    appProfileId: 'babel-guild',
                    contentPreview: 'guild log',
                }),
            ]);
            expect(pocketRes.body).toEqual([
                expect.objectContaining({
                    appProfileId: 'babel-pocket',
                    contentPreview: 'pocket log',
                }),
            ]);
        } finally {
            dashboard.close();
        }
    });

    it('should apply error type filters within product-scoped combined logs', async () => {
        const scopedLog = new TranslationLog(10);
        scopedLog.addError({
            appProfileId: 'babel-guild',
            guildId: 'guild-1',
            guildName: 'Guild Server',
            userId: 'guild-user',
            error: 'Guild rate limited',
            command: '/translate',
            errorType: 'rate_limit',
        });
        scopedLog.addError({
            appProfileId: 'babel-pocket',
            guildId: null,
            guildName: 'Direct Message',
            userId: 'pocket-user',
            error: 'Pocket rate limited',
            command: 'Babel Pocket',
            errorType: 'rate_limit',
        });
        scopedLog.addError({
            appProfileId: 'babel-guild',
            guildId: 'guild-1',
            guildName: 'Guild Server',
            userId: 'guild-user',
            error: 'Guild auth failed',
            command: '/translate',
            errorType: 'auth',
        });
        const dashboard = startCombinedDashboard({ log: scopedLog });

        try {
            const { cookie } = await loginDashboard(dashboard.server);

            const guildRes = await request(
                dashboard.server,
                'GET',
                '/guild/api/logs?errorType=rate_limit',
                { cookie },
            );
            const pocketRes = await request(
                dashboard.server,
                'GET',
                '/pocket/api/logs?errorType=rate_limit',
                { cookie },
            );

            expect(guildRes.status).toBe(200);
            expect(pocketRes.status).toBe(200);
            expect(guildRes.body).toEqual([
                expect.objectContaining({
                    appProfileId: 'babel-guild',
                    error: 'Guild rate limited',
                    errorType: 'rate_limit',
                }),
            ]);
            expect(pocketRes.body).toEqual([
                expect.objectContaining({
                    appProfileId: 'babel-pocket',
                    error: 'Pocket rate limited',
                    errorType: 'rate_limit',
                }),
            ]);
        } finally {
            dashboard.close();
        }
    });

    it('should return product-scoped usage history for combined dashboard API paths', async () => {
        const globalHistory = [
            {
                date: '2026-06-01',
                inputTokens: 3000,
                outputTokens: 1500,
                totalTokens: 4500,
                requests: 3,
                cost: 0,
            },
        ];
        const guildHistory = [
            {
                date: '2026-06-01',
                inputTokens: 1000,
                outputTokens: 500,
                totalTokens: 1500,
                requests: 1,
                cost: 0,
            },
        ];
        const pocketHistory = [
            {
                date: '2026-06-01',
                inputTokens: 2000,
                outputTokens: 1000,
                totalTokens: 3000,
                requests: 2,
                cost: 0,
            },
        ];
        usageMock.getHistory.mockReturnValue(globalHistory);
        usageMock.getGuildHistory.mockReturnValue(guildHistory);
        usageMock.getUserHistory.mockReturnValue(pocketHistory);
        usageMock.getGuildHistoryForGuilds.mockReturnValue(guildHistory);
        usageMock.getAllUserHistory.mockReturnValue(pocketHistory);

        const guildClient = {
            ...createMinimalClient(),
            guilds: {
                cache: {
                    size: 1,
                    map: (fn: Function) =>
                        [
                            {
                                id: 'guild-1',
                                name: 'Guild One',
                                iconURL: () => '',
                                memberCount: 10,
                            },
                        ].map(fn),
                    [Symbol.iterator]: function* () {
                        yield [
                            'guild-1',
                            {
                                id: 'guild-1',
                                name: 'Guild One',
                                iconURL: () => '',
                                memberCount: 10,
                            },
                        ];
                    },
                },
            },
        } as unknown as Client;
        const dashboard = startCombinedDashboard({
            client: guildClient,
            clients: {
                'babel-guild': guildClient,
                'babel-pocket': createMinimalClient(),
            },
        });

        try {
            const { cookie } = await loginDashboard(dashboard.server);

            const rootRes = await request(dashboard.server, 'GET', '/api/usage/history', {
                cookie,
            });
            const guildRes = await request(dashboard.server, 'GET', '/guild/api/usage/history', {
                cookie,
            });
            const pocketRes = await request(dashboard.server, 'GET', '/pocket/api/usage/history', {
                cookie,
            });

            expect(rootRes.status).toBe(200);
            expect(guildRes.status).toBe(200);
            expect(pocketRes.status).toBe(200);
            expect(rootRes.body).toEqual(globalHistory);
            expect(guildRes.body).toEqual(guildHistory);
            expect(pocketRes.body).toEqual(pocketHistory);
            expect(usageMock.getGuildHistoryForGuilds).toHaveBeenCalledWith(['guild-1']);
            expect(usageMock.getAllUserHistory).toHaveBeenCalled();

            usageMock.getGuildHistory.mockClear();
            const pocketGuildFilterRes = await request(
                dashboard.server,
                'GET',
                '/pocket/api/usage/history?guildId=guild-1',
                {
                    cookie,
                },
            );
            expect(pocketGuildFilterRes.status).toBe(400);
            expect(pocketGuildFilterRes.body).toEqual({
                error: 'guildId filter is not available for this dashboard scope',
            });
            expect(usageMock.getGuildHistory).not.toHaveBeenCalled();
        } finally {
            usageMock.getHistory.mockReturnValue([]);
            usageMock.getGuildHistory.mockReturnValue([]);
            usageMock.getUserHistory.mockReturnValue([]);
            usageMock.getGuildHistoryForGuilds.mockReturnValue([]);
            usageMock.getAllUserHistory.mockReturnValue([]);
            dashboard.close();
        }
    });

    it('should return product-scoped operations metrics for combined dashboard API paths', async () => {
        const scopedMetrics = new AppMetrics();
        scopedMetrics.recordTranslationSuccess({ appProfileId: 'babel-guild' });
        scopedMetrics.recordTranslationApiCall({ appProfileId: 'babel-guild' });
        scopedMetrics.recordProviderSuccess('vertex', {
            appProfileId: 'babel-guild',
            latencyMs: 42,
        });
        scopedMetrics.recordTranslationFailure({ appProfileId: 'babel-pocket' });
        scopedMetrics.recordProviderFailure('openai', {
            appProfileId: 'babel-pocket',
            errorType: 'auth',
            error: 'Pocket OpenAI 401',
        });
        scopedMetrics.recordProviderFallback({
            appProfileId: 'babel-pocket',
            from: 'openai',
            to: 'vertex',
            errorType: 'auth',
            error: 'Pocket OpenAI 401',
        });

        const dashboard = startCombinedDashboard({
            metrics: scopedMetrics,
        });

        try {
            const { cookie } = await loginDashboard(dashboard.server);

            const rootRes = await request(dashboard.server, 'GET', '/api/stats', { cookie });
            const guildRes = await request(dashboard.server, 'GET', '/guild/api/stats', { cookie });
            const pocketRes = await request(dashboard.server, 'GET', '/pocket/api/stats', {
                cookie,
            });

            expect(rootRes.status).toBe(200);
            expect(guildRes.status).toBe(200);
            expect(pocketRes.status).toBe(200);

            const rootOperations = rootRes.body!.operations as Record<string, unknown>;
            const guildOperations = guildRes.body!.operations as Record<string, unknown>;
            const pocketOperations = pocketRes.body!.operations as Record<string, unknown>;
            const guildProviders = guildOperations.providers as Record<
                string,
                Record<string, unknown>
            >;
            const pocketProviders = pocketOperations.providers as Record<
                string,
                Record<string, unknown>
            >;
            const rootTranslations = rootRes.body!.translations as Record<string, unknown>;
            const guildTranslations = guildRes.body!.translations as Record<string, unknown>;
            const pocketTranslations = pocketRes.body!.translations as Record<string, unknown>;

            expect(rootOperations.fallbackTotal).toBe(1);
            expect(guildOperations.fallbackTotal).toBe(0);
            expect(pocketOperations.fallbackTotal).toBe(1);
            expect(guildOperations.lastFallback).toBeNull();
            expect(pocketOperations.lastFallback).toMatchObject({
                from: 'openai',
                to: 'vertex',
                errorType: 'auth',
            });
            expect(guildProviders.vertex.successTotal).toBe(1);
            expect(guildProviders.openai.failureTotal).toBe(0);
            expect(pocketProviders.vertex.successTotal).toBe(0);
            expect(pocketProviders.openai.failureTotal).toBe(1);
            expect(rootTranslations.total).toBe(1);
            expect(rootTranslations.apiCalls).toBe(1);
            expect(guildTranslations.total).toBe(1);
            expect(guildTranslations.apiCalls).toBe(1);
            expect(guildTranslations.failures).toBe(0);
            expect(pocketTranslations.total).toBe(0);
            expect(pocketTranslations.apiCalls).toBe(0);
            expect(pocketTranslations.failures).toBe(1);
        } finally {
            dashboard.close();
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
