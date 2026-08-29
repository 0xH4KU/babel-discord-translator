/**
 * In-memory ring buffer for translation audit logs.
 * Does NOT persist to disk — privacy by design.
 */
import type { LogEntry } from './types.js';
import type { AppProfile } from '../apps/app-profile.js';

export class TranslationLog {
    entries: LogEntry[];
    maxSize: number;
    private _errorCount: number;

    constructor(maxSize: number = 200) {
        this.entries = [];
        this.maxSize = maxSize;
        this._errorCount = 0;
    }

    /**
     * Add a translation log entry.
     * Only stores a short preview of the content, not full text.
     */
    add(params: {
        appProfileId?: AppProfile['id'];
        guildId?: string | null;
        guildName?: string;
        userId: string;
        userTag: string;
        contentPreview?: string;
        cached?: boolean;
        targetLanguage?: string;
        langSource?: string;
        command?: string;
        timestamp?: number;
    }): void {
        this.pushEntry({
            type: 'translation',
            appProfileId: params.appProfileId,
            guildId: params.guildId ?? null,
            guildName: params.guildName || params.guildId || 'Unknown',
            userId: params.userId,
            userTag: params.userTag || params.userId,
            contentPreview: params.contentPreview?.slice(0, 50) || '',
            cached: !!params.cached,
            targetLanguage: params.targetLanguage || 'auto',
            langSource: params.langSource || 'auto',
            command: params.command || 'unknown',
            timestamp: params.timestamp || Date.now(),
        });
    }

    /** Add an error log entry. */
    addError(params: {
        appProfileId?: AppProfile['id'];
        guildId?: string | null;
        guildName?: string;
        userId?: string;
        userTag?: string;
        error: string;
        command?: string;
        requestId?: string;
        provider?: string;
        errorType?: string;
        suggestedAction?: string;
        timestamp?: number;
    }): void {
        this._errorCount++;
        this.pushEntry({
            type: 'error',
            appProfileId: params.appProfileId,
            guildId: params.guildId ?? null,
            guildName: params.guildName || params.guildId || 'Unknown',
            userId: params.userId || 'Unknown',
            userTag: params.userTag || params.userId || 'Unknown',
            error: String(params.error).slice(0, 200),
            command: params.command || 'unknown',
            requestId: params.requestId,
            provider: params.provider,
            errorType: params.errorType,
            suggestedAction: params.suggestedAction,
            timestamp: params.timestamp || Date.now(),
        });
    }

    /** Get recent log entries (newest first). */
    getRecent(count: number = 50, filter?: string): LogEntry[] {
        const filtered = filter ? this.entries.filter((e) => e.type === filter) : this.entries;
        return filtered.slice(-count).reverse();
    }

    /** Get recent log entries for one app profile (newest first). */
    getRecentForProfile(
        appProfileId: AppProfile['id'],
        count: number = 50,
        filter?: string,
    ): LogEntry[] {
        const filtered = this.entries.filter((entry) => {
            return entry.appProfileId === appProfileId && (!filter || entry.type === filter);
        });
        return filtered.slice(-count).reverse();
    }

    /** Get total entry count. */
    get size(): number {
        return this.entries.length;
    }

    /** Get error count. O(1) via maintained counter. */
    get errorCount(): number {
        return this._errorCount;
    }

    private pushEntry(entry: LogEntry): void {
        if (this.entries.length >= this.maxSize) {
            const evicted = this.entries.shift();
            if (evicted?.type === 'error') {
                this._errorCount--;
            }
        }
        this.entries.push(entry);
    }
}
