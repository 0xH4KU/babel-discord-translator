/**
 * In-memory ring buffer for translation audit logs.
 * Does NOT persist to disk — privacy by design.
 */
export class TranslationLog {
    constructor(maxSize = 200) {
        this.entries = [];
        this.maxSize = maxSize;
    }

    /**
     * Add a translation log entry.
     * Only stores a short preview of the content, not full text.
     */
    add({ guildId, guildName, userId, userTag, contentPreview, cached, targetLanguage, langSource, timestamp }) {
        this.entries.push({
            guildId,
            guildName: guildName || guildId,
            userId,
            userTag: userTag || userId,
            contentPreview: contentPreview?.slice(0, 50) || '',
            cached: !!cached,
            targetLanguage: targetLanguage || 'auto',
            langSource: langSource || 'auto',
            timestamp: timestamp || Date.now(),
        });

        if (this.entries.length > this.maxSize) {
            this.entries.shift();
        }
    }

    /**
     * Get recent log entries (newest first).
     */
    getRecent(count = 50) {
        return this.entries.slice(-count).reverse();
    }

    /**
     * Get total entry count.
     */
    get size() {
        return this.entries.length;
    }
}
