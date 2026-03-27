type TranslationCommand = 'babel' | 'translate';

interface TranslationCommandMessages {
    setupIncomplete: string;
    emptyText: string;
    sameLanguage: string;
    budgetExceeded: string;
    userBusy: string;
    guildBusy: string;
    serviceBusy: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
    'zh-TW': '繁體中文',
    'zh-CN': '简体中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    pt: 'Português',
    ru: 'Русский',
    it: 'Italiano',
    vi: 'Tiếng Việt',
    th: 'ไทย',
    ar: 'العربية',
    hi: 'हिन्दी',
    id: 'Bahasa Indonesia',
    tr: 'Türkçe',
};

const TRANSLATION_COMMAND_MESSAGES: Record<TranslationCommand, TranslationCommandMessages> = {
    babel: {
        setupIncomplete: 'Bot not configured yet. Please complete setup in the dashboard.',
        emptyText: 'No text content',
        sameLanguage: 'This message is already in your language!',
        budgetExceeded: 'Daily budget exceeded, try again tomorrow!',
        userBusy: 'You already have a translation in progress. Please wait a moment.',
        guildBusy: 'This server is handling too many translations right now. Please try again shortly.',
        serviceBusy: 'Translation service is busy right now. Please try again in a moment.',
    },
    translate: {
        setupIncomplete: 'Bot not configured yet.',
        emptyText: 'Text is required',
        sameLanguage: 'This text is already in your target language!',
        budgetExceeded: 'Daily budget exceeded',
        userBusy: 'You already have a translation in progress. Please wait a moment.',
        guildBusy: 'This server is handling too many translations right now. Please try again shortly.',
        serviceBusy: 'Translation service is busy right now. Please try again in a moment.',
    },
};

export function getDiscordLanguageName(languageCode: string): string {
    return LANGUAGE_NAMES[languageCode] || languageCode;
}

export function getDiscordTranslationCommandMessages(command: TranslationCommand): TranslationCommandMessages {
    return TRANSLATION_COMMAND_MESSAGES[command];
}

export const discordMessages = {
    unauthorizedGuild(): string {
        return 'This server is not authorized.';
    },
    cooldownRemaining(seconds: number): string {
        return `Please wait ${seconds}s`;
    },
    textTooLong(length: number, maxLength: number): string {
        return `Text too long (${length}/${maxLength} chars)`;
    },
    translationFailed(errorMessage: string): string {
        return `Translation failed: ${errorMessage}`;
    },
    languagePreferenceCleared(): string {
        return 'Language preference cleared. Will use your Discord locale automatically.';
    },
    languageTargetSet(languageCode: string): string {
        return `Translation target set to: **${languageCode}**`;
    },
    currentLanguageFromPreference(languageName: string, languageCode: string): string {
        return `Your translation language: **${languageName}** (\`${languageCode}\`), set via /setlang\n` +
            'Use `/setlang auto` to reset to auto-detect.';
    },
    currentLanguageFromLocale(languageName: string, locale: string): string {
        return `Your translation language: **${languageName}** (auto-detected from Discord locale: \`${locale}\`)\n` +
            'Use `/setlang` to set a custom language.';
    },
    currentLanguageAuto(locale: string): string {
        return 'Your translation language: **Auto** (Chinese ↔ English based on content)\n' +
            `Discord locale: \`${locale}\`\n` +
            'Use `/setlang` to set a specific target language.';
    },
    quotedTranslation(originalText: string, translatedText: string): string {
        const preview = originalText.length > 200 ? originalText.slice(0, 200) + '…' : originalText;
        return `> ${preview.replace(/\n/g, '\n> ')}\n\n${translatedText}`;
    },
};
