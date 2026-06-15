/**
 * Shared type definitions for the Babel Discord Translator.
 */
import type { Client } from 'discord.js';
import type { TranslationCache } from '../modules/translation/cache.js';
import type { CooldownManager } from '../modules/translation/cooldown.js';
import type { TranslationLog } from './log.js';
import type { AppMetricsCollector } from './app-metrics.js';
import type { VertexAiHealthStatus } from '../infra/vertex-ai-client.js';
import type { OpenAiHealthStatus } from '../infra/openai-client.js';
import type { TranslationService } from '../modules/translation/translation-service.js';
import type { SessionRepository } from '../modules/dashboard/auth/session-repository.js';
import type { TranslationRuntimeLimiter } from '../modules/translation/translation-runtime-limiter.js';
import type { TranslationWebhookService } from '../modules/translation/webhook-service.js';
import type { VersionMetadataWithUpdate } from './version.js';
import type { DiscordUserProfileRepository } from '../modules/dashboard/discord-user-profile-repository.js';
import type { PendingUserInstallOwnerRepository } from '../modules/dashboard/pending-user-install-owner-repository.js';
import type { AppProfile } from '../apps/app-profile.js';

// --- Provider ---

export type TranslationProviderMode = 'vertex' | 'openai' | 'vertex+openai' | 'openai+vertex';

// --- Store ---

export interface GuildBudgetConfig {
    dailyBudgetUsd: number;
}

export interface UserBudgetConfig {
    dailyBudgetUsd: number;
}

export interface TranslationScope {
    guildId?: string | null;
    actorUserId: string;
    billingUserId?: string | null;
}

export interface DiscordUserProfile {
    userId: string;
    username: string;
    globalName: string | null;
    displayName: string;
    avatarUrl: string;
    fetchedAt: string;
    lastSeenAt: string | null;
}

export interface GuildGlossaryEntry {
    id: number;
    guildId: string;
    sourceText: string;
    targetText: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
}

export interface GuildGlossaryInput {
    id?: number;
    sourceText: string;
    targetText: string;
    notes?: string;
}

export interface StoreData {
    vertexAiApiKey: string;
    gcpProject: string;
    gcpLocation: string;
    geminiModel: string;
    allowedGuildIds: string[];
    allowedUserIds: string[];
    cooldownSeconds: number;
    cacheMaxSize: number;
    setupComplete: boolean;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    dailyBudgetUsd: number;
    defaultUserDailyBudgetUsd: number;
    tokenUsage: TokenUsage | null;
    usageHistory: UsageHistoryEntry[];
    translationPrompt: string;
    userLanguagePrefs: Record<string, string>;
    maxInputLength: number;
    maxOutputTokens: number;
    translationMaxConcurrent: number;
    translationMaxGlobalQueue: number;
    translationMaxGuildQueue: number;
    translationMaxUserOutstanding: number;
    translationMaxQueueWaitMs: number;
    // OpenAI-compatible provider
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    translationProvider: TranslationProviderMode;
    // Per-guild budget & usage
    guildBudgets: Record<string, GuildBudgetConfig>;
    guildTokenUsage: Record<string, TokenUsage>;
    guildUsageHistory: Record<string, UsageHistoryEntry[]>;
    // Per-user budget & usage
    userBudgets: Record<string, UserBudgetConfig>;
    userTokenUsage: Record<string, TokenUsage>;
    userUsageHistory: Record<string, UsageHistoryEntry[]>;
}

export interface TokenUsage {
    date: string;
    inputTokens: number;
    outputTokens: number;
    requests: number;
}

export interface UsageHistoryEntry {
    date: string;
    inputTokens: number;
    outputTokens: number;
    requests: number;
}

// --- Translation ---

export interface TranslationResult {
    text: string;
    inputTokens: number;
    outputTokens: number;
    provider?: string;
    fallback?: boolean;
}

export interface VertexAIResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
    };
}

export interface OpenAIChatResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
}

// --- Command Dependencies ---

export interface BotStats {
    totalTranslations: number;
    apiCalls: number;
}

export interface CommandDeps {
    translationService: TranslationService;
}

export interface TranslateCommandDeps extends CommandDeps {
    webhookService: TranslationWebhookService;
}

// --- Logging ---

export interface TranslationLogEntry {
    type: 'translation';
    guildId: string | null;
    guildName: string;
    userId: string;
    userTag: string;
    contentPreview: string;
    cached: boolean;
    targetLanguage: string;
    langSource: string;
    timestamp: number;
}

export interface ErrorLogEntry {
    type: 'error';
    guildId: string | null;
    guildName: string;
    userId: string;
    userTag: string;
    error: string;
    command: string;
    requestId?: string;
    provider?: string;
    errorType?: string;
    suggestedAction?: string;
    timestamp: number;
}

export type LogEntry = TranslationLogEntry | ErrorLogEntry;

// --- Dashboard ---

export interface SessionData {
    expiry: number;
    csrf: string;
}

export interface DashboardDeps {
    cache: TranslationCache;
    cooldown: CooldownManager;
    cooldowns?: Partial<Record<AppProfile['id'], CooldownManager>>;
    log: TranslationLog;
    client: Client;
    getStats: () => BotStats;
    metrics?: AppMetricsCollector;
    runtimeLimiter?: TranslationRuntimeLimiter;
    healthProbeCacheTtlMs?: number;
    healthCheck?: () => Promise<VertexAiHealthStatus>;
    openAiHealthCheck?: () => Promise<OpenAiHealthStatus>;
    versionCheck?: (options?: { forceRefresh?: boolean }) => Promise<VersionMetadataWithUpdate>;
    sessionRepository?: SessionRepository;
    userProfileRepository?: DiscordUserProfileRepository;
    profile?: AppProfile;
    profiles?: AppProfile[];
    clients?: Partial<Record<AppProfile['id'], Client>>;
    pendingUserInstallOwnerRepository?: PendingUserInstallOwnerRepository;
    metricsToken?: string;
}

// --- Usage ---

export interface UsageCost {
    date: string;
    inputTokens: number;
    outputTokens: number;
    requests: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
}

export interface UsageStats extends UsageCost {
    dailyBudget: number;
    budgetUsedPercent: number;
    budgetExceeded: boolean;
}

export interface UsageHistoryDay extends UsageHistoryEntry {
    totalTokens: number;
    cost: number;
}

// --- Script types ---

export type ScriptFamily = 'zh' | 'ja' | 'ko' | 'ru' | 'ar' | 'th' | 'hi' | null;
