/**
 * Daily token usage tracker with cost calculation, budget enforcement,
 * and 30-day history archiving. Supports global, per-guild, and per-user tracking.
 */
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import { guildBudgetRepository } from './guild-budget-repository.js';
import { userBudgetRepository } from './user-budget-repository.js';
import { usageRepository } from './usage-repository.js';
import { resolveBudgetScope } from './budget-scope.js';
import { normalizeUsageScope, type LegacyUsageScope, type UsageScope } from './usage-scope.js';
import { calculateCost, createEmptyUsage, toUsageStats, withCost } from './usage-cost.js';
import type {
    UsageCost,
    UsageStats,
    UsageHistoryDay,
    TokenUsage,
    UsageHistoryEntry,
} from '../../shared/types.js';

export type UsageExportScope = 'global' | 'guild' | 'user';

export interface UsageExportRow {
    scope: UsageExportScope;
    id: string;
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
}

class UsageTracker {
    private lastEnsuredDate: string | null = null;

    constructor() {
        this.ensureToday();
    }

    /** Reset counters if the date has changed, archiving previous day. */
    ensureToday(): void {
        const today = new Date().toISOString().slice(0, 10);
        if (this.lastEnsuredDate === today) {
            return;
        }

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

        for (const guildId of Object.keys(guildUsage)) {
            const usageEntry = guildUsage[guildId];
            if (usageEntry && usageEntry.date !== today) {
                const history = usageRepository.getGuildUsageHistory(guildId);
                history.push(toHistoryEntry(usageEntry));
                while (history.length > 30) history.shift();
                usageRepository.saveGuildUsageHistory(guildId, history);
                usageRepository.saveGuildDailyUsage(guildId, createEmptyUsage(today));
            }
        }

        const userUsage = usageRepository.getAllUserDailyUsage();

        for (const userId of Object.keys(userUsage)) {
            const usageEntry = userUsage[userId];
            if (usageEntry && usageEntry.date !== today) {
                const history = usageRepository.getUserUsageHistory(userId);
                history.push(toHistoryEntry(usageEntry));
                while (history.length > 30) history.shift();
                usageRepository.saveUserUsageHistory(userId, history);
                usageRepository.saveUserDailyUsage(userId, createEmptyUsage(today));
            }
        }

        this.lastEnsuredDate = today;
    }

    /** Record a translation's token usage (global + optional guild/user). */
    record(inputTokens: number, outputTokens: number, scopeInput?: LegacyUsageScope): void {
        const scope = normalizeUsageScope(scopeInput);
        this.ensureToday();

        const usage = usageRepository.getDailyUsage() ?? createEmptyUsage(today());
        usage.inputTokens += inputTokens || 0;
        usage.outputTokens += outputTokens || 0;
        usage.requests += 1;
        usageRepository.saveDailyUsage(usage);

        if (scope.guildId) {
            const todayValue = today();
            const currentUsage = usageRepository.getGuildDailyUsage(scope.guildId);
            const entry =
                currentUsage?.date === todayValue ? currentUsage : createEmptyUsage(todayValue);

            entry.inputTokens += inputTokens || 0;
            entry.outputTokens += outputTokens || 0;
            entry.requests += 1;
            usageRepository.saveGuildDailyUsage(scope.guildId, entry);
        }

        if (scope.userId) {
            const todayValue = today();
            const currentUsage = usageRepository.getUserDailyUsage(scope.userId);
            const entry =
                currentUsage?.date === todayValue ? currentUsage : createEmptyUsage(todayValue);

            entry.inputTokens += inputTokens || 0;
            entry.outputTokens += outputTokens || 0;
            entry.requests += 1;
            usageRepository.saveUserDailyUsage(scope.userId, entry);
        }
    }

    /** Calculate today's cost in USD (global). */
    getCost(runtimeConfig = configRepository.getRuntimeConfig()): UsageCost {
        this.ensureToday();
        const usage = usageRepository.getDailyUsage() ?? createEmptyUsage(today());

        return withCost(
            usage,
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }

    /** Calculate today's cost for a specific user. */
    getUserCost(userId: string, runtimeConfig = configRepository.getRuntimeConfig()): UsageCost {
        this.ensureToday();
        const todayValue = today();
        const userUsage = usageRepository.getUserDailyUsage(userId);
        const usage = userUsage?.date === todayValue ? userUsage : createEmptyUsage(todayValue);

        return withCost(
            usage,
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }

    /** Calculate today's cost for a specific guild. */
    getGuildCost(guildId: string, runtimeConfig = configRepository.getRuntimeConfig()): UsageCost {
        this.ensureToday();
        const todayValue = today();
        const guildUsage = usageRepository.getGuildDailyUsage(guildId);
        const usage = guildUsage?.date === todayValue ? guildUsage : createEmptyUsage(todayValue);

        return withCost(
            usage,
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }

    /**
     * Check if daily budget is exceeded.
     * If guildId is provided, checks guild-specific budget first,
     * then falls back to the global budget.
     */
    isBudgetExceeded(scopeInput?: LegacyUsageScope): boolean {
        const scope = normalizeUsageScope(scopeInput);
        const runtimeConfig = configRepository.getRuntimeConfig();
        const { budget, cost } = this.getBudgetScope(scope, runtimeConfig);

        if (this.isCostOverBudget(cost, budget)) {
            return true;
        }

        return !!scope.userId && this.isGlobalSafetyBudgetExceeded(runtimeConfig);
    }

    wouldExceedBudget({
        estimatedInputTokens,
        estimatedOutputTokens,
        guildId,
        userId,
    }: {
        estimatedInputTokens: number;
        estimatedOutputTokens: number;
        guildId?: string | null;
        userId?: string | null;
    }): boolean {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const { budget, cost } = this.getBudgetScope({ guildId, userId }, runtimeConfig);

        const estimatedCost =
            (estimatedInputTokens / 1_000_000) * (runtimeConfig.inputPricePerMillion || 0) +
            (estimatedOutputTokens / 1_000_000) * (runtimeConfig.outputPricePerMillion || 0);

        if (this.wouldCostExceedBudget(cost, budget, estimatedCost)) {
            return true;
        }

        if (!userId) {
            return false;
        }

        const globalBudget = runtimeConfig.dailyBudgetUsd || 0;
        const globalCost = this.getSharedGlobalBudgetCost(runtimeConfig);
        return this.wouldCostExceedBudget(globalCost, globalBudget, estimatedCost);
    }

    private getBudgetScope(
        scope: UsageScope,
        runtimeConfig: RuntimeConfig,
    ): { budget: number; cost: UsageCost } {
        const decision = resolveBudgetScope(scope, runtimeConfig);

        if (decision.kind === 'user' && decision.userId) {
            return {
                budget: decision.budget,
                cost: this.getUserCost(decision.userId, runtimeConfig),
            };
        }

        if (decision.kind === 'guild' && decision.guildId) {
            return {
                budget: decision.budget,
                cost: this.getGuildCost(decision.guildId, runtimeConfig),
            };
        }

        return {
            budget: decision.budget,
            cost: this.getSharedGlobalBudgetCost(runtimeConfig),
        };
    }

    /** Get stats for dashboard display (global). */
    getStats(): UsageStats {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const cost = this.getSharedGlobalBudgetCost(runtimeConfig);
        const budget = runtimeConfig.dailyBudgetUsd || 0;

        return toUsageStats(cost, budget);
    }

    /** Get stats for a specific guild. */
    getGuildStats(guildId: string): UsageStats {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const cost = this.getGuildCost(guildId, runtimeConfig);
        const budget =
            guildBudgetRepository.getBudget(guildId)?.dailyBudgetUsd ??
            (runtimeConfig.dailyBudgetUsd || 0);

        return toUsageStats(cost, budget);
    }

    /** Get stats for a specific user. */
    getUserStats(userId: string): UsageStats {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const cost = this.getUserCost(userId, runtimeConfig);
        const budget =
            userBudgetRepository.getBudget(userId)?.dailyBudgetUsd ??
            (runtimeConfig.defaultUserDailyBudgetUsd || 0);

        return toUsageStats(cost, budget);
    }

    /** Get stats for multiple guilds with shared config, budget, and usage snapshots. */
    getGuildStatsForGuilds(guildIds: readonly string[]): Record<string, UsageStats> {
        this.ensureToday();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const todayValue = today();
        const guildUsage = usageRepository.getAllGuildDailyUsage();
        const guildBudgets = guildBudgetRepository.listBudgets();

        return Object.fromEntries(
            guildIds.map((guildId) => {
                const usage =
                    guildUsage[guildId]?.date === todayValue
                        ? guildUsage[guildId]
                        : createEmptyUsage(todayValue);
                const cost = withCost(
                    usage,
                    runtimeConfig.inputPricePerMillion || 0,
                    runtimeConfig.outputPricePerMillion || 0,
                );
                const budget =
                    guildBudgets[guildId]?.dailyBudgetUsd ?? (runtimeConfig.dailyBudgetUsd || 0);

                return [guildId, toUsageStats(cost, budget)];
            }),
        );
    }

    /** Get global usage history (last 30 days) with cost calculations. */
    getHistory(): UsageHistoryDay[] {
        this.ensureToday();
        const history = usageRepository.getUsageHistory();
        const runtimeConfig = configRepository.getRuntimeConfig();

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: calculateCost(day, runtimeConfig),
        }));
    }

    /** Get usage history for a specific guild (last 30 days). */
    getGuildHistory(guildId: string): UsageHistoryDay[] {
        this.ensureToday();
        const history = usageRepository.getGuildUsageHistory(guildId);
        const runtimeConfig = configRepository.getRuntimeConfig();

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: calculateCost(day, runtimeConfig),
        }));
    }

    /** Get aggregated usage history for selected guilds (last 30 days). */
    getGuildHistoryForGuilds(guildIds: readonly string[]): UsageHistoryDay[] {
        this.ensureToday();
        const allHistory = usageRepository.getAllGuildUsageHistory();
        const history = guildIds.flatMap((guildId) => allHistory[guildId] ?? []);

        return aggregateHistoryByDate(history);
    }

    /** Get usage history for a specific user (last 30 days). */
    getUserHistory(userId: string): UsageHistoryDay[] {
        this.ensureToday();
        const history = usageRepository.getUserUsageHistory(userId);
        const runtimeConfig = configRepository.getRuntimeConfig();

        return history.map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: calculateCost(day, runtimeConfig),
        }));
    }

    /** Get aggregated usage history for all user-install users (last 30 days). */
    getAllUserHistory(): UsageHistoryDay[] {
        this.ensureToday();
        const allHistory = usageRepository.getAllUserUsageHistory();

        return aggregateHistoryByDate(Object.values(allHistory).flat());
    }

    getUsageExportRows(): UsageExportRow[] {
        this.ensureToday();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const rows = [
            ...toUsageExportRows('global', '', usageRepository.getUsageHistory(), runtimeConfig),
            ...Object.entries(usageRepository.getAllGuildUsageHistory()).flatMap(
                ([guildId, history]) => toUsageExportRows('guild', guildId, history, runtimeConfig),
            ),
            ...Object.entries(usageRepository.getAllUserUsageHistory()).flatMap(
                ([userId, history]) => toUsageExportRows('user', userId, history, runtimeConfig),
            ),
        ];

        return rows.sort(compareUsageExportRows);
    }

    private getSharedGlobalBudgetCost(runtimeConfig: RuntimeConfig): UsageCost {
        this.ensureToday();
        const todayValue = today();
        const totalUsage = usageRepository.getDailyUsage();
        const sharedUsage =
            totalUsage?.date === todayValue ? { ...totalUsage } : createEmptyUsage(todayValue);
        const guildUsage = usageRepository.getAllGuildDailyUsage();
        const customBudgets = guildBudgetRepository.listBudgets();

        for (const guildId of Object.keys(customBudgets)) {
            const customUsage = guildUsage[guildId];
            if (customUsage?.date !== todayValue) {
                continue;
            }

            sharedUsage.inputTokens -= customUsage.inputTokens;
            sharedUsage.outputTokens -= customUsage.outputTokens;
            sharedUsage.requests -= customUsage.requests;
        }

        sharedUsage.inputTokens = Math.max(sharedUsage.inputTokens, 0);
        sharedUsage.outputTokens = Math.max(sharedUsage.outputTokens, 0);
        sharedUsage.requests = Math.max(sharedUsage.requests, 0);

        return withCost(
            sharedUsage,
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }

    private isGlobalSafetyBudgetExceeded(runtimeConfig: RuntimeConfig): boolean {
        return this.isCostOverBudget(
            this.getSharedGlobalBudgetCost(runtimeConfig),
            runtimeConfig.dailyBudgetUsd || 0,
        );
    }

    private isCostOverBudget(cost: UsageCost, budget: number): boolean {
        if (budget <= 0) {
            return false;
        }

        return cost.totalCost >= budget;
    }

    private wouldCostExceedBudget(cost: UsageCost, budget: number, estimatedCost: number): boolean {
        if (budget <= 0) {
            return false;
        }

        return cost.totalCost + estimatedCost >= budget;
    }
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function toHistoryEntry(usage: TokenUsage): UsageHistoryEntry {
    return {
        date: usage.date,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        requests: usage.requests,
    };
}

function aggregateHistoryByDate(history: UsageHistoryEntry[]): UsageHistoryDay[] {
    const runtimeConfig = configRepository.getRuntimeConfig();
    const byDate = new Map<string, UsageHistoryEntry>();

    for (const entry of history) {
        const aggregate =
            byDate.get(entry.date) ??
            ({
                date: entry.date,
                inputTokens: 0,
                outputTokens: 0,
                requests: 0,
            } satisfies UsageHistoryEntry);
        aggregate.inputTokens += entry.inputTokens;
        aggregate.outputTokens += entry.outputTokens;
        aggregate.requests += entry.requests;
        byDate.set(entry.date, aggregate);
    }

    return Array.from(byDate.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-30)
        .map((day) => ({
            ...day,
            totalTokens: day.inputTokens + day.outputTokens,
            cost: calculateCost(day, runtimeConfig),
        }));
}

function toUsageExportRows(
    scope: UsageExportScope,
    id: string,
    history: UsageHistoryEntry[],
    runtimeConfig: RuntimeConfig,
): UsageExportRow[] {
    return history.map((day) => ({
        scope,
        id,
        date: day.date,
        requests: day.requests,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.inputTokens + day.outputTokens,
        costUsd: calculateCost(day, runtimeConfig),
    }));
}

function compareUsageExportRows(a: UsageExportRow, b: UsageExportRow): number {
    const scopeOrder: Record<UsageExportScope, number> = { global: 0, guild: 1, user: 2 };
    return (
        scopeOrder[a.scope] - scopeOrder[b.scope] ||
        a.id.localeCompare(b.id) ||
        a.date.localeCompare(b.date)
    );
}

export const usage = new UsageTracker();

export const _test = {
    /** Clear the same-day rollover memo so the next ensureToday() runs a full pass. */
    resetRolloverMemo(): void {
        (usage as unknown as { lastEnsuredDate: string | null }).lastEnsuredDate = null;
    },
};
