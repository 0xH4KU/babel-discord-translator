/**
 * Shared type definitions for the Babel Discord Translator.
 */
import type {
    Client,
    TextChannel,
    Webhook,
} from 'discord.js';
import type { TranslationCache } from './cache.js';
import type { CooldownManager } from './cooldown.js';
import type { TranslationLog } from './log.js';

// --- Store ---

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
    cache: TranslationCache;
    cooldown: CooldownManager;
    log: TranslationLog;
    stats: BotStats;
}

export interface TranslateCommandDeps extends CommandDeps {
    getOrCreateWebhook: (channel: TextChannel, forceRefresh?: boolean) => Promise<Webhook>;
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
