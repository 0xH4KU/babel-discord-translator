import { buildTranslationCacheKey, type TranslationCache } from './cache.js';
import type { CooldownManager } from './cooldown.js';
import type { AccessMode, AppProfile } from '../../apps/app-profile.js';
import { ProviderOrchestratorError } from '../../infra/provider-orchestrator.js';
import type { TranslationLog } from '../../shared/log.js';
import {
    createProfileMetricsCollector,
    type AppMetricsCollector,
} from '../../shared/app-metrics.js';
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import { store } from '../../persistence/store.js';
import type {
    RuntimeLimitReason,
    TranslationRuntimeLimiter,
    TranslationRuntimeReservation,
} from './translation-runtime-limiter.js';
import { usage, type UsageBudgetReservation } from '../usage/usage.js';
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
import { createTranslationScope, getEffectiveUserId } from './translation-scope.js';
import {
    resolveTargetLanguage,
    type LangSource,
    type UserPreferenceRepositoryLike,
} from './target-language.js';
import {
    buildGlossaryVersion,
    classifyTranslationError,
    selectGlossaryEntriesForTarget,
    suggestedActionForErrorType,
    type ServiceCommand,
    type TranslatorOptions,
} from './translation-service-helpers.js';
import type { GuildGlossaryEntry, TranslationResult } from '../../shared/types.js';

interface ConfigRepositoryLike {
    getRuntimeConfig(): RuntimeConfig;
    isSetupComplete(): boolean;
}

interface GlossaryRepositoryLike {
    listGuildGlossary(guildId: string): GuildGlossaryEntry[];
}

interface UsageLike {
    tryReserveBudget(estimate: {
        estimatedInputTokens: number;
        estimatedOutputTokens: number;
        guildId?: string | null;
        userId?: string | null;
    }): UsageBudgetReservation | null;
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
    bypassAccessControl?: boolean;
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
    appProfileId?: AppProfile['id'];
    configStore?: ConfigRepositoryLike;
    userPreferenceStore?: UserPreferenceRepositoryLike;
    glossaryRepository?: GlossaryRepositoryLike;
    usageTracker?: UsageLike;
    translator?: Translator;
    metrics: AppMetricsCollector;
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
    configStore = configRepository,
    userPreferenceStore = store,
    glossaryRepository = store,
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
    const profileMetrics = createProfileMetricsCollector(metrics, appProfileId);

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
            const accessDecision = request.bypassAccessControl
                ? { authorized: true }
                : decideTranslationAccess(accessMode, runtimeConfig, scope);
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
                guildId: accessMode === 'guild' ? (request.guildId ?? null) : null,
                userId: accessMode === 'user-install' ? getEffectiveUserId(scope) : null,
            };

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

            const { targetLanguage, langSource } = resolveTargetLanguage(
                request,
                userPreferenceStore,
                { accessMode },
            );
            const prompt = resolveSystemPrompt(targetLanguage, runtimeConfig.translationPrompt);
            const glossaryEntries =
                enableGuildGlossary && request.guildId
                    ? glossaryRepository.listGuildGlossary(request.guildId)
                    : [];
            const selectedGlossaryEntries = selectGlossaryEntriesForTarget(
                glossaryEntries,
                targetLanguage,
            );
            const glossaryVersion = buildGlossaryVersion(selectedGlossaryEntries);
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
            let budgetReservation: UsageBudgetReservation | null = null;
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

                    const result = await inFlight.promise;
                    translated = result.text;
                    cached = true;
                    inputTokens = 0;
                    outputTokens = 0;
                    provider = result.provider;
                    fallback = result.fallback;
                    joinedInFlight = true;
                }

                if (!cached && runtimeLimiter) {
                    const admission = runtimeLimiter.acquire({
                        guildId: request.guildId ?? null,
                        userId: getEffectiveUserId(scope),
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

                if (!cached && !joinedInFlight) {
                    budgetReservation = usageTracker.tryReserveBudget({
                        estimatedInputTokens: Math.ceil(originalText.length / 4),
                        estimatedOutputTokens: runtimeConfig.maxOutputTokens || 1000,
                        ...usageScope,
                    });
                    if (!budgetReservation) {
                        reservation?.cancel();
                        profileMetrics?.recordBudgetExceeded();
                        requestLogger.warn('translation.request.blocked', {
                            blockReason: 'budget_exceeded',
                        });
                        return { status: 'blocked', message: messages.budgetExceeded };
                    }

                    const inFlightTranslation = createInFlightTranslation();
                    leaderInFlight = inFlightTranslation.entry;
                    resolveLeaderInFlight = inFlightTranslation.resolve;
                    rejectLeaderInFlight = inFlightTranslation.reject;
                    inFlightTranslations.set(cacheKey, leaderInFlight);
                    void leaderInFlight.promise.catch(() => undefined);
                }

                if (!joinedInFlight && request.beforeTranslate) {
                    await request.beforeTranslate();
                    deferred = true;
                    requestLogger.info('translation.request.deferred');
                }

                if (!joinedInFlight) {
                    cooldown.set(request.userId);
                }

                if (!translated) {
                    const translateAndRecord = async (): Promise<string> => {
                        profileMetrics?.recordTranslationApiCall();
                        const result = await translator(originalText, targetLanguage, {
                            logContext: {
                                requestId,
                                guildId: request.guildId ?? null,
                                userId: getEffectiveUserId(scope),
                                command: request.command,
                            },
                            metrics: profileMetrics,
                            ...(selectedGlossaryEntries.length > 0
                                ? { glossaryEntries: selectedGlossaryEntries }
                                : {}),
                            runtimeConfig,
                        });
                        cache.set(cacheKey, result.text);
                        inputTokens = result.inputTokens;
                        outputTokens = result.outputTokens;
                        provider = result.provider;
                        fallback = result.fallback;
                        budgetReservation?.settle(result.inputTokens, result.outputTokens);
                        budgetReservation = null;
                        resolveLeaderInFlight?.(result);
                        return result.text;
                    };

                    if (reservation) {
                        translated = await reservation.run(async (meta) => {
                            if (meta.queued) {
                                requestLogger.info('translation.queue.started', {
                                    waitMs: meta.waitMs,
                                    runtime: meta.snapshot,
                                });
                            }

                            const queuedCached = meta.queued ? cache.get(cacheKey) : null;
                            if (queuedCached) {
                                budgetReservation?.release();
                                budgetReservation = null;
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

                            return translateAndRecord();
                        });
                    } else {
                        translated = await translateAndRecord();
                    }
                }

                profileMetrics?.recordTranslationSuccess({ cached });
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
                budgetReservation?.release();
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
                profileMetrics?.recordTranslationFailure();
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
