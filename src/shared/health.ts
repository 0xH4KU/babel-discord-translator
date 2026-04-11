import { configRepository, type ConfigRepository } from '../modules/config/config-repository.js';
import type { AppMetricsSnapshot } from './app-metrics.js';
import { createEmptyAppMetricsSnapshot } from './app-metrics.js';
import { checkVertexAiHealth, type VertexAiHealthStatus } from '../infra/vertex-ai-client.js';
import { checkOpenAiHealth, type OpenAiHealthStatus } from '../infra/openai-client.js';
import type { TranslationProviderMode } from '../types.js';

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
        openAi: HealthCheckResult;
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
        openAi: HealthCheckResult;
    };
    metrics: Pick<
        AppMetricsSnapshot,
        'translationFailureRate' | 'translationCacheHitRate' | 'budgetExceededTotal'
    >;
}

interface HealthDeps {
    configStore?: Pick<ConfigRepository, 'getRuntimeConfig' | 'isSetupComplete'>;
    healthCheck?: () => Promise<VertexAiHealthStatus>;
    openAiHealthCheck?: () => Promise<OpenAiHealthStatus>;
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

function createOpenAiCheck(result: OpenAiHealthStatus): HealthCheckResult {
    if (result.healthy) {
        return {
            status: 'pass',
            detail: 'OpenAI probe succeeded',
            latencyMs: result.latencyMs,
        };
    }

    return {
        status: 'fail',
        detail: 'OpenAI probe failed',
        error: result.error,
    };
}

function providerModeUsesVertex(mode: TranslationProviderMode): boolean {
    return mode === 'vertex' || mode === 'vertex+openai' || mode === 'openai+vertex';
}

function providerModeUsesOpenAi(mode: TranslationProviderMode): boolean {
    return mode === 'openai' || mode === 'vertex+openai' || mode === 'openai+vertex';
}

function providerModeSkipMessage(providerName: string): string {
    return `${providerName} probe skipped — not enabled in current provider mode`;
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
    openAiHealthCheck = checkOpenAiHealth,
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
                    openAi: {
                        status: 'skip',
                        detail: 'OpenAI readiness probe skipped until setup completes',
                    },
                },
            };
        }

        const runtimeConfig = configStore.getRuntimeConfig();
        const mode = runtimeConfig.translationProvider || 'vertex';
        const useVertex = providerModeUsesVertex(mode);
        const useOpenAi = providerModeUsesOpenAi(mode);

        const [vertexResult, openAiResult] = await Promise.all([
            useVertex ? healthCheck() : null,
            useOpenAi ? openAiHealthCheck() : null,
        ]);

        const vertexCheck: HealthCheckResult = vertexResult
            ? createVertexCheck(vertexResult)
            : { status: 'skip', detail: providerModeSkipMessage('Vertex AI') };
        const openAiCheck: HealthCheckResult = openAiResult
            ? createOpenAiCheck(openAiResult)
            : { status: 'skip', detail: providerModeSkipMessage('OpenAI') };

        // Ready if at least one enabled provider is healthy
        const enabledProviderHealthy =
            (vertexResult?.healthy ?? false) || (openAiResult?.healthy ?? false);
        // If neither provider is enabled at all (shouldn't happen), not ready
        const anyEnabled = useVertex || useOpenAi;
        const ready = anyEnabled && enabledProviderHealthy;

        return {
            ready,
            status: ready ? 'ready' : 'not_ready',
            timestamp,
            checks: {
                configuration: {
                    status: 'pass',
                    detail: 'Runtime configuration is complete',
                },
                vertexAi: vertexCheck,
                openAi: openAiCheck,
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
                openAi: {
                    status: 'skip',
                    detail: 'OpenAI readiness probe skipped because readiness evaluation failed',
                },
            },
        };
    }
}

export async function getHealthStatus(
    {
        configStore = configRepository,
        healthCheck = checkVertexAiHealth,
        openAiHealthCheck = checkOpenAiHealth,
    }: HealthDeps = {},
    metrics: AppMetricsSnapshot = createEmptyAppMetricsSnapshot(),
): Promise<HealthStatus> {
    const liveness = getLivenessStatus({ configStore });
    const readiness = await getReadinessStatus({ configStore, healthCheck, openAiHealthCheck });

    return {
        live: liveness.live,
        ready: readiness.ready,
        status: !liveness.live ? 'fail' : readiness.ready ? 'ok' : 'degraded',
        timestamp: now(),
        strategy: {
            liveness:
                'Only local process and in-process dependencies affect liveness to avoid restart loops on external outages.',
            readiness:
                'Readiness requires completed setup and at least one healthy translation provider before translation traffic is considered ready.',
            healthz:
                'Health combines liveness and readiness so degraded means the app is alive but not ready for translation work.',
        },
        checks: {
            process: liveness.checks.process,
            configStore: liveness.checks.configStore,
            configuration: readiness.checks.configuration,
            vertexAi: readiness.checks.vertexAi,
            openAi: readiness.checks.openAi,
        },
        metrics: {
            translationFailureRate: metrics.translationFailureRate,
            translationCacheHitRate: metrics.translationCacheHitRate,
            budgetExceededTotal: metrics.budgetExceededTotal,
        },
    };
}
