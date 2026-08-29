import express, { type Request, type Response } from 'express';
import { createEmptyAppMetricsSnapshot } from '../../shared/app-metrics.js';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../shared/health.js';
import { createMetricsAuthMiddleware } from './metrics-auth.js';
import { createEmptyRuntimeSnapshot, renderPrometheusMetrics } from './prometheus-metrics.js';
import type { DashboardDeps } from '../../shared/types.js';

type HealthDashboardDeps = Pick<
    DashboardDeps,
    'cache' | 'metrics' | 'runtimeLimiter' | 'discordReady' | 'metricsToken' | 'host'
>;

export function registerHealthRoutes(
    app: express.Express,
    { cache, metrics, runtimeLimiter, discordReady, metricsToken, host }: HealthDashboardDeps,
): void {
    app.get('/livez', (_req: Request, res: Response) => {
        const health = getLivenessStatus();
        res.status(health.live ? 200 : 503).json(health);
    });

    app.get('/readyz', async (_req: Request, res: Response) => {
        const health = await getReadinessStatus({ discordReady });
        res.status(health.ready ? 200 : 503).json(health);
    });

    app.get('/healthz', async (_req: Request, res: Response) => {
        const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
        const health = await getHealthStatus({ discordReady }, metricsSnapshot);
        res.status(health.live ? 200 : 503).json(health);
    });

    app.get(
        '/metrics',
        createMetricsAuthMiddleware({ token: metricsToken, host }),
        (_req: Request, res: Response) => {
            const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
            const runtimeSnapshot = runtimeLimiter?.snapshot() ?? createEmptyRuntimeSnapshot();

            res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.send(
                renderPrometheusMetrics({
                    metricsSnapshot,
                    cacheStats: cache.stats(),
                    runtimeSnapshot,
                }),
            );
        },
    );
}

export function createHealthDashboardApp(deps: HealthDashboardDeps): express.Express {
    const app = express();
    registerHealthRoutes(app, deps);
    return app;
}
