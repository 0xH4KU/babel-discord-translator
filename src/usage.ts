/**
 * Daily token usage tracker with cost calculation, budget enforcement,
 * and 30-day history archiving. Supports both global and per-guild tracking.
 */
import { configRepository } from './repositories/config-repository.js';
import { guildBudgetRepository } from './repositories/guild-budget-repository.js';
import { usageRepository } from './repositories/usage-repository.js';
import type { UsageCost, UsageStats, UsageHistoryDay, TokenUsage, UsageHistoryEntry } from './types.js';

class UsageTracker {
    constructor() {
        this.ensureToday();
    }

    /** Reset counters if the date has changed, archiving previous day. */
    ensureToday(): void {
        const today = new Date().toISOString().slice(0, 10);

        const usage = usageRepository.getDailyUsage();
        if (!usage || usage.date !== today) {
            if (usage && usage.date) {
                const history = usageRepository.getUsageHistory();
                history.push(toHistoryEntry(usage));
                while (history.length > 30) history.shift();
                usageRepository.saveUsageHistory(history);
            }

            usageRepository.saveDailyUsage(createEmptyUsage(today));
        }

        const guildUsage = usageRepository.getAllGuildDailyUsage();
        const guildHistory = usageRepository.getAllGuildUsageHistory();
        let guildUsageChanged = false;
        let guildHistoryChanged = false;

        for (const guildId of Object.keys(guildUsage)) {
            const usageEntry = guildUsage[guildId];
            if (usageEntry && usageEntry.date !== today) {
                const history = guildHistory[guildId] ?? [];
                history.push(toHistoryEntry(usageEntry));
                while (history.length > 30) history.shift();
                guildHistory[guildId] = history;
                guildUsage[guildId] = createEmptyUsage(today);
                guildHistoryChanged = true;
                guildUsageChanged = true;
            }
        }

        if (guildHistoryChanged) {
            usageRepository.saveAllGuildUsageHistory(guildHistory);
        }

        if (guildUsageChanged) {
            usageRepository.saveAllGuildDailyUsage(guildUsage);
        }
    }

    /** Record a translation's token usage (global + optional guild). */
    record(inputTokens: number, outputTokens: number, guildId?: string | null): void {
        this.ensureToday();

        const usage = usageRepository.getDailyUsage() ?? createEmptyUsage(today());
        usage.inputTokens += inputTokens || 0;
        usage.outputTokens += outputTokens || 0;
        usage.requests += 1;
        usageRepository.saveDailyUsage(usage);

        if (guildId) {
            const todayValue = today();
            const guildUsage = usageRepository.getAllGuildDailyUsage();
            const entry = guildUsage[guildId]?.date === todayValue
                ? guildUsage[guildId]
                : createEmptyUsage(todayValue);

            entry.inputTokens += inputTokens || 0;
            entry.outputTokens += outputTokens || 0;
            entry.requests += 1;
            guildUsage[guildId] = entry;
            usageRepository.saveAllGuildDailyUsage(guildUsage);
        }
    }

    /** Calculate today's cost in USD (global). */
    getCost(): UsageCost {
        this.ensureToday();
        const usage = usageRepository.getDailyUsage() ?? createEmptyUsage(today());
        const config = configRepository.getRuntimeConfig();

        return withCost(usage, config.inputPricePerMillion || 0, config.outputPricePerMillion || 0);
    }

    /** Calculate today's cost for a specific guild. */
    getGuildCost(guildId: string): UsageCost {
        this.ensureToday();
        const todayValue = today();
        const guildUsage = usageRepository.getAllGuildDailyUsage();
        const usage = guildUsage[guildId] && guildUsage[guildId].date === todayValue
            ? guildUsage[guildId]
            : createEmptyUsage(todayValue);
        const config = configRepository.getRuntimeConfig();

        return withCost(usage, config.inputPricePerMillion || 0, config.outputPricePerMillion || 0);
    }

    /**
     * Check if daily budget is exceeded.
     * If guildId is provided, checks guild-specific budget first,
     * then falls back to the global budget.
     */
    isBudgetExceeded(guildId?: string | null): boolean {
        let budget: number;
        let cost: UsageCost;

        if (guildId) {
            const guildBudget = guildBudgetRepository.getBudget(guildId);
            budget = guildBudget?.dailyBudgetUsd ?? (configRepository.getRuntimeConfig().dailyBudgetUsd || 0);
            cost = this.getGuildCost(guildId);
        } else {
            budget = configRepository.getRuntimeConfig().dailyBudgetUsd || 0;
            cost = this.getCost();
        }

        if (budget <= 0) return false;
        return cost.totalCost >= budget;
    }

    /** Get stats for dashboard display (global). */
    getStats(): UsageStats {
        const config = configRepository.getRuntimeConfig();
        const cost = this.getCost();
        const budget = config.dailyBudgetUsd || 0;

        return {
            ...cost,
            dailyBudget: budget,
            budgetUsedPercent: budget > 0 ? Math.min((cost.totalCost / budget) * 100, 100) : 0,
            budgetExceeded: budget > 0 && cost.totalCost >= budget,
        };
    }

    /** Get stats for a specific guild. */
    getGuildStats(guildId: string): UsageStats {
        const cost = this.getGuildCost(guildId);
        const budget = guildBudgetRepository.getBudget(guildId)?.dailyBudgetUsd
            ?? (configRepository.getRuntimeConfig().dailyBudgetUsd || 0);

        return {
            ...cost,
            dailyBudget: budget,
            budgetUsedPercent: budget > 0 ? Math.min((cost.totalCost / budget) * 100, 100) : 0,
            budgetExceeded: budget > 0 && cost.totalCost >= budget,
        };
    }

    /** Get global usage history (last 30 days) with cost calculations. */
    getHistory(): UsageHistoryDay[] {
        this.ensureToday();
        const history = usageRepository.getUsageHistory();
        const config = configRepository.getRuntimeConfig();

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: (day.inputTokens / 1_000_000) * (config.inputPricePerMillion || 0)
                + (day.outputTokens / 1_000_000) * (config.outputPricePerMillion || 0),
        }));
    }

    /** Get usage history for a specific guild (last 30 days). */
    getGuildHistory(guildId: string): UsageHistoryDay[] {
        this.ensureToday();
        const history = usageRepository.getAllGuildUsageHistory()[guildId] || [];
        const config = configRepository.getRuntimeConfig();

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: (day.inputTokens / 1_000_000) * (config.inputPricePerMillion || 0)
                + (day.outputTokens / 1_000_000) * (config.outputPricePerMillion || 0),
        }));
    }
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function createEmptyUsage(date: string): TokenUsage {
    return {
        date,
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
    };
}

function toHistoryEntry(usage: TokenUsage): UsageHistoryEntry {
    return {
        date: usage.date,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        requests: usage.requests,
    };
}

function withCost(usage: TokenUsage, inputPrice: number, outputPrice: number): UsageCost {
    const inputCost = (usage.inputTokens / 1_000_000) * inputPrice;
    const outputCost = (usage.outputTokens / 1_000_000) * outputPrice;

    return {
        ...usage,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
    };
}

export const usage = new UsageTracker();
