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

function env(overrides: Partial<WorkerEnv> = {}, firstResult: unknown = null): WorkerEnv {
    let cached: { translated_text: string; provider: string } | null = null;
    return {
        DB: {
            prepare: (query: string) => {
                let values: Array<string | number | null> = [];
                const statement: TestStatement = {
                    bind: (...bound) => {
                        values = bound;
                        return statement;
                    },
                    all: async <T>() => ({ results: [] as T[] }),
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
        ...overrides,
    };
}

function dashboardEnv(): WorkerEnv {
    const sessions = new Map<string, { expiry: number; csrf: string }>();
    const config = new Map<string, string>();
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
                        if (query.includes('SELECT 1 AS ok')) return { ok: 1 } as T;
                        return null;
                    },
                    run: async () => {
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
                { ok: 1 },
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

    it('serves static dashboard assets through the Worker binding', async () => {
        const assets = { fetch: vi.fn().mockResolvedValue(new Response('<html>dashboard</html>')) };
        const response = await worker.fetch(
            new Request('https://worker.example/'),
            env({ ASSETS: assets }),
            { waitUntil: vi.fn() },
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toContain('dashboard');
        expect(response.headers.get('x-frame-options')).toBe('DENY');
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
            env({
                TRANSLATION_PROVIDER: 'vertex+openai',
                VERTEX_AI_API_KEY: 'vertex-key',
                GCP_PROJECT: 'project',
                OPENAI_API_KEY: 'openai-key',
                OPENAI_BASE_URL: 'https://api.example',
                OPENAI_MODEL: 'model',
                ALLOWED_GUILD_IDS: 'guild-id',
            }),
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
