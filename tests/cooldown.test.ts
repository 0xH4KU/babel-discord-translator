import { describe, it, expect } from 'vitest';
import { CooldownManager } from '../src/cooldown.js';

describe('CooldownManager', () => {
    it('should allow first request', () => {
        const cd = new CooldownManager(5);
        expect(cd.check('user1').allowed).toBe(true);
    });

    it('should block during cooldown', () => {
        const cd = new CooldownManager(5);
        cd.set('user1');

        const result = cd.check('user1');
        expect(result.allowed).toBe(false);
        if (!result.allowed) {
            expect(result.remaining).toBeGreaterThan(0);
            expect(result.remaining).toBeLessThanOrEqual(5);
        }
    });

    it('should allow after cooldown expires', () => {
        const cd = new CooldownManager(1); // 1 second cooldown
        cd.set('user1');

        // Manually set timestamp to the past
        cd.cooldowns.set('user1', Date.now() - 2000);

        expect(cd.check('user1').allowed).toBe(true);
    });

    it('should track separate cooldowns per user', () => {
        const cd = new CooldownManager(5);
        cd.set('user1');

        expect(cd.check('user1').allowed).toBe(false);
        expect(cd.check('user2').allowed).toBe(true);
    });

    it('should cleanup expired entries', () => {
        const cd = new CooldownManager(1);
        cd.set('user1');
        cd.set('user2');

        // Set both to expired
        cd.cooldowns.set('user1', Date.now() - 2000);
        cd.cooldowns.set('user2', Date.now() - 2000);

        cd.cleanup();
        expect(cd.cooldowns.size).toBe(0);
    });

    it('should not cleanup unexpired entries', () => {
        const cd = new CooldownManager(60);
        cd.set('user1');

        cd.cleanup();
        expect(cd.cooldowns.size).toBe(1);
    });
});
