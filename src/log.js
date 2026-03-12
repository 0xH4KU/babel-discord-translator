/**
 * In-memory ring buffer for translation audit logs.
 * Does NOT persist to disk — privacy by design.
 * @module log
 */
export class TranslationLog {
    /**
     * @param {number} [maxSize=200] - Maximum number of log entries to retain.
     */
    constructor(maxSize = 200) {
        /** @type {Array<object>} */
        this.entries = [];
        this.maxSize = maxSize;
    }

    /**
     * Add a translation log entry.
     * Only stores a short preview of the content, not full text.
     * @param {object} params
     * @param {string} [params.guildId]
     * @param {string} [params.guildName]
     * @param {string} [params.userId]
     * @param {string} [params.userTag]
     * @param {string} [params.contentPreview] - Truncated to 50 characters.
     * @param {boolean} [params.cached]
     * @param {string} [params.targetLanguage]
     * @param {string} [params.langSource]
     * @param {number} [params.timestamp]
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
     * @param {object} params
     * @param {string} [params.guildId]
     * @param {string} [params.guildName]
     * @param {string} [params.userId]
     * @param {string} [params.userTag]
     * @param {string} params.error - Error message, truncated to 200 characters.
     * @param {string} [params.command]
     * @param {number} [params.timestamp]
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
     * @param {number} [count=50] - Maximum entries to return.
     * @param {string} [filter] - 'translation', 'error', or undefined for all.
     * @returns {Array<object>}
     */
    getRecent(count = 50, filter) {
        const filtered = filter
            ? this.entries.filter(e => e.type === filter)
            : this.entries;
        return filtered.slice(-count).reverse();
    }

    /**
     * Get total entry count.
     * @returns {number}
     */
    get size() {
        return this.entries.length;
    }

    /**
     * Get error count.
     * @returns {number}
     */
    get errorCount() {
        return this.entries.filter(e => e.type === 'error').length;
    }
}
