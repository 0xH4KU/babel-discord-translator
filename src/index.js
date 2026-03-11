import {
    Client, Events, GatewayIntentBits, MessageFlags,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
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

// In-memory map for button re-translations: shortId → { content, guildId }
// Cleaned up after 30 minutes to prevent memory leaks
const pendingRetranslations = new Map();
let retranslateCounter = 0;

function storeForRetranslate(content, guildId) {
    const id = (++retranslateCounter).toString(36);
    pendingRetranslations.set(id, { content, guildId, ts: Date.now() });
    return id;
}

// --- Flag emoji + language display name maps ---
const FLAG_MAP = {
    'zh-TW': '🇹🇼', 'zh-CN': '🇨🇳', zh: '🇨🇳',
    en: '🇬🇧', 'en-US': '🇺🇸', 'en-GB': '🇬🇧',
    ja: '🇯🇵', ko: '🇰🇷', es: '🇪🇸', fr: '🇫🇷',
    de: '🇩🇪', pt: '🇧🇷', ru: '🇷🇺', it: '🇮🇹',
    vi: '🇻🇳', th: '🇹🇭', ar: '🇸🇦', hi: '🇮🇳',
    id: '🇮🇩', pl: '🇵🇱', nl: '🇳🇱', tr: '🇹🇷',
};

const LANG_NAMES = {
    'zh-TW': '繁中', 'zh-CN': '简中', zh: '中文',
    en: 'English', 'en-US': 'English', 'en-GB': 'English',
    ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français',
    de: 'Deutsch', pt: 'Português', ru: 'Русский', it: 'Italiano',
    vi: 'Tiếng Việt', th: 'ไทย', ar: 'العربية', hi: 'हिन्दी',
    id: 'Indonesia', pl: 'Polski', nl: 'Nederlands', tr: 'Türkçe',
};

function getFlag(lang) {
    if (!lang) return '🌐';
    return FLAG_MAP[lang] || FLAG_MAP[lang.split('-')[0]] || '🌐';
}

function getLangName(lang) {
    if (!lang || lang === 'auto') return 'Auto';
    return LANG_NAMES[lang] || LANG_NAMES[lang.split('-')[0]] || lang;
}

/** Build re-translate buttons, excluding the current target language. */
function buildRetranslateButtons(retranslateId, currentLang) {
    const allChoices = [
        { lang: 'zh-TW', label: '繁中' },
        { lang: 'en', label: 'English' },
        { lang: 'ja', label: '日本語' },
        { lang: 'ko', label: '한국어' },
        { lang: 'es', label: 'Español' },
    ];

    const choices = allChoices
        .filter(c => c.lang !== currentLang && langToScript(c.lang) !== langToScript(currentLang))
        .slice(0, 4);

    if (choices.length === 0) return null;

    const row = new ActionRowBuilder();
    for (const c of choices) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`rt:${retranslateId}:${c.lang}`)
                .setLabel(c.label)
                .setEmoji(getFlag(c.lang))
                .setStyle(ButtonStyle.Secondary),
        );
    }
    return row;
}

/** Build the translation Embed. */
function buildTranslationEmbed(original, translated, sourceLang, targetLang) {
    const sourceFlag = getFlag(sourceLang);
    const targetFlag = getFlag(targetLang);
    const sourceName = getLangName(sourceLang);
    const targetName = getLangName(targetLang);

    const truncated = original.length > 300 ? original.slice(0, 300) + '…' : original;

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setDescription(`${sourceFlag} ${sourceName} → ${targetFlag} ${targetName}`)
        .addFields(
            { name: 'Original', value: truncated },
            { name: 'Translation', value: translated },
        )
        .setFooter({ text: 'Babel · Powered by Gemini' })
        .setTimestamp();
}

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

    // --- /translate command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'translate') {
        const text = interaction.options.getString('text');
        const targetOpt = interaction.options.getString('to');

        if (!store.isSetupComplete()) {
            return interaction.reply({ content: 'Bot not configured yet.', flags: MessageFlags.Ephemeral });
        }
        const allowedGuilds = store.get('allowedGuildIds');
        if (!allowedGuilds.includes(interaction.guildId)) {
            return interaction.reply({ content: '⛔ This server is not authorized.', flags: MessageFlags.Ephemeral });
        }
        if (usage.isBudgetExceeded()) {
            return interaction.reply({ content: '已達每日預算上限 / Daily budget exceeded', flags: MessageFlags.Ephemeral });
        }
        const cd = cooldown.check(interaction.user.id);
        if (!cd.allowed) {
            return interaction.reply({ content: `冷卻中，請等 ${cd.remaining} 秒 / Please wait ${cd.remaining}s`, flags: MessageFlags.Ephemeral });
        }

        // Resolve target language
        const userPrefs = store.get('userLanguagePrefs') || {};
        const userPref = userPrefs[interaction.user.id];
        const localeLang = localeToLang(interaction.locale);
        const targetLanguage = targetOpt && targetOpt !== 'auto'
            ? targetOpt
            : (userPref || localeLang || 'auto');

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        cooldown.set(interaction.user.id);
        totalTranslations++;

        try {
            const result = await translate(text, targetLanguage);
            cache.set(`slash:${Date.now()}:${targetLanguage}`, result.text);
            usage.record(result.inputTokens, result.outputTokens);
            apiCalls++;

            const detectedLang = detectScript(text) || 'auto';
            const retranslateId = storeForRetranslate(text, interaction.guildId);
            const embed = buildTranslationEmbed(text, result.text, detectedLang, targetLanguage);
            const buttons = buildRetranslateButtons(retranslateId, targetLanguage);

            const payload = { embeds: [embed] };
            if (buttons) payload.components = [buttons];
            await interaction.editReply(payload);
        } catch (error) {
            console.error('[/translate]', error.message);
            await interaction.editReply({ content: `翻譯失敗 / Translation failed: ${error.message}` });
        }
        return;
    }

    // --- /help command ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'help') {
        const isZh = interaction.locale?.startsWith('zh');

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(isZh ? '📖 如何使用 Babel' : '📖 How to Use Babel')
            .addFields(
                {
                    name: isZh ? '🔄 翻譯訊息' : '🔄 Translate a Message',
                    value: isZh
                        ? '右鍵點擊訊息 → 應用程式 → **Babel**'
                        : 'Right-click a message → Apps → **Babel**',
                },
                {
                    name: isZh ? '✏️ 快速翻譯' : '✏️ Quick Translate',
                    value: isZh
                        ? '`/translate` — 直接輸入文字翻譯'
                        : '`/translate` — Type text directly to translate',
                },
                {
                    name: isZh ? '🌍 設定語言' : '🌍 Set Your Language',
                    value: isZh
                        ? '`/setlang` — 選擇你偏好的翻譯目標語言'
                        : '`/setlang` — Choose your preferred target language',
                },
                {
                    name: isZh ? '💡 小提示' : '💡 Tips',
                    value: isZh
                        ? '• 翻譯結果僅你可見\n• 點擊語言按鈕可快速切換翻譯語言\n• 語言會從 Discord 設定自動偵測'
                        : '• Translations are private (only you can see them)\n• Click the language buttons below to re-translate\n• Your language is auto-detected from Discord settings',
                },
            )
            .setFooter({ text: 'Babel · Powered by Gemini' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // --- Button interaction (re-translate) ---
    if (interaction.isButton() && interaction.customId.startsWith('rt:')) {
        const [, retranslateId, targetLang] = interaction.customId.split(':');
        const stored = pendingRetranslations.get(retranslateId);

        if (!stored) {
            return interaction.reply({
                content: '⏰ This button has expired. Please translate again.',
                flags: MessageFlags.Ephemeral,
            });
        }

        // Budget + cooldown checks
        if (usage.isBudgetExceeded()) {
            return interaction.reply({
                content: '已達每日預算上限 / Daily budget exceeded',
                flags: MessageFlags.Ephemeral,
            });
        }
        const cd = cooldown.check(interaction.user.id);
        if (!cd.allowed) {
            return interaction.reply({
                content: `冷卻中，請等 ${cd.remaining} 秒 / Please wait ${cd.remaining}s`,
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferUpdate();
        cooldown.set(interaction.user.id);
        totalTranslations++;

        try {
            const cacheKey = `${retranslateId}:${targetLang}`;
            let translated = cache.get(cacheKey);
            const cached = !!translated;

            if (!cached) {
                const result = await translate(stored.content, targetLang);
                translated = result.text;
                cache.set(cacheKey, translated);
                usage.record(result.inputTokens, result.outputTokens);
                apiCalls++;
            }

            const detectedLang = detectScript(stored.content) || 'auto';
            const embed = buildTranslationEmbed(stored.content, translated, detectedLang, targetLang);
            const buttons = buildRetranslateButtons(retranslateId, targetLang);

            const payload = { embeds: [embed] };
            if (buttons) payload.components = [buttons];
            await interaction.editReply(payload);
        } catch (error) {
            console.error('[Retranslate]', error.message);
            // Can't editReply with error content after deferUpdate on ephemeral,
            // so we follow up instead
            await interaction.followUp({
                content: `翻譯失敗 / Translation failed: ${error.message}`,
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }

    if (!interaction.isMessageContextMenuCommand()) return;
    if (interaction.commandName !== 'Babel') return;

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
            content: 'This message is already in your language!',
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

        // Build Embed reply with re-translate buttons
        const detectedLang = detectScript(content) || 'auto';
        const retranslateId = storeForRetranslate(content, interaction.guildId);
        const embed = buildTranslationEmbed(content, translated, detectedLang, targetLanguage);
        const buttons = buildRetranslateButtons(retranslateId, targetLanguage);

        const replyPayload = { embeds: [embed] };
        if (buttons) replyPayload.components = [buttons];
        await interaction.editReply(replyPayload);
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

// Cleanup expired cooldowns every minute + expired retranslation data every 5 min
setInterval(() => cooldown.cleanup(), 60_000);
setInterval(() => {
    const cutoff = Date.now() - 30 * 60_000; // 30 min TTL
    for (const [id, data] of pendingRetranslations) {
        if (data.ts < cutoff) pendingRetranslations.delete(id);
    }
}, 5 * 60_000);

// --- Start ---
client.login(config.discordToken);
