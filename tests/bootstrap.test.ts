import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';

const mocks = vi.hoisted(() => {
    const clients: Array<{
        once: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        login: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
    }> = [];

    const createClient = () => {
        const client = {
            once: vi.fn(),
            on: vi.fn(),
            login: vi.fn(async () => undefined),
            destroy: vi.fn(),
        };
        clients.push(client);
        return client;
    };

    return {
        clients,
        createClient,
        createTranslationService: vi.fn(() => ({ process: vi.fn() })),
        createDashboardApp: vi.fn(),
        startDashboardServer: vi.fn(),
        createWebhookService: vi.fn(() => ({ sendTranslation: vi.fn() })),
        loadConfig: vi.fn(() => ({
            discordToken: 'test-token',
            discordTokens: {
                'babel-guild': 'guild-token',
                'babel-pocket': 'pocket-token',
            },
            dashboardPort: 0,
            dashboardHost: '127.0.0.1',
            dashboardPassword: 'test-password',
        })),
        getRuntimeConfig: vi.fn(() => ({
            cooldownSeconds: 0,
            cacheMaxSize: 100,
            translationMaxConcurrent: 4,
            translationMaxGlobalQueue: 25,
            translationMaxGuildQueue: 5,
            translationMaxUserOutstanding: 1,
            translationMaxQueueWaitMs: 30000,
        })),
        createGracefulShutdownHandler: vi.fn(() => vi.fn(async () => undefined)),
        closeSqliteDatabase: vi.fn(),
        getSqliteDatabase: vi.fn(() => ({
            prepare: vi.fn(() => ({
                all: vi.fn(() => []),
            })),
        })),
    };
});

vi.mock('discord.js', () => ({
    Client: vi.fn(function Client() {
        return mocks.createClient();
    }),
    Events: {
        ClientReady: 'ready',
        InteractionCreate: 'interactionCreate',
    },
    GatewayIntentBits: {
        Guilds: 1,
    },
    MessageFlags: {
        Ephemeral: 64,
    },
    Options: {
        DefaultMakeCacheSettings: {},
        cacheWithLimits: vi.fn((settings: unknown) => settings),
    },
}));

vi.mock('../src/modules/config/config.js', () => ({
    loadConfig: mocks.loadConfig,
}));

vi.mock('../src/modules/config/config-repository.js', () => ({
    configRepository: {
        getRuntimeConfig: mocks.getRuntimeConfig,
    },
}));

vi.mock('../src/modules/translation/translation-service.js', () => ({
    createTranslationService: mocks.createTranslationService,
}));

vi.mock('../src/modules/dashboard/dashboard.js', () => ({
    createDashboardApp: mocks.createDashboardApp,
    startDashboardServer: mocks.startDashboardServer,
}));

vi.mock('../src/modules/translation/webhook-service.js', () => ({
    createWebhookService: mocks.createWebhookService,
}));

vi.mock('../src/commands/babel.js', () => ({
    handleBabel: vi.fn(),
}));

vi.mock('../src/commands/translate.js', () => ({
    handleTranslate: vi.fn(),
}));

vi.mock('../src/commands/setlang.js', () => ({
    handleSetlang: vi.fn(),
    handleMylang: vi.fn(),
}));

vi.mock('../src/commands/help.js', () => ({
    handleHelp: vi.fn(),
}));

vi.mock('../src/shared/shutdown.js', () => ({
    createGracefulShutdownHandler: mocks.createGracefulShutdownHandler,
}));

vi.mock('../src/persistence/sqlite-database.js', () => ({
    closeSqliteDatabase: mocks.closeSqliteDatabase,
    getSqliteDatabase: mocks.getSqliteDatabase,
}));

describe('startBabelApp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clients.length = 0;
    });

    it('passes the profile guild glossary capability to the translation service', async () => {
        const { startBabelApp } = await import('../src/apps/bootstrap.js');

        await startBabelApp(BABEL_POCKET_PROFILE);

        expect(mocks.createTranslationService).toHaveBeenCalledWith(
            expect.objectContaining({
                accessMode: 'user-install',
                enableGuildGlossary: false,
            }),
        );
    });

    it('logs in the selected single profile with its profile-specific token when present', async () => {
        const { startBabelApp } = await import('../src/apps/bootstrap.js');

        await startBabelApp(BABEL_POCKET_PROFILE);

        expect(mocks.clients).toHaveLength(1);
        expect(mocks.clients[0]!.login).toHaveBeenCalledWith('pocket-token');
    });

    it('starts multiple profiles as separate Discord clients sharing one dashboard runtime', async () => {
        const { startBabelApps } = await import('../src/apps/bootstrap.js');

        await startBabelApps([BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE]);

        expect(mocks.clients).toHaveLength(2);
        expect(mocks.clients[0]!.login).toHaveBeenCalledWith('guild-token');
        expect(mocks.clients[1]!.login).toHaveBeenCalledWith('pocket-token');
        expect(mocks.createTranslationService).toHaveBeenCalledTimes(2);
        expect(mocks.createGracefulShutdownHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                clients: mocks.clients,
            }),
        );
    });

    it('creates a combined dashboard once all selected Discord clients are ready', async () => {
        const { startBabelApps } = await import('../src/apps/bootstrap.js');

        await startBabelApps([BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE]);
        const readyCallbacks = mocks.clients.map((client) => client.once.mock.calls[0]![1]);
        readyCallbacks[0]!({
            user: { id: 'guild-bot', tag: 'Guild#0001' },
        });
        expect(mocks.createDashboardApp).not.toHaveBeenCalled();

        readyCallbacks[1]!({
            user: { id: 'pocket-bot', tag: 'Pocket#0001' },
        });

        expect(mocks.createDashboardApp).toHaveBeenCalledTimes(1);
        expect(mocks.startDashboardServer).toHaveBeenCalledTimes(1);
        expect(mocks.createDashboardApp).toHaveBeenCalledWith(
            expect.objectContaining({
                profile: BABEL_GUILD_PROFILE,
                profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
                client: mocks.clients[0],
                clients: {
                    'babel-guild': mocks.clients[0],
                    'babel-pocket': mocks.clients[1],
                },
            }),
        );
    });
});
