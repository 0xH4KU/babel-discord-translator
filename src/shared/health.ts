import { configRepository, type ConfigRepository } from '../modules/config/config-repository.js';
import type { AppMetricsSnapshot } from './app-metrics.js';
import { createEmptyAppMetricsSnapshot } from './app-metrics.js';
import {
    checkVertexAiHealth,
    isVertexAiConfigured,
    type VertexAiHealthStatus,
} from '../infra/vertex-ai-client.js';
import {
    checkOpenAiHealth,
    isOpenAiConfigured,
    type OpenAiHealthStatus,
} from '../infra/openai-client.js';
import type { TranslationProviderMode } from './types.js';

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
        discord: HealthCheckResult;
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
        discord: HealthCheckResult;
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
    probeProviders?: boolean;
    discordReady?: () => boolean;
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
    return `${providerName} check skipped — not enabled in current provider mode`;
}

function createProviderConfigCheck(providerName: string, configured: boolean): HealthCheckResult {
    return configured
        ? { status: 'pass', detail: `${providerName} configuration is present` }
        : { status: 'fail', detail: `${providerName} configuration is incomplete` };
}

function createDiscordCheck(discordReady?: () => boolean): HealthCheckResult {
    if (!discordReady) {
        return { status: 'skip', detail: 'Discord readiness check is unavailable' };
    }

    try {
        return discordReady()
            ? { status: 'pass', detail: 'Discord client is connected' }
            : { status: 'fail', detail: 'Discord client is not connected' };
    } catch {
        return { status: 'fail', detail: 'Discord readiness check failed' };
    }
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
    } catch {
        return {
            live: false,
            status: 'fail',
            timestamp,
            checks: {
                process: processCheck,
                configStore: {
                    status: 'fail',
                    detail: 'Runtime config repository is unavailable',
                },
            },
        };
    }
}

export async function getReadinessStatus({
    configStore = configRepository,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    probeProviders = false,
    discordReady,
}: HealthDeps = {}): Promise<ReadinessStatus> {
    const timestamp = now();

    try {
        if (!configStore.isSetupComplete()) {
            const status: ReadinessStatus = {
                ready: false,
                status: 'not_ready',
                timestamp,
                checks: {
                    configuration: {
                        status: 'fail',
                        detail: 'Dashboard setup is incomplete',
                    },
                    discord: {
                        status: 'skip',
                        detail: 'Discord readiness check skipped until setup completes',
                    },
                    vertexAi: {
                        status: 'skip',
                        detail: 'Vertex AI check skipped until setup completes',
                    },
                    openAi: {
                        status: 'skip',
                        detail: 'OpenAI check skipped until setup completes',
                    },
                },
            };
            return status;
        }

        const runtimeConfig = configStore.getRuntimeConfig();
        const mode = runtimeConfig.translationProvider || 'vertex';
        const useVertex = providerModeUsesVertex(mode);
        const useOpenAi = providerModeUsesOpenAi(mode);

        const [vertexResult, openAiResult] = probeProviders
            ? await Promise.all([
                  useVertex ? healthCheck() : null,
                  useOpenAi ? openAiHealthCheck() : null,
              ])
            : [null, null];
        const vertexConfigured = useVertex && isVertexAiConfigured(runtimeConfig);
        const openAiConfigured = useOpenAi && isOpenAiConfigured(runtimeConfig);

        const vertexCheck: HealthCheckResult = !useVertex
            ? { status: 'skip', detail: providerModeSkipMessage('Vertex AI') }
            : vertexResult
              ? createVertexCheck(vertexResult)
              : createProviderConfigCheck('Vertex AI', vertexConfigured);
        const openAiCheck: HealthCheckResult = !useOpenAi
            ? { status: 'skip', detail: providerModeSkipMessage('OpenAI') }
            : openAiResult
              ? createOpenAiCheck(openAiResult)
              : createProviderConfigCheck('OpenAI', openAiConfigured);
        const discordCheck = createDiscordCheck(discordReady);

        const enabledProviderHealthy = probeProviders
            ? (vertexResult?.healthy ?? false) || (openAiResult?.healthy ?? false)
            : vertexConfigured || openAiConfigured;
        const anyEnabled = useVertex || useOpenAi;
        const ready = anyEnabled && enabledProviderHealthy && discordCheck.status !== 'fail';

        const status: ReadinessStatus = {
            ready,
            status: ready ? 'ready' : 'not_ready',
            timestamp,
            checks: {
                configuration: {
                    status: 'pass',
                    detail: 'Runtime configuration is complete',
                },
                discord: discordCheck,
                vertexAi: vertexCheck,
                openAi: openAiCheck,
            },
        };
        return status;
    } catch (error) {
        const status: ReadinessStatus = {
            ready: false,
            status: 'not_ready',
            timestamp,
            checks: {
                configuration: {
                    status: 'fail',
                    detail: 'Readiness evaluation failed',
                    error: probeProviders ? (error as Error).message : undefined,
                },
                discord: {
                    status: 'skip',
                    detail: 'Discord readiness check skipped because evaluation failed',
                },
                vertexAi: {
                    status: 'skip',
                    detail: 'Vertex AI check skipped because readiness evaluation failed',
                },
                openAi: {
                    status: 'skip',
                    detail: 'OpenAI check skipped because readiness evaluation failed',
                },
            },
        };
        return status;
    }
}

export async function getHealthStatus(
    { configStore = configRepository, discordReady }: HealthDeps = {},
    metrics: AppMetricsSnapshot = createEmptyAppMetricsSnapshot(),
): Promise<HealthStatus> {
    const liveness = getLivenessStatus({ configStore });
    const readiness = await getReadinessStatus({
        configStore,
        discordReady,
    });

    return {
        live: liveness.live,
        ready: readiness.ready,
        status: !liveness.live ? 'fail' : readiness.ready ? 'ok' : 'degraded',
        timestamp: now(),
        strategy: {
            liveness:
                'Only local process and in-process dependencies affect liveness to avoid restart loops on external outages.',
            readiness:
                'Readiness requires completed setup, a connected Discord client, and at least one configured translation provider.',
            healthz:
                'Health combines liveness and readiness so degraded means the app is alive but not ready for translation work.',
        },
        checks: {
            process: liveness.checks.process,
            configStore: liveness.checks.configStore,
            configuration: readiness.checks.configuration,
            discord: readiness.checks.discord,
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
