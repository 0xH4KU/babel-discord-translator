import { Client, Events } from 'discord.js';
import { config } from './config.js';
import { store } from './store.js';
import { translate } from './translate.js';
import { TranslationCache } from './cache.js';
import { CooldownManager } from './cooldown.js';
import { usage } from './usage.js';
import { startDashboard } from './dashboard.js';

// --- State ---
const cache = new TranslationCache(store.get('cacheMaxSize'));
const cooldown = new CooldownManager(store.get('cooldownSeconds'));
let totalTranslations = 0;
let apiCalls = 0;

// --- Discord Client ---
const client = new Client({ intents: [] });

client.once(Events.ClientReady, (c) => {
    console.log(`✅ ${c.user.tag} is online`);
    startDashboard({
        cache,
        cooldown,
        client,
        getStats: () => ({ totalTranslations, apiCalls }),
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isMessageContextMenuCommand()) return;
    if (interaction.commandName !== 'Translate / 翻譯') return;

    // --- Setup check ---
    if (!store.isSetupComplete()) {
        return interaction.reply({
            content: 'Bot not configured yet. Please complete setup in the dashboard.',
            ephemeral: true,
        });
    }

    // --- Whitelist check ---
    const allowedGuilds = store.get('allowedGuildIds');
    if (allowedGuilds.length > 0 && !allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({
            content: '⛔ This server is not authorized.',
            ephemeral: true,
        });
    }

    // --- Budget check ---
    if (usage.isBudgetExceeded()) {
        return interaction.reply({
            content: '已達每日預算上限，明天再試吧！\nDaily budget exceeded, try again tomorrow!',
            ephemeral: true,
        });
    }

    // --- Cooldown check ---
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        return interaction.reply({
            content: `冷卻中，請等 ${cd.remaining} 秒 / Please wait ${cd.remaining}s`,
            ephemeral: true,
        });
    }

    // --- No text content ---
    const content = interaction.targetMessage.content;
    if (!content?.trim()) {
        return interaction.reply({
            content: '沒有文字內容 / No text content',
            ephemeral: true,
        });
    }

    // --- Defer + translate ---
    await interaction.deferReply({ ephemeral: true });
    cooldown.set(interaction.user.id);
    totalTranslations++;

    try {
        let translated = cache.get(interaction.targetMessage.id);

        if (!translated) {
            const result = await translate(content);
            translated = result.text;
            cache.set(interaction.targetMessage.id, translated);
            usage.record(result.inputTokens, result.outputTokens);
            apiCalls++;
        }

        await interaction.editReply({ content: translated });
    } catch (error) {
        console.error('[Translate]', error.message);
        await interaction.editReply({
            content: `翻譯失敗 / Translation failed: ${error.message}`,
        });
    }
});

// Cleanup expired cooldowns every minute
setInterval(() => cooldown.cleanup(), 60_000);

// --- Start ---
client.login(config.discordToken);
