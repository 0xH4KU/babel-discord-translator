import { buildTranslationCacheKey, type TranslationCache } from './cache.js';
import type { CooldownManager } from './cooldown.js';
import type { AccessMode, AppProfile } from '../../apps/app-profile.js';
import { ProviderOrchestratorError } from '../../infra/provider-orchestrator.js';
import type { TranslationLog } from '../../shared/log.js';
import { isSameLanguage } from './lang.js';
import type { AppMetricsCollector } from '../../shared/app-metrics.js';
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import { userPreferenceRepository } from './user-preference-repository.js';
import { guildGlossaryRepository } from './guild-glossary-repository.js';
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
import { decideTranslationAccess } from './access-policy.js';
import {
    createTranslationScope,
    getBillingUsageUserId,
    getRuntimeLimiterUserId,
} from './translation-scope.js';
import {
    resolveTargetLanguage,
    type LangSource,
    type UserPreferenceRepositoryLike,
} from './target-language.js';
import {
    buildGlossaryVersion,
    classifyTranslationError,
    createTranslatorOptions,
    suggestedActionForErrorType,
    type ServiceCommand,
    type TranslatorOptions,
} from './translation-service-helpers.js';
import type { BotStats, GuildGlossaryEntry, TranslationResult } from '../../shared/types.js';

interface ConfigRepositoryLike {
    getRuntimeConfig(): RuntimeConfig;
    isSetupComplete(): boolean;
}

interface GlossaryRepositoryLike {
    listEntries(guildId: string): GuildGlossaryEntry[];
}

interface UsageLike {
    isBudgetExceeded(scope?: { guildId?: string | null; userId?: string | null }): boolean;
    wouldExceedBudget?(estimate: {
        estimatedInputTokens: number;
        estimatedOutputTokens: number;
        guildId?: string | null;
        userId?: string | null;
    }): boolean;
    record(
        inputTokens: number,
        outputTokens: number,
        scope?: { guildId?: string | null; userId?: string | null },
    ): void;
}

interface PendingUserInstallOwnerRepositoryLike {
    recordSeen(userId: string): void;
}

interface Translator {
    (
        text: string,
        targetLanguage?: string,
        options?: TranslatorOptions,
    ): Promise<TranslationResult>;
}

interface InFlightTranslation {
    promise: Promise<TranslationResult>;
}

export interface TranslationServiceRequest {
    command: ServiceCommand;
    commandLabel: string;
    guildId?: string | null;
    guildName?: string;
    userId: string;
    billingUserId?: string | null;
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
    appProfileId?: AppProfile['id'];
    configStore?: ConfigRepositoryLike;
    userPreferenceStore?: UserPreferenceRepositoryLike;
    glossaryRepository?: GlossaryRepositoryLike;
    usageTracker?: UsageLike;
    translator?: Translator;
    metrics?: AppMetricsCollector;
    runtimeLimiter?: TranslationRuntimeLimiter;
    logger?: StructuredLogger;
    accessMode?: AccessMode;
    enableGuildGlossary?: boolean;
    pendingUserInstallOwnerRepository?: PendingUserInstallOwnerRepositoryLike;
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

function buildProviderFingerprint(config: RuntimeConfig): string {
    const mode = config.translationProvider || 'vertex';
    const vertex = [
        config.gcpProject,
        config.gcpLocation || 'global',
        config.geminiModel,
        config.vertexAiApiKey,
    ].join('|');
    const openai = [config.openaiBaseUrl, config.openaiModel, config.openaiApiKey].join('|');

    return [mode, vertex, openai].join('::');
}

function createInFlightTranslation() {
    let resolve!: (value: TranslationResult | PromiseLike<TranslationResult>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<TranslationResult>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {
        entry: { promise },
        resolve,
        reject,
    };
}

export function createTranslationService({
    cache,
    cooldown,
    log,
    stats,
    configStore = configRepository,
    userPreferenceStore = userPreferenceRepository,
    glossaryRepository = guildGlossaryRepository,
    usageTracker = usage,
    translator = translate,
    metrics,
    runtimeLimiter,
    logger = appLogger.child({ component: 'translation_service' }),
    appProfileId,
    accessMode = 'guild',
    enableGuildGlossary = true,
    pendingUserInstallOwnerRepository,
}: TranslationServiceDeps): TranslationService {
    const inFlightTranslations = new Map<string, InFlightTranslation>();

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
            const scope = createTranslationScope(request);
            const accessDecision = decideTranslationAccess(accessMode, runtimeConfig, scope);
            if (!accessDecision.authorized) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: accessDecision.blockReason,
                });
                if (accessDecision.pendingUserId) {
                    pendingUserInstallOwnerRepository?.recordSeen(accessDecision.pendingUserId);
                }

                return {
                    status: 'blocked',
                    message:
                        accessDecision.blockReason === 'user_not_allowed'
                            ? discordMessages.unauthorizedUser()
                            : discordMessages.unauthorizedGuild(),
                };
            }

            const usageScope = {
                guildId: request.guildId ?? null,
                userId: accessMode === 'user-install' ? getBillingUsageUserId(scope) : null,
            };

            if (usageTracker.isBudgetExceeded(usageScope)) {
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
                    ...usageScope,
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
            const glossaryEntries =
                enableGuildGlossary && request.guildId
                    ? glossaryRepository.listEntries(request.guildId)
                    : [];
            const glossaryVersion = buildGlossaryVersion(glossaryEntries);
            const cacheKey = buildTranslationCacheKey({
                sourceText: originalText,
                targetLanguage,
                geminiModel: runtimeConfig.geminiModel,
                providerFingerprint: buildProviderFingerprint(runtimeConfig),
                prompt,
                maxOutputTokens: runtimeConfig.maxOutputTokens || 1000,
                glossaryVersion,
            });

            let deferred = false;
            let reservation: TranslationRuntimeReservation | null = null;
            let leaderInFlight: InFlightTranslation | null = null;
            let resolveLeaderInFlight:
                | ((value: TranslationResult | PromiseLike<TranslationResult>) => void)
                | null = null;
            let rejectLeaderInFlight: ((reason?: unknown) => void) | null = null;

            try {
                let translated = cache.get(cacheKey);
                let cached = translated !== null;
                let inputTokens = 0;
                let outputTokens = 0;
                let provider: string | undefined;
                let fallback: boolean | undefined;
                let joinedInFlight = false;
                requestLogger.info(cached ? 'translation.cache.hit' : 'translation.cache.miss', {
                    targetLanguage,
                    langSource,
                });

                const inFlight = !cached ? inFlightTranslations.get(cacheKey) : undefined;
                if (inFlight) {
                    requestLogger.info('translation.inflight.joined', {
                        targetLanguage,
                        langSource,
                    });

                    if (request.beforeTranslate) {
                        await request.beforeTranslate();
                        deferred = true;
                        requestLogger.info('translation.request.deferred');
                    }

                    cooldown.set(request.userId);
                    stats.totalTranslations++;

                    const result = await inFlight.promise;
                    translated = result.text;
                    cached = true;
                    inputTokens = 0;
                    outputTokens = 0;
                    provider = result.provider;
                    fallback = result.fallback;
                    joinedInFlight = true;
                }

                if (!cached && !joinedInFlight) {
                    const inFlightTranslation = createInFlightTranslation();
                    leaderInFlight = inFlightTranslation.entry;
                    resolveLeaderInFlight = inFlightTranslation.resolve;
                    rejectLeaderInFlight = inFlightTranslation.reject;
                    inFlightTranslations.set(cacheKey, leaderInFlight);
                    void leaderInFlight.promise.catch(() => undefined);
                }

                if (!cached && runtimeLimiter) {
                    const admission = runtimeLimiter.acquire({
                        guildId: request.guildId ?? null,
                        userId: getRuntimeLimiterUserId(scope),
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

                if (!joinedInFlight && request.beforeTranslate) {
                    await request.beforeTranslate();
                    deferred = true;
                    requestLogger.info('translation.request.deferred');
                }

                if (!joinedInFlight) {
                    cooldown.set(request.userId);
                    stats.totalTranslations++;
                }

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
                                resolveLeaderInFlight?.({
                                    text: queuedCached,
                                    inputTokens: 0,
                                    outputTokens: 0,
                                });
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
                                        userId: getRuntimeLimiterUserId(scope),
                                        command: request.command,
                                    },
                                    metrics,
                                    glossaryEntries,
                                    runtimeConfig,
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
                                usageScope,
                            );
                            resolveLeaderInFlight?.(result);
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
                                    userId: getRuntimeLimiterUserId(scope),
                                    command: request.command,
                                },
                                metrics,
                                glossaryEntries,
                                runtimeConfig,
                            ),
                        );
                        translated = result.text;
                        inputTokens = result.inputTokens;
                        outputTokens = result.outputTokens;
                        provider = result.provider;
                        fallback = result.fallback;
                        cache.set(cacheKey, translated);
                        usageTracker.record(result.inputTokens, result.outputTokens, usageScope);
                        resolveLeaderInFlight?.(result);
                    }
                }

                metrics?.recordTranslationSuccess({ cached });
                log.add({
                    appProfileId,
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
                rejectLeaderInFlight?.(error);
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
                    appProfileId,
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
            } finally {
                if (leaderInFlight && inFlightTranslations.get(cacheKey) === leaderInFlight) {
                    inFlightTranslations.delete(cacheKey);
                }
            }
        },
    };
}

export const _test = {
    resolveTargetLanguage,
    resolveQueueBusyMessage,
    classifyTranslationError,
    buildGlossaryVersion,
};
