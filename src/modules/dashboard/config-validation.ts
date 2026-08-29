import { dashboardMessages } from '../../shared/messages/dashboard-messages.js';
import type { StoreData } from '../../shared/types.js';

const MAX_CACHE_SIZE = 2000;
const STRING_CONFIG_KEYS = [
    'vertexAiApiKey',
    'visionApiKey',
    'gcpProject',
    'gcpLocation',
    'geminiModel',
    'translationPrompt',
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
] as const;
const ARRAY_CONFIG_KEYS = ['allowedGuildIds', 'lensEnabledGuildIds', 'allowedUserIds'] as const;
const BOOLEAN_CONFIG_KEYS = ['setupComplete'] as const;
const NUMBER_CONFIG_KEYS = [
    'cooldownSeconds',
    'cacheMaxSize',
    'maxInputLength',
    'maxOutputTokens',
    'dailyBudgetUsd',
    'visionMonthlyImageLimit',
    'defaultUserDailyBudgetUsd',
    'inputPricePerMillion',
    'outputPricePerMillion',
    'translationMaxConcurrent',
    'translationMaxGlobalQueue',
    'translationMaxGuildQueue',
    'translationMaxUserOutstanding',
    'translationMaxQueueWaitMs',
] as const;
const OTHER_CONFIG_KEYS = ['translationProvider'] as const;
const ALLOWED_CONFIG_KEYS = new Set<string>([
    ...STRING_CONFIG_KEYS,
    ...ARRAY_CONFIG_KEYS,
    ...BOOLEAN_CONFIG_KEYS,
    ...NUMBER_CONFIG_KEYS,
    ...OTHER_CONFIG_KEYS,
]);

function toFiniteNumber(value: unknown): number {
    if ((typeof value !== 'number' && typeof value !== 'string') || !String(value).trim()) {
        return NaN;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function sanitizeStringArrayField(
    value: unknown,
    key: 'allowedGuildIds' | 'lensEnabledGuildIds' | 'allowedUserIds',
): { ok: true; value: string[] } | { ok: false; error: string } {
    if (!Array.isArray(value)) {
        return { ok: false, error: `${key} must be an array of non-empty strings` };
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') {
            return { ok: false, error: `${key} must be an array of non-empty strings` };
        }

        const trimmed = item.trim();
        if (!trimmed) {
            return { ok: false, error: `${key} must be an array of non-empty strings` };
        }

        if (!seen.has(trimmed)) {
            seen.add(trimmed);
            normalized.push(trimmed);
        }
    }

    return { ok: true, value: normalized };
}

function sanitizeNonNegativeNumberField(
    sanitized: Record<string, unknown>,
    key: keyof StoreData,
    error: string,
): { valid: true } | { valid: false; error: string; sanitized: Partial<StoreData> } {
    if (sanitized[key] === undefined) {
        return { valid: true };
    }

    const v = toFiniteNumber(sanitized[key]);
    if (Number.isNaN(v) || v < 0) {
        return {
            valid: false,
            error,
            sanitized: sanitized as Partial<StoreData>,
        };
    }
    sanitized[key] = v;
    return { valid: true };
}

export function validateConfigUpdate(updates: Record<string, unknown>): {
    valid: boolean;
    error?: string;
    sanitized: Partial<StoreData>;
} {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
        if (ALLOWED_CONFIG_KEYS.has(key)) {
            sanitized[key] = value;
        }
    }

    for (const key of STRING_CONFIG_KEYS) {
        if (sanitized[key] !== undefined && typeof sanitized[key] !== 'string') {
            return {
                valid: false,
                error: `${key} must be a string`,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
    }

    for (const key of BOOLEAN_CONFIG_KEYS) {
        if (sanitized[key] !== undefined && typeof sanitized[key] !== 'boolean') {
            return {
                valid: false,
                error: `${key} must be a boolean`,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
    }

    if (!sanitized.vertexAiApiKey || String(sanitized.vertexAiApiKey).startsWith('••••')) {
        delete sanitized.vertexAiApiKey;
    }

    if (!sanitized.visionApiKey || String(sanitized.visionApiKey).startsWith('••••')) {
        delete sanitized.visionApiKey;
    }

    if (!sanitized.openaiApiKey || String(sanitized.openaiApiKey).startsWith('••••')) {
        delete sanitized.openaiApiKey;
    }

    for (const key of ARRAY_CONFIG_KEYS) {
        if (sanitized[key] !== undefined) {
            const result = sanitizeStringArrayField(sanitized[key], key);
            if (!result.ok) {
                return {
                    valid: false,
                    error: result.error,
                    sanitized: sanitized as Partial<StoreData>,
                };
            }
            sanitized[key] = result.value;
        }
    }

    if (sanitized.cooldownSeconds !== undefined) {
        const v = toFiniteNumber(sanitized.cooldownSeconds);
        if (!Number.isInteger(v) || v < 1 || v > 300) {
            return {
                valid: false,
                error: dashboardMessages.validation.cooldownSeconds,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.cooldownSeconds = v;
    }
    if (sanitized.cacheMaxSize !== undefined) {
        const v = toFiniteNumber(sanitized.cacheMaxSize);
        if (!Number.isInteger(v) || v < 10 || v > MAX_CACHE_SIZE) {
            return {
                valid: false,
                error: dashboardMessages.validation.cacheMaxSize,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.cacheMaxSize = v;
    }
    if (sanitized.maxInputLength !== undefined) {
        const v = toFiniteNumber(sanitized.maxInputLength);
        if (!Number.isInteger(v) || v < 100 || v > 10000) {
            return {
                valid: false,
                error: dashboardMessages.validation.maxInputLength,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.maxInputLength = v;
    }
    if (sanitized.maxOutputTokens !== undefined) {
        const v = toFiniteNumber(sanitized.maxOutputTokens);
        if (!Number.isInteger(v) || v < 100 || v > 8192) {
            return {
                valid: false,
                error: dashboardMessages.validation.maxOutputTokens,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.maxOutputTokens = v;
    }
    const dailyBudget = sanitizeNonNegativeNumberField(
        sanitized,
        'dailyBudgetUsd',
        dashboardMessages.validation.dailyBudgetUsd,
    );
    if (!dailyBudget.valid) return dailyBudget;
    if (sanitized.visionMonthlyImageLimit !== undefined) {
        const v = toFiniteNumber(sanitized.visionMonthlyImageLimit);
        if (!Number.isSafeInteger(v) || v < 0) {
            return {
                valid: false,
                error: 'visionMonthlyImageLimit must be a non-negative integer',
                sanitized: sanitized as Partial<StoreData>,
            };
        }
        sanitized.visionMonthlyImageLimit = v;
    }
    const defaultUserDailyBudget = sanitizeNonNegativeNumberField(
        sanitized,
        'defaultUserDailyBudgetUsd',
        dashboardMessages.validation.dailyBudgetUsd,
    );
    if (!defaultUserDailyBudget.valid) return defaultUserDailyBudget;
    for (const key of [
        'translationMaxConcurrent',
        'translationMaxGlobalQueue',
        'translationMaxGuildQueue',
        'translationMaxUserOutstanding',
        'translationMaxQueueWaitMs',
    ] as const) {
        if (sanitized[key] !== undefined) {
            const v = toFiniteNumber(sanitized[key]);
            if (!Number.isInteger(v) || v < 1) {
                return {
                    valid: false,
                    error: `${key} must be a positive integer`,
                    sanitized: sanitized as Partial<StoreData>,
                };
            }
            sanitized[key] = v;
        }
    }
    const inputPrice = sanitizeNonNegativeNumberField(
        sanitized,
        'inputPricePerMillion',
        dashboardMessages.validation.inputPricePerMillion,
    );
    if (!inputPrice.valid) return inputPrice;
    const outputPrice = sanitizeNonNegativeNumberField(
        sanitized,
        'outputPricePerMillion',
        dashboardMessages.validation.outputPricePerMillion,
    );
    if (!outputPrice.valid) return outputPrice;

    if (sanitized.translationProvider !== undefined) {
        const valid = ['vertex', 'openai', 'vertex+openai', 'openai+vertex'];
        if (
            typeof sanitized.translationProvider !== 'string' ||
            !valid.includes(sanitized.translationProvider)
        ) {
            return {
                valid: false,
                error: dashboardMessages.validation.translationProvider,
                sanitized: sanitized as Partial<StoreData>,
            };
        }
    }

    return { valid: true, sanitized: sanitized as Partial<StoreData> };
}
