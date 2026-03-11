import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { store } from './store.js';
import { translate } from './translate.js';
import { TranslationCache } from './cache.js';
import { CooldownManager } from './cooldown.js';
import { TranslationLog } from './log.js';
import { usage } from './usage.js';
import { startDashboard } from './dashboard.js';

// --- State ---
const cache = new TranslationCache(store.get('cacheMaxSize'));
const cooldown = new CooldownManager(store.get('cooldownSeconds'));
const log = new TranslationLog();
let totalTranslations = 0;
let apiCalls = 0;

// --- Discord Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
    console.log(`✅ ${c.user.tag} is online`);
    startDashboard({
        cache,
        cooldown,
        log,
        client,
        getStats: () => ({ totalTranslations, apiCalls }),
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    // --- /setlang command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'setlang') {
        const lang = interaction.options.getString('language');
        const prefs = store.get('userLanguagePrefs') || {};

        if (lang === 'auto') {
            delete prefs[interaction.user.id];
            store.set('userLanguagePrefs', prefs);
            return interaction.reply({
                content: '✅ Language preference cleared. Will use your Discord locale automatically.',
                ephemeral: true,
            });
        }

        prefs[interaction.user.id] = lang;
        store.set('userLanguagePrefs', prefs);
        return interaction.reply({
            content: `✅ Translation target set to: **${lang}**`,
            ephemeral: true,
        });
    }

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
    if (!allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({
            content: '⛔ This server is not authorized.\n此伺服器未授權使用翻譯。',
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

    // --- Resolve target language ---
    const userPrefs = store.get('userLanguagePrefs') || {};
    const targetLanguage = userPrefs[interaction.user.id] || localeToLang(interaction.locale) || 'auto';

    // --- Defer + translate ---
    await interaction.deferReply({ ephemeral: true });
    cooldown.set(interaction.user.id);
    totalTranslations++;

    try {
        // Cache key includes language to store per-language translations
        const cacheKey = `${interaction.targetMessage.id}:${targetLanguage}`;
        let translated = cache.get(cacheKey);
        const cached = !!translated;

        if (!translated) {
            const result = await translate(content, targetLanguage);
            translated = result.text;
            cache.set(cacheKey, translated);
            usage.record(result.inputTokens, result.outputTokens);
            apiCalls++;
        }

        // Log the translation
        log.add({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            contentPreview: content,
            cached,
        });

        // Format: original (truncated) + translation
        const original = content.length > 200 ? content.slice(0, 200) + '…' : content;
        const reply = `> ${original.replace(/\n/g, '\n> ')}\n\n${translated}`;
        await interaction.editReply({ content: reply });
    } catch (error) {
        console.error('[Translate]', error.message);
        await interaction.editReply({
            content: `翻譯失敗 / Translation failed: ${error.message}`,
        });
    }
});

/**
 * Map Discord locale code to a short language code.
 * Returns null for locales that should use the default auto-detect.
 */
function localeToLang(locale) {
    if (!locale) return null;
    // If it's a Chinese or English locale, use auto-detect (default behavior)
    if (locale.startsWith('zh') || locale.startsWith('en')) return null;
    // For other locales, extract the base language code
    return locale.split('-')[0];
}

// Cleanup expired cooldowns every minute
setInterval(() => cooldown.cleanup(), 60_000);

// --- Start ---
client.login(config.discordToken);
