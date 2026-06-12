import { describe, expect, it } from 'vitest';
import {
    discordMessages,
    getDiscordLanguageName,
    getDiscordTranslationCommandMessages,
} from '../src/shared/messages/discord-messages.js';

describe('discord-messages', () => {
    it('should map known language codes to display names and fall back to the code', () => {
        expect(getDiscordLanguageName('zh-TW')).toBe('繁體中文');
        expect(getDiscordLanguageName('ja')).toBe('日本語');
        expect(getDiscordLanguageName('xx-unknown')).toBe('xx-unknown');
    });

    it('should expose distinct message sets per translation command', () => {
        const babel = getDiscordTranslationCommandMessages('babel');
        const translate = getDiscordTranslationCommandMessages('translate');

        expect(babel.setupIncomplete).toContain('dashboard');
        expect(translate.emptyText).toBe('Text is required');
        expect(babel.emptyText).not.toBe(translate.emptyText);
    });

    it('should format simple status messages', () => {
        expect(discordMessages.unauthorizedGuild()).toContain('not authorized');
        expect(discordMessages.unauthorizedUser()).toContain('not authorized');
        expect(discordMessages.cooldownRemaining(7)).toBe('Please wait 7s');
        expect(discordMessages.textTooLong(2500, 2000)).toBe('Text too long (2500/2000 chars)');
        expect(discordMessages.translationFailed('boom')).toBe('Translation failed: boom');
    });

    it('should format language preference messages', () => {
        expect(discordMessages.languagePreferenceCleared()).toContain('cleared');
        expect(discordMessages.languageTargetSet('ja')).toContain('**ja**');
        expect(discordMessages.currentLanguageFromPreference('日本語', 'ja')).toContain(
            '**日本語** (`ja`)',
        );
        expect(discordMessages.currentLanguageFromLocale('한국어', 'ko')).toContain(
            'auto-detected from Discord locale: `ko`',
        );
        expect(discordMessages.currentLanguageAuto('en-US')).toContain('**Auto**');
    });

    it('should quote the original text and keep short messages intact', () => {
        const result = discordMessages.quotedTranslation('line one\nline two', 'translated');

        expect(result).toBe('> line one\n> line two\n\ntranslated');
    });

    it('should truncate quoted originals longer than 200 characters', () => {
        const original = 'a'.repeat(250);

        const result = discordMessages.quotedTranslation(original, 'translated');

        expect(result).toContain('a'.repeat(200) + '…');
        expect(result).not.toContain('a'.repeat(201));
    });
});
