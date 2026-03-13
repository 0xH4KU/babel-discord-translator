/**
 * In-memory ring buffer for translation audit logs.
 * Does NOT persist to disk — privacy by design.
 */
import type { LogEntry } from './types.js';

export class TranslationLog {
    entries: LogEntry[];
    maxSize: number;

    constructor(maxSize: number = 200) {
        this.entries = [];
        this.maxSize = maxSize;
    }

    /**
     * Add a translation log entry.
     * Only stores a short preview of the content, not full text.
     */
    add(params: {
        guildId?: string | null;
        guildName?: string;
        userId: string;
        userTag: string;
        contentPreview?: string;
        cached?: boolean;
        targetLanguage?: string;
        langSource?: string;
        timestamp?: number;
    }): void {
        this.entries.push({
            type: 'translation',
            guildId: params.guildId ?? null,
            guildName: params.guildName || params.guildId || 'Unknown',
            userId: params.userId,
            userTag: params.userTag || params.userId,
            contentPreview: params.contentPreview?.slice(0, 50) || '',
            cached: !!params.cached,
            targetLanguage: params.targetLanguage || 'auto',
            langSource: params.langSource || 'auto',
            timestamp: params.timestamp || Date.now(),
        });

        if (this.entries.length > this.maxSize) {
            this.entries.shift();
        }
    }

    /** Add an error log entry. */
    addError(params: {
        guildId?: string | null;
        guildName?: string;
        userId?: string;
        userTag?: string;
        error: string;
        command?: string;
        timestamp?: number;
    }): void {
        this.entries.push({
            type: 'error',
            guildId: params.guildId ?? null,
            guildName: params.guildName || params.guildId || 'Unknown',
            userId: params.userId || 'Unknown',
            userTag: params.userTag || params.userId || 'Unknown',
            error: String(params.error).slice(0, 200),
            command: params.command || 'unknown',
            timestamp: params.timestamp || Date.now(),
        });

        if (this.entries.length > this.maxSize) {
            this.entries.shift();
        }
    }

    /** Get recent log entries (newest first). */
    getRecent(count: number = 50, filter?: string): LogEntry[] {
        const filtered = filter
            ? this.entries.filter(e => e.type === filter)
            : this.entries;
        return filtered.slice(-count).reverse();
    }

    /** Get total entry count. */
    get size(): number {
        return this.entries.length;
    }

    /** Get error count. */
    get errorCount(): number {
        return this.entries.filter(e => e.type === 'error').length;
    }
}
