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
            type: 'translation',
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
     * Add an error log entry.
     */
    addError({ guildId, guildName, userId, userTag, error, command, timestamp }) {
        this.entries.push({
            type: 'error',
            guildId,
            guildName: guildName || guildId || 'Unknown',
            userId,
            userTag: userTag || userId || 'Unknown',
            error: String(error).slice(0, 200),
            command: command || 'unknown',
            timestamp: timestamp || Date.now(),
        });

        if (this.entries.length > this.maxSize) {
            this.entries.shift();
        }
    }

    /**
     * Get recent log entries (newest first).
     * @param {number} count
     * @param {string} [filter] - 'translation', 'error', or undefined for all
     */
    getRecent(count = 50, filter) {
        const filtered = filter
            ? this.entries.filter(e => e.type === filter)
            : this.entries;
        return filtered.slice(-count).reverse();
    }

    /**
     * Get total entry count.
     */
    get size() {
        return this.entries.length;
    }

    /**
     * Get error count.
     */
    get errorCount() {
        return this.entries.filter(e => e.type === 'error').length;
    }
}
