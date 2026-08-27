import { describe, expect, it } from 'vitest';
import { validateConfigUpdate } from '../src/modules/dashboard/config-validation.js';
import { dashboardMessages } from '../src/shared/messages/dashboard-messages.js';

describe('validateConfigUpdate', () => {
    it('should drop empty or masked API keys from the update', () => {
        const result = validateConfigUpdate({
            vertexAiApiKey: '••••1234',
            openaiApiKey: '',
            cooldownSeconds: 10,
        });

        expect(result.valid).toBe(true);
        expect(result.sanitized).not.toHaveProperty('vertexAiApiKey');
        expect(result.sanitized).not.toHaveProperty('openaiApiKey');
    });

    it('should keep real API keys in the update', () => {
        const result = validateConfigUpdate({
            vertexAiApiKey: 'real-vertex-key',
            openaiApiKey: 'real-openai-key',
        });

        expect(result.valid).toBe(true);
        expect(result.sanitized.vertexAiApiKey).toBe('real-vertex-key');
        expect(result.sanitized.openaiApiKey).toBe('real-openai-key');
    });

    it('should strip usage and preference data that must not be written via config', () => {
        const result = validateConfigUpdate({
            tokenUsage: { date: 'x', inputTokens: 1, outputTokens: 1 },
            usageHistory: [],
            userLanguagePrefs: { u: 'ja' },
            userLanguagePreferenceEntries: [{ guildId: 'g', userId: 'u', language: 'ja' }],
            guildBudgets: { g: { dailyBudgetUsd: 1 } },
            guildTokenUsage: {},
            guildUsageHistory: {},
        });

        expect(result.valid).toBe(true);
        expect(result.sanitized).toEqual({});
    });

    it('should drop unknown config keys instead of persisting arbitrary dashboard body fields', () => {
        const result = validateConfigUpdate({
            cooldownSeconds: 12,
            unknownNested: { can: 'not be stored' },
            __proto__: { polluted: true },
        });

        expect(result.valid).toBe(true);
        expect(result.sanitized).toEqual({ cooldownSeconds: 12 });
        expect(result.sanitized).not.toHaveProperty('unknownNested');
        expect(Object.prototype).not.toHaveProperty('polluted');
    });

    it('should normalize allowlist arrays and reject invalid allowlist payloads', () => {
        const valid = validateConfigUpdate({
            allowedGuildIds: [' guild-1 ', 'guild-1', 'guild-2'],
            allowedUserIds: [' user-1 ', 'user-2', 'user-2'],
        });

        expect(valid.valid).toBe(true);
        expect(valid.sanitized.allowedGuildIds).toEqual(['guild-1', 'guild-2']);
        expect(valid.sanitized.allowedUserIds).toEqual(['user-1', 'user-2']);

        expect(validateConfigUpdate({ allowedGuildIds: ['guild-1', 42] })).toMatchObject({
            valid: false,
            error: 'allowedGuildIds must be an array of non-empty strings',
        });
        expect(validateConfigUpdate({ allowedUserIds: 'user-1' })).toMatchObject({
            valid: false,
            error: 'allowedUserIds must be an array of non-empty strings',
        });
    });

    const rangeCases = [
        ['cooldownSeconds', 0, 301, 60, dashboardMessages.validation.cooldownSeconds],
        ['cacheMaxSize', 9, 2001, 100, dashboardMessages.validation.cacheMaxSize],
        ['maxInputLength', 99, 10001, 2000, dashboardMessages.validation.maxInputLength],
        ['maxOutputTokens', 99, 8193, 1000, dashboardMessages.validation.maxOutputTokens],
    ] as const;

    for (const [field, low, high, ok, message] of rangeCases) {
        it(`should enforce the allowed range for ${field}`, () => {
            expect(validateConfigUpdate({ [field]: low })).toMatchObject({
                valid: false,
                error: message,
            });
            expect(validateConfigUpdate({ [field]: high })).toMatchObject({
                valid: false,
                error: message,
            });
            expect(validateConfigUpdate({ [field]: 'abc' })).toMatchObject({
                valid: false,
                error: message,
            });

            const valid = validateConfigUpdate({ [field]: String(ok) });
            expect(valid.valid).toBe(true);
            expect(valid.sanitized[field]).toBe(ok);
        });
    }

    const nonNegativeCases = [
        ['dailyBudgetUsd', dashboardMessages.validation.dailyBudgetUsd],
        ['inputPricePerMillion', dashboardMessages.validation.inputPricePerMillion],
        ['outputPricePerMillion', dashboardMessages.validation.outputPricePerMillion],
    ] as const;

    for (const [field, message] of nonNegativeCases) {
        it(`should reject negative or non-numeric ${field}`, () => {
            expect(validateConfigUpdate({ [field]: -1 })).toMatchObject({
                valid: false,
                error: message,
            });
            expect(validateConfigUpdate({ [field]: 'abc' })).toMatchObject({
                valid: false,
                error: message,
            });

            const valid = validateConfigUpdate({ [field]: '1.5' });
            expect(valid.valid).toBe(true);
            expect(valid.sanitized[field]).toBe(1.5);
        });
    }

    it('should require positive integers for translation throughput limits', () => {
        for (const field of [
            'translationMaxConcurrent',
            'translationMaxGlobalQueue',
            'translationMaxGuildQueue',
            'translationMaxUserOutstanding',
            'translationMaxQueueWaitMs',
        ]) {
            expect(validateConfigUpdate({ [field]: 0 })).toMatchObject({
                valid: false,
                error: `${field} must be a positive integer`,
            });

            const valid = validateConfigUpdate({ [field]: '8' });
            expect(valid.valid).toBe(true);
            expect(valid.sanitized[field as keyof typeof valid.sanitized]).toBe(8);
        }
    });

    it('should validate the translation provider value', () => {
        expect(validateConfigUpdate({ translationProvider: 'gemini' })).toMatchObject({
            valid: false,
            error: dashboardMessages.validation.translationProvider,
        });

        for (const provider of ['vertex', 'openai', 'vertex+openai', 'openai+vertex']) {
            expect(validateConfigUpdate({ translationProvider: provider }).valid).toBe(true);
        }
    });

    it('should pass through untouched fields and skip absent ones', () => {
        const result = validateConfigUpdate({ translationPrompt: 'Translate {text}' });

        expect(result).toEqual({
            valid: true,
            sanitized: { translationPrompt: 'Translate {text}' },
        });
    });

    it('should reject malformed scalar values instead of coercing them', () => {
        expect(validateConfigUpdate({ translationPrompt: { text: 'translate' } })).toMatchObject({
            valid: false,
            error: 'translationPrompt must be a string',
        });
        expect(validateConfigUpdate({ setupComplete: 'true' })).toMatchObject({
            valid: false,
            error: 'setupComplete must be a boolean',
        });
        expect(validateConfigUpdate({ dailyBudgetUsd: '1oops' })).toMatchObject({
            valid: false,
            error: dashboardMessages.validation.dailyBudgetUsd,
        });
        expect(validateConfigUpdate({ translationMaxConcurrent: '3.5' })).toMatchObject({
            valid: false,
            error: 'translationMaxConcurrent must be a positive integer',
        });
        expect(validateConfigUpdate({ translationMaxConcurrent: [3] })).toMatchObject({
            valid: false,
            error: 'translationMaxConcurrent must be a positive integer',
        });
        expect(validateConfigUpdate({ translationProvider: ['vertex'] })).toMatchObject({
            valid: false,
            error: dashboardMessages.validation.translationProvider,
        });
    });
});
