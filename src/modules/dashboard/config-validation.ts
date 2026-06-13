import { dashboardMessages } from '../../shared/messages/dashboard-messages.js';
import type { StoreData } from '../../shared/types.js';

const MAX_CACHE_SIZE = 2000;

export function validateConfigUpdate(updates: Record<string, unknown>): {
    valid: boolean;
    error?: string;
    sanitized: Partial<StoreData>;
} {
    const sanitized: Record<string, unknown> = { ...updates };

    if (!sanitized.vertexAiApiKey || String(sanitized.vertexAiApiKey).startsWith('••••')) {
        delete sanitized.vertexAiApiKey;
    }

    if (!sanitized.openaiApiKey || String(sanitized.openaiApiKey).startsWith('••••')) {
        delete sanitized.openaiApiKey;
    }

    delete sanitized.tokenUsage;
    delete sanitized.usageHistory;
    delete sanitized.userLanguagePrefs;
    delete sanitized.guildBudgets;
    delete sanitized.guildTokenUsage;
    delete sanitized.guildUsageHistory;

    if (sanitized.cooldownSeconds !== undefined) {
        const v = parseInt(String(sanitized.cooldownSeconds));
        if (isNaN(v) || v < 1 || v > 300) {
            return {
                valid: false,
                error: dashboardMessages.validation.cooldownSeconds,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.cooldownSeconds = v;
    }
    if (sanitized.cacheMaxSize !== undefined) {
        const v = parseInt(String(sanitized.cacheMaxSize));
        if (isNaN(v) || v < 10 || v > MAX_CACHE_SIZE) {
            return {
                valid: false,
                error: dashboardMessages.validation.cacheMaxSize,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.cacheMaxSize = v;
    }
    if (sanitized.maxInputLength !== undefined) {
        const v = parseInt(String(sanitized.maxInputLength));
        if (isNaN(v) || v < 100 || v > 10000) {
            return {
                valid: false,
                error: dashboardMessages.validation.maxInputLength,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.maxInputLength = v;
    }
    if (sanitized.maxOutputTokens !== undefined) {
        const v = parseInt(String(sanitized.maxOutputTokens));
        if (isNaN(v) || v < 100 || v > 8192) {
            return {
                valid: false,
                error: dashboardMessages.validation.maxOutputTokens,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.maxOutputTokens = v;
    }
    if (sanitized.dailyBudgetUsd !== undefined) {
        const v = parseFloat(String(sanitized.dailyBudgetUsd));
        if (isNaN(v) || v < 0) {
            return {
                valid: false,
                error: dashboardMessages.validation.dailyBudgetUsd,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.dailyBudgetUsd = v;
    }
    for (const key of [
        'translationMaxConcurrent',
        'translationMaxGlobalQueue',
        'translationMaxGuildQueue',
        'translationMaxUserOutstanding',
        'translationMaxQueueWaitMs',
    ] as const) {
        if (sanitized[key] !== undefined) {
            const v = parseInt(String(sanitized[key]));
            if (isNaN(v) || v < 1) {
                return {
                    valid: false,
                    error: `${key} must be a positive integer`,
                    sanitized: sanitized as Partial<StoreData>,
                };
            }
            sanitized[key] = v;
        }
    }
    if (sanitized.inputPricePerMillion !== undefined) {
        const v = parseFloat(String(sanitized.inputPricePerMillion));
        if (isNaN(v) || v < 0) {
            return {
                valid: false,
                error: dashboardMessages.validation.inputPricePerMillion,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.inputPricePerMillion = v;
    }
    if (sanitized.outputPricePerMillion !== undefined) {
        const v = parseFloat(String(sanitized.outputPricePerMillion));
        if (isNaN(v) || v < 0) {
            return {
                valid: false,
                error: dashboardMessages.validation.outputPricePerMillion,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.outputPricePerMillion = v;
    }

    if (sanitized.translationProvider !== undefined) {
        const valid = ['vertex', 'openai', 'vertex+openai', 'openai+vertex'];
        if (!valid.includes(String(sanitized.translationProvider))) {
            return {
                valid: false,
                error: dashboardMessages.validation.translationProvider,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
    }

    return { valid: true, sanitized: sanitized as Partial<StoreData> };
}
