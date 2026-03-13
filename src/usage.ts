/**
 * Daily token usage tracker with cost calculation, budget enforcement,
 * and 30-day history archiving. Supports both global and per-guild tracking.
 */
import { store } from './store.js';
import type { UsageCost, UsageStats, UsageHistoryDay, TokenUsage } from './types.js';

class UsageTracker {
    constructor() {
        this.ensureToday();
    }

    /** Reset counters if the date has changed, archiving previous day. */
    ensureToday(): void {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // --- Global usage ---
        const usage = store.get('tokenUsage');
        if (!usage || usage.date !== today) {
            if (usage && usage.date) {
                const history = store.get('usageHistory') || [];
                history.push({
                    date: usage.date,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    requests: usage.requests,
                });
                while (history.length > 30) history.shift();
                store.set('usageHistory', history);
            }
            store.set('tokenUsage', {
                date: today,
                inputTokens: 0,
                outputTokens: 0,
                requests: 0,
            });
        }

        // --- Per-guild usage ---
        const guildUsage = store.get('guildTokenUsage') || {};
        let guildChanged = false;
        for (const guildId of Object.keys(guildUsage)) {
            const gu = guildUsage[guildId];
            if (gu && gu.date !== today) {
                // Archive this guild's yesterday data
                const guildHistory = store.get('guildUsageHistory') || {};
                if (!guildHistory[guildId]) guildHistory[guildId] = [];
                guildHistory[guildId].push({
                    date: gu.date,
                    inputTokens: gu.inputTokens,
                    outputTokens: gu.outputTokens,
                    requests: gu.requests,
                });
                while (guildHistory[guildId].length > 30) guildHistory[guildId].shift();
                store.set('guildUsageHistory', guildHistory);

                // Reset guild usage for today
                guildUsage[guildId] = {
                    date: today,
                    inputTokens: 0,
                    outputTokens: 0,
                    requests: 0,
                };
                guildChanged = true;
            }
        }
        if (guildChanged) {
            store.set('guildTokenUsage', guildUsage);
        }
    }

    /** Record a translation's token usage (global + optional guild). */
    record(inputTokens: number, outputTokens: number, guildId?: string | null): void {
        this.ensureToday();

        // Global
        const usage = store.get('tokenUsage')!;
        usage.inputTokens += inputTokens || 0;
        usage.outputTokens += outputTokens || 0;
        usage.requests += 1;
        store.set('tokenUsage', usage);

        // Per-guild
        if (guildId) {
            const today = new Date().toISOString().slice(0, 10);
            const guildUsage = store.get('guildTokenUsage') || {};
            if (!guildUsage[guildId] || guildUsage[guildId].date !== today) {
                guildUsage[guildId] = { date: today, inputTokens: 0, outputTokens: 0, requests: 0 };
            }
            guildUsage[guildId].inputTokens += inputTokens || 0;
            guildUsage[guildId].outputTokens += outputTokens || 0;
            guildUsage[guildId].requests += 1;
            store.set('guildTokenUsage', guildUsage);
        }
    }

    /** Calculate today's cost in USD (global). */
    getCost(): UsageCost {
        this.ensureToday();
        const usage = store.get('tokenUsage')!;
        const inputPrice = store.get('inputPricePerMillion') || 0;
        const outputPrice = store.get('outputPricePerMillion') || 0;

        const inputCost = (usage.inputTokens / 1_000_000) * inputPrice;
        const outputCost = (usage.outputTokens / 1_000_000) * outputPrice;

        return {
            ...usage,
            inputCost,
            outputCost,
            totalCost: inputCost + outputCost,
        };
    }

    /** Calculate today's cost for a specific guild. */
    getGuildCost(guildId: string): UsageCost {
        this.ensureToday();
        const today = new Date().toISOString().slice(0, 10);
        const guildUsage = store.get('guildTokenUsage') || {};
        const usage: TokenUsage = guildUsage[guildId] && guildUsage[guildId].date === today
            ? guildUsage[guildId]
            : { date: today, inputTokens: 0, outputTokens: 0, requests: 0 };

        const inputPrice = store.get('inputPricePerMillion') || 0;
        const outputPrice = store.get('outputPricePerMillion') || 0;

        const inputCost = (usage.inputTokens / 1_000_000) * inputPrice;
        const outputCost = (usage.outputTokens / 1_000_000) * outputPrice;

        return {
            ...usage,
            inputCost,
            outputCost,
            totalCost: inputCost + outputCost,
        };
    }

    /**
     * Check if daily budget is exceeded.
     * If guildId is provided, checks guild-specific budget first,
     * then falls back to the global budget.
     */
    isBudgetExceeded(guildId?: string | null): boolean {
        // Determine the effective budget
        let budget: number;
        let cost: UsageCost;

        if (guildId) {
            const guildBudgets = store.get('guildBudgets') || {};
            const guildBudget = guildBudgets[guildId];

            if (guildBudget && guildBudget.dailyBudgetUsd !== undefined) {
                // Guild has its own budget setting
                budget = guildBudget.dailyBudgetUsd;
                cost = this.getGuildCost(guildId);
            } else {
                // Fallback to global budget, but check against guild cost
                budget = store.get('dailyBudgetUsd') || 0;
                cost = this.getGuildCost(guildId);
            }
        } else {
            budget = store.get('dailyBudgetUsd') || 0;
            cost = this.getCost();
        }

        if (budget <= 0) return false; // 0 = unlimited
        return cost.totalCost >= budget;
    }

    /** Get stats for dashboard display (global). */
    getStats(): UsageStats {
        const cost = this.getCost();
        const budget = store.get('dailyBudgetUsd') || 0;

        return {
            date: cost.date,
            inputTokens: cost.inputTokens,
            outputTokens: cost.outputTokens,
            requests: cost.requests,
            inputCost: cost.inputCost,
            outputCost: cost.outputCost,
            totalCost: cost.totalCost,
            dailyBudget: budget,
            budgetUsedPercent: budget > 0 ? Math.min((cost.totalCost / budget) * 100, 100) : 0,
            budgetExceeded: budget > 0 && cost.totalCost >= budget,
        };
    }

    /** Get stats for a specific guild. */
    getGuildStats(guildId: string): UsageStats {
        const cost = this.getGuildCost(guildId);
        const guildBudgets = store.get('guildBudgets') || {};
        const guildBudget = guildBudgets[guildId];
        const budget = guildBudget?.dailyBudgetUsd ?? (store.get('dailyBudgetUsd') || 0);

        return {
            date: cost.date,
            inputTokens: cost.inputTokens,
            outputTokens: cost.outputTokens,
            requests: cost.requests,
            inputCost: cost.inputCost,
            outputCost: cost.outputCost,
            totalCost: cost.totalCost,
            dailyBudget: budget,
            budgetUsedPercent: budget > 0 ? Math.min((cost.totalCost / budget) * 100, 100) : 0,
            budgetExceeded: budget > 0 && cost.totalCost >= budget,
        };
    }

    /** Get global usage history (last 30 days) with cost calculations. */
    getHistory(): UsageHistoryDay[] {
        this.ensureToday();
        const history = store.get('usageHistory') || [];
        const inputPrice = store.get('inputPricePerMillion') || 0;
        const outputPrice = store.get('outputPricePerMillion') || 0;

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: (day.inputTokens / 1_000_000) * inputPrice + (day.outputTokens / 1_000_000) * outputPrice,
        }));
    }

    /** Get usage history for a specific guild (last 30 days). */
    getGuildHistory(guildId: string): UsageHistoryDay[] {
        this.ensureToday();
        const guildHistory = store.get('guildUsageHistory') || {};
        const history = guildHistory[guildId] || [];
        const inputPrice = store.get('inputPricePerMillion') || 0;
        const outputPrice = store.get('outputPricePerMillion') || 0;

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: (day.inputTokens / 1_000_000) * inputPrice + (day.outputTokens / 1_000_000) * outputPrice,
        }));
    }
}

export const usage = new UsageTracker();
