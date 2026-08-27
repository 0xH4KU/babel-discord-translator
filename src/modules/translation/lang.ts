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
