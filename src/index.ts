import { Client, Events, GatewayIntentBits, type TextChannel, type Webhook } from 'discord.js';
import { AppMetrics } from './shared/app-metrics.js';
import { config } from './modules/config/config.js';
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
import type { BotStats } from './types.js';
import type express from 'express';
import type http from 'http';

const runtimeConfig = configRepository.getRuntimeConfig();
const cache = new TranslationCache(runtimeConfig.cacheMaxSize);
const cooldown = new CooldownManager(runtimeConfig.cooldownSeconds);
const log = new TranslationLog();
const stats: BotStats = { totalTranslations: 0, apiCalls: 0 };
const metrics = new AppMetrics();
const runtimeLimiter = new TranslationRuntimeLimiter();
const translationService = createTranslationService({ cache, cooldown, log, stats, metrics, runtimeLimiter });
const startupLogger = appLogger.child({ component: 'startup' });

startupLogger.info('translation.runtime_limits.configured', {
    runtime: runtimeLimiter.snapshot(),
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let dashboardApp: express.Express | null = null;
let dashboardServer: http.Server | null = null;

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

const webhookCache = new Map<string, Webhook>();

async function getOrCreateWebhook(channel: TextChannel, forceRefresh: boolean = false): Promise<Webhook> {
    if (forceRefresh) {
        webhookCache.delete(channel.id);
    }

    const cached = webhookCache.get(channel.id);
    if (cached) return cached;

    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find((w) => w.name === 'Babel' && w.owner?.id === channel.client.user.id);

    if (!webhook) {
        webhook = await channel.createWebhook({ name: 'Babel', reason: 'Babel /translate public output' });
    }

    webhookCache.set(channel.id, webhook);
    return webhook;
}

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
            case 'setlang':
                return handleSetlang(interaction);
            case 'translate':
                return handleTranslate(interaction, { translationService, getOrCreateWebhook, metrics });
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
