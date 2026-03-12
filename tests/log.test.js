import { describe, it, expect } from 'vitest';
import { TranslationLog } from '../src/log.js';

describe('TranslationLog', () => {
    it('should add and retrieve entries', () => {
        const log = new TranslationLog(10);
        log.add({
            guildId: 'g1',
            guildName: 'Test Server',
            userId: 'u1',
            userTag: 'User#1234',
            contentPreview: 'Hello world',
            cached: false,
        });

        const entries = log.getRecent(10);
        expect(entries).toHaveLength(1);
        expect(entries[0].guildName).toBe('Test Server');
        expect(entries[0].cached).toBe(false);
    });

    it('should return entries in newest-first order', () => {
        const log = new TranslationLog(10);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'First', cached: false });
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'Second', cached: false });

        const entries = log.getRecent(10);
        expect(entries[0].contentPreview).toBe('Second');
        expect(entries[1].contentPreview).toBe('First');
    });

    it('should enforce max size (ring buffer)', () => {
        const log = new TranslationLog(3);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'A', cached: false });
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'B', cached: false });
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'C', cached: false });
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'D', cached: false });

        expect(log.size).toBe(3);
        const entries = log.getRecent(10);
        expect(entries[0].contentPreview).toBe('D');
        // 'A' should have been evicted
        expect(entries.find((e) => e.contentPreview === 'A')).toBeUndefined();
    });

    it('should truncate content preview to 50 chars', () => {
        const log = new TranslationLog(10);
        const longText = 'A'.repeat(100);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: longText, cached: false });

        const entries = log.getRecent(1);
        expect(entries[0].contentPreview.length).toBe(50);
    });

    it('should limit getRecent count', () => {
        const log = new TranslationLog(100);
        for (let i = 0; i < 10; i++) {
            log.add({ guildId: 'g1', userId: 'u1', contentPreview: `Msg ${i}`, cached: false });
        }

        expect(log.getRecent(3)).toHaveLength(3);
    });

    it('should auto-set timestamp', () => {
        const log = new TranslationLog(10);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'Test', cached: false });

        const entries = log.getRecent(1);
        expect(entries[0].timestamp).toBeGreaterThan(0);
    });

    it('should add error entries via addError()', () => {
        const log = new TranslationLog(10);
        log.addError({
            guildId: 'g1',
            guildName: 'Test Server',
            userId: 'u1',
            userTag: 'User#1234',
            error: 'API timeout',
            command: 'Babel',
        });

        const entries = log.getRecent(10);
        expect(entries).toHaveLength(1);
        expect(entries[0].type).toBe('error');
        expect(entries[0].error).toBe('API timeout');
        expect(entries[0].command).toBe('Babel');
    });

    it('should truncate error message to 200 chars', () => {
        const log = new TranslationLog(10);
        const longError = 'E'.repeat(500);
        log.addError({ guildId: 'g1', userId: 'u1', error: longError, command: 'test' });

        const entries = log.getRecent(1);
        expect(entries[0].error.length).toBe(200);
    });

    it('should filter by type "translation"', () => {
        const log = new TranslationLog(10);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'Hello', cached: false });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'fail', command: 'test' });
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'World', cached: true });

        const translations = log.getRecent(10, 'translation');
        expect(translations).toHaveLength(2);
        expect(translations.every(e => e.type === 'translation')).toBe(true);
    });

    it('should filter by type "error"', () => {
        const log = new TranslationLog(10);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'Hello', cached: false });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'fail1', command: 'test' });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'fail2', command: 'test' });

        const errors = log.getRecent(10, 'error');
        expect(errors).toHaveLength(2);
        expect(errors.every(e => e.type === 'error')).toBe(true);
    });

    it('should count errors via errorCount getter', () => {
        const log = new TranslationLog(10);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'Hello', cached: false });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'fail1', command: 'test' });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'fail2', command: 'test' });

        expect(log.errorCount).toBe(2);
    });

    it('should use default values for optional fields in add()', () => {
        const log = new TranslationLog(10);
        log.add({ guildId: 'g1', userId: 'u1', cached: false });

        const entry = log.getRecent(1)[0];
        expect(entry.guildName).toBe('g1'); // defaults to guildId
        expect(entry.userTag).toBe('u1');   // defaults to userId
        expect(entry.contentPreview).toBe('');
        expect(entry.targetLanguage).toBe('auto');
        expect(entry.langSource).toBe('auto');
    });

    it('should use default values for optional fields in addError()', () => {
        const log = new TranslationLog(10);
        log.addError({ error: 'oops' });

        const entry = log.getRecent(1)[0];
        expect(entry.guildName).toBe('Unknown');
        expect(entry.userTag).toBe('Unknown');
        expect(entry.command).toBe('unknown');
    });

    it('should enforce max size with mixed translation and error entries', () => {
        const log = new TranslationLog(3);
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'A', cached: false });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'err1', command: 'test' });
        log.add({ guildId: 'g1', userId: 'u1', contentPreview: 'B', cached: false });
        log.addError({ guildId: 'g1', userId: 'u1', error: 'err2', command: 'test' });

        expect(log.size).toBe(3);
        // 'A' should have been evicted
        const all = log.getRecent(10);
        expect(all.find(e => e.contentPreview === 'A')).toBeUndefined();
    });
});

