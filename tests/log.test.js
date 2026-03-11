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
});
