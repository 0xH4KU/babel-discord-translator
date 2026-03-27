import type { Client } from 'discord.js';
import type { Server } from 'http';
import type express from 'express';

interface ShutdownLogger {
    log: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
}

export interface GracefulShutdownDeps {
    client: Pick<Client, 'destroy'>;
    getDashboardApp?: () => express.Express | null;
    getDashboardServer?: () => Pick<Server, 'close' | 'listening'> | null;
    timers?: Array<NodeJS.Timeout | null | undefined>;
    timeoutMs?: number;
    logger?: ShutdownLogger;
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
    timeoutMs = 10_000,
    logger = console,
    exit = (code: number) => {
        process.exit(code);
    },
}: GracefulShutdownDeps): (signal: string) => Promise<void> {
    let inFlightShutdown: Promise<void> | null = null;

    return async (signal: string): Promise<void> => {
        if (inFlightShutdown) {
            logger.warn(`[Shutdown] ${signal} received while shutdown is already in progress`);
            return inFlightShutdown;
        }

        inFlightShutdown = (async () => {
            logger.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);

            const forceExitTimer = setTimeout(() => {
                logger.error(`[Shutdown] Timed out after ${timeoutMs}ms, forcing exit`);
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
                    logger.error(`[Shutdown] Dashboard cleanup failed: ${(error as Error).message}`);
                }

                try {
                    const dashboardServer = getDashboardServer?.() ?? null;
                    const hadDashboardServer = !!dashboardServer?.listening;
                    await closeHttpServer(dashboardServer);
                    if (hadDashboardServer) {
                        logger.log('[Shutdown] HTTP server closed');
                    }
                } catch (error) {
                    errors.push(error as Error);
                    logger.error(`[Shutdown] HTTP server close failed: ${(error as Error).message}`);
                }

                try {
                    client.destroy();
                    logger.log('[Shutdown] Discord client destroyed');
                } catch (error) {
                    errors.push(error as Error);
                    logger.error(`[Shutdown] Discord client destroy failed: ${(error as Error).message}`);
                }

                process.exitCode = errors.length === 0 ? 0 : 1;
            } finally {
                clearTimeout(forceExitTimer);
            }
        })();

        return inFlightShutdown;
    };
}

export const _test = { closeHttpServer, stopTimers };
