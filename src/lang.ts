/**
 * Language detection and mapping utilities.
 * Pure functions extracted for testability.
 */
import type { ScriptFamily } from './types.js';

/**
 * Map Discord locale code to a short language code.
 * Returns null for locales that should use the default auto-detect.
 */
export function localeToLang(locale: string | undefined): string | null {
    if (!locale) return null;
    // If it's a Chinese or English locale, use auto-detect (default behavior)
    if (locale.startsWith('zh') || locale.startsWith('en')) return null;
    // For other locales, extract the base language code
    return locale.split('-')[0]!;
}

/**
 * Detect the dominant script of text content.
 * Returns: 'zh', 'ja', 'ko', 'ru', 'ar', 'th', 'hi', or null (Latin/unknown).
 */
export function detectScript(text: string): ScriptFamily {
    let cjk = 0, kana = 0, hangul = 0, cyrillic = 0, arabic = 0, thai = 0, devanagari = 0;

    for (const char of text) {
        const c = char.codePointAt(0)!;
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

/** Map a language code to its script family. */
export function langToScript(lang: string | null): ScriptFamily {
    if (!lang) return null;
    const map: Record<string, ScriptFamily> = {
        'zh-TW': 'zh', 'zh-CN': 'zh', zh: 'zh',
        ja: 'ja', ko: 'ko', ru: 'ru',
        ar: 'ar', th: 'th', hi: 'hi',
    };
    return map[lang] ?? map[lang.split('-')[0]!] ?? null;
}

/**
 * Check if content is already in the user's target language.
 * Only checks non-Latin scripts (Chinese, Japanese, Korean, etc.)
 * since Latin-script languages can't be reliably distinguished.
 */
export function isSameLanguage(content: string, targetLanguage: string, userLocale?: string): boolean {
    const contentScript = detectScript(content);
    if (!contentScript) return false; // Latin/unknown — let it through

    if (targetLanguage === 'auto') {
        // In auto mode, check against user's Discord locale
        const userScript = langToScript(userLocale || null);
        return contentScript === userScript;
    }

    // For explicit target, check if content matches target language's script
    return contentScript === langToScript(targetLanguage);
}
