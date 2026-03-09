import { store } from './store.js';

/**
 * Daily token usage tracker with cost calculation and budget enforcement.
 */
class UsageTracker {
    constructor() {
        this.ensureToday();
    }

    /** Reset counters if the date has changed. */
    ensureToday() {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const usage = store.get('tokenUsage');

        if (!usage || usage.date !== today) {
            store.set('tokenUsage', {
                date: today,
                inputTokens: 0,
                outputTokens: 0,
                requests: 0,
            });
        }
    }

    /** Record a translation's token usage. */
    record(inputTokens, outputTokens) {
        this.ensureToday();
        const usage = store.get('tokenUsage');
        usage.inputTokens += inputTokens || 0;
        usage.outputTokens += outputTokens || 0;
        usage.requests += 1;
        store.set('tokenUsage', usage);
    }

    /** Calculate today's cost in USD. */
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

    /** Check if daily budget is exceeded. */
    isBudgetExceeded() {
        const budget = store.get('dailyBudgetUsd') || 0;
        if (budget <= 0) return false; // 0 = unlimited

        const { totalCost } = this.getCost();
        return totalCost >= budget;
    }

    /** Get stats for dashboard. */
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
}

export const usage = new UsageTracker();
