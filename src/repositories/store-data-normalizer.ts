import type {
    GuildBudgetConfig,
    StoreData,
    TokenUsage,
    TranslationProviderMode,
    UsageHistoryEntry,
} from '../types.js';

function normalizeNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

const VALID_PROVIDER_MODES: ReadonlySet<string> = new Set([
    'vertex',
    'openai',
    'vertex+openai',
    'openai+vertex',
]);

function normalizeProviderMode(value: unknown): TranslationProviderMode {
    return typeof value === 'string' && VALID_PROVIDER_MODES.has(value)
        ? (value as TranslationProviderMode)
        : 'vertex';
}

function normalizeUsageEntry(
    entry: Partial<UsageHistoryEntry> | null | undefined,
): UsageHistoryEntry {
    return {
        date: normalizeString(entry?.date),
        inputTokens: normalizeNumber(entry?.inputTokens),
        outputTokens: normalizeNumber(entry?.outputTokens),
        requests: normalizeNumber(entry?.requests),
    };
}

function normalizeTokenUsageEntry(entry: Partial<TokenUsage> | null | undefined): TokenUsage {
    return {
        date: normalizeString(entry?.date),
        inputTokens: normalizeNumber(entry?.inputTokens),
        outputTokens: normalizeNumber(entry?.outputTokens),
        requests: normalizeNumber(entry?.requests),
    };
}

export function cloneTokenUsage(usage: TokenUsage | null | undefined): TokenUsage | null {
    return usage ? normalizeTokenUsageEntry(usage) : null;
}

export function cloneUsageHistory(history: UsageHistoryEntry[] | undefined): UsageHistoryEntry[] {
    if (!Array.isArray(history)) {
        return [];
    }

    return history.map((entry) => normalizeUsageEntry(entry));
}

export function cloneUserLanguagePrefs(
    prefs: Record<string, string> | undefined,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(prefs ?? {}).map(([userId, language]) => [
            userId,
            normalizeString(language),
        ]),
    );
}

export function cloneGuildBudgets(
    budgets: Record<string, GuildBudgetConfig> | undefined,
): Record<string, GuildBudgetConfig> {
    return Object.fromEntries(
        Object.entries(budgets ?? {}).map(([guildId, budget]) => [
            guildId,
            { dailyBudgetUsd: normalizeNumber(budget?.dailyBudgetUsd) },
        ]),
    );
}

export function cloneGuildDailyUsage(
    usage: Record<string, TokenUsage> | undefined,
): Record<string, TokenUsage> {
    return Object.fromEntries(
        Object.entries(usage ?? {}).map(([guildId, entry]) => [
            guildId,
            normalizeTokenUsageEntry(entry),
        ]),
    );
}

export function cloneGuildUsageHistory(
    history: Record<string, UsageHistoryEntry[]> | undefined,
): Record<string, UsageHistoryEntry[]> {
    return Object.fromEntries(
        Object.entries(history ?? {}).map(([guildId, entries]) => [
            guildId,
            cloneUsageHistory(entries),
        ]),
    );
}

export function normalizeStoreData(data: Partial<StoreData> | undefined): StoreData {
    const source = data ?? {};

    return {
        vertexAiApiKey: normalizeString(source.vertexAiApiKey),
        gcpProject: normalizeString(source.gcpProject),
        gcpLocation: normalizeString(source.gcpLocation, 'global'),
        geminiModel: normalizeString(source.geminiModel, 'gemini-2.5-flash-lite'),
        allowedGuildIds: Array.isArray(source.allowedGuildIds)
            ? source.allowedGuildIds.filter(
                  (guildId): guildId is string => typeof guildId === 'string',
              )
            : [],
        cooldownSeconds: normalizeNumber(source.cooldownSeconds, 5),
        cacheMaxSize: normalizeNumber(source.cacheMaxSize, 2000),
        setupComplete: source.setupComplete === true,
        inputPricePerMillion: normalizeNumber(source.inputPricePerMillion),
        outputPricePerMillion: normalizeNumber(source.outputPricePerMillion),
        dailyBudgetUsd: normalizeNumber(source.dailyBudgetUsd),
        tokenUsage: cloneTokenUsage(source.tokenUsage),
        usageHistory: cloneUsageHistory(source.usageHistory),
        translationPrompt: normalizeString(source.translationPrompt),
        userLanguagePrefs: cloneUserLanguagePrefs(source.userLanguagePrefs),
        maxInputLength: normalizeNumber(source.maxInputLength, 2000),
        maxOutputTokens: normalizeNumber(source.maxOutputTokens, 1000),
        openaiApiKey: normalizeString(source.openaiApiKey),
        openaiBaseUrl: normalizeString(source.openaiBaseUrl),
        openaiModel: normalizeString(source.openaiModel),
        translationProvider: normalizeProviderMode(source.translationProvider),
        guildBudgets: cloneGuildBudgets(source.guildBudgets),
        guildTokenUsage: cloneGuildDailyUsage(source.guildTokenUsage),
        guildUsageHistory: cloneGuildUsageHistory(source.guildUsageHistory),
    };
}
