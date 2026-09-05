import { describe, expect, it } from 'vitest';
import {
    cloneGuildDailyUsage,
    cloneGuildUsageHistory,
    cloneTokenUsage,
    cloneUsageHistory,
    cloneUserBudgets,
    cloneUserDailyUsage,
    normalizeStoreData,
} from '../src/persistence/store-data-normalizer.js';

describe('store-data-normalizer clone helpers', () => {
    it('returns defensive copies for store usage snapshots', () => {
        const tokenUsage = {
            date: '2026-06-03',
            inputTokens: 10,
            outputTokens: 5,
            requests: 1,
            inputCost: 0.01,
            outputCost: 0.02,
        };
        const tokenCopy = cloneTokenUsage(tokenUsage)!;
        tokenCopy.inputTokens = 999;

        expect(tokenUsage.inputTokens).toBe(10);
        expect(tokenCopy).toMatchObject({ inputCost: 0.01, outputCost: 0.02 });

        const history = [tokenUsage];
        const historyCopy = cloneUsageHistory(history);
        historyCopy[0]!.requests = 999;

        expect(history[0]!.requests).toBe(1);

        const guildUsage = { 'guild-1': tokenUsage };
        const guildUsageCopy = cloneGuildDailyUsage(guildUsage);
        guildUsageCopy['guild-1']!.outputTokens = 999;

        expect(guildUsage['guild-1']!.outputTokens).toBe(5);

        const userUsage = { 'user-1': tokenUsage };
        const userUsageCopy = cloneUserDailyUsage(userUsage);
        userUsageCopy['user-1']!.requests = 999;

        expect(userUsage['user-1']!.requests).toBe(1);
    });

    it('returns defensive copies for nested budgets and histories', () => {
        const userBudgets = { 'user-1': { monthlyBudgetUsd: 1.5 } };
        const userBudgetCopy = cloneUserBudgets(userBudgets);
        userBudgetCopy['user-1']!.monthlyBudgetUsd = 9;

        expect(userBudgets['user-1']!.monthlyBudgetUsd).toBe(1.5);

        const guildHistory = {
            'guild-1': [
                {
                    date: '2026-06-03',
                    inputTokens: 10,
                    outputTokens: 5,
                    requests: 1,
                },
            ],
        };
        const guildHistoryCopy = cloneGuildUsageHistory(guildHistory);
        guildHistoryCopy['guild-1']![0]!.requests = 99;

        expect(guildHistory['guild-1']![0]!.requests).toBe(1);
    });

    it('normalizes legacy and guild-scoped user language preferences without duplicate keys', () => {
        const normalized = normalizeStoreData({
            userLanguagePrefs: { 'user-1': 'ja' },
            userLanguagePreferenceEntries: [
                { guildId: '', userId: 'user-1', language: 'ko' },
                { guildId: 'guild-1', userId: 'user-1', language: 'zh-TW' },
            ],
        });

        expect(normalized.userLanguagePrefs).toEqual({ 'user-1': 'ja' });
        expect(normalized.userLanguagePreferenceEntries).toEqual([
            { guildId: '', userId: 'user-1', language: 'ko' },
            { guildId: 'guild-1', userId: 'user-1', language: 'zh-TW' },
        ]);
    });

    it('defaults legacy image capabilities off and validates media resolution', () => {
        expect(normalizeStoreData({})).toMatchObject({
            vertexAiSupportsImages: false,
            openaiSupportsImages: false,
            geminiMediaResolution: 'default',
        });
        expect(
            normalizeStoreData({
                vertexAiSupportsImages: true,
                openaiSupportsImages: true,
                geminiMediaResolution: 'high',
            }),
        ).toMatchObject({
            vertexAiSupportsImages: true,
            openaiSupportsImages: true,
            geminiMediaResolution: 'high',
        });
        expect(
            normalizeStoreData({ geminiMediaResolution: 'ultra_high' as 'high' })
                .geminiMediaResolution,
        ).toBe('default');
    });

    it('converts legacy daily budget fields to monthly values', () => {
        expect(
            normalizeStoreData({
                dailyBudgetUsd: 2,
                defaultUserDailyBudgetUsd: 0.5,
                guildBudgets: { guild: { dailyBudgetUsd: 3 } },
                userBudgets: { user: { dailyBudgetUsd: 0.25 } },
            }),
        ).toMatchObject({
            monthlyBudgetUsd: 60,
            defaultUserMonthlyBudgetUsd: 15,
            guildBudgets: { guild: { monthlyBudgetUsd: 90 } },
            userBudgets: { user: { monthlyBudgetUsd: 7.5 } },
        });
    });

    it('defaults and preserves configurable budget limit settings', () => {
        expect(normalizeStoreData({})).toMatchObject({
            budgetFiveHourPercent: 5,
            budgetSevenDayPercent: 30,
            budgetFairShareMultiplier: 1.5,
            guildBudgetLimitOverrides: {},
        });
        expect(
            normalizeStoreData({
                budgetFiveHourPercent: 8,
                budgetSevenDayPercent: 40,
                budgetFairShareMultiplier: 2,
                guildBudgetLimitOverrides: {
                    guild: { budgetFiveHourPercent: 10, budgetFairShareMultiplier: 3 },
                },
            }),
        ).toMatchObject({
            budgetFiveHourPercent: 8,
            budgetSevenDayPercent: 40,
            budgetFairShareMultiplier: 2,
            guildBudgetLimitOverrides: {
                guild: { budgetFiveHourPercent: 10, budgetFairShareMultiplier: 3 },
            },
        });
    });
});
