import { describe, it, expect } from 'vitest';
import { buildTranslationCacheKey, TranslationCache } from '../src/cache.js';

describe('TranslationCache', () => {
    it('should return null for cache miss', () => {
        const cache = new TranslationCache(10);
        expect(cache.get('unknown')).toBeNull();
    });

    it('should store and retrieve a translation', () => {
        const cache = new TranslationCache(10);
        cache.set('msg1', 'Hello');
        expect(cache.get('msg1')).toBe('Hello');
    });

    it('should evict oldest entry when max size is reached', () => {
        const cache = new TranslationCache(3);
        cache.set('a', '1');
        cache.set('b', '2');
        cache.set('c', '3');
        cache.set('d', '4'); // should evict 'a'

        expect(cache.get('a')).toBeNull();
        expect(cache.get('d')).toBe('4');
    });

    it('should move accessed entries to most recent', () => {
        const cache = new TranslationCache(3);
        cache.set('a', '1');
        cache.set('b', '2');
        cache.set('c', '3');

        // Access 'a' to make it most recent
        cache.get('a');

        cache.set('d', '4'); // should evict 'b' (oldest after 'a' was accessed)
        expect(cache.get('a')).toBe('1');
        expect(cache.get('b')).toBeNull();
    });

    it('should track hit and miss stats', () => {
        const cache = new TranslationCache(10);
        cache.set('msg1', 'Hello');

        cache.get('msg1'); // hit
        cache.get('msg2'); // miss
        cache.get('msg1'); // hit

        const stats = cache.stats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBe('66.7%');
    });

    it('should report size correctly', () => {
        const cache = new TranslationCache(10);
        cache.set('a', '1');
        cache.set('b', '2');

        const stats = cache.stats();
        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(10);
    });

    it('should update existing entry without growing size', () => {
        const cache = new TranslationCache(10);
        cache.set('a', 'old');
        cache.set('a', 'new');

        expect(cache.get('a')).toBe('new');
        expect(cache.stats().size).toBe(1);
    });

    it('should trim cached entries immediately when capacity is reduced', () => {
        const cache = new TranslationCache(3);
        cache.set('a', '1');
        cache.set('b', '2');
        cache.set('c', '3');

        cache.setMaxSize(2);

        expect(cache.stats().maxSize).toBe(2);
        expect(cache.stats().size).toBe(2);
        expect(cache.get('a')).toBeNull();
    });

    it('should build stable versioned cache keys for the same translation inputs', () => {
        const first = buildTranslationCacheKey({
            sourceText: 'Hello world',
            targetLanguage: 'ja',
            geminiModel: 'gemini-2.5-flash-lite',
            prompt: 'Translate to Japanese',
            maxOutputTokens: 1000,
        });
        const second = buildTranslationCacheKey({
            sourceText: 'Hello world',
            targetLanguage: 'ja',
            geminiModel: 'gemini-2.5-flash-lite',
            prompt: 'Translate to Japanese',
            maxOutputTokens: 1000,
        });

        expect(first).toBe(second);
    });

    it('should change the cache key when model, prompt, or source content changes', () => {
        const base = buildTranslationCacheKey({
            sourceText: 'Hello world',
            targetLanguage: 'ja',
            geminiModel: 'gemini-2.5-flash-lite',
            prompt: 'Translate to Japanese',
            maxOutputTokens: 1000,
        });

        const differentModel = buildTranslationCacheKey({
            sourceText: 'Hello world',
            targetLanguage: 'ja',
            geminiModel: 'gemini-2.5-pro',
            prompt: 'Translate to Japanese',
            maxOutputTokens: 1000,
        });
        const differentPrompt = buildTranslationCacheKey({
            sourceText: 'Hello world',
            targetLanguage: 'ja',
            geminiModel: 'gemini-2.5-flash-lite',
            prompt: 'Translate to Korean',
            maxOutputTokens: 1000,
        });
        const differentSource = buildTranslationCacheKey({
            sourceText: 'Hello world!',
            targetLanguage: 'ja',
            geminiModel: 'gemini-2.5-flash-lite',
            prompt: 'Translate to Japanese',
            maxOutputTokens: 1000,
        });

        expect(base).not.toBe(differentModel);
        expect(base).not.toBe(differentPrompt);
        expect(base).not.toBe(differentSource);
    });
});
