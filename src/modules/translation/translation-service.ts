import { buildTranslationCacheKey, type TranslationCache } from './cache.js';
import type { CooldownManager } from './cooldown.js';
import { ProviderOrchestratorError } from '../../infra/provider-orchestrator.js';
import type { TranslationLog } from '../../shared/log.js';
import { isSameLanguage, localeToLang } from './lang.js';
import type { AppMetricsCollector } from '../../shared/app-metrics.js';
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import { userPreferenceRepository } from './user-preference-repository.js';
import type {
    RuntimeLimitReason,
    TranslationRuntimeLimiter,
    TranslationRuntimeReservation,
} from './translation-runtime-limiter.js';
import { usage } from '../usage/usage.js';
import { translate, resolveSystemPrompt } from './translate.js';
import { sanitizeError } from '../../shared/errors.js';
import {
    appLogger,
    createRequestId,
    type StructuredLogger,
} from '../../shared/structured-logger.js';
import {
    discordMessages,
    getDiscordTranslationCommandMessages,
} from '../../shared/messages/discord-messages.js';
import type { BotStats, TranslationResult } from '../../types.js';

type ServiceCommand = 'babel' | 'translate';
type LangSource = 'option' | 'setlang' | 'locale' | 'auto';
type TranslatorOptions = {
    metrics?: AppMetricsCollector;
    logContext: {
        requestId: string;
        guildId?: string | null;
        userId: string;
        command: ServiceCommand;
    };
};

interface ConfigRepositoryLike {
    getRuntimeConfig(): RuntimeConfig;
    isSetupComplete(): boolean;
}

interface UserPreferenceRepositoryLike {
    getLanguage(userId: string): string | null;
}

interface UsageLike {
    isBudgetExceeded(guildId?: string | null): boolean;
    wouldExceedBudget?(estimate: {
        estimatedInputTokens: number;
        estimatedOutputTokens: number;
        guildId?: string | null;
    }): boolean;
    record(inputTokens: number, outputTokens: number, guildId?: string | null): void;
}

interface Translator {
    (
        text: string,
        targetLanguage?: string,
        options?: TranslatorOptions,
    ): Promise<TranslationResult>;
}

export interface TranslationServiceRequest {
    command: ServiceCommand;
    commandLabel: string;
    guildId?: string | null;
    guildName?: string;
    userId: string;
    userTag: string;
    locale?: string;
    text: string;
    targetLanguageOption?: string | null;
    requestId?: string;
    beforeTranslate?: () => Promise<unknown>;
}

export type TranslationServiceResult =
    | { status: 'blocked'; message: string }
    | {
          status: 'success';
          deferred: boolean;
          translatedText: string;
          originalText: string;
          cached: boolean;
          targetLanguage: string;
          langSource: LangSource;
          inputTokens: number;
          outputTokens: number;
          provider?: string;
          fallback?: boolean;
      }
    | { status: 'error'; deferred: boolean; message: string };

export interface TranslationService {
    process(request: TranslationServiceRequest): Promise<TranslationServiceResult>;
}

export interface TranslationServiceDeps {
    cache: TranslationCache;
    cooldown: CooldownManager;
    log: TranslationLog;
    stats: BotStats;
    configStore?: ConfigRepositoryLike;
    userPreferenceStore?: UserPreferenceRepositoryLike;
    usageTracker?: UsageLike;
    translator?: Translator;
    metrics?: AppMetricsCollector;
    runtimeLimiter?: TranslationRuntimeLimiter;
    logger?: StructuredLogger;
}

interface TargetLanguageDecision {
    targetLanguage: string;
    langSource: LangSource;
}

interface QueueBusyMessages {
    userBusy: string;
    guildBusy: string;
    serviceBusy: string;
}

function resolveQueueBusyMessage(reason: RuntimeLimitReason, messages: QueueBusyMessages): string {
    switch (reason) {
        case 'user_queue_full':
            return messages.userBusy;
        case 'guild_queue_full':
            return messages.guildBusy;
        case 'global_queue_full':
            return messages.serviceBusy;
        case 'queue_wait_timeout':
            return messages.serviceBusy;
    }
}

function createTranslatorOptions(
    logContext: TranslatorOptions['logContext'],
    metrics?: AppMetricsCollector,
): TranslatorOptions {
    if (metrics) {
        return { logContext, metrics };
    }

    return { logContext };
}

function suggestedActionForErrorType(errorType: string): string {
    switch (errorType) {
        case 'rate_limit':
            return 'Provider rate limit reached. Try fallback mode or reduce concurrency.';
        case 'auth':
            return 'Check provider API key and provider configuration.';
        case 'timeout':
            return 'Provider timed out. Check provider status or use fallback mode.';
        case 'budget':
            return 'Review global or server budget limits.';
        case 'server_error':
            return 'Provider returned a server error. Check provider status or use fallback mode.';
        default:
            return 'Check structured logs for this request id.';
    }
}

function classifyTranslationError(message: string): { errorType: string; suggestedAction: string } {
    if (/429|rate/i.test(message)) {
        return {
            errorType: 'rate_limit',
            suggestedAction: suggestedActionForErrorType('rate_limit'),
        };
    }
    if (/401|403|auth|api key|not configured/i.test(message)) {
        return {
            errorType: 'auth',
            suggestedAction: suggestedActionForErrorType('auth'),
        };
    }
    if (/timeout|aborted/i.test(message)) {
        return {
            errorType: 'timeout',
            suggestedAction: suggestedActionForErrorType('timeout'),
        };
    }
    if (/budget/i.test(message)) {
        return {
            errorType: 'budget',
            suggestedAction: suggestedActionForErrorType('budget'),
        };
    }
    if (/5\d\d|server/i.test(message)) {
        return {
            errorType: 'server_error',
            suggestedAction: suggestedActionForErrorType('server_error'),
        };
    }

    return {
        errorType: 'unknown',
        suggestedAction: suggestedActionForErrorType('unknown'),
    };
}

export function createTranslationService({
    cache,
    cooldown,
    log,
    stats,
    configStore = configRepository,
    userPreferenceStore = userPreferenceRepository,
    usageTracker = usage,
    translator = translate,
    metrics,
    runtimeLimiter,
    logger = appLogger.child({ component: 'translation_service' }),
}: TranslationServiceDeps): TranslationService {
    return {
        async process(request: TranslationServiceRequest): Promise<TranslationServiceResult> {
            const messages = getDiscordTranslationCommandMessages(request.command);
            const requestId = request.requestId ?? createRequestId();
            const requestLogger = logger.child({
                requestId,
                guildId: request.guildId ?? null,
                userId: request.userId,
                command: request.command,
            });
            requestLogger.info('translation.request.started', {
                locale: request.locale ?? null,
                textLength: request.text.length,
                hasTargetLanguageOption: !!(
                    request.targetLanguageOption && request.targetLanguageOption !== 'auto'
                ),
            });

            if (!configStore.isSetupComplete()) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'setup_incomplete',
                });
                return { status: 'blocked', message: messages.setupIncomplete };
            }

            const runtimeConfig = configStore.getRuntimeConfig();
            const allowedGuilds = runtimeConfig.allowedGuildIds;
            if (!request.guildId || !allowedGuilds.includes(request.guildId)) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'guild_not_allowed',
                });
                return { status: 'blocked', message: discordMessages.unauthorizedGuild() };
            }

            if (usageTracker.isBudgetExceeded(request.guildId)) {
                metrics?.recordBudgetExceeded();
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'budget_exceeded',
                });
                return { status: 'blocked', message: messages.budgetExceeded };
            }

            const cooldownState = cooldown.check(request.userId);
            if (!cooldownState.allowed) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'cooldown_active',
                    cooldownRemainingSeconds: cooldownState.remaining,
                });
                return {
                    status: 'blocked',
                    message: discordMessages.cooldownRemaining(cooldownState.remaining),
                };
            }

            const originalText = request.text;
            if (!originalText.trim()) {
                requestLogger.warn('translation.request.blocked', { blockReason: 'empty_text' });
                return { status: 'blocked', message: messages.emptyText };
            }

            const maxInputLength = runtimeConfig.maxInputLength || 2000;
            if (originalText.length > maxInputLength) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'input_too_long',
                    textLength: originalText.length,
                    maxInputLength,
                });
                return {
                    status: 'blocked',
                    message: discordMessages.textTooLong(originalText.length, maxInputLength),
                };
            }

            if (
                usageTracker.wouldExceedBudget?.({
                    estimatedInputTokens: Math.ceil(originalText.length / 4),
                    estimatedOutputTokens: runtimeConfig.maxOutputTokens || 1000,
                    guildId: request.guildId,
                })
            ) {
                metrics?.recordBudgetExceeded();
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'budget_estimate_exceeded',
                });
                return { status: 'blocked', message: messages.budgetExceeded };
            }

            const { targetLanguage, langSource } = resolveTargetLanguage(
                request,
                userPreferenceStore,
            );
            if (isSameLanguage(originalText, targetLanguage, request.locale)) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'same_language',
                    targetLanguage,
                    langSource,
                });
                return { status: 'blocked', message: messages.sameLanguage };
            }

            const prompt = resolveSystemPrompt(targetLanguage, runtimeConfig.translationPrompt);
            const cacheKey = buildTranslationCacheKey({
                sourceText: originalText,
                targetLanguage,
                geminiModel: runtimeConfig.geminiModel,
                prompt,
                maxOutputTokens: runtimeConfig.maxOutputTokens || 1000,
            });

            let deferred = false;
            let reservation: TranslationRuntimeReservation | null = null;

            try {
                let translated = cache.get(cacheKey);
                let cached = translated !== null;
                let inputTokens = 0;
                let outputTokens = 0;
                let provider: string | undefined;
                let fallback: boolean | undefined;
                requestLogger.info(cached ? 'translation.cache.hit' : 'translation.cache.miss', {
                    targetLanguage,
                    langSource,
                });

                if (!cached && runtimeLimiter) {
                    const admission = runtimeLimiter.acquire({
                        guildId: request.guildId ?? null,
                        userId: request.userId,
                    });

                    if (!admission.accepted) {
                        requestLogger.warn('translation.request.blocked', {
                            blockReason: admission.reason,
                            runtime: admission.snapshot,
                        });
                        return {
                            status: 'blocked',
                            message: resolveQueueBusyMessage(admission.reason, messages),
                        };
                    }

                    reservation = admission.reservation;
                    requestLogger.info(
                        reservation.queued
                            ? 'translation.queue.enqueued'
                            : 'translation.queue.acquired',
                        {
                            runtime: runtimeLimiter.snapshot(),
                        },
                    );
                }

                if (request.beforeTranslate) {
                    await request.beforeTranslate();
                    deferred = true;
                    requestLogger.info('translation.request.deferred');
                }

                cooldown.set(request.userId);
                stats.totalTranslations++;

                if (!translated) {
                    if (reservation) {
                        translated = await reservation.run(async (meta) => {
                            if (meta.queued) {
                                requestLogger.info('translation.queue.started', {
                                    waitMs: meta.waitMs,
                                    runtime: meta.snapshot,
                                });
                            }

                            const queuedCached = cache.get(cacheKey);
                            if (queuedCached) {
                                requestLogger.info('translation.cache.hit_after_queue', {
                                    targetLanguage,
                                    langSource,
                                    waitMs: meta.waitMs,
                                });
                                cached = true;
                                return queuedCached;
                            }

                            stats.apiCalls++;
                            metrics?.recordTranslationApiCall();
                            const result = await translator(
                                originalText,
                                targetLanguage,
                                createTranslatorOptions(
                                    {
                                        requestId,
                                        guildId: request.guildId ?? null,
                                        userId: request.userId,
                                        command: request.command,
                                    },
                                    metrics,
                                ),
                            );
                            cache.set(cacheKey, result.text);
                            inputTokens = result.inputTokens;
                            outputTokens = result.outputTokens;
                            provider = result.provider;
                            fallback = result.fallback;
                            usageTracker.record(
                                result.inputTokens,
                                result.outputTokens,
                                request.guildId,
                            );
                            return result.text;
                        });
                    } else {
                        stats.apiCalls++;
                        metrics?.recordTranslationApiCall();
                        const result = await translator(
                            originalText,
                            targetLanguage,
                            createTranslatorOptions(
                                {
                                    requestId,
                                    guildId: request.guildId ?? null,
                                    userId: request.userId,
                                    command: request.command,
                                },
                                metrics,
                            ),
                        );
                        translated = result.text;
                        inputTokens = result.inputTokens;
                        outputTokens = result.outputTokens;
                        provider = result.provider;
                        fallback = result.fallback;
                        cache.set(cacheKey, translated);
                        usageTracker.record(
                            result.inputTokens,
                            result.outputTokens,
                            request.guildId,
                        );
                    }
                }

                metrics?.recordTranslationSuccess({ cached });
                log.add({
                    guildId: request.guildId,
                    guildName: request.guildName,
                    userId: request.userId,
                    userTag: request.userTag,
                    contentPreview: originalText,
                    cached,
                    targetLanguage,
                    langSource,
                });
                requestLogger.info('translation.request.completed', {
                    cached,
                    targetLanguage,
                    langSource,
                    translatedLength: translated.length,
                });

                return {
                    status: 'success',
                    deferred,
                    translatedText: translated,
                    originalText,
                    cached,
                    targetLanguage,
                    langSource,
                    inputTokens,
                    outputTokens,
                    provider,
                    fallback,
                };
            } catch (error) {
                reservation?.cancel();
                const caughtError = error instanceof Error ? error : new Error(String(error));
                const message = caughtError.message;
                const sanitizedMessage = sanitizeError(message);
                const diagnostic =
                    caughtError instanceof ProviderOrchestratorError
                        ? {
                              errorType: caughtError.errorType,
                              suggestedAction: suggestedActionForErrorType(caughtError.errorType),
                          }
                        : classifyTranslationError(message);
                metrics?.recordTranslationFailure();
                log.addError({
                    guildId: request.guildId,
                    guildName: request.guildName,
                    userId: request.userId,
                    userTag: request.userTag,
                    error: sanitizedMessage,
                    command: request.commandLabel,
                    requestId,
                    provider:
                        caughtError instanceof ProviderOrchestratorError
                            ? caughtError.provider
                            : undefined,
                    errorType: diagnostic.errorType,
                    suggestedAction: diagnostic.suggestedAction,
                });
                requestLogger.error('translation.request.failed', {
                    error: sanitizedMessage,
                    errorType: diagnostic.errorType,
                });

                return {
                    status: 'error',
                    deferred,
                    message: discordMessages.translationFailed(sanitizedMessage),
                };
            }
        },
    };
}

function resolveTargetLanguage(
    request: Pick<TranslationServiceRequest, 'locale' | 'targetLanguageOption' | 'userId'>,
    preferenceStore: UserPreferenceRepositoryLike,
): TargetLanguageDecision {
    const userPreference = preferenceStore.getLanguage(request.userId);
    const localeLanguage = localeToLang(request.locale);

    if (request.targetLanguageOption && request.targetLanguageOption !== 'auto') {
        return {
            targetLanguage: request.targetLanguageOption,
            langSource: 'option',
        };
    }

    if (userPreference) {
        return {
            targetLanguage: userPreference,
            langSource: 'setlang',
        };
    }

    if (localeLanguage) {
        return {
            targetLanguage: localeLanguage,
            langSource: 'locale',
        };
    }

    return {
        targetLanguage: 'auto',
        langSource: 'auto',
    };
}

export const _test = {
    resolveTargetLanguage,
    resolveQueueBusyMessage,
    classifyTranslationError,
};
