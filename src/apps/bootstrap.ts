import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { AppMetrics, createProfileMetricsCollector } from '../shared/app-metrics.js';
import { loadConfig } from '../modules/config/config.js';
import { TranslationCache } from '../modules/translation/cache.js';
import { CooldownManager } from '../modules/translation/cooldown.js';
import { TranslationLog } from '../shared/log.js';
import { createDashboardApp, startDashboardServer } from '../modules/dashboard/dashboard.js';
import { resolveDashboardMode } from '../modules/dashboard/dashboard-mode.js';
import { createHealthDashboardApp } from '../modules/dashboard/health-dashboard.js';
import { configRepository } from '../modules/config/config-repository.js';
import { createGracefulShutdownHandler } from '../shared/shutdown.js';
import { createTranslationService } from '../modules/translation/translation-service.js';
import { handleBabel } from '../commands/babel.js';
import { handleTranslate } from '../commands/translate.js';
import { handleSetlang, handleMylang } from '../commands/setlang.js';
import { handleHelp } from '../commands/help.js';
import { closeSqliteDatabase } from '../persistence/sqlite-database.js';
import { appLogger } from '../shared/structured-logger.js';
import { TranslationRuntimeLimiter } from '../modules/translation/translation-runtime-limiter.js';
import { createWebhookService } from '../modules/translation/webhook-service.js';
import { PendingUserInstallOwnerRepository } from '../modules/dashboard/pending-user-install-owner-repository.js';
import type { AppProfile } from './app-profile.js';
import type { TranslationService } from '../modules/translation/translation-service.js';
import type express from 'express';
import type http from 'http';

let processHandlersInstalled = false;

interface SharedBabelRuntime {
    config: ReturnType<typeof loadConfig>;
    cache: TranslationCache;
    log: TranslationLog;
    metrics: AppMetrics;
    runtimeLimiter: TranslationRuntimeLimiter;
}

interface ProfileBabelRuntime {
    profile: AppProfile;
    client: Client;
    cooldown: CooldownManager;
    translationService: TranslationService;
}

function installProcessErrorHandlers(): void {
    if (processHandlersInstalled) {
        return;
    }
    processHandlersInstalled = true;

    process.on('unhandledRejection', (reason) => {
        const errorLogger = appLogger.child({ component: 'process' });
        errorLogger.error('process.unhandled_rejection', {
            error: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
        });
    });

    process.on('uncaughtException', (error) => {
        const errorLogger = appLogger.child({ component: 'process' });
        errorLogger.error('process.uncaught_exception', {
            error: error.message,
            stack: error.stack,
        });
        process.exit(1);
    });
}

export async function startBabelApp(profile: AppProfile): Promise<void> {
    await startBabelApps([profile]);
}

function createSharedRuntime(): SharedBabelRuntime {
    const config = (() => {
        try {
            return loadConfig();
        } catch {
            process.exit(1);
        }
    })();

    const runtimeConfig = configRepository.getRuntimeConfig();

    return {
        config,
        cache: new TranslationCache(runtimeConfig.cacheMaxSize),
        log: new TranslationLog(),
        metrics: new AppMetrics(),
        runtimeLimiter: new TranslationRuntimeLimiter({
            maxConcurrent: runtimeConfig.translationMaxConcurrent,
            maxGlobalQueue: runtimeConfig.translationMaxGlobalQueue,
            maxGuildQueue: runtimeConfig.translationMaxGuildQueue,
            maxUserOutstanding: runtimeConfig.translationMaxUserOutstanding,
            maxQueueWaitMs: runtimeConfig.translationMaxQueueWaitMs,
        }),
    };
}

function createDiscordClient(): Client {
    // Commands read users/members from the interaction payload, never from these
    // caches, so they can stay tiny — only guild/channel/role caches (defaults)
    // are needed for webhook output and the dashboard guild list.
    return new Client({
        intents: [GatewayIntentBits.Guilds],
        makeCache: Options.cacheWithLimits({
            ...Options.DefaultMakeCacheSettings,
            MessageManager: 0,
            ReactionManager: 0,
            PresenceManager: 0,
            GuildMemberManager: {
                maxSize: 100,
                keepOverLimit: (member) => member.id === member.client.user.id,
            },
            UserManager: {
                maxSize: 100,
                keepOverLimit: (user) => user.id === user.client.user.id,
            },
        }),
    });
}

function createProfileRuntime(
    profile: AppProfile,
    shared: SharedBabelRuntime,
): ProfileBabelRuntime {
    const runtimeConfig = configRepository.getRuntimeConfig();
    const cooldown = new CooldownManager(runtimeConfig.cooldownSeconds);
    const translationService = createTranslationService({
        cache: shared.cache,
        cooldown,
        log: shared.log,
        appProfileId: profile.id,
        metrics: shared.metrics,
        runtimeLimiter: shared.runtimeLimiter,
        accessMode: profile.accessMode,
        enableGuildGlossary: profile.enableGuildGlossary,
        pendingUserInstallOwnerRepository: profile.enableUserAccess
            ? new PendingUserInstallOwnerRepository()
            : undefined,
    });
    const webhookService = profile.enableWebhookOutput
        ? createWebhookService({
              metrics: createProfileMetricsCollector(shared.metrics, profile.id),
          })
        : null;

    const client = createDiscordClient();

    client.on(Events.InteractionCreate, async (interaction) => {
        if (interaction.isChatInputCommand()) {
            switch (interaction.commandName) {
                case 'setlang':
                    return handleSetlang(interaction, { profile });
                case 'translate':
                    if (profile.enableTranslateCommand && webhookService) {
                        return handleTranslate(interaction, { translationService, webhookService });
                    }
                    return;
                case 'help':
                    return handleHelp(interaction, { profile });
                case 'mylang':
                    return handleMylang(interaction, { profile });
            }
        }

        if (
            interaction.isMessageContextMenuCommand() &&
            interaction.commandName === profile.commandName
        ) {
            return handleBabel(interaction, { translationService, profile });
        }
    });

    return { profile, client, cooldown, translationService };
}

function resolveDiscordTokenForProfile(
    profile: AppProfile,
    config: SharedBabelRuntime['config'],
): string {
    return config.discordTokens[profile.id] || config.discordToken;
}

export async function startBabelApps(profiles: AppProfile[]): Promise<void> {
    installProcessErrorHandlers();

    const startupLogger = appLogger.child({
        component: 'startup',
        app: profiles.map((profile) => profile.id).join('+'),
    });

    const shared = createSharedRuntime();
    const dashboardMode = resolveDashboardMode();

    startupLogger.info('translation.runtime_limits.configured', {
        runtime: shared.runtimeLimiter.snapshot(),
    });

    const runtimes = profiles.map((profile) => createProfileRuntime(profile, shared));
    const primaryRuntime = runtimes[0];
    if (!primaryRuntime) {
        throw new Error('At least one Babel app profile is required');
    }

    let dashboardApp: express.Express | null = null;
    let dashboardServer: http.Server | null = null;
    const clientsByProfile = Object.fromEntries(
        runtimes.map((runtime) => [runtime.profile.id, runtime.client]),
    );
    const cooldownsByProfile = Object.fromEntries(
        runtimes.map((runtime) => [runtime.profile.id, runtime.cooldown]),
    );
    const translationServicesByProfile = Object.fromEntries(
        runtimes.map((runtime) => [runtime.profile.id, runtime.translationService]),
    );

    const discordReady = () => runtimes.every((runtime) => runtime.client.isReady());
    const startDashboard = () => {
        if (dashboardApp || dashboardServer) {
            return;
        }

        if (dashboardMode === 'off') {
            startupLogger.info('dashboard.server.skipped', { mode: dashboardMode });
            return;
        }

        if (dashboardMode === 'health-only') {
            dashboardApp = createHealthDashboardApp({
                cache: shared.cache,
                metrics: shared.metrics,
                runtimeLimiter: shared.runtimeLimiter,
                discordReady,
                host: shared.config.dashboardHost,
            });
            dashboardServer = startDashboardServer(
                dashboardApp,
                shared.config.dashboardPort,
                shared.config.dashboardHost,
            );
            return;
        }

        dashboardApp = createDashboardApp({
            cache: shared.cache,
            cooldown: primaryRuntime.cooldown,
            cooldowns: cooldownsByProfile,
            log: shared.log,
            client: primaryRuntime.client,
            clients: clientsByProfile,
            discordReady,
            metrics: shared.metrics,
            runtimeLimiter: shared.runtimeLimiter,
            profile: primaryRuntime.profile,
            profiles,
            host: shared.config.dashboardHost,
            translationService: primaryRuntime.translationService,
            translationServices: translationServicesByProfile,
        });
        dashboardServer = startDashboardServer(
            dashboardApp,
            shared.config.dashboardPort,
            shared.config.dashboardHost,
        );
    };

    for (const runtime of runtimes) {
        runtime.client.once(Events.ClientReady, (c) => {
            appLogger
                .child({ component: 'startup', app: runtime.profile.id })
                .info('discord.client.ready', {
                    botTag: c.user.tag,
                    botUserId: c.user.id,
                });
        });
    }

    startDashboard();

    const cooldownIntervals = runtimes.map((runtime) => {
        return setInterval(() => runtime.cooldown.cleanup(), 60_000);
    });

    const shutdown = createGracefulShutdownHandler({
        client: primaryRuntime.client,
        clients: runtimes.map((runtime) => runtime.client),
        getDashboardApp: () => dashboardApp,
        getDashboardServer: () => dashboardServer,
        timers: cooldownIntervals,
        cleanupTasks: [closeSqliteDatabase],
    });

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

    await Promise.all(
        runtimes.map(async (runtime) => {
            try {
                const token = resolveDiscordTokenForProfile(runtime.profile, shared.config);
                await runtime.client.login(token);
            } catch (error) {
                startupLogger.error('discord.login.failed', {
                    app: runtime.profile.id,
                    error: (error as Error).message,
                });
                process.exit(1);
            }
        }),
    );
}
