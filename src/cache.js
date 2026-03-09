/**
 * LRU Translation Cache.
 * Stores messageId → translation to avoid duplicate API calls.
 */
export class TranslationCache {
    constructor(maxSize = 2000) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.hits = 0;
        this.misses = 0;
    }

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
