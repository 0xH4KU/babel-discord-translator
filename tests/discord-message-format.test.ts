import { describe, expect, it } from 'vitest';
import {
    buildTranslationMessages,
    DISCORD_MESSAGE_LIMIT,
} from '../src/shared/discord-message-format.js';

describe('discord message formatting', () => {
    it('should split long translation output into Discord-safe chunks with metadata', () => {
        const translatedText = 'a'.repeat(DISCORD_MESSAGE_LIMIT * 2 + 120);

        const messages = buildTranslationMessages({
            originalText: 'Hello world',
            translatedText,
            targetLanguage: 'ja',
            cached: true,
            provider: 'vertex',
            inputTokens: 12,
            outputTokens: 34,
        });

        expect(messages.length).toBeGreaterThan(1);
        expect(messages.every((message) => message.length <= DISCORD_MESSAGE_LIMIT)).toBe(true);
        expect(messages[0]).toContain('Target: `ja`');
        expect(messages[0]).toContain('Cache: `hit`');
        expect(messages[0]).toContain('Provider: `vertex`');
        expect(messages[0]).toContain('Tokens: `12 in / 34 out`');
        expect(messages.join('')).toContain(translatedText);
    });

    it('should keep a short quoted preview of the original text in the first chunk only', () => {
        const messages = buildTranslationMessages({
            originalText: 'line one\nline two',
            translatedText: 'こんにちは',
            targetLanguage: 'ja',
            cached: false,
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('> line one\n> line two');
        expect(messages[0]).toContain('Cache: `miss`');
    });
});
