import type { StructuredLogFields } from '../shared/structured-logger.js';
import { appLogger } from '../shared/structured-logger.js';
import type { AppMetricsCollector } from '../shared/app-metrics.js';
import type {
    TranslationPrompt,
    TranslationProviderMode,
    TranslationResult,
} from '../shared/types.js';
import type { RuntimeConfig } from '../modules/config/config-repository.js';

export interface TranslateOptions {
    logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
    metrics?: AppMetricsCollector;
    runtimeConfig?: RuntimeConfig;
    signal?: AbortSignal;
}

export const DEFAULT_TRANSLATION_PROVIDER_TIMEOUT_MS = 25_000;

export interface TranslationProvider {
    /** Human-readable provider name for logging. */
    name: string;
    /** Translate a prompt. */
    translate(
        prompt: TranslationPrompt,
        maxOutputTokens: number,
        options?: TranslateOptions,
    ): Promise<TranslationResult>;
    /** Whether the provider has enough config to attempt a call. */
    isConfigured(options?: TranslateOptions): boolean;
}

export interface ProviderOrchestratorResult extends TranslationResult {
    /** Which provider produced this result. */
    provider: string;
    /** Whether a fallback provider was used. */
    fallback: boolean;
}

export interface ProviderOrchestratorOptions {
    metrics?: AppMetricsCollector;
    circuitBreaker?: {
        failureThreshold?: number;
        cooldownMs?: number;
        now?: () => number;
    };
}

export class ProviderOrchestratorError extends Error {
    readonly provider: string;
    readonly errorType: string;

    constructor(
        message: string,
        options: {
            provider: string;
            errorType: string;
            cause?: Error;
        },
    ) {
        super(message, { cause: options.cause });
        this.name = 'ProviderOrchestratorError';
        this.provider = options.provider;
        this.errorType = options.errorType;
    }
}

function resolveProviderOrder(
    mode: TranslationProviderMode,
    providers: Map<string, TranslationProvider>,
): TranslationProvider[] {
    switch (mode) {
        case 'vertex':
            return [providers.get('vertex')].filter(Boolean) as TranslationProvider[];
        case 'openai':
            return [providers.get('openai')].filter(Boolean) as TranslationProvider[];
        case 'vertex+openai':
            return [providers.get('vertex'), providers.get('openai')].filter(
                Boolean,
            ) as TranslationProvider[];
        case 'openai+vertex':
            return [providers.get('openai'), providers.get('vertex')].filter(
                Boolean,
            ) as TranslationProvider[];
        default:
            return [providers.get('vertex')].filter(Boolean) as TranslationProvider[];
    }
}

export function classifyProviderError(error: Error | null): string {
    if (error && 'errorType' in error && typeof error.errorType === 'string') {
        return error.errorType;
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';

    const message = error?.message ?? '';
    if (/429|rate/i.test(message)) return 'rate_limit';
    if (/401|403|auth|api key|not configured/i.test(message)) return 'auth';
    if (/timeout|aborted/i.test(message)) return 'timeout';
    if (/5\d\d|server/i.test(message)) return 'server_error';
    if (/budget/i.test(message)) return 'budget';
    return 'unknown';
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export function createProviderOrchestrator(
    mode: TranslationProviderMode,
    providers: Map<string, TranslationProvider>,
    orchestratorOptions: ProviderOrchestratorOptions = {},
) {
    const logger = appLogger.child({ component: 'provider_orchestrator' });
    const breaker = {
        failureThreshold: orchestratorOptions.circuitBreaker?.failureThreshold ?? 3,
        cooldownMs: orchestratorOptions.circuitBreaker?.cooldownMs ?? 60_000,
        now: orchestratorOptions.circuitBreaker?.now ?? (() => Date.now()),
        state: new Map<string, { failures: number; openUntil: number }>(),
    };

    const isCircuitOpen = (provider: string): boolean => {
        const state = breaker.state.get(provider);
        return state !== undefined && state.openUntil > breaker.now();
    };

    const recordBreakerSuccess = (provider: string): void => {
        breaker.state.delete(provider);
    };

    const recordBreakerFailure = (provider: string): void => {
        const current = breaker.state.get(provider) ?? { failures: 0, openUntil: 0 };
        const failures = current.failures + 1;
        breaker.state.set(provider, {
            failures,
            openUntil:
                failures >= breaker.failureThreshold ? breaker.now() + breaker.cooldownMs : 0,
        });
    };

    return {
        async translate(
            prompt: TranslationPrompt,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<ProviderOrchestratorResult> {
            const metrics = options?.metrics ?? orchestratorOptions.metrics;
            const providerOptions = {
                ...options,
                signal:
                    options?.signal ?? AbortSignal.timeout(DEFAULT_TRANSLATION_PROVIDER_TIMEOUT_MS),
            };
            const ordered = resolveProviderOrder(mode, providers);
            const configured = ordered.filter((p) => p.isConfigured(options));
            const available = configured.filter((p) => !isCircuitOpen(p.name));

            if (configured.length === 0) {
                throw new Error(
                    'No translation provider is configured. Please complete setup in the dashboard.',
                );
            }

            if (available.length === 0) {
                throw new Error(
                    'All configured translation providers are temporarily unavailable.',
                );
            }

            providerOptions.signal.throwIfAborted();

            let lastError: Error | null = null;
            let lastProvider: string | null = null;

            for (let i = 0; i < available.length; i++) {
                const provider = available[i]!;
                const configuredIndex = configured.indexOf(provider);
                const isFallback = configuredIndex > 0;

                try {
                    if (isFallback) {
                        const fromProvider = configured[configuredIndex - 1]!;
                        const fallbackError =
                            lastError ?? new Error(`${fromProvider.name} circuit is open`);
                        metrics?.recordProviderFallback({
                            from: fromProvider.name,
                            to: provider.name,
                            errorType: lastError
                                ? classifyProviderError(lastError)
                                : 'circuit_open',
                            error: fallbackError.message,
                        });
                        logger.warn('provider_orchestrator.fallback', {
                            from: fromProvider.name,
                            to: provider.name,
                            error: fallbackError.message,
                            ...options?.logContext,
                        });
                    }

                    const startedAt = Date.now();
                    const result = await provider.translate(
                        prompt,
                        maxOutputTokens,
                        providerOptions,
                    );
                    recordBreakerSuccess(provider.name);
                    metrics?.recordProviderSuccess(provider.name, {
                        latencyMs: Date.now() - startedAt,
                    });
                    return {
                        ...result,
                        provider: provider.name,
                        fallback: isFallback,
                    };
                } catch (error) {
                    lastError = toError(error);
                    lastProvider = provider.name;
                    recordBreakerFailure(provider.name);
                    metrics?.recordProviderFailure(provider.name, {
                        errorType: classifyProviderError(lastError),
                        error: lastError.message,
                    });
                    logger.error('provider_orchestrator.provider_failed', {
                        provider: provider.name,
                        error: lastError.message,
                        hasNextProvider: i < available.length - 1,
                        ...options?.logContext,
                    });
                    if (providerOptions.signal.aborted) break;
                }
            }

            // All providers failed — preserve the last provider diagnostic for callers.
            throw new ProviderOrchestratorError(lastError?.message ?? 'Unknown provider failure', {
                provider: lastProvider ?? 'unknown',
                errorType: classifyProviderError(lastError),
                cause: lastError ?? undefined,
            });
        },
    };
}

export const _test = { resolveProviderOrder };
