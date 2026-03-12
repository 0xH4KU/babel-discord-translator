/**
 * LRU Translation Cache.
 * Stores messageId → translation to avoid duplicate API calls.
 * @module cache
 */
export class TranslationCache {
    /**
     * @param {number} [maxSize=2000] - Maximum number of cached entries.
     */
    constructor(maxSize = 2000) {
        this.maxSize = maxSize;
        /** @type {Map<string, string>} */
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Retrieve a cached translation. Moves entry to most-recently-used.
     * @param {string} messageId
     * @returns {string|null} Cached translation or null on miss.
     */
    get(messageId) {
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

    /**
     * Store a translation in the cache. Evicts oldest entry if at capacity.
     * @param {string} messageId
     * @param {string} translation
     */
    set(messageId, translation) {
        if (this.cache.has(messageId)) {
            this.cache.delete(messageId);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest entry
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
        }
        this.cache.set(messageId, translation);
    }

    /** Clear all cached entries and reset statistics. */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get cache statistics.
     * @returns {{ size: number, maxSize: number, hits: number, misses: number, hitRate: string }}
     */
    stats() {
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
