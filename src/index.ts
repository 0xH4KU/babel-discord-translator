import { Client, Events, GatewayIntentBits } from 'discord.js';
import { AppMetrics } from './shared/app-metrics.js';
import { loadConfig } from './modules/config/config.js';
import { TranslationCache } from './modules/translation/cache.js';
import { CooldownManager } from './modules/translation/cooldown.js';
import { TranslationLog } from './shared/log.js';
import { createDashboardApp, startDashboardServer } from './modules/dashboard/dashboard.js';
import { configRepository } from './modules/config/config-repository.js';
import { createGracefulShutdownHandler } from './shared/shutdown.js';
import { createTranslationService } from './modules/translation/translation-service.js';
import { handleBabel } from './commands/babel.js';
import { handleTranslate } from './commands/translate.js';
import { handleSetlang, handleMylang } from './commands/setlang.js';
import { handleHelp } from './commands/help.js';
import { closeSqliteDatabase } from './persistence/sqlite-database.js';
import { appLogger } from './shared/structured-logger.js';
import { TranslationRuntimeLimiter } from './modules/translation/translation-runtime-limiter.js';
import { createWebhookService } from './modules/translation/webhook-service.js';
import type { BotStats } from './types.js';
import type express from 'express';
import type http from 'http';

const startupLogger = appLogger.child({ component: 'startup' });

// --- Global error handlers ---

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
    // Exit after logging — uncaught exceptions leave the process in an undefined state
    process.exit(1);
});

const config = (() => {
    try {
        return loadConfig();
    } catch {
        process.exit(1);
    }
})();

const runtimeConfig = configRepository.getRuntimeConfig();
const cache = new TranslationCache(runtimeConfig.cacheMaxSize);
const cooldown = new CooldownManager(runtimeConfig.cooldownSeconds);
const log = new TranslationLog();
const stats: BotStats = { totalTranslations: 0, apiCalls: 0 };
const metrics = new AppMetrics();
const runtimeLimiter = new TranslationRuntimeLimiter();
const translationService = createTranslationService({
    cache,
    cooldown,
    log,
    stats,
    metrics,
    runtimeLimiter,
});
const webhookService = createWebhookService({ metrics });

startupLogger.info('translation.runtime_limits.configured', {
    runtime: runtimeLimiter.snapshot(),
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let dashboardApp: express.Express | null = null;
let dashboardServer: http.Server | null = null;

// --- Discord events ---

client.once(Events.ClientReady, (c) => {
    startupLogger.info('discord.client.ready', {
        botTag: c.user.tag,
        botUserId: c.user.id,
    });

    dashboardApp = createDashboardApp({
        cache,
        cooldown,
        log,
        client,
        getStats: () => stats,
        metrics,
        runtimeLimiter,
    });
    dashboardServer = startDashboardServer(dashboardApp, config.dashboardPort);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
            case 'setlang':
                return handleSetlang(interaction);
            case 'translate':
                return handleTranslate(interaction, { translationService, webhookService });
            case 'help':
                return handleHelp(interaction);
            case 'mylang':
                return handleMylang(interaction);
        }
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Babel') {
        return handleBabel(interaction, { translationService });
    }
});

const cooldownInterval = setInterval(() => cooldown.cleanup(), 60_000);

const shutdown = createGracefulShutdownHandler({
    client,
    getDashboardApp: () => dashboardApp,
    getDashboardServer: () => dashboardServer,
    timers: [cooldownInterval],
    cleanupTasks: [closeSqliteDatabase],
});

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

client.login(config.discordToken).catch((error) => {
    startupLogger.error('discord.login.failed', {
        error: (error as Error).message,
    });
    process.exit(1);
});
