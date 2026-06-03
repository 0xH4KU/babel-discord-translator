import { describe, expect, it } from 'vitest';
import {
    cloneGuildDailyUsage,
    cloneGuildUsageHistory,
    cloneTokenUsage,
    cloneUsageHistory,
    cloneUserBudgets,
    cloneUserDailyUsage,
} from '../src/repositories/store-data-normalizer.js';

describe('store-data-normalizer clone helpers', () => {
    it('returns defensive copies for store usage snapshots', () => {
        const tokenUsage = {
            date: '2026-06-03',
            inputTokens: 10,
            outputTokens: 5,
            requests: 1,
        };
        const tokenCopy = cloneTokenUsage(tokenUsage)!;
        tokenCopy.inputTokens = 999;

        expect(tokenUsage.inputTokens).toBe(10);

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
        const userBudgets = { 'user-1': { dailyBudgetUsd: 1.5 } };
        const userBudgetCopy = cloneUserBudgets(userBudgets);
        userBudgetCopy['user-1']!.dailyBudgetUsd = 9;

        expect(userBudgets['user-1']!.dailyBudgetUsd).toBe(1.5);

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
});
