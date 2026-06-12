import { describe, expect, it } from 'vitest';
import { extractTranslatableMessageText } from '../src/shared/message-extraction.js';

describe('message extraction', () => {
    it('should prefer message content when present', () => {
        const text = extractTranslatableMessageText({
            content: 'Hello from content',
            embeds: [{ title: 'Embed title', description: 'Embed body' }],
        });

        expect(text).toBe('Hello from content');
    });

    it('should extract embed titles, descriptions, fields, attachments, and reference summary', () => {
        const text = extractTranslatableMessageText({
            content: '',
            embeds: [
                {
                    title: 'Embed title',
                    description: 'Embed description',
                    fields: [{ name: 'Field name', value: 'Field value' }],
                },
            ],
            attachments: {
                map: (fn: (attachment: unknown) => string) =>
                    [
                        { name: 'menu.pdf', description: 'Lunch menu' },
                        { filename: 'photo.png' },
                    ].map(fn),
            },
            reference: { messageId: 'ref-1' },
        });

        expect(text).toContain('Embed title');
        expect(text).toContain('Embed description');
        expect(text).toContain('Field name: Field value');
        expect(text).toContain('Attachment: menu.pdf - Lunch menu');
        expect(text).toContain('Attachment: photo.png');
        expect(text).toContain('Referenced message: ref-1');
    });

    it('should return an empty string when no translatable material exists', () => {
        expect(extractTranslatableMessageText({ content: '', embeds: [], attachments: [] })).toBe(
            '',
        );
    });

    it('should handle messages with all optional sections missing', () => {
        expect(extractTranslatableMessageText({})).toBe('');
        expect(
            extractTranslatableMessageText({
                content: '   ',
                embeds: null,
                attachments: null,
                reference: { messageId: '  ' },
            }),
        ).toBe('');
    });

    it('should keep one-sided embed fields and skip blank ones', () => {
        const text = extractTranslatableMessageText({
            embeds: [
                {
                    fields: [
                        { name: 'Only name', value: '  ' },
                        { name: null, value: 'Only value' },
                        { name: '', value: '' },
                    ],
                },
            ],
        });

        expect(text).toBe('Only name\nOnly value');
    });

    it('should accept plain attachment arrays and skip unnamed attachments', () => {
        const text = extractTranslatableMessageText({
            attachments: [
                { filename: 'fallback.txt' },
                { description: 'description without a name' },
            ],
        });

        expect(text).toBe('Attachment: fallback.txt');
    });
});
