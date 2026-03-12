/**
 * Daily token usage tracker with cost calculation, budget enforcement,
 * and 30-day history archiving.
 * @module usage
 */
import { store } from './store.js';

class UsageTracker {
    constructor() {
        this.ensureToday();
    }

    /** Reset counters if the date has changed, archiving previous day. */
    ensureToday() {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const usage = store.get('tokenUsage');

        if (!usage || usage.date !== today) {
            // Archive yesterday's data before resetting
            if (usage && usage.date) {
                const history = store.get('usageHistory') || [];
                history.push({
                    date: usage.date,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    requests: usage.requests,
                });
                // Keep only last 30 days
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
    }

    /**
     * Record a translation's token usage.
     * @param {number} inputTokens
     * @param {number} outputTokens
     */
    record(inputTokens, outputTokens) {
        this.ensureToday();
        const usage = store.get('tokenUsage');
        usage.inputTokens += inputTokens || 0;
        usage.outputTokens += outputTokens || 0;
        usage.requests += 1;
        store.set('tokenUsage', usage);
    }

    /**
     * Calculate today's cost in USD.
     * @returns {{ date: string, inputTokens: number, outputTokens: number, requests: number, inputCost: number, outputCost: number, totalCost: number }}
     */
    getCost() {
        this.ensureToday();
        const usage = store.get('tokenUsage');
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
     * @returns {boolean} True if budget exceeded, false if under budget or budget is 0 (unlimited).
     */
    isBudgetExceeded() {
        const budget = store.get('dailyBudgetUsd') || 0;
        if (budget <= 0) return false; // 0 = unlimited

        const { totalCost } = this.getCost();
        return totalCost >= budget;
    }

    /**
     * Get stats for dashboard display.
     * @returns {{ date: string, inputTokens: number, outputTokens: number, requests: number, inputCost: number, outputCost: number, totalCost: number, dailyBudget: number, budgetUsedPercent: number, budgetExceeded: boolean }}
     */
    getStats() {
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

    /**
     * Get usage history for dashboard (last 30 days) with cost calculations.
     * @returns {Array<{ date: string, inputTokens: number, outputTokens: number, requests: number, totalTokens: number, cost: number }>}
     */
    getHistory() {
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
}

export const usage = new UsageTracker();
