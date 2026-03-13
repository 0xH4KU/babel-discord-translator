import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { store } from '../store.js';
import { localeToLang } from '../lang.js';

const LANG_NAMES: Record<string, string> = {
    'zh-TW': '繁體中文', 'zh-CN': '简体中文', en: 'English',
    ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français',
    de: 'Deutsch', pt: 'Português', ru: 'Русский', it: 'Italiano',
    vi: 'Tiếng Việt', th: 'ไทย', ar: 'العربية', hi: 'हिन्दी',
    id: 'Bahasa Indonesia', tr: 'Türkçe',
};

/** Handle /setlang command — set user's preferred translation language. */
export async function handleSetlang(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = interaction.options.getString('language')!;
    const prefs = store.get('userLanguagePrefs') || {};

    if (lang === 'auto') {
        delete prefs[interaction.user.id];
        store.set('userLanguagePrefs', prefs);
        await interaction.reply({
            content: 'Language preference cleared. Will use your Discord locale automatically.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    prefs[interaction.user.id] = lang;
    store.set('userLanguagePrefs', prefs);
    await interaction.reply({
        content: ` Translation target set to: **${lang}**`,
        flags: MessageFlags.Ephemeral,
    });
}

/** Handle /mylang command — show user's current translation language. */
export async function handleMylang(interaction: ChatInputCommandInteraction): Promise<void> {
    const prefs = store.get('userLanguagePrefs') || {};
    const userPref = prefs[interaction.user.id];
    const localeLang = localeToLang(interaction.locale);

    let reply: string;
    if (userPref) {
        const name = LANG_NAMES[userPref] || userPref;
        reply = `Your translation language: **${name}** (\`${userPref}\`), set via /setlang\n` +
            `Use \`/setlang auto\` to reset to auto-detect.`;
    } else if (localeLang) {
        const name = LANG_NAMES[localeLang] || localeLang;
        reply = `Your translation language: **${name}** (auto-detected from Discord locale: \`${interaction.locale}\`)\n` +
            `Use \`/setlang\` to set a custom language.`;
    } else {
        reply = `Your translation language: **Auto** (Chinese ↔ English based on content)\n` +
            `Discord locale: \`${interaction.locale}\`\n` +
            `Use \`/setlang\` to set a specific target language.`;
    }

    await interaction.reply({ content: reply, flags: MessageFlags.Ephemeral });
}
