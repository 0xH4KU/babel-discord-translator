/**
 * Per-user cooldown manager.
 * Prevents rapid-fire translation requests.
 */
export class CooldownManager {
    constructor(seconds = 5) {
        this.seconds = seconds;
        this.cooldowns = new Map();
    }

    /**
     * Check if a user is allowed to translate.
     * @returns {{ allowed: boolean, remaining?: number }}
     */
    check(userId) {
        const last = this.cooldowns.get(userId);
        if (!last) return { allowed: true };

        const elapsed = (Date.now() - last) / 1000;
        if (elapsed >= this.seconds) return { allowed: true };

        return {
            allowed: false,
            remaining: Math.ceil(this.seconds - elapsed),
        };
    }

    set(userId) {
        this.cooldowns.set(userId, Date.now());
    }

    /** Remove expired entries to prevent memory leak. */
    cleanup() {
        const threshold = Date.now() - this.seconds * 1000;
        for (const [userId, timestamp] of this.cooldowns) {
            if (timestamp < threshold) {
                this.cooldowns.delete(userId);
            }
        }
    }
}
