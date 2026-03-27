import { describe, expect, it } from 'vitest';
import { TranslationRuntimeLimiter } from '../src/translation-runtime-limiter.js';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('TranslationRuntimeLimiter', () => {
    it('should queue work behind active permits and start queued work in FIFO order', async () => {
        const limiter = new TranslationRuntimeLimiter({
            maxConcurrent: 1,
            maxGlobalQueue: 2,
            maxGuildQueue: 2,
            maxUserOutstanding: 1,
        });
        const gate = deferred<void>();
        const firstAdmission = limiter.acquire({ userId: 'user-1', guildId: 'guild-1' });
        const secondAdmission = limiter.acquire({ userId: 'user-2', guildId: 'guild-1' });
        const order: string[] = [];
        let secondStarted = false;

        if (!firstAdmission.accepted || !secondAdmission.accepted) {
            throw new Error('Expected reservations to be accepted');
        }

        const first = firstAdmission.reservation.run(async () => {
            order.push('first');
            await gate.promise;
            return 'first-done';
        });
        const second = secondAdmission.reservation.run(async (meta) => {
            secondStarted = true;
            order.push(`second:${meta.queued}`);
            return 'second-done';
        });

        await Promise.resolve();

        expect(limiter.snapshot().inflight).toBe(1);
        expect(limiter.snapshot().queued).toBe(1);
        expect(order).toEqual(['first']);
        expect(secondStarted).toBe(false);

        gate.resolve();

        await expect(first).resolves.toBe('first-done');
        await expect(second).resolves.toBe('second-done');
        expect(order).toEqual(['first', 'second:true']);
        expect(limiter.snapshot().inflight).toBe(0);
        expect(limiter.snapshot().queued).toBe(0);
    });

    it('should reject when the same user already has an active or queued translation', () => {
        const limiter = new TranslationRuntimeLimiter({
            maxConcurrent: 2,
            maxGlobalQueue: 2,
            maxGuildQueue: 2,
            maxUserOutstanding: 1,
        });
        const firstAdmission = limiter.acquire({ userId: 'user-1', guildId: 'guild-1' });
        const secondAdmission = limiter.acquire({ userId: 'user-1', guildId: 'guild-1' });

        expect(firstAdmission.accepted).toBe(true);
        expect(secondAdmission).toMatchObject({
            accepted: false,
            reason: 'user_queue_full',
        });
        expect(limiter.snapshot().rejectionCounts.user_queue_full).toBe(1);

        if (firstAdmission.accepted) {
            firstAdmission.reservation.cancel();
        }
    });

    it('should reject when guild or global queue limits are exceeded', () => {
        const limiter = new TranslationRuntimeLimiter({
            maxConcurrent: 1,
            maxGlobalQueue: 1,
            maxGuildQueue: 1,
            maxUserOutstanding: 3,
        });
        const firstAdmission = limiter.acquire({ userId: 'user-1', guildId: 'guild-1' });
        const secondAdmission = limiter.acquire({ userId: 'user-2', guildId: 'guild-1' });
        const guildRejected = limiter.acquire({ userId: 'user-3', guildId: 'guild-1' });
        const globalRejected = limiter.acquire({ userId: 'user-4', guildId: 'guild-2' });

        expect(firstAdmission.accepted).toBe(true);
        expect(secondAdmission.accepted).toBe(true);
        expect(guildRejected).toMatchObject({
            accepted: false,
            reason: 'guild_queue_full',
        });
        expect(globalRejected).toMatchObject({
            accepted: false,
            reason: 'global_queue_full',
        });
        expect(limiter.snapshot().rejectionCounts.guild_queue_full).toBe(1);
        expect(limiter.snapshot().rejectionCounts.global_queue_full).toBe(1);

        if (secondAdmission.accepted) {
            secondAdmission.reservation.cancel();
        }
        if (firstAdmission.accepted) {
            firstAdmission.reservation.cancel();
        }
    });
});
