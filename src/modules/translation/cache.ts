import crypto from 'crypto';

export const TRANSLATION_CACHE_SCHEMA_VERSION = 'v2';

export interface TranslationCacheKeyInput {
    sourceText: string;
    targetLanguage: string;
    geminiModel: string;
    prompt: string;
    maxOutputTokens: number;
}

function hashCachePart(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function buildTranslationCacheKey({
    sourceText,
    targetLanguage,
    geminiModel,
    prompt,
    maxOutputTokens,
}: TranslationCacheKeyInput): string {
    return [
        'translation',
        TRANSLATION_CACHE_SCHEMA_VERSION,
        hashCachePart(sourceText),
        targetLanguage,
        geminiModel,
        maxOutputTokens,
        hashCachePart(prompt),
    ].join(':');
}

/**
 * LRU Translation Cache.
 * Stores versioned translation keys → translation to avoid duplicate API calls.
 */
export class TranslationCache {
    maxSize: number;
    cache: Map<string, string>;
    hits: number;
    misses: number;

    constructor(maxSize: number = 2000) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
    }

    /** Retrieve a cached translation. Moves entry to most-recently-used. */
    get(messageId: string): string | null {
        const result = this.cache.get(messageId);
        if (result) {
            this.hits++;
            // Move to end (most recently used)
            this.cache.delete(messageId);
            this.cache.set(messageId, result);
            return result;
        }
        this.misses++;
        return null;
    }

    /** Store a translation in the cache. Evicts oldest entry if at capacity. */
    set(messageId: string, translation: string): void {
        if (this.cache.has(messageId)) {
            this.cache.delete(messageId);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest entry
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(messageId, translation);
    }

    /** Clear all cached entries and reset statistics. */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /** Get cache statistics. */
    stats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: string } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : 'N/A',
        };
    }
}
