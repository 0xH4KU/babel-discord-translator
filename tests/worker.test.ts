import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { handleInteraction, type WorkerEnv } from '../apps/babel-worker/src/index.js';

function hex(bytes: ArrayBuffer | Uint8Array): string {
    return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
}

interface TestStatement {
    bind(...values: Array<string | number | null>): TestStatement;
    all<T>(): Promise<{ results: T[] }>;
    first<T>(): Promise<T | null>;
    run(): Promise<unknown>;
}

function env(
    overrides: Partial<WorkerEnv> = {},
    firstResult: unknown = null,
    allResults: unknown[] = [],
): WorkerEnv & { queries: string[] } {
    let cached: { translated_text: string; provider: string } | null = null;
    const queries: string[] = [];
    return {
        DB: {
            prepare: (query: string) => {
                queries.push(query);
                let values: Array<string | number | null> = [];
                const statement: TestStatement = {
                    bind: (...bound) => {
                        values = bound;
                        return statement;
                    },
                    all: async <T>() => ({ results: allResults as T[] }),
                    first: async <T>() =>
                        (query.includes('RETURNING expires_at')
                            ? { expires_at: Date.now() + 5000 }
                            : query.includes('AS user_rank')
                              ? { user_rank: 1, global_queue_rank: 1, guild_queue_rank: 1 }
                              : query.includes('RETURNING lease_id')
                                ? { lease_id: 'lease-id' }
                                : query.includes(
                                        'SELECT translated_text, provider FROM translation_cache',
                                    )
                                  ? cached
                                  : query.includes('FROM sqlite_master')
                                    ? firstResult
                                    : firstResult) as T | null,
                    run: async () => {
                        if (query.includes('INSERT INTO translation_cache')) {
                            cached = {
                                translated_text: String(values[2]),
                                provider: String(values[3]),
                            };
                        }
                        return {};
                    },
                };
                return statement;
            },
            batch: async (statements) =>
                Promise.all(statements.map((statement) => statement.run())),
        },
        DISCORD_PUBLIC_KEY: '',
        queries,
        ...overrides,
    };
}

function dashboardEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv & {
    usageWrites: string[];
    stats: { configReads: number };
} {
    const sessions = new Map<string, { expiry: number; csrf: string }>();
    const config = new Map<string, string>();
    const usageWrites: string[] = [];
    const stats = { configReads: 0 };
    let loginAttempts = 0;

    return {
        DASHBOARD_PASSWORD: 'correct-password',
        DB: {
            prepare(query: string) {
                let values: Array<string | number | null> = [];
                const statement: TestStatement = {
                    bind: (...bound) => {
                        values = bound;
                        return statement;
                    },
                    all: async <T>() => {
                        if (query.includes('FROM app_config')) {
                            stats.configReads++;
                            return {
                                results: [...config].map(([key, value]) => ({ key, value })) as T[],
                            };
                        }
                        if (query.includes('FROM sessions')) {
                            return {
                                results: [...sessions].map(([token, session]) => ({
                                    token,
                                    ...session,
                                })) as T[],
                            };
                        }
                        return { results: [] as T[] };
                    },
                    first: async <T>() => {
                        if (query.includes('RETURNING attempts')) {
                            loginAttempts += 1;
                            return { attempts: loginAttempts } as T;
                        }
                        if (query.includes('FROM sessions WHERE token')) {
                            const token = String(values[0]);
                            const found = sessions.get(token);
                            return (found ? { token, ...found } : null) as T | null;
                        }
                        if (query.includes('FROM sqlite_master')) {
                            return { table_count: 20 } as T;
                        }
                        if (query.includes('RETURNING expires_at')) {
                            return { expires_at: Date.now() + 5000 } as T;
                        }
                        if (query.includes('AS user_rank')) {
                            return {
                                user_rank: 1,
                                global_queue_rank: 1,
                                guild_queue_rank: 1,
                            } as T;
                        }
                        if (query.includes('RETURNING lease_id')) {
                            return { lease_id: 'dashboard-lease' } as T;
                        }
                        return null;
                    },
                    run: async () => {
                        if (query.includes('INSERT INTO daily_usage')) usageWrites.push(query);
                        if (query.startsWith('INSERT INTO sessions')) {
                            sessions.set(String(values[0]), {
                                expiry: Number(values[1]),
                                csrf: String(values[2]),
                            });
                        } else if (query.startsWith('DELETE FROM sessions')) {
                            sessions.delete(String(values[0]));
                        } else if (query.startsWith('DELETE FROM dashboard_login_attempts')) {
                            loginAttempts = 0;
                        } else if (query.includes('INSERT INTO app_config')) {
                            config.set(String(values[0]), String(values[1]));
                        }
                        return {};
                    },
                };
                return statement;
            },
            batch: async (statements) =>
                Promise.all(statements.map((statement) => statement.run())),
        },
        usageWrites,
        stats,
        ...overrides,
    };
}

describe('Cloudflare Worker runtime', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('accepts a signed Discord PING and rejects an invalid signature', async () => {
        const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
        const publicKey = await crypto.subtle.exportKey('raw', keys.publicKey);
        const timestamp = '1234567890';
        const body = JSON.stringify({ type: 1, application_id: 'app', token: 'token' });
        const message = new TextEncoder().encode(timestamp + body);
        const signature = await crypto.subtle.sign('Ed25519', keys.privateKey, message);
        const headers = {
            'content-type': 'application/json',
            'x-signature-ed25519': hex(signature),
            'x-signature-timestamp': timestamp,
        };

        const response = await worker.fetch(
            new Request('https://worker.example/interactions', {
                method: 'POST',
                headers,
                body,
            }),
            env({ DISCORD_PUBLIC_KEY: hex(publicKey) }),
            { waitUntil: vi.fn() },
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ type: 1 });

        const rejected = await worker.fetch(
            new Request('https://worker.example/interactions', {
                method: 'POST',
                headers: { ...headers, 'x-signature-ed25519': '00'.repeat(64) },
                body,
            }),
            env({ DISCORD_PUBLIC_KEY: hex(publicKey) }),
            { waitUntil: vi.fn() },
        );
        expect(rejected.status).toBe(401);
    });

    it('routes the Pocket endpoint with its own public key', async () => {
        const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
        const publicKey = await crypto.subtle.exportKey('raw', keys.publicKey);
        const timestamp = '1234567890';
        const body = JSON.stringify({
            type: 2,
            application_id: 'app',
            token: 'token',
            locale: 'en-US',
            user: { id: 'user' },
            data: { type: 1, name: 'help' },
        });
        const signature = await crypto.subtle.sign(
            'Ed25519',
            keys.privateKey,
            new TextEncoder().encode(timestamp + body),
        );
        const response = await worker.fetch(
            new Request('https://worker.example/pocket/interactions', {
                method: 'POST',
                headers: {
                    'x-signature-ed25519': hex(signature),
                    'x-signature-timestamp': timestamp,
                },
                body,
            }),
            env({ BABEL_POCKET_DISCORD_PUBLIC_KEY: hex(publicKey) }),
            { waitUntil: vi.fn() },
        );

        const payload = (await response.json()) as { data: { content: string } };
        expect(payload.data.content).toContain('Babel Pocket');
        expect(payload.data.content).not.toContain('Quick translation');
    });

    it('uses the profile public key on the single-profile interaction endpoint', async () => {
        const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
        const publicKey = await crypto.subtle.exportKey('raw', keys.publicKey);
        const timestamp = '1234567890';
        const body = JSON.stringify({ type: 1, application_id: 'app', token: 'token' });
        const signature = await crypto.subtle.sign(
            'Ed25519',
            keys.privateKey,
            new TextEncoder().encode(timestamp + body),
        );

        const response = await worker.fetch(
            new Request('https://worker.example/interactions', {
                method: 'POST',
                headers: {
                    'x-signature-ed25519': hex(signature),
                    'x-signature-timestamp': timestamp,
                },
                body,
            }),
            env({
                BABEL_APP: 'pocket',
                BABEL_POCKET_DISCORD_PUBLIC_KEY: hex(publicKey),
            }),
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ type: 1 });
    });

    it('reports ready only when the active runtime is fully configured', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            Response.json({
                candidates: [{ content: { parts: [{ text: 'OK' }] } }],
            }),
        );
        const response = await worker.fetch(
            new Request('https://worker.example/readyz'),
            env(
                {
                    DISCORD_PUBLIC_KEY: 'public-key',
                    DISCORD_BOT_TOKEN: 'bot-token',
                    VERTEX_AI_API_KEY: 'provider-key',
                    GCP_PROJECT: 'project',
                    ALLOWED_GUILD_IDS: 'guild-id',
                },
                { table_count: 20 },
            ),
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: 'ready',
            checks: {
                database: true,
                discord: true,
                provider: true,
                access: true,
                publicOutput: true,
            },
        });
        const request = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
        expect(JSON.parse(String(request.body)).generationConfig.maxOutputTokens).toBe(64);
    });

    it('stays ready when one fallback provider is healthy', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
            .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'OK' } }] }));
        const response = await worker.fetch(
            new Request('https://worker.example/readyz'),
            env(
                {
                    DISCORD_PUBLIC_KEY: 'public-key',
                    DISCORD_BOT_TOKEN: 'bot-token',
                    TRANSLATION_PROVIDER: 'vertex+openai',
                    VERTEX_AI_API_KEY: 'provider-key',
                    GCP_PROJECT: 'fallback-project',
                    OPENAI_API_KEY: 'openai-key',
                    OPENAI_BASE_URL: 'https://api.example',
                    OPENAI_MODEL: 'model',
                    ALLOWED_GUILD_IDS: 'guild-id',
                },
                { table_count: 20 },
            ),
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            status: 'ready',
            checks: { database: true, provider: true },
        });
    });

    it('reports not ready when a D1 migration is missing', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValue(Response.json({ choices: [{ message: { content: 'OK' } }] }));
        const response = await worker.fetch(
            new Request('https://worker.example/readyz'),
            env(
                {
                    DISCORD_PUBLIC_KEY: 'public-key',
                    DISCORD_BOT_TOKEN: 'bot-token',
                    VERTEX_AI_API_KEY: 'provider-key',
                    GCP_PROJECT: 'missing-schema-project',
                    ALLOWED_GUILD_IDS: 'guild-id',
                },
                { table_count: 19 },
            ),
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            status: 'not_ready',
            checks: { database: false },
        });
    });

    it('caches only content-hashed dashboard assets through the Worker binding', async () => {
        const assets = {
            fetch: vi
                .fn()
                .mockResolvedValueOnce(
                    new Response('body {}', { headers: { 'Content-Type': 'text/css' } }),
                )
                .mockResolvedValueOnce(
                    new Response('<html>fallback</html>', {
                        headers: { 'Content-Type': 'text/html' },
                    }),
                ),
        };
        const response = await worker.fetch(
            new Request('https://worker.example/css/variables.abcdef123456.css'),
            env({ ASSETS: assets }),
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toContain('body');
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(response.headers.get('x-frame-options')).toBe('DENY');

        const fallback = await worker.fetch(
            new Request('https://worker.example/css/missing.abcdef123456.css'),
            env({ ASSETS: assets }),
            { waitUntil: vi.fn() },
        );
        expect(fallback.headers.get('cache-control')).toBeNull();
    });

    it('exports combined runtime counters by profile and daily usage as gauges', async () => {
        const response = await worker.fetch(
            new Request('https://worker.example/metrics'),
            env({ BABEL_APP: 'combined' }, { input_tokens: 120, output_tokens: 30, requests: 4 }, [
                {
                    app_profile_id: 'babel-guild',
                    translations_total: 7,
                    api_calls_total: 6,
                    cache_hits_total: 1,
                    failures_total: 2,
                    rejected_total: 3,
                    provider_fallback_total: 4,
                },
                {
                    app_profile_id: 'babel-pocket',
                    translations_total: 11,
                    api_calls_total: 10,
                    cache_hits_total: 5,
                    failures_total: 0,
                    rejected_total: 1,
                    provider_fallback_total: 2,
                },
            ]),
            { waitUntil: vi.fn() },
        );
        const body = await response.text();

        expect(body).toContain('babel_translations_total{app_profile_id="babel-guild"} 7');
        expect(body).toContain('babel_translations_total{app_profile_id="babel-pocket"} 11');
        expect(body).toContain('# TYPE babel_daily_translation_input_tokens gauge');
        expect(body).toContain('babel_daily_translation_input_tokens 120');
        expect(body).toContain('babel_daily_translation_requests 4');
        expect(body).not.toContain('babel_translation_input_tokens_total');
    });

    it('authenticates dashboard sessions and applies D1 configuration updates', async () => {
        const runtimeEnv = dashboardEnv();
        const login = await worker.fetch(
            new Request('https://worker.example/api/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password: 'correct-password' }),
            }),
            runtimeEnv,
            { waitUntil: vi.fn() },
        );
        const loginPayload = (await login.json()) as { csrfToken: string };
        const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
        expect(login.status).toBe(200);
        expect(cookie).toMatch(/^session=/);

        const save = await worker.fetch(
            new Request('https://worker.example/api/config', {
                method: 'POST',
                headers: {
                    cookie,
                    'content-type': 'application/json',
                    'x-csrf-token': loginPayload.csrfToken,
                },
                body: JSON.stringify({
                    translationProvider: 'openai',
                    openaiApiKey: 'secret-key',
                    openaiBaseUrl: 'https://api.example',
                    openaiModel: 'model',
                    allowedGuildIds: ['guild-id'],
                }),
            }),
            runtimeEnv,
            { waitUntil: vi.fn() },
        );
        expect(save.status).toBe(200);

        const config = await worker.fetch(
            new Request('https://worker.example/api/config', { headers: { cookie } }),
            runtimeEnv,
            { waitUntil: vi.fn() },
        );
        const payload = (await config.json()) as Record<string, unknown>;
        expect(payload).toMatchObject({
            translationProvider: 'openai',
            openaiApiKey: '••••et-key',
            hasOpenaiApiKey: true,
            allowedGuildIds: ['guild-id'],
        });

        await worker.fetch(
            new Request('https://worker.example/api/config', { headers: { cookie } }),
            runtimeEnv,
            { waitUntil: vi.fn() },
        );
        expect(runtimeEnv.stats.configReads).toBe(2);
    });

    it('records dashboard test translations and returns their real cache state', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            Response.json({
                choices: [{ message: { content: 'dashboard result' } }],
                usage: { prompt_tokens: 8, completion_tokens: 3 },
            }),
        );
        const runtimeEnv = dashboardEnv({
            TRANSLATION_PROVIDER: 'openai',
            OPENAI_API_KEY: 'key',
            OPENAI_BASE_URL: 'https://api.example',
            OPENAI_MODEL: 'model',
            ALLOWED_GUILD_IDS: 'guild-id',
        });
        const login = await worker.fetch(
            new Request('https://worker.example/api/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password: 'correct-password' }),
            }),
            runtimeEnv,
            { waitUntil: vi.fn() },
        );
        const loginPayload = (await login.json()) as { csrfToken: string };
        const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';

        const response = await worker.fetch(
            new Request('https://worker.example/api/translate/test', {
                method: 'POST',
                headers: {
                    cookie,
                    'content-type': 'application/json',
                    'x-csrf-token': loginPayload.csrfToken,
                },
                body: JSON.stringify({ text: 'Hello', targetLanguage: 'zh-TW' }),
            }),
            runtimeEnv,
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            ok: true,
            translation: 'dashboard result',
            inputTokens: 8,
            outputTokens: 3,
            cached: false,
            fallback: false,
        });
        expect(runtimeEnv.usageWrites).toHaveLength(1);
    });

    it('defers translation and edits the interaction response', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({ choices: [{ message: { content: '你好世界' } }] }),
            )
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        let task: Promise<unknown> | undefined;

        const response = await handleInteraction(
            {
                type: 2,
                application_id: 'app-id',
                token: 'interaction-token',
                guild_id: 'guild-id',
                locale: 'en-US',
                user: { id: 'user-id' },
                data: {
                    type: 1,
                    name: 'translate',
                    options: [
                        { name: 'text', value: 'Hello world' },
                        { name: 'to', value: 'zh-TW' },
                        { name: 'visibility', value: 'private' },
                    ],
                },
            },
            env({
                TRANSLATION_PROVIDER: 'openai',
                OPENAI_API_KEY: 'key',
                OPENAI_BASE_URL: 'https://api.example',
                OPENAI_MODEL: 'model',
                ALLOWED_GUILD_IDS: 'guild-id',
            }),
            { waitUntil: (promise) => (task = promise) },
        );

        expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
        await task;
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            'https://discord.com/api/v10/webhooks/app-id/interaction-token/messages/@original',
            expect.objectContaining({ method: 'PATCH' }),
        );
    });

    it('reuses D1 cached translations without another provider call', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({ choices: [{ message: { content: '你好世界' } }] }),
            )
            .mockResolvedValue(new Response(null, { status: 204 }));
        const runtimeEnv = env({
            TRANSLATION_PROVIDER: 'openai',
            OPENAI_API_KEY: 'key',
            OPENAI_BASE_URL: 'https://api.example',
            OPENAI_MODEL: 'model',
            ALLOWED_GUILD_IDS: 'guild-id',
        });
        const interaction = {
            type: 2,
            application_id: 'app-id',
            token: 'interaction-token',
            guild_id: 'guild-id',
            locale: 'en-US',
            user: { id: 'user-id' },
            data: {
                type: 1,
                name: 'translate',
                options: [
                    { name: 'text', value: 'Hello world' },
                    { name: 'to', value: 'zh-TW' },
                    { name: 'visibility', value: 'private' },
                ],
            },
        };

        for (let index = 0; index < 2; index++) {
            let task: Promise<unknown> | undefined;
            await handleInteraction(interaction, runtimeEnv, {
                waitUntil: (promise) => (task = promise),
            });
            await task;
        }

        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            1,
            'https://api.example/v1/chat/completions',
            expect.any(Object),
        );
    });

    it('falls back to the secondary configured provider', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
            .mockResolvedValueOnce(
                Response.json({ choices: [{ message: { content: 'fallback result' } }] }),
            )
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        let task: Promise<unknown> | undefined;

        const runtimeEnv = env({
            TRANSLATION_PROVIDER: 'vertex+openai',
            VERTEX_AI_API_KEY: 'vertex-key',
            GCP_PROJECT: 'project',
            OPENAI_API_KEY: 'openai-key',
            OPENAI_BASE_URL: 'https://api.example',
            OPENAI_MODEL: 'model',
            ALLOWED_GUILD_IDS: 'guild-id',
        });
        await handleInteraction(
            {
                type: 2,
                application_id: 'app-id',
                token: 'interaction-token',
                guild_id: 'guild-id',
                locale: 'en-US',
                user: { id: 'fallback-user' },
                data: {
                    type: 1,
                    name: 'translate',
                    options: [
                        { name: 'text', value: 'Hello world' },
                        { name: 'to', value: 'zh-TW' },
                        { name: 'visibility', value: 'private' },
                    ],
                },
            },
            runtimeEnv,
            { waitUntil: (promise) => (task = promise) },
        );
        await task;

        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            2,
            'https://api.example/v1/chat/completions',
            expect.any(Object),
        );
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            3,
            'https://discord.com/api/v10/webhooks/app-id/interaction-token/messages/@original',
            expect.objectContaining({
                body: JSON.stringify({ content: 'fallback result' }),
            }),
        );
        const metricWrites = runtimeEnv.queries.filter((query) =>
            query.includes('INSERT INTO runtime_metrics'),
        );
        expect(metricWrites).toHaveLength(1);
        expect(metricWrites[0]).toContain('vertex_failure_total');
        expect(metricWrites[0]).toContain('openai_success_total');
    });

    it('denies translation when the allowlist is empty', async () => {
        const waitUntil = vi.fn();
        const response = await handleInteraction(
            {
                type: 2,
                application_id: 'app-id',
                token: 'interaction-token',
                guild_id: 'guild-id',
                user: { id: 'user-id' },
                data: {
                    type: 1,
                    name: 'translate',
                    options: [{ name: 'text', value: 'Hello world' }],
                },
            },
            env(),
            { waitUntil },
        );

        expect(await response.json()).toEqual({
            type: 4,
            data: { content: 'This server is not authorized.', flags: 64 },
        });
        expect(waitUntil).not.toHaveBeenCalled();
    });

    it('blocks an estimated translation that reaches the daily budget', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        let task: Promise<unknown> | undefined;
        const response = await handleInteraction(
            {
                type: 2,
                application_id: 'app-id',
                token: 'interaction-token',
                guild_id: 'guild-id',
                user: { id: 'user-id' },
                data: {
                    type: 1,
                    name: 'translate',
                    options: [
                        { name: 'text', value: 'Hello world' },
                        { name: 'to', value: 'zh-TW' },
                        { name: 'visibility', value: 'private' },
                    ],
                },
            },
            env({
                TRANSLATION_PROVIDER: 'openai',
                OPENAI_API_KEY: 'key',
                OPENAI_BASE_URL: 'https://api.example',
                OPENAI_MODEL: 'model',
                ALLOWED_GUILD_IDS: 'guild-id',
                OUTPUT_PRICE_PER_MILLION: '10',
                DAILY_BUDGET_USD: '0.001',
            }),
            { waitUntil: (promise) => (task = promise) },
        );

        expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
        await task;
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://discord.com/api/v10/webhooks/app-id/interaction-token/messages/@original',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ content: 'Daily budget exceeded' }),
            }),
        );
    });

    it('sends public translations through a user-styled channel webhook', async () => {
        globalThis.fetch = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({
                    choices: [{ message: { content: '你好世界' } }],
                    usage: { prompt_tokens: 10, completion_tokens: 4 },
                }),
            )
            .mockResolvedValueOnce(
                Response.json([
                    {
                        id: 'webhook-id',
                        name: 'Babel',
                        token: 'webhook-token',
                        user: { id: 'app-id' },
                    },
                ]),
            )
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        let task: Promise<unknown> | undefined;
        const response = await handleInteraction(
            {
                type: 2,
                application_id: 'app-id',
                token: 'interaction-token',
                guild_id: 'guild-id',
                channel_id: 'channel-id',
                locale: 'en-US',
                member: {
                    nick: 'Display Name',
                    user: { id: 'user-id', username: 'username', avatar: 'avatar-hash' },
                },
                data: {
                    type: 1,
                    name: 'translate',
                    options: [
                        { name: 'text', value: 'Hello world' },
                        { name: 'to', value: 'zh-TW' },
                    ],
                },
            },
            env({
                TRANSLATION_PROVIDER: 'openai',
                OPENAI_API_KEY: 'key',
                OPENAI_BASE_URL: 'https://api.example',
                OPENAI_MODEL: 'model',
                DISCORD_BOT_TOKEN: 'bot-token',
                ALLOWED_GUILD_IDS: 'guild-id',
            }),
            { waitUntil: (promise) => (task = promise) },
        );

        expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
        await task;
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            3,
            'https://discord.com/api/v10/webhooks/webhook-id/webhook-token?wait=true',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    content: '你好世界',
                    username: 'Display Name',
                    avatar_url:
                        'https://cdn.discordapp.com/avatars/user-id/avatar-hash.png?size=128',
                    allowed_mentions: { parse: [] },
                }),
            }),
        );
        expect(globalThis.fetch).toHaveBeenNthCalledWith(
            4,
            'https://discord.com/api/v10/webhooks/app-id/interaction-token/messages/@original',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });
});
