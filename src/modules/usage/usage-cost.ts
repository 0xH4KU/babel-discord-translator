import type { RuntimeConfig } from '../config/config-repository.js';
import type { TokenUsage, UsageCost, UsageStats } from '../../shared/types.js';

export function createEmptyUsage(date: string): TokenUsage {
    return {
        date,
        inputTokens: 0,
        outputTokens: 0,
        requests: 0,
    };
}

export function withCost(usage: TokenUsage, inputPrice: number, outputPrice: number): UsageCost {
    const inputCost = (usage.inputTokens / 1_000_000) * inputPrice;
    const outputCost = (usage.outputTokens / 1_000_000) * outputPrice;

    return {
        ...usage,
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
    };
}

export function toUsageStats(cost: UsageCost, budget: number): UsageStats {
    return {
        ...cost,
        monthlyBudget: budget,
        budgetUsedPercent: budget > 0 ? Math.min((cost.totalCost / budget) * 100, 100) : 0,
        budgetExceeded: budget > 0 && cost.totalCost >= budget,
    };
}

export function calculateCost(
    usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens'>,
    runtimeConfig: Pick<RuntimeConfig, 'inputPricePerMillion' | 'outputPricePerMillion'>,
): number {
    return (
        (usage.inputTokens / 1_000_000) * (runtimeConfig.inputPricePerMillion || 0) +
        (usage.outputTokens / 1_000_000) * (runtimeConfig.outputPricePerMillion || 0)
    );
}
