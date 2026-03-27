import { configRepository, type ConfigRepository } from '../modules/config/config-repository.js';
import type { AppMetricsSnapshot } from './app-metrics.js';
import { createEmptyAppMetricsSnapshot } from './app-metrics.js';
import { checkVertexAiHealth, type VertexAiHealthStatus } from '../infra/vertex-ai-client.js';

type HealthCheckLevel = 'pass' | 'fail' | 'skip';

interface HealthCheckResult {
    status: HealthCheckLevel;
    detail: string;
    latencyMs?: number;
    error?: string;
}

export interface LivenessStatus {
    live: boolean;
    status: 'ok' | 'fail';
    timestamp: string;
    checks: {
        process: HealthCheckResult;
        configStore: HealthCheckResult;
    };
}

export interface ReadinessStatus {
    ready: boolean;
    status: 'ready' | 'not_ready';
    timestamp: string;
    checks: {
        configuration: HealthCheckResult;
        vertexAi: HealthCheckResult;
    };
}

export interface HealthStatus {
    live: boolean;
    ready: boolean;
    status: 'ok' | 'degraded' | 'fail';
    timestamp: string;
    strategy: {
        liveness: string;
        readiness: string;
        healthz: string;
    };
    checks: {
        process: HealthCheckResult;
        configStore: HealthCheckResult;
        configuration: HealthCheckResult;
        vertexAi: HealthCheckResult;
    };
    metrics: Pick<AppMetricsSnapshot, 'translationFailureRate' | 'translationCacheHitRate' | 'budgetExceededTotal'>;
}

interface HealthDeps {
    configStore?: Pick<ConfigRepository, 'getRuntimeConfig' | 'isSetupComplete'>;
    healthCheck?: () => Promise<VertexAiHealthStatus>;
}

function now(): string {
    return new Date().toISOString();
}

function createVertexCheck(result: VertexAiHealthStatus): HealthCheckResult {
    if (result.healthy) {
        return {
            status: 'pass',
            detail: 'Vertex AI probe succeeded',
            latencyMs: result.latencyMs,
        };
    }

    return {
        status: 'fail',
        detail: 'Vertex AI probe failed',
        error: result.error,
    };
}

export function getLivenessStatus({
    configStore = configRepository,
}: Pick<HealthDeps, 'configStore'> = {}): LivenessStatus {
    const timestamp = now();
    const processCheck: HealthCheckResult = {
        status: 'pass',
        detail: 'HTTP process is responding',
    };

    try {
        configStore.getRuntimeConfig();

        return {
            live: true,
            status: 'ok',
            timestamp,
            checks: {
                process: processCheck,
                configStore: {
                    status: 'pass',
                    detail: 'Runtime config repository is reachable',
                },
            },
        };
    } catch (error) {
        return {
            live: false,
            status: 'fail',
            timestamp,
            checks: {
                process: processCheck,
                configStore: {
                    status: 'fail',
                    detail: 'Runtime config repository is unavailable',
                    error: (error as Error).message,
                },
            },
        };
    }
}

export async function getReadinessStatus({
    configStore = configRepository,
    healthCheck = checkVertexAiHealth,
}: HealthDeps = {}): Promise<ReadinessStatus> {
    const timestamp = now();

    try {
        if (!configStore.isSetupComplete()) {
            return {
                ready: false,
                status: 'not_ready',
                timestamp,
                checks: {
                    configuration: {
                        status: 'fail',
                        detail: 'Dashboard setup is incomplete',
                    },
                    vertexAi: {
                        status: 'skip',
                        detail: 'Vertex AI readiness probe skipped until setup completes',
                    },
                },
            };
        }

        const vertexAi = await healthCheck();
        return {
            ready: vertexAi.healthy,
            status: vertexAi.healthy ? 'ready' : 'not_ready',
            timestamp,
            checks: {
                configuration: {
                    status: 'pass',
                    detail: 'Runtime configuration is complete',
                },
                vertexAi: createVertexCheck(vertexAi),
            },
        };
    } catch (error) {
        return {
            ready: false,
            status: 'not_ready',
            timestamp,
            checks: {
                configuration: {
                    status: 'fail',
                    detail: 'Readiness evaluation failed',
                    error: (error as Error).message,
                },
                vertexAi: {
                    status: 'skip',
                    detail: 'Vertex AI readiness probe skipped because readiness evaluation failed',
                },
            },
        };
    }
}

export async function getHealthStatus(
    {
        configStore = configRepository,
        healthCheck = checkVertexAiHealth,
    }: HealthDeps = {},
    metrics: AppMetricsSnapshot = createEmptyAppMetricsSnapshot(),
): Promise<HealthStatus> {
    const liveness = getLivenessStatus({ configStore });
    const readiness = await getReadinessStatus({ configStore, healthCheck });

    return {
        live: liveness.live,
        ready: readiness.ready,
        status: !liveness.live ? 'fail' : readiness.ready ? 'ok' : 'degraded',
        timestamp: now(),
        strategy: {
            liveness: 'Only local process and in-process dependencies affect liveness to avoid restart loops on external outages.',
            readiness: 'Readiness requires completed setup and a successful Vertex AI probe before translation traffic is considered ready.',
            healthz: 'Health combines liveness and readiness so degraded means the app is alive but not ready for translation work.',
        },
        checks: {
            process: liveness.checks.process,
            configStore: liveness.checks.configStore,
            configuration: readiness.checks.configuration,
            vertexAi: readiness.checks.vertexAi,
        },
        metrics: {
            translationFailureRate: metrics.translationFailureRate,
            translationCacheHitRate: metrics.translationCacheHitRate,
            budgetExceededTotal: metrics.budgetExceededTotal,
        },
    };
}
