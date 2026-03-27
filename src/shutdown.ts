import type { Client } from 'discord.js';
import type { Server } from 'http';
import type express from 'express';
import { appLogger, type StructuredLogger } from './structured-logger.js';

export interface GracefulShutdownDeps {
    client: Pick<Client, 'destroy'>;
    getDashboardApp?: () => express.Express | null;
    getDashboardServer?: () => Pick<Server, 'close' | 'listening'> | null;
    timers?: Array<NodeJS.Timeout | null | undefined>;
    cleanupTasks?: Array<(() => void | Promise<void>) | null | undefined>;
    timeoutMs?: number;
    logger?: StructuredLogger;
    exit?: (code: number) => void;
}

async function closeHttpServer(server?: Pick<Server, 'close' | 'listening'> | null): Promise<void> {
    if (!server || !server.listening) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function stopTimers(timers: Array<NodeJS.Timeout | null | undefined>): void {
    for (const timer of timers) {
        if (!timer) {
            continue;
        }

        clearInterval(timer);
        clearTimeout(timer);
    }
}

export function createGracefulShutdownHandler({
    client,
    getDashboardApp,
    getDashboardServer,
    timers = [],
    cleanupTasks = [],
    timeoutMs = 10_000,
    logger = appLogger.child({ component: 'shutdown' }),
    exit = (code: number) => {
        process.exit(code);
    },
}: GracefulShutdownDeps): (signal: string) => Promise<void> {
    let inFlightShutdown: Promise<void> | null = null;

    return async (signal: string): Promise<void> => {
        if (inFlightShutdown) {
            logger.warn('shutdown.duplicate_signal', { signal });
            return inFlightShutdown;
        }

        inFlightShutdown = (async () => {
            logger.info('shutdown.started', { signal });

            const forceExitTimer = setTimeout(() => {
                logger.error('shutdown.timed_out', { signal, timeoutMs });
                exit(1);
            }, timeoutMs);
            forceExitTimer.unref?.();

            const errors: Error[] = [];

            try {
                stopTimers(timers);

                try {
                    const dashboardApp = getDashboardApp?.() ?? null;
                    dashboardApp?.locals.disposeDashboardApp?.();
                } catch (error) {
                    errors.push(error as Error);
                    logger.error('shutdown.dashboard_cleanup.failed', {
                        signal,
                        error: (error as Error).message,
                    });
                }

                try {
                    const dashboardServer = getDashboardServer?.() ?? null;
                    const hadDashboardServer = !!dashboardServer?.listening;
                    await closeHttpServer(dashboardServer);
                    if (hadDashboardServer) {
                        logger.info('shutdown.http_server.closed', { signal });
                    }
                } catch (error) {
                    errors.push(error as Error);
                    logger.error('shutdown.http_server.failed', {
                        signal,
                        error: (error as Error).message,
                    });
                }

                try {
                    client.destroy();
                    logger.info('shutdown.discord_client.destroyed', { signal });
                } catch (error) {
                    errors.push(error as Error);
                    logger.error('shutdown.discord_client.failed', {
                        signal,
                        error: (error as Error).message,
                    });
                }

                for (const cleanupTask of cleanupTasks) {
                    if (!cleanupTask) {
                        continue;
                    }

                    try {
                        await cleanupTask();
                    } catch (error) {
                        errors.push(error as Error);
                        logger.error('shutdown.cleanup_task.failed', {
                            signal,
                            error: (error as Error).message,
                        });
                    }
                }

                process.exitCode = errors.length === 0 ? 0 : 1;
                logger.info('shutdown.completed', {
                    signal,
                    exitCode: process.exitCode,
                    errorCount: errors.length,
                });
            } finally {
                clearTimeout(forceExitTimer);
            }
        })();

        return inFlightShutdown;
    };
}

export const _test = { closeHttpServer, stopTimers };
