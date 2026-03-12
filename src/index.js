import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { store } from './store.js';
import { TranslationCache } from './cache.js';
import { CooldownManager } from './cooldown.js';
import { TranslationLog } from './log.js';
import { startDashboard } from './dashboard.js';
import { handleBabel } from './commands/babel.js';
import { handleTranslate } from './commands/translate.js';
import { handleSetlang, handleMylang } from './commands/setlang.js';
import { handleHelp } from './commands/help.js';

// --- State ---
const cache = new TranslationCache(store.get('cacheMaxSize'));
const cooldown = new CooldownManager(store.get('cooldownSeconds'));
const log = new TranslationLog();
const stats = { totalTranslations: 0, apiCalls: 0 };

// --- Discord Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
    console.log(` ${c.user.tag} is online`);
    startDashboard({
        cache,
        cooldown,
        log,
        client,
        getStats: () => stats,
    });
});

// --- Webhook management for /translate ---
/** @type {Map<string, import('discord.js').Webhook>} channelId → Webhook */
const webhookCache = new Map();

/**
 * Get or create a Babel webhook for a channel.
 * @param {import('discord.js').TextChannel} channel
 * @param {boolean} [forceRefresh=false] - Clear cached webhook and re-fetch
 * @returns {Promise<import('discord.js').Webhook>}
 */
async function getOrCreateWebhook(channel, forceRefresh = false) {
    if (forceRefresh) {
        webhookCache.delete(channel.id);
    }

    const cached = webhookCache.get(channel.id);
    if (cached) return cached;

    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === 'Babel' && w.owner?.id === channel.client.user.id);

    if (!webhook) {
        webhook = await channel.createWebhook({ name: 'Babel', reason: 'Babel /translate public output' });
    }

    webhookCache.set(channel.id, webhook);
    return webhook;
}

// --- Interaction handler ---
client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
            case 'setlang':
                return handleSetlang(interaction);
            case 'translate':
                return handleTranslate(interaction, { cache, cooldown, log, getOrCreateWebhook, stats });
            case 'help':
                return handleHelp(interaction);
            case 'mylang':
                return handleMylang(interaction);
        }
    }

    if (interaction.isMessageContextMenuCommand() && interaction.commandName === 'Babel') {
        return handleBabel(interaction, { cache, cooldown, log, stats });
    }
});

// Cleanup expired cooldowns every minute
const cooldownInterval = setInterval(() => cooldown.cleanup(), 60_000);

// --- Graceful shutdown ---
async function shutdown(signal) {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);
    clearInterval(cooldownInterval);
    client.destroy();
    console.log('[Shutdown] Discord client destroyed');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Start ---
client.login(config.discordToken);
