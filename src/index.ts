import { Client, Events, GatewayIntentBits, type TextChannel, type Webhook } from 'discord.js';
import { config } from './config.js';
import { TranslationCache } from './cache.js';
import { CooldownManager } from './cooldown.js';
import { TranslationLog } from './log.js';
import { createDashboardApp, startDashboardServer } from './dashboard.js';
import { configRepository } from './repositories/config-repository.js';
import { createGracefulShutdownHandler } from './shutdown.js';
import { createTranslationService } from './services/translation-service.js';
import { handleBabel } from './commands/babel.js';
import { handleTranslate } from './commands/translate.js';
import { handleSetlang, handleMylang } from './commands/setlang.js';
import { handleHelp } from './commands/help.js';
import type { BotStats } from './types.js';
import type express from 'express';
import type http from 'http';

const runtimeConfig = configRepository.getRuntimeConfig();
const cache = new TranslationCache(runtimeConfig.cacheMaxSize);
const cooldown = new CooldownManager(runtimeConfig.cooldownSeconds);
const log = new TranslationLog();
const stats: BotStats = { totalTranslations: 0, apiCalls: 0 };
const translationService = createTranslationService({ cache, cooldown, log, stats });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let dashboardApp: express.Express | null = null;
let dashboardServer: http.Server | null = null;

client.once(Events.ClientReady, (c) => {
    console.log(` ${c.user.tag} is online`);

    dashboardApp = createDashboardApp({
        cache,
        cooldown,
        log,
        client,
        getStats: () => stats,
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
                return handleTranslate(interaction, { translationService, getOrCreateWebhook });
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
});

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

client.login(config.discordToken).catch((error) => {
    console.error('[Startup] Failed to login to Discord:', error);
    process.exit(1);
});
