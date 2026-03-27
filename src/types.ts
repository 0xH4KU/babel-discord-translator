/**
 * Shared type definitions for the Babel Discord Translator.
 */
import type {
    Client,
} from 'discord.js';
import type { TranslationCache } from './cache.js';
import type { CooldownManager } from './cooldown.js';
import type { TranslationLog } from './log.js';
import type { AppMetricsCollector } from './app-metrics.js';
import type { VertexAiHealthStatus } from './infra/vertex-ai-client.js';
import type { TranslationService } from './services/translation-service.js';
import type { SessionRepository } from './auth/session-repository.js';
import type { TranslationRuntimeLimiter } from './translation-runtime-limiter.js';
import type { TranslationWebhookService } from './webhook-service.js';

// --- Store ---

export interface GuildBudgetConfig {
    dailyBudgetUsd: number;
}

export interface StoreData {
    vertexAiApiKey: string;
    gcpProject: string;
    gcpLocation: string;
    geminiModel: string;
    allowedGuildIds: string[];
    cooldownSeconds: number;
    cacheMaxSize: number;
    setupComplete: boolean;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    dailyBudgetUsd: number;
    tokenUsage: TokenUsage | null;
    usageHistory: UsageHistoryEntry[];
    translationPrompt: string;
    userLanguagePrefs: Record<string, string>;
    maxInputLength: number;
    maxOutputTokens: number;
    // Per-guild budget & usage
    guildBudgets: Record<string, GuildBudgetConfig>;
    guildTokenUsage: Record<string, TokenUsage>;
    guildUsageHistory: Record<string, UsageHistoryEntry[]>;
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
    log: TranslationLog;
    client: Client;
    getStats: () => BotStats;
    metrics?: AppMetricsCollector;
    runtimeLimiter?: TranslationRuntimeLimiter;
    healthCheck?: () => Promise<VertexAiHealthStatus>;
    sessionRepository?: SessionRepository;
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
