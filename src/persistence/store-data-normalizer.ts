import type {
    GuildBudgetConfig,
    GeminiMediaResolution,
    StoreData,
    TokenUsage,
    TranslationProviderMode,
    UsageHistoryEntry,
    UserBudgetConfig,
    UserLanguagePreferenceEntry,
} from '../shared/types.js';

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

const VALID_MEDIA_RESOLUTIONS: ReadonlySet<string> = new Set([
    'default',
    'low',
    'medium',
    'high',
]);

function normalizeMediaResolution(value: unknown): GeminiMediaResolution {
    return typeof value === 'string' && VALID_MEDIA_RESOLUTIONS.has(value)
        ? (value as GeminiMediaResolution)
        : 'default';
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

export function cloneUserLanguagePreferenceEntries(
    entries: UserLanguagePreferenceEntry[] | undefined,
): UserLanguagePreferenceEntry[] {
    if (!Array.isArray(entries)) {
        return [];
    }

    return entries.map((entry) => ({
        guildId: normalizeString(entry?.guildId),
        userId: normalizeString(entry?.userId),
        language: normalizeString(entry?.language),
    }));
}

function normalizeUserLanguagePreferenceEntries(
    legacyPrefs: Record<string, string> | undefined,
    entries: UserLanguagePreferenceEntry[] | undefined,
): UserLanguagePreferenceEntry[] {
    const byKey = new Map<string, UserLanguagePreferenceEntry>();
    const normalizedEntries = [
        ...Object.entries(cloneUserLanguagePrefs(legacyPrefs)).map(([userId, language]) => ({
            guildId: '',
            userId,
            language,
        })),
        ...cloneUserLanguagePreferenceEntries(entries),
    ];

    for (const entry of normalizedEntries) {
        byKey.set(`${entry.guildId}\u0000${entry.userId}`, entry);
    }

    return [...byKey.values()];
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

export function cloneUserBudgets(
    budgets: Record<string, UserBudgetConfig> | undefined,
): Record<string, UserBudgetConfig> {
    return Object.fromEntries(
        Object.entries(budgets ?? {}).map(([userId, budget]) => [
            userId,
            { dailyBudgetUsd: normalizeNumber(budget?.dailyBudgetUsd) },
        ]),
    );
}

function cloneVisionLimits(limits: Record<string, number> | undefined): Record<string, number> {
    return Object.fromEntries(
        Object.entries(limits ?? {}).filter(
            ([scopeId, limit]) => scopeId && Number.isSafeInteger(limit) && limit >= 0,
        ),
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

export function cloneUserDailyUsage(
    usage: Record<string, TokenUsage> | undefined,
): Record<string, TokenUsage> {
    return Object.fromEntries(
        Object.entries(usage ?? {}).map(([userId, entry]) => [
            userId,
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

export function cloneUserUsageHistory(
    history: Record<string, UsageHistoryEntry[]> | undefined,
): Record<string, UsageHistoryEntry[]> {
    return Object.fromEntries(
        Object.entries(history ?? {}).map(([userId, entries]) => [
            userId,
            cloneUsageHistory(entries),
        ]),
    );
}

export function normalizeStoreData(data: Partial<StoreData> | undefined): StoreData {
    const source = data ?? {};

    return {
        vertexAiApiKey: normalizeString(source.vertexAiApiKey),
        visionApiKey: normalizeString(source.visionApiKey),
        gcpProject: normalizeString(source.gcpProject),
        gcpLocation: normalizeString(source.gcpLocation, 'global'),
        geminiModel: normalizeString(source.geminiModel, 'gemini-2.5-flash-lite'),
        vertexAiSupportsImages: source.vertexAiSupportsImages === true,
        geminiMediaResolution: normalizeMediaResolution(source.geminiMediaResolution),
        allowedGuildIds: Array.isArray(source.allowedGuildIds)
            ? source.allowedGuildIds.filter(
                  (guildId): guildId is string => typeof guildId === 'string',
              )
            : [],
        lensEnabledGuildIds: Array.isArray(source.lensEnabledGuildIds)
            ? source.lensEnabledGuildIds.filter(
                  (guildId): guildId is string => typeof guildId === 'string',
              )
            : [],
        allowedUserIds: Array.isArray(source.allowedUserIds)
            ? source.allowedUserIds.filter((userId): userId is string => typeof userId === 'string')
            : [],
        cooldownSeconds: normalizeNumber(source.cooldownSeconds, 5),
        cacheMaxSize: normalizeNumber(source.cacheMaxSize, 2000),
        setupComplete: source.setupComplete === true,
        inputPricePerMillion: normalizeNumber(source.inputPricePerMillion),
        outputPricePerMillion: normalizeNumber(source.outputPricePerMillion),
        dailyBudgetUsd: normalizeNumber(source.dailyBudgetUsd),
        visionMonthlyImageLimit: normalizeNumber(source.visionMonthlyImageLimit, 900),
        defaultUserDailyBudgetUsd: normalizeNumber(source.defaultUserDailyBudgetUsd),
        tokenUsage: cloneTokenUsage(source.tokenUsage),
        usageHistory: cloneUsageHistory(source.usageHistory),
        translationPrompt: normalizeString(source.translationPrompt),
        userLanguagePrefs: cloneUserLanguagePrefs(source.userLanguagePrefs),
        userLanguagePreferenceEntries: normalizeUserLanguagePreferenceEntries(
            source.userLanguagePrefs,
            source.userLanguagePreferenceEntries,
        ),
        maxInputLength: normalizeNumber(source.maxInputLength, 2000),
        maxOutputTokens: normalizeNumber(source.maxOutputTokens, 1000),
        translationMaxConcurrent: normalizeNumber(source.translationMaxConcurrent, 4),
        translationMaxGlobalQueue: normalizeNumber(source.translationMaxGlobalQueue, 25),
        translationMaxGuildQueue: normalizeNumber(source.translationMaxGuildQueue, 5),
        translationMaxUserOutstanding: normalizeNumber(source.translationMaxUserOutstanding, 1),
        translationMaxQueueWaitMs: normalizeNumber(source.translationMaxQueueWaitMs, 30000),
        openaiApiKey: normalizeString(source.openaiApiKey),
        openaiBaseUrl: normalizeString(source.openaiBaseUrl),
        openaiModel: normalizeString(source.openaiModel),
        openaiSupportsImages: source.openaiSupportsImages === true,
        translationProvider: normalizeProviderMode(source.translationProvider),
        guildBudgets: cloneGuildBudgets(source.guildBudgets),
        guildVisionLimits: cloneVisionLimits(source.guildVisionLimits),
        guildTokenUsage: cloneGuildDailyUsage(source.guildTokenUsage),
        guildUsageHistory: cloneGuildUsageHistory(source.guildUsageHistory),
        userBudgets: cloneUserBudgets(source.userBudgets),
        userVisionLimits: cloneVisionLimits(source.userVisionLimits),
        userTokenUsage: cloneUserDailyUsage(source.userTokenUsage),
        userUsageHistory: cloneUserUsageHistory(source.userUsageHistory),
    };
}
