/**
 * Per-user cooldown manager.
 * Prevents rapid-fire translation requests.
 * @module cooldown
 */
export class CooldownManager {
    /**
     * @param {number} [seconds=5] - Cooldown duration in seconds.
     */
    constructor(seconds = 5) {
        this.seconds = seconds;
        /** @type {Map<string, number>} userId → timestamp */
        this.cooldowns = new Map();
    }

    /**
     * Check if a user is allowed to translate.
     * @param {string} userId
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

    /**
     * Record a cooldown timestamp for a user.
     * @param {string} userId
     */
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
