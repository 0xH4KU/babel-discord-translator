/**
 * Per-user cooldown manager.
 * Prevents rapid-fire translation requests.
 */
export class CooldownManager {
    seconds: number;
    cooldowns: Map<string, number>;

    constructor(seconds: number = 5) {
        this.seconds = seconds;
        this.cooldowns = new Map();
    }

    /** Check if a user is allowed to translate. */
    check(userId: string): { allowed: true } | { allowed: false; remaining: number } {
        const last = this.cooldowns.get(userId);
        if (!last) return { allowed: true };

        const elapsed = (Date.now() - last) / 1000;
        if (elapsed >= this.seconds) return { allowed: true };

        return {
            allowed: false,
            remaining: Math.ceil(this.seconds - elapsed),
        };
    }

    /** Record a cooldown timestamp for a user. */
    set(userId: string): void {
        this.cooldowns.set(userId, Date.now());
    }

    /** Remove expired entries to prevent memory leak. */
    cleanup(): void {
        const threshold = Date.now() - this.seconds * 1000;
        for (const [userId, timestamp] of this.cooldowns) {
            if (timestamp < threshold) {
                this.cooldowns.delete(userId);
            }
        }
    }
}
