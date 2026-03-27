import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGracefulShutdownHandler } from '../src/shutdown.js';

describe('createGracefulShutdownHandler', () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
        process.exitCode = undefined;
    });

    afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should stop timers, close the HTTP server, and destroy the Discord client', async () => {
        const order: string[] = [];
        const logger = {
            log: vi.fn((message: string) => {
                order.push(`log:${message}`);
            }),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const timer = setInterval(() => undefined, 60_000);
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

        const shutdown = createGracefulShutdownHandler({
            client: {
                destroy: vi.fn(() => {
                    order.push('client.destroy');
                }),
            },
            getDashboardApp: () => ({
                locals: {
                    disposeDashboardApp: () => {
                        order.push('dashboard.dispose');
                    },
                },
            }) as never,
            getDashboardServer: () => ({
                listening: true,
                close: (callback?: (error?: Error) => void) => {
                    order.push('server.close');
                    callback?.();
                    return undefined as never;
                },
            }),
            timers: [timer],
            cleanupTasks: [() => {
                order.push('cleanup.db');
            }],
            logger,
            exit: vi.fn(),
        });

        await shutdown('SIGTERM');

        expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
        expect(order).toContain('dashboard.dispose');
        expect(order).toContain('server.close');
        expect(order).toContain('client.destroy');
        expect(order).toContain('cleanup.db');
        expect(order.indexOf('dashboard.dispose')).toBeLessThan(order.indexOf('server.close'));
        expect(order.indexOf('server.close')).toBeLessThan(order.indexOf('client.destroy'));
        expect(order.indexOf('client.destroy')).toBeLessThan(order.indexOf('cleanup.db'));
        expect(process.exitCode).toBe(0);
    });

    it('should force exit when shutdown exceeds the timeout', async () => {
        vi.useFakeTimers();
        const exit = vi.fn();

        const shutdown = createGracefulShutdownHandler({
            client: { destroy: vi.fn() },
            getDashboardServer: () => ({
                listening: true,
                close: () => undefined as never,
            }),
            timeoutMs: 250,
            logger: {
                log: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            exit,
        });

        void shutdown('SIGTERM');
        await vi.advanceTimersByTimeAsync(250);

        expect(exit).toHaveBeenCalledWith(1);
    });

    it('should only run shutdown once when multiple signals arrive', async () => {
        const close = vi.fn((callback?: (error?: Error) => void) => {
            callback?.();
            return undefined as never;
        });
        const warn = vi.fn();

        const shutdown = createGracefulShutdownHandler({
            client: { destroy: vi.fn() },
            getDashboardServer: () => ({
                listening: true,
                close,
            }),
            logger: {
                log: vi.fn(),
                warn,
                error: vi.fn(),
            },
            exit: vi.fn(),
        });

        await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

        expect(close).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
