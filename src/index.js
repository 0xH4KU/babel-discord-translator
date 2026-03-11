import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
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
                flags: MessageFlags.Ephemeral,
            });
        }

        prefs[interaction.user.id] = lang;
        store.set('userLanguagePrefs', prefs);
        return interaction.reply({
            content: `✅ Translation target set to: **${lang}**`,
            flags: MessageFlags.Ephemeral,
        });
    }

    if (!interaction.isMessageContextMenuCommand()) return;
    if (interaction.commandName !== 'Translate / 翻譯') return;

    // --- Setup check ---
    if (!store.isSetupComplete()) {
        return interaction.reply({
            content: 'Bot not configured yet. Please complete setup in the dashboard.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Whitelist check ---
    const allowedGuilds = store.get('allowedGuildIds');
    if (!allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({
            content: '⛔ This server is not authorized.\n此伺服器未授權使用翻譯。',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Budget check ---
    if (usage.isBudgetExceeded()) {
        return interaction.reply({
            content: '已達每日預算上限，明天再試吧！\nDaily budget exceeded, try again tomorrow!',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Cooldown check ---
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        return interaction.reply({
            content: `冷卻中，請等 ${cd.remaining} 秒 / Please wait ${cd.remaining}s`,
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- No text content ---
    const content = interaction.targetMessage.content;
    if (!content?.trim()) {
        return interaction.reply({
            content: '沒有文字內容 / No text content',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Resolve target language ---
    const userPrefs = store.get('userLanguagePrefs') || {};
    const userPref = userPrefs[interaction.user.id];
    const localeLang = localeToLang(interaction.locale);
    const targetLanguage = userPref || localeLang || 'auto';
    const langSource = userPref ? 'setlang' : localeLang ? 'locale' : 'auto';
    console.log(`[Translate] user=${interaction.user.tag} lang=${targetLanguage} (from ${langSource}, locale=${interaction.locale})`);

    // --- Same-language check (skip redundant translations) ---
    if (isSameLanguage(content, targetLanguage, interaction.locale)) {
        console.log(`[Translate] Skipped: content already in target language`);
        return interaction.reply({
            content: '這條訊息已經是你的語言了，不需要翻譯 \nThis message is already in your language!',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Defer + translate ---
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    cooldown.set(interaction.user.id);
    totalTranslations++;

    try {
        // Cache key includes language to store per-language translations
        const cacheKey = `${interaction.targetMessage.id}:${targetLanguage}`;
        let translated = cache.get(cacheKey);
        const cached = !!translated;

        if (cached) {
            console.log(`[Translate] Cache HIT: ${cacheKey}`);
        } else {
            console.log(`[Translate] Cache MISS: ${cacheKey}, calling API...`);
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
            targetLanguage,
            langSource,
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

/**
 * Detect the dominant script of text content.
 * Returns: 'zh', 'ja', 'ko', 'ru', 'ar', 'th', 'hi', or null (Latin/unknown).
 */
function detectScript(text) {
    let cjk = 0, kana = 0, hangul = 0, cyrillic = 0, arabic = 0, thai = 0, devanagari = 0;

    for (const char of text) {
        const c = char.codePointAt(0);
        if (c >= 0x4e00 && c <= 0x9fff) cjk++;
        else if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff)) kana++;
        else if (c >= 0xac00 && c <= 0xd7af) hangul++;
        else if (c >= 0x0400 && c <= 0x04ff) cyrillic++;
        else if (c >= 0x0600 && c <= 0x06ff) arabic++;
        else if (c >= 0x0e00 && c <= 0x0e7f) thai++;
        else if (c >= 0x0900 && c <= 0x097f) devanagari++;
    }

    // Japanese = has kana (hiragana/katakana), may also have kanji
    if (kana > 0) return 'ja';
    if (hangul > 0) return 'ko';
    if (cjk > 0) return 'zh'; // Chinese (simplified & traditional treated the same)
    if (cyrillic > 0) return 'ru';
    if (arabic > 0) return 'ar';
    if (thai > 0) return 'th';
    if (devanagari > 0) return 'hi';

    return null; // Latin or unrecognizable — don't block
}

/**
 * Map a language code to its script family.
 */
function langToScript(lang) {
    if (!lang) return null;
    const map = {
        'zh-TW': 'zh', 'zh-CN': 'zh', zh: 'zh',
        ja: 'ja', ko: 'ko', ru: 'ru',
        ar: 'ar', th: 'th', hi: 'hi',
    };
    return map[lang] || map[lang.split('-')[0]] || null;
}

/**
 * Check if content is already in the user's target language.
 * Only checks non-Latin scripts (Chinese, Japanese, Korean, etc.)
 * since Latin-script languages can't be reliably distinguished.
 */
function isSameLanguage(content, targetLanguage, userLocale) {
    const contentScript = detectScript(content);
    if (!contentScript) return false; // Latin/unknown — let it through

    if (targetLanguage === 'auto') {
        // In auto mode, check against user's Discord locale
        const userScript = langToScript(userLocale);
        return contentScript === userScript;
    }

    // For explicit target, check if content matches target language's script
    return contentScript === langToScript(targetLanguage);
}

// Cleanup expired cooldowns every minute
setInterval(() => cooldown.cleanup(), 60_000);

// --- Start ---
client.login(config.discordToken);
