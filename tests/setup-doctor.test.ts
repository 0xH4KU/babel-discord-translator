import { describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, type Client } from 'discord.js';
import { getCommandsForProfile } from '../src/apps/commands.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import { runSetupDoctor } from '../src/modules/dashboard/setup-doctor.js';
import type { StoreData } from '../src/shared/types.js';

const baseConfig = {
    vertexAiApiKey: 'vertex-key',
    gcpProject: 'project',
    gcpLocation: 'global',
    geminiModel: 'gemini-2.5-flash-lite',
    allowedGuildIds: [],
    allowedUserIds: [],
    cooldownSeconds: 5,
    cacheMaxSize: 100,
    setupComplete: true,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.2,
    dailyBudgetUsd: 1,
    defaultUserDailyBudgetUsd: 1,
    translationPrompt: '',
    maxInputLength: 2000,
    maxOutputTokens: 1000,
    translationMaxConcurrent: 2,
    translationMaxGlobalQueue: 10,
    translationMaxGuildQueue: 5,
    translationMaxUserOutstanding: 1,
    translationMaxQueueWaitMs: 30000,
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    translationProvider: 'vertex',
    tokenUsage: null,
    usageHistory: [],
    userLanguagePrefs: {},
    userLanguagePreferenceEntries: [],
    guildBudgets: {},
    guildTokenUsage: {},
    guildUsageHistory: {},
    userBudgets: {},
    userTokenUsage: {},
    userUsageHistory: {},
} satisfies StoreData;

function configStore(overrides: Partial<StoreData> = {}) {
    const cfg = { ...baseConfig, ...overrides };
    return {
        getDashboardConfig: () => cfg,
        getRuntimeConfig: () => cfg,
        isSetupComplete: () => cfg.setupComplete,
    };
}

function client(user: unknown = { id: 'bot-1', tag: 'Babel#1234' }): Client {
    return {
        user,
        guilds: {
            cache: {
                size: 0,
                values: function* () {},
            },
        },
    } as unknown as Client;
}

function clientWithGuilds(guilds: unknown[]): Client {
    return {
        user: { id: 'bot-1', tag: 'Babel#1234' },
        guilds: {
            cache: {
                size: guilds.length,
                values: function* () {
                    yield* guilds;
                },
            },
        },
    } as unknown as Client;
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function registeredCommandsFetch(profile = BABEL_GUILD_PROFILE) {
    return vi.fn(async () =>
        response(
            getCommandsForProfile(profile).map((command, index) => ({
                id: String(index),
                name: command.name,
            })),
        ),
    );
}

describe('runSetupDoctor', () => {
    it('returns ok with warnings when only unlimited budgets and webhook inspection are skipped', async () => {
        const expectedCommands = getCommandsForProfile(BABEL_GUILD_PROFILE);
        const fetchFn = vi.fn(async () =>
            response(
                expectedCommands.map((command, index) => ({
                    id: String(index),
                    name: command.name,
                })),
            ),
        );

        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: configStore({ dailyBudgetUsd: 0 }),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn,
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(true);
        expect(report.checks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'discord', status: 'pass' }),
                expect.objectContaining({ id: 'commands', status: 'pass' }),
                expect.objectContaining({ id: 'provider-vertex', status: 'pass' }),
                expect.objectContaining({ id: 'provider-openai', status: 'skipped' }),
                expect.objectContaining({ id: 'sqlite', status: 'pass' }),
                expect.objectContaining({ id: 'budget', status: 'warn' }),
                expect.objectContaining({ id: 'webhook', status: 'skipped' }),
            ]),
        );
    });

    it('returns display titles for every check row', async () => {
        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: configStore({ dailyBudgetUsd: 0 }),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn: registeredCommandsFetch(),
            sqliteProbe: vi.fn(),
        });

        expect(report.checks.every((check) => typeof check.title === 'string')).toBe(true);
        expect(report.checks.map((check) => check.title)).toContain('Discord');
    });

    it('fails the report when an expected command is missing', async () => {
        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: configStore(),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn: vi.fn(async () => response([{ id: '1', name: 'Babel' }])),
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'commands',
                status: 'fail',
                action: expect.stringContaining('npm run register'),
            }),
        );
    });

    it('skips command checks when registration env is missing', async () => {
        const fetchFn = vi.fn();

        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: configStore(),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: {},
            fetchFn,
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(true);
        expect(fetchFn).not.toHaveBeenCalled();
        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'commands',
                status: 'skipped',
                action: expect.stringContaining('registration env'),
            }),
        );
    });

    it('can require profile-specific registration env for a single profile', async () => {
        const fetchFn = registeredCommandsFetch();

        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            requireProfileSpecificRegistrationEnv: true,
            client: client(),
            configStore: configStore(),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn,
            sqliteProbe: vi.fn(),
        });

        expect(fetchFn).not.toHaveBeenCalled();
        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'commands',
                status: 'skipped',
            }),
        );
    });

    it('keeps running later checks when SQLite probe fails', async () => {
        const report = await runSetupDoctor({
            profile: BABEL_POCKET_PROFILE,
            profiles: [BABEL_POCKET_PROFILE],
            client: client(),
            configStore: configStore({
                translationProvider: 'openai',
                openaiApiKey: 'key',
                openaiBaseUrl: 'https://api.example.test',
                openaiModel: 'model',
            }),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: {},
            fetchFn: vi.fn(),
            sqliteProbe: vi.fn(() => {
                throw new Error('readonly database');
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toContainEqual(
            expect.objectContaining({ id: 'sqlite', status: 'fail' }),
        );
        expect(report.checks).toContainEqual(
            expect.objectContaining({ id: 'budget', status: 'pass' }),
        );
        expect(report.checks).toContainEqual(
            expect.objectContaining({ id: 'webhook', status: 'skipped' }),
        );
    });

    it('fails provider checks when readiness configuration fails', async () => {
        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: {
                ...configStore(),
                getRuntimeConfig: () => {
                    throw new Error('runtime config unavailable');
                },
            },
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn: registeredCommandsFetch(),
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'provider-vertex',
                status: 'fail',
                error: 'runtime config unavailable',
            }),
        );
    });

    it('fails webhook check when a cached channel denies Manage Webhooks', async () => {
        const channelHas = vi.fn(() => false);
        const permissionsFor = vi.fn(() => ({ has: channelHas }));
        const guildPermissionHas = vi.fn(() => true);

        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: clientWithGuilds([
                {
                    name: 'Guild One',
                    members: { me: { permissions: { has: guildPermissionHas } } },
                    channels: {
                        cache: {
                            values: function* () {
                                yield { name: 'blocked-channel', permissionsFor };
                            },
                        },
                    },
                },
            ]),
            configStore: configStore(),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn: registeredCommandsFetch(),
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'webhook',
                status: 'fail',
                detail: expect.stringContaining('blocked-channel'),
            }),
        );
        expect(permissionsFor).toHaveBeenCalledWith('bot-1');
        expect(channelHas).toHaveBeenCalledWith(PermissionFlagsBits.ManageWebhooks);
    });

    it('checks only the first cached webhook channel with inspectable permissions', async () => {
        const allowedHas = vi.fn(() => true);
        const blockedHas = vi.fn(() => false);
        const allowedPermissionsFor = vi.fn(() => ({ has: allowedHas }));
        const blockedPermissionsFor = vi.fn(() => ({ has: blockedHas }));

        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: clientWithGuilds([
                {
                    name: 'Guild One',
                    channels: {
                        cache: {
                            values: function* () {
                                yield { name: 'allowed-channel', permissionsFor: allowedPermissionsFor };
                                yield { name: 'blocked-channel', permissionsFor: blockedPermissionsFor };
                            },
                        },
                    },
                },
            ]),
            configStore: configStore(),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn: registeredCommandsFetch(),
            sqliteProbe: vi.fn(),
        });

        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'webhook',
                status: 'pass',
                detail: expect.stringContaining('allowed-channel'),
            }),
        );
        expect(allowedPermissionsFor).toHaveBeenCalledWith('bot-1');
        expect(blockedPermissionsFor).not.toHaveBeenCalled();
    });
});
