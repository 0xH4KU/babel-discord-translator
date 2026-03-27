export type RuntimeLimitReason = 'user_queue_full' | 'guild_queue_full' | 'global_queue_full';

export interface TranslationRuntimeLimits {
    maxConcurrent: number;
    maxGlobalQueue: number;
    maxGuildQueue: number;
    maxUserOutstanding: number;
}

export interface TranslationRuntimeSnapshot {
    inflight: number;
    queued: number;
    rejectedTotal: number;
    rejectionCounts: Record<RuntimeLimitReason, number>;
    limits: TranslationRuntimeLimits;
}

export interface TranslationRuntimeScope {
    guildId?: string | null;
    userId: string;
}

interface QueueEntry {
    id: number;
    createdAt: number;
    guildKey: string;
    userId: string;
    activeAt?: number;
    cancelled: boolean;
    resolve: (meta: ReservationRunMeta) => void;
}

export interface ReservationRunMeta {
    queued: boolean;
    waitMs: number;
    snapshot: TranslationRuntimeSnapshot;
}

export type TranslationRuntimeAdmission =
    | {
        accepted: true;
        reservation: TranslationRuntimeReservation;
    }
    | {
        accepted: false;
        reason: RuntimeLimitReason;
        snapshot: TranslationRuntimeSnapshot;
    };

export interface TranslationRuntimeReservation {
    readonly queued: boolean;
    run<T>(task: (meta: ReservationRunMeta) => Promise<T> | T): Promise<T>;
    cancel(): void;
}

export const DEFAULT_TRANSLATION_RUNTIME_LIMITS: TranslationRuntimeLimits = {
    maxConcurrent: 4,
    maxGlobalQueue: 25,
    maxGuildQueue: 5,
    maxUserOutstanding: 1,
};

const EMPTY_REJECTION_COUNTS: Record<RuntimeLimitReason, number> = {
    user_queue_full: 0,
    guild_queue_full: 0,
    global_queue_full: 0,
};

function guildKey(guildId?: string | null): string {
    return guildId ?? '__unknown_guild__';
}

export class TranslationRuntimeLimiter {
    private readonly limits: TranslationRuntimeLimits;
    private inflight = 0;
    private readonly queue: QueueEntry[] = [];
    private readonly outstandingByUser = new Map<string, number>();
    private readonly queuedByGuild = new Map<string, number>();
    private rejectedTotal = 0;
    private readonly rejectionCounts: Record<RuntimeLimitReason, number>;
    private nextId = 1;

    constructor(limits: Partial<TranslationRuntimeLimits> = {}) {
        this.limits = {
            ...DEFAULT_TRANSLATION_RUNTIME_LIMITS,
            ...limits,
        };
        this.rejectionCounts = { ...EMPTY_REJECTION_COUNTS };
    }

    acquire(scope: TranslationRuntimeScope): TranslationRuntimeAdmission {
        const guild = guildKey(scope.guildId);

        if ((this.outstandingByUser.get(scope.userId) ?? 0) >= this.limits.maxUserOutstanding) {
            return this.reject('user_queue_full');
        }

        if ((this.queuedByGuild.get(guild) ?? 0) >= this.limits.maxGuildQueue) {
            return this.reject('guild_queue_full');
        }

        if (this.queue.length >= this.limits.maxGlobalQueue) {
            return this.reject('global_queue_full');
        }

        this.bumpMap(this.outstandingByUser, scope.userId, 1);

        if (this.inflight < this.limits.maxConcurrent && this.queue.length === 0) {
            this.inflight += 1;
            return {
                accepted: true,
                reservation: this.createActiveReservation({
                    queued: false,
                    waitMs: 0,
                    snapshot: this.snapshot(),
                }, scope.userId),
            };
        }

        this.bumpMap(this.queuedByGuild, guild, 1);

        let resolve: (meta: ReservationRunMeta) => void = () => undefined;
        const activation = new Promise<ReservationRunMeta>((res) => {
            resolve = res;
        });

        const entry: QueueEntry = {
            id: this.nextId++,
            createdAt: Date.now(),
            guildKey: guild,
            userId: scope.userId,
            cancelled: false,
            resolve,
        };
        this.queue.push(entry);

        return {
            accepted: true,
            reservation: this.createQueuedReservation(entry, activation),
        };
    }

    snapshot(): TranslationRuntimeSnapshot {
        return {
            inflight: this.inflight,
            queued: this.queue.length,
            rejectedTotal: this.rejectedTotal,
            rejectionCounts: { ...this.rejectionCounts },
            limits: { ...this.limits },
        };
    }

    private createActiveReservation(meta: ReservationRunMeta, userId: string): TranslationRuntimeReservation {
        let settled = false;

        return {
            queued: false,
            run: async <T>(task: (runMeta: ReservationRunMeta) => Promise<T> | T): Promise<T> => {
                if (settled) {
                    throw new Error('Runtime reservation already consumed');
                }
                settled = true;

                try {
                    return await task(meta);
                } finally {
                    this.releaseActive(userId);
                }
            },
            cancel: (): void => {
                if (settled) return;
                settled = true;
                this.releaseActive(userId);
            },
        };
    }

    private createQueuedReservation(entry: QueueEntry, activation: Promise<ReservationRunMeta>): TranslationRuntimeReservation {
        let settled = false;

        return {
            queued: true,
            run: async <T>(task: (meta: ReservationRunMeta) => Promise<T> | T): Promise<T> => {
                if (settled) {
                    throw new Error('Runtime reservation already consumed');
                }
                settled = true;

                const meta = await activation;
                try {
                    return await task(meta);
                } finally {
                    this.releaseActive(entry.userId);
                }
            },
            cancel: (): void => {
                if (settled) return;
                settled = true;
                if (entry.activeAt !== undefined) {
                    this.releaseActive(entry.userId);
                    return;
                }

                this.cancelQueuedEntry(entry);
            },
        };
    }

    private cancelQueuedEntry(entry: QueueEntry): void {
        const index = this.queue.findIndex((candidate) => candidate.id === entry.id);
        if (index === -1) {
            return;
        }

        this.queue.splice(index, 1);
        entry.cancelled = true;
        this.bumpMap(this.queuedByGuild, entry.guildKey, -1);
        this.bumpMap(this.outstandingByUser, entry.userId, -1);
    }

    private releaseActive(userId: string): void {
        this.inflight -= 1;
        this.bumpMap(this.outstandingByUser, userId, -1);
        this.activateQueuedEntries();
    }

    private activateQueuedEntries(): void {
        while (this.inflight < this.limits.maxConcurrent && this.queue.length > 0) {
            const entry = this.queue.shift();
            if (!entry || entry.cancelled) {
                continue;
            }

            this.inflight += 1;
            this.bumpMap(this.queuedByGuild, entry.guildKey, -1);
            const activeAt = Date.now();
            entry.activeAt = activeAt;
            entry.resolve({
                queued: true,
                waitMs: Math.max(activeAt - entry.createdAt, 0),
                snapshot: this.snapshot(),
            });
        }
    }

    private reject(reason: RuntimeLimitReason): TranslationRuntimeAdmission {
        this.rejectedTotal += 1;
        this.rejectionCounts[reason] += 1;

        return {
            accepted: false,
            reason,
            snapshot: this.snapshot(),
        };
    }

    private bumpMap(map: Map<string, number>, key: string, delta: number): void {
        const next = (map.get(key) ?? 0) + delta;
        if (next <= 0) {
            map.delete(key);
            return;
        }

        map.set(key, next);
    }
}
