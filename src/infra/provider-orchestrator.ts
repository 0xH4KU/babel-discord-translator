import type { StructuredLogFields } from '../shared/structured-logger.js';
import { appLogger } from '../shared/structured-logger.js';
import type { AppMetricsCollector } from '../shared/app-metrics.js';
import type {
    ImageTranslationRequest,
    ImageTranslationResult,
    LensRegion,
    TranslationPrompt,
    TranslationProviderMode,
    TranslationResult,
} from '../shared/types.js';
import type { RuntimeConfig } from '../modules/config/config-repository.js';
import {
    extractRegionTranslations,
    normalizeRegionTranslation,
} from '../modules/translation/lens-regions.js';
import { ProviderResponseError } from './provider-errors.js';

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
    supportsImageInput(options?: TranslateOptions): boolean;
    translateImage(
        request: ImageTranslationRequest,
        maxOutputTokens: number,
        options?: TranslateOptions,
    ): Promise<ImageTranslationResult>;
}

export interface ProviderOrchestratorResult extends TranslationResult {
    /** Which provider produced this result. */
    provider: string;
    /** Whether a fallback provider was used. */
    fallback: boolean;
}

export interface VisionTranslationResolution {
    hasText: boolean;
    prompt?: TranslationPrompt;
    boxes?: LensRegion['box_2d'][];
}

export interface ProviderImageTranslationRequest extends ImageTranslationRequest {
    resolveVision: () => Promise<VisionTranslationResolution>;
}

export interface ProviderImageOrchestratorResult extends ImageTranslationResult {
    provider: string;
    fallback: boolean;
    route: 'direct' | 'vision';
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
    readonly inputTokens: number;
    readonly outputTokens: number;

    constructor(
        message: string,
        options: {
            provider: string;
            errorType: string;
            cause?: Error;
            inputTokens?: number;
            outputTokens?: number;
        },
    ) {
        super(message, { cause: options.cause });
        this.name = 'ProviderOrchestratorError';
        this.provider = options.provider;
        this.errorType = options.errorType;
        this.inputTokens = options.inputTokens ?? 0;
        this.outputTokens = options.outputTokens ?? 0;
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

class ProviderRouteError extends Error {
    constructor(
        message: string,
        readonly route: 'vision',
        options?: { cause?: Error },
    ) {
        super(message, options);
        this.name = 'ProviderRouteError';
    }
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

    const breakerKey = (operation: 'text' | 'image', provider: string): string =>
        `${operation}:${provider}`;

    const isCircuitOpen = (operation: 'text' | 'image', provider: string): boolean => {
        const state = breaker.state.get(breakerKey(operation, provider));
        return state !== undefined && state.openUntil > breaker.now();
    };

    const recordBreakerSuccess = (operation: 'text' | 'image', provider: string): void => {
        breaker.state.delete(breakerKey(operation, provider));
    };

    const recordBreakerFailure = (operation: 'text' | 'image', provider: string): void => {
        const key = breakerKey(operation, provider);
        const current = breaker.state.get(key) ?? { failures: 0, openUntil: 0 };
        const failures = current.failures + 1;
        breaker.state.set(key, {
            failures,
            openUntil:
                failures >= breaker.failureThreshold ? breaker.now() + breaker.cooldownMs : 0,
        });
    };

    const runProviders = async <T extends TranslationResult>(
        operation: 'text' | 'image',
        options: TranslateOptions | undefined,
        attempt: (
            provider: TranslationProvider,
            providerOptions: TranslateOptions,
        ) => Promise<{ result: T; providerCalled: boolean; route?: 'direct' | 'vision' }>,
    ): Promise<T & { provider: string; fallback: boolean }> => {
        const metrics = options?.metrics ?? orchestratorOptions.metrics;
        const ordered = resolveProviderOrder(mode, providers);
        const configured = ordered.filter((provider) => provider.isConfigured(options));
        const available = configured.filter((provider) => !isCircuitOpen(operation, provider.name));

        if (configured.length === 0) {
            throw new Error(
                'No translation provider is configured. Please complete setup in the dashboard.',
            );
        }
        if (available.length === 0) {
            throw new Error('All configured translation providers are temporarily unavailable.');
        }

        options?.signal?.throwIfAborted();
        let lastError: Error | null = null;
        let lastProvider: string | null = null;
        let failedInputTokens = 0;
        let failedOutputTokens = 0;

        for (let index = 0; index < available.length; index++) {
            const provider = available[index]!;
            const orderedIndex = ordered.indexOf(provider);
            const isFallback = orderedIndex > 0;
            const attemptSignal = AbortSignal.timeout(DEFAULT_TRANSLATION_PROVIDER_TIMEOUT_MS);
            const providerOptions: TranslateOptions = {
                ...options,
                signal: options?.signal
                    ? AbortSignal.any([options.signal, attemptSignal])
                    : attemptSignal,
            };

            try {
                if (isFallback) {
                    const fromProvider = ordered[orderedIndex - 1]!;
                    const fallbackErrorType = lastError
                        ? classifyProviderError(lastError)
                        : configured.includes(fromProvider)
                          ? 'circuit_open'
                          : 'configuration';
                    const fallbackError =
                        lastError ??
                        new Error(
                            configured.includes(fromProvider)
                                ? `${fromProvider.name} circuit is open`
                                : `${fromProvider.name} is not configured`,
                        );
                    metrics?.recordProviderFallback({
                        from: fromProvider.name,
                        to: provider.name,
                        errorType: fallbackErrorType,
                        error: fallbackError.message,
                    });
                    logger.warn('provider_orchestrator.fallback', {
                        from: fromProvider.name,
                        to: provider.name,
                        error: fallbackError.message,
                        fallbackReason: !lastError
                            ? fallbackErrorType
                            : lastError instanceof ProviderRouteError
                              ? `${lastError.route}_failed`
                              : classifyProviderError(lastError),
                        ...options?.logContext,
                    });
                }

                const startedAt = Date.now();
                const outcome = await attempt(provider, providerOptions);
                if (outcome.providerCalled) {
                    recordBreakerSuccess(operation, provider.name);
                    metrics?.recordProviderSuccess(provider.name, {
                        latencyMs: Date.now() - startedAt,
                    });
                }
                if (
                    'warnings' in outcome.result &&
                    Array.isArray(outcome.result.warnings) &&
                    outcome.result.warnings.length > 0
                ) {
                    logger.warn('provider_orchestrator.image_regions_invalid', {
                        route: outcome.route,
                        provider: provider.name,
                        warnings: outcome.result.warnings,
                        ...options?.logContext,
                    });
                }
                if (outcome.route) {
                    logger.info('provider_orchestrator.image_completed', {
                        route: outcome.route,
                        provider: provider.name,
                        fallback: isFallback,
                        regionCount:
                            'regions' in outcome.result && Array.isArray(outcome.result.regions)
                                ? outcome.result.regions.length
                                : 0,
                        ...options?.logContext,
                    });
                }
                return {
                    ...outcome.result,
                    inputTokens: failedInputTokens + outcome.result.inputTokens,
                    outputTokens: failedOutputTokens + outcome.result.outputTokens,
                    provider: provider.name,
                    fallback: isFallback,
                };
            } catch (error) {
                lastError = toError(error);
                lastProvider = provider.name;
                if (lastError instanceof ProviderResponseError) {
                    failedInputTokens += lastError.inputTokens;
                    failedOutputTokens += lastError.outputTokens;
                }
                if (lastError instanceof ProviderRouteError) {
                    logger.warn('provider_orchestrator.route_failed', {
                        route: lastError.route,
                        provider: provider.name,
                        error: lastError.message,
                        hasNextProvider: index < available.length - 1,
                        ...options?.logContext,
                    });
                } else {
                    recordBreakerFailure(operation, provider.name);
                    metrics?.recordProviderFailure(provider.name, {
                        errorType: classifyProviderError(lastError),
                        error: lastError.message,
                    });
                    logger.error('provider_orchestrator.provider_failed', {
                        provider: provider.name,
                        error: lastError.message,
                        hasNextProvider: index < available.length - 1,
                        ...options?.logContext,
                    });
                }
                if (options?.signal?.aborted) break;
            }
        }

        throw new ProviderOrchestratorError(lastError?.message ?? 'Unknown provider failure', {
            provider: lastProvider ?? 'unknown',
            errorType: classifyProviderError(lastError),
            cause: lastError ?? undefined,
            inputTokens: failedInputTokens,
            outputTokens: failedOutputTokens,
        });
    };

    return {
        async translate(
            prompt: TranslationPrompt,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<ProviderOrchestratorResult> {
            return runProviders('text', options, async (provider, providerOptions) => ({
                result: await provider.translate(prompt, maxOutputTokens, providerOptions),
                providerCalled: true,
            }));
        },

        async translateImage(
            request: ProviderImageTranslationRequest,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<ProviderImageOrchestratorResult> {
            let visionPromise: Promise<VisionTranslationResolution> | null = null;
            const resolveVision = (): Promise<VisionTranslationResolution> =>
                (visionPromise ??= request.resolveVision());

            return runProviders<ImageTranslationResult>(
                'image',
                options,
                async (provider, providerOptions) => {
                    if (provider.supportsImageInput(providerOptions)) {
                        const result = await provider.translateImage(
                            request,
                            maxOutputTokens,
                            providerOptions,
                        );
                        return {
                            result: { ...result, route: 'direct' as const },
                            providerCalled: true,
                            route: 'direct' as const,
                        };
                    }

                    let vision: VisionTranslationResolution;
                    try {
                        vision = await resolveVision();
                    } catch (error) {
                        const cause = toError(error);
                        throw new ProviderRouteError(cause.message, 'vision', { cause });
                    }
                    if (!vision.hasText) {
                        return {
                            result: {
                                text: '',
                                hasText: false,
                                regions: [],
                                inputTokens: 0,
                                outputTokens: 0,
                                route: 'vision' as const,
                            },
                            providerCalled: false,
                            route: 'vision' as const,
                        };
                    }
                    if (!vision.prompt) {
                        throw new ProviderRouteError(
                            'Cloud Vision returned no translation prompt',
                            'vision',
                        );
                    }

                    const translated = await provider.translate(
                        vision.prompt,
                        maxOutputTokens,
                        providerOptions,
                    );
                    const boxes = vision.boxes ?? [];
                    const normalized = normalizeRegionTranslation(translated.text, boxes.length);
                    const regions = normalized.markersMatch
                        ? extractRegionTranslations(translated.text, boxes)
                        : [];
                    const warnings =
                        boxes.length === 0 || regions.length !== boxes.length
                            ? ['invalid_regions']
                            : undefined;
                    return {
                        result: {
                            ...translated,
                            text: normalized.displayText,
                            hasText: true,
                            regions,
                            route: 'vision' as const,
                            ...(warnings ? { warnings } : {}),
                        },
                        providerCalled: true,
                        route: 'vision' as const,
                    };
                },
            ) as Promise<ProviderImageOrchestratorResult>;
        },
    };
}

export const _test = { resolveProviderOrder };
