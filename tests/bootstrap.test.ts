import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';

const mocks = vi.hoisted(() => {
    const client = {
        once: vi.fn(),
        on: vi.fn(),
        login: vi.fn(async () => undefined),
        destroy: vi.fn(),
    };

    return {
        client,
        createTranslationService: vi.fn(() => ({ process: vi.fn() })),
        createDashboardApp: vi.fn(),
        startDashboardServer: vi.fn(),
        createWebhookService: vi.fn(() => ({ sendTranslation: vi.fn() })),
        loadConfig: vi.fn(() => ({
            discordToken: 'test-token',
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
        return mocks.client;
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
        mocks.client.login.mockResolvedValue(undefined);
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
});
