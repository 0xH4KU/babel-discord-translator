import express, { type NextFunction, type Request, type Response } from 'express';
import { createEmptyAppMetricsSnapshot } from '../../shared/app-metrics.js';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../shared/health.js';
import { checkOpenAiHealth } from '../../infra/openai-client.js';
import { checkVertexAiHealth } from '../../infra/vertex-ai-client.js';
import { createMetricsAuthMiddleware } from './metrics-auth.js';
import { createEmptyRuntimeSnapshot, renderPrometheusMetrics } from './prometheus-metrics.js';
import type { DashboardDeps } from '../../shared/types.js';

type HealthDashboardDeps = Pick<
    DashboardDeps,
    | 'cache'
    | 'metrics'
    | 'runtimeLimiter'
    | 'healthCheck'
    | 'openAiHealthCheck'
    | 'healthProbeCacheTtlMs'
    | 'metricsToken'
>;

function asyncHandler(
    fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
        fn(req, res).catch(next);
    };
}

export function createHealthDashboardApp({
    cache,
    metrics,
    runtimeLimiter,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    healthProbeCacheTtlMs = 5_000,
    metricsToken,
}: HealthDashboardDeps): express.Express {
    const app = express();
    app.set('trust proxy', 1);

    app.get('/livez', (_req: Request, res: Response) => {
        const health = getLivenessStatus();
        res.status(health.live ? 200 : 503).json(health);
    });

    app.get(
        '/readyz',
        asyncHandler(async (_req: Request, res: Response) => {
            const health = await getReadinessStatus({
                healthCheck,
                openAiHealthCheck,
                cacheTtlMs: healthProbeCacheTtlMs,
            });
            res.status(health.ready ? 200 : 503).json(health);
        }),
    );

    app.get(
        '/healthz',
        asyncHandler(async (_req: Request, res: Response) => {
            const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
            const health = await getHealthStatus(
                { healthCheck, openAiHealthCheck, cacheTtlMs: healthProbeCacheTtlMs },
                metricsSnapshot,
            );
            res.status(health.live ? 200 : 503).json(health);
        }),
    );

    app.get(
        '/metrics',
        createMetricsAuthMiddleware(metricsToken),
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

    return app;
}
