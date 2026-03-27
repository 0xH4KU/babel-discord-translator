import { buildTranslationCacheKey, type TranslationCache } from '../cache.js';
import type { CooldownManager } from '../cooldown.js';
import type { TranslationLog } from '../log.js';
import { isSameLanguage, localeToLang } from '../lang.js';
import { configRepository, type RuntimeConfig } from '../repositories/config-repository.js';
import { userPreferenceRepository } from '../repositories/user-preference-repository.js';
import { usage } from '../usage.js';
import { translate, resolveSystemPrompt } from '../translate.js';
import { sanitizeError } from '../commands/shared.js';
import { appLogger, createRequestId, type StructuredLogger } from '../structured-logger.js';
import type { BotStats, TranslationResult } from '../types.js';

type ServiceCommand = 'babel' | 'translate';
type LangSource = 'option' | 'setlang' | 'locale' | 'auto';

interface ConfigRepositoryLike {
    getRuntimeConfig(): RuntimeConfig;
    isSetupComplete(): boolean;
}

interface UserPreferenceRepositoryLike {
    getLanguage(userId: string): string | null;
}

interface UsageLike {
    isBudgetExceeded(guildId?: string | null): boolean;
    record(inputTokens: number, outputTokens: number, guildId?: string | null): void;
}

interface Translator {
    (text: string, targetLanguage?: string, options?: { logContext?: { requestId: string; guildId?: string | null; userId: string; command: ServiceCommand } }): Promise<TranslationResult>;
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
    logger?: StructuredLogger;
}

interface TargetLanguageDecision {
    targetLanguage: string;
    langSource: LangSource;
}

const COMMAND_MESSAGES: Record<ServiceCommand, {
    setupIncomplete: string;
    emptyText: string;
    sameLanguage: string;
    budgetExceeded: string;
}> = {
    babel: {
        setupIncomplete: 'Bot not configured yet. Please complete setup in the dashboard.',
        emptyText: 'No text content',
        sameLanguage: 'This message is already in your language!',
        budgetExceeded: 'Daily budget exceeded, try again tomorrow!',
    },
    translate: {
        setupIncomplete: 'Bot not configured yet.',
        emptyText: 'Text is required',
        sameLanguage: 'This text is already in your target language!',
        budgetExceeded: 'Daily budget exceeded',
    },
};

export function createTranslationService({
    cache,
    cooldown,
    log,
    stats,
    configStore = configRepository,
    userPreferenceStore = userPreferenceRepository,
    usageTracker = usage,
    translator = translate,
    logger = appLogger.child({ component: 'translation_service' }),
}: TranslationServiceDeps): TranslationService {
    return {
        async process(request: TranslationServiceRequest): Promise<TranslationServiceResult> {
            const messages = COMMAND_MESSAGES[request.command];
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
                hasTargetLanguageOption: !!(request.targetLanguageOption && request.targetLanguageOption !== 'auto'),
            });

            if (!configStore.isSetupComplete()) {
                requestLogger.warn('translation.request.blocked', { blockReason: 'setup_incomplete' });
                return { status: 'blocked', message: messages.setupIncomplete };
            }

            const runtimeConfig = configStore.getRuntimeConfig();
            const allowedGuilds = runtimeConfig.allowedGuildIds;
            if (!request.guildId || !allowedGuilds.includes(request.guildId)) {
                requestLogger.warn('translation.request.blocked', { blockReason: 'guild_not_allowed' });
                return { status: 'blocked', message: 'This server is not authorized.' };
            }

            if (usageTracker.isBudgetExceeded(request.guildId)) {
                requestLogger.warn('translation.request.blocked', { blockReason: 'budget_exceeded' });
                return { status: 'blocked', message: messages.budgetExceeded };
            }

            const cooldownState = cooldown.check(request.userId);
            if (!cooldownState.allowed) {
                requestLogger.warn('translation.request.blocked', {
                    blockReason: 'cooldown_active',
                    cooldownRemainingSeconds: cooldownState.remaining,
                });
                return { status: 'blocked', message: `Please wait ${cooldownState.remaining}s` };
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
                    message: `Text too long (${originalText.length}/${maxInputLength} chars)`,
                };
            }

            const { targetLanguage, langSource } = resolveTargetLanguage(request, userPreferenceStore);
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

            try {
                if (request.beforeTranslate) {
                    await request.beforeTranslate();
                    deferred = true;
                    requestLogger.info('translation.request.deferred');
                }

                cooldown.set(request.userId);
                stats.totalTranslations++;

                let translated = cache.get(cacheKey);
                const cached = translated !== null;
                requestLogger.info(cached ? 'translation.cache.hit' : 'translation.cache.miss', {
                    targetLanguage,
                    langSource,
                });

                if (!translated) {
                    const result = await translator(originalText, targetLanguage, {
                        logContext: {
                            requestId,
                            guildId: request.guildId ?? null,
                            userId: request.userId,
                            command: request.command,
                        },
                    });
                    translated = result.text;
                    cache.set(cacheKey, translated);
                    usageTracker.record(result.inputTokens, result.outputTokens, request.guildId);
                    stats.apiCalls++;
                }

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
                };
            } catch (error) {
                const message = (error as Error).message;
                log.addError({
                    guildId: request.guildId,
                    guildName: request.guildName,
                    userId: request.userId,
                    userTag: request.userTag,
                    error: message,
                    command: request.commandLabel,
                });
                requestLogger.error('translation.request.failed', {
                    error: message,
                });

                return {
                    status: 'error',
                    deferred,
                    message: `Translation failed: ${sanitizeError(message)}`,
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

export const _test = { resolveTargetLanguage };
