/**
 * Daily token usage tracker with cost calculation, budget enforcement,
 * and 30-day history archiving. Supports global, per-guild, and per-user tracking.
 */
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import { store } from '../../persistence/store.js';
import { resolveBudgetScope } from './budget-scope.js';
import type { UsageScope } from './usage-scope.js';
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

export interface UsageBudgetEstimate extends UsageScope {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
}

export interface UsageBudgetReservation {
    settle(inputTokens: number, outputTokens: number): void;
    release(): void;
}

interface BudgetAdmission {
    key: string;
    budget: number;
    cost: UsageCost;
}

class UsageTracker {
    private lastEnsuredDate: string | null = null;
    private readonly pendingCosts = new Map<string, number>();

    constructor() {
        this.ensureToday();
    }

    /** Reset counters if the date has changed, archiving previous day. */
    ensureToday(): void {
        const todayValue = today();
        if (this.lastEnsuredDate === todayValue) {
            return;
        }

        rolloverUsage(
            store.getDailyUsage(),
            todayValue,
            () => store.getUsageHistory(),
            (history) => store.saveUsageHistory(history),
            (usage) => store.saveDailyUsage(usage),
        );

        for (const [id, usage] of Object.entries(store.getAllGuildDailyUsage())) {
            rolloverUsage(
                usage,
                todayValue,
                () => store.getGuildUsageHistory(id),
                (history) => store.saveGuildUsageHistory(id, history),
                (entry) => store.saveGuildDailyUsage(id, entry),
            );
        }

        for (const [id, usage] of Object.entries(store.getAllUserDailyUsage())) {
            rolloverUsage(
                usage,
                todayValue,
                () => store.getUserUsageHistory(id),
                (history) => store.saveUserUsageHistory(id, history),
                (entry) => store.saveUserDailyUsage(id, entry),
            );
        }

        this.pendingCosts.clear();
        this.lastEnsuredDate = todayValue;
    }

    /** Record a translation's token usage (global + optional guild/user). */
    record(inputTokens: number, outputTokens: number, scope: UsageScope = {}): void {
        this.ensureToday();

        const todayValue = today();
        store.saveDailyUsage(
            addUsage(store.getDailyUsage(), todayValue, inputTokens, outputTokens),
        );

        if (scope.guildId) {
            store.saveGuildDailyUsage(
                scope.guildId,
                addUsage(
                    store.getGuildDailyUsage(scope.guildId),
                    todayValue,
                    inputTokens,
                    outputTokens,
                ),
            );
        }

        if (scope.userId) {
            store.saveUserDailyUsage(
                scope.userId,
                addUsage(
                    store.getUserDailyUsage(scope.userId),
                    todayValue,
                    inputTokens,
                    outputTokens,
                ),
            );
        }
    }

    /** Calculate today's cost in USD (global). */
    getCost(runtimeConfig = configRepository.getRuntimeConfig()): UsageCost {
        this.ensureToday();
        return currentCost(store.getDailyUsage(), runtimeConfig);
    }

    /** Calculate today's cost for a specific user. */
    getUserCost(userId: string, runtimeConfig = configRepository.getRuntimeConfig()): UsageCost {
        this.ensureToday();
        return currentCost(store.getUserDailyUsage(userId), runtimeConfig);
    }

    /** Calculate today's cost for a specific guild. */
    getGuildCost(guildId: string, runtimeConfig = configRepository.getRuntimeConfig()): UsageCost {
        this.ensureToday();
        return currentCost(store.getGuildDailyUsage(guildId), runtimeConfig);
    }

    /**
     * Check if daily budget is exceeded.
     * If guildId is provided, checks guild-specific budget first,
     * then falls back to the global budget.
     */
    isBudgetExceeded(scope: UsageScope = {}): boolean {
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

    tryReserveBudget({
        estimatedInputTokens,
        estimatedOutputTokens,
        guildId,
        userId,
    }: UsageBudgetEstimate): UsageBudgetReservation | null {
        this.ensureToday();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const scope = { guildId, userId };
        const estimatedCost = calculateCost(
            { inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens },
            runtimeConfig,
        );
        const reservationDate = today();
        const admissions = this.getBudgetAdmissions(scope, runtimeConfig).map((admission) => ({
            ...admission,
            key: `${reservationDate}:${admission.key}`,
        }));

        if (
            admissions.some(
                ({ key, budget, cost }) =>
                    budget > 0 &&
                    cost.totalCost + (this.pendingCosts.get(key) ?? 0) + estimatedCost >= budget,
            )
        ) {
            return null;
        }

        for (const { key } of admissions) {
            this.pendingCosts.set(key, (this.pendingCosts.get(key) ?? 0) + estimatedCost);
        }

        let active = true;
        const release = (): void => {
            if (!active) return;
            active = false;

            for (const { key } of admissions) {
                const remaining = (this.pendingCosts.get(key) ?? 0) - estimatedCost;
                if (remaining > 0) this.pendingCosts.set(key, remaining);
                else this.pendingCosts.delete(key);
            }
        };

        return {
            settle: (inputTokens, outputTokens) => {
                if (!active) return;
                release();
                this.record(inputTokens, outputTokens, scope);
            },
            release,
        };
    }

    private getBudgetAdmissions(
        scope: UsageScope,
        runtimeConfig: RuntimeConfig,
    ): BudgetAdmission[] {
        const decision = resolveBudgetScope(scope, runtimeConfig);

        if (decision.kind === 'user' && decision.userId) {
            return [
                {
                    key: `user:${decision.userId}`,
                    budget: decision.budget,
                    cost: this.getUserCost(decision.userId, runtimeConfig),
                },
                {
                    key: 'global',
                    budget: runtimeConfig.dailyBudgetUsd || 0,
                    cost: this.getSharedGlobalBudgetCost(runtimeConfig),
                },
            ];
        }

        if (decision.kind === 'guild' && decision.guildId) {
            return [
                {
                    key: `guild:${decision.guildId}`,
                    budget: decision.budget,
                    cost: this.getGuildCost(decision.guildId, runtimeConfig),
                },
            ];
        }

        return [
            {
                key: 'global',
                budget: decision.budget,
                cost: this.getSharedGlobalBudgetCost(runtimeConfig),
            },
        ];
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
            store.getGuildBudget(guildId)?.dailyBudgetUsd ?? (runtimeConfig.dailyBudgetUsd || 0);

        return toUsageStats(cost, budget);
    }

    /** Get stats for a specific user. */
    getUserStats(userId: string): UsageStats {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const cost = this.getUserCost(userId, runtimeConfig);
        const budget =
            store.getUserBudget(userId)?.dailyBudgetUsd ??
            (runtimeConfig.defaultUserDailyBudgetUsd || 0);

        return toUsageStats(cost, budget);
    }

    /** Get stats for multiple guilds with shared config, budget, and usage snapshots. */
    getGuildStatsForGuilds(guildIds: readonly string[]): Record<string, UsageStats> {
        this.ensureToday();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const todayValue = today();
        const guildUsage = store.getAllGuildDailyUsage();
        const guildBudgets = store.listGuildBudgets();

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
        const history = store.getUsageHistory();
        const runtimeConfig = configRepository.getRuntimeConfig();

        return withHistoryCost(history, runtimeConfig);
    }

    /** Get usage history for a specific guild (last 30 days). */
    getGuildHistory(guildId: string): UsageHistoryDay[] {
        this.ensureToday();
        const history = store.getGuildUsageHistory(guildId);
        const runtimeConfig = configRepository.getRuntimeConfig();

        return withHistoryCost(history, runtimeConfig);
    }

    /** Get aggregated usage history for selected guilds (last 30 days). */
    getGuildHistoryForGuilds(guildIds: readonly string[]): UsageHistoryDay[] {
        this.ensureToday();
        const allHistory = store.getAllGuildUsageHistory();
        const history = guildIds.flatMap((guildId) => allHistory[guildId] ?? []);

        return aggregateHistoryByDate(history);
    }

    /** Get usage history for a specific user (last 30 days). */
    getUserHistory(userId: string): UsageHistoryDay[] {
        this.ensureToday();
        const history = store.getUserUsageHistory(userId);
        const runtimeConfig = configRepository.getRuntimeConfig();

        return withHistoryCost(history, runtimeConfig);
    }

    /** Get aggregated usage history for all user-install users (last 30 days). */
    getAllUserHistory(): UsageHistoryDay[] {
        this.ensureToday();
        const allHistory = store.getAllUserUsageHistory();

        return aggregateHistoryByDate(Object.values(allHistory).flat());
    }

    getUsageExportRows(): UsageExportRow[] {
        this.ensureToday();
        const runtimeConfig = configRepository.getRuntimeConfig();
        const rows = [
            ...toUsageExportRows('global', '', store.getUsageHistory(), runtimeConfig),
            ...Object.entries(store.getAllGuildUsageHistory()).flatMap(([guildId, history]) =>
                toUsageExportRows('guild', guildId, history, runtimeConfig),
            ),
            ...Object.entries(store.getAllUserUsageHistory()).flatMap(([userId, history]) =>
                toUsageExportRows('user', userId, history, runtimeConfig),
            ),
        ];

        return rows.sort(compareUsageExportRows);
    }

    private getSharedGlobalBudgetCost(runtimeConfig: RuntimeConfig): UsageCost {
        this.ensureToday();
        const todayValue = today();
        const totalUsage = store.getDailyUsage();
        const sharedUsage =
            totalUsage?.date === todayValue ? { ...totalUsage } : createEmptyUsage(todayValue);
        const guildUsage = store.getAllGuildDailyUsage();
        const customBudgets = store.listGuildBudgets();

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

function rolloverUsage(
    usage: TokenUsage | null,
    date: string,
    getHistory: () => UsageHistoryEntry[],
    saveHistory: (history: UsageHistoryEntry[]) => void,
    saveDaily: (usage: TokenUsage) => void,
): void {
    if (usage?.date === date) return;

    if (usage?.date) {
        const history = [...getHistory(), toHistoryEntry(usage)].slice(-30);
        saveHistory(history);
    }

    saveDaily(createEmptyUsage(date));
}

function addUsage(
    current: TokenUsage | null,
    date: string,
    inputTokens: number,
    outputTokens: number,
): TokenUsage {
    const usage = current?.date === date ? current : createEmptyUsage(date);
    usage.inputTokens += inputTokens || 0;
    usage.outputTokens += outputTokens || 0;
    usage.requests += 1;
    return usage;
}

function currentCost(usage: TokenUsage | null, runtimeConfig: RuntimeConfig): UsageCost {
    const date = today();
    return withCost(
        usage?.date === date ? usage : createEmptyUsage(date),
        runtimeConfig.inputPricePerMillion || 0,
        runtimeConfig.outputPricePerMillion || 0,
    );
}

function withHistoryCost(
    history: UsageHistoryEntry[],
    runtimeConfig: RuntimeConfig,
): UsageHistoryDay[] {
    return history.map((day) => ({
        ...day,
        totalTokens: day.inputTokens + day.outputTokens,
        cost: calculateCost(day, runtimeConfig),
    }));
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
        const tracker = usage as unknown as {
            lastEnsuredDate: string | null;
            pendingCosts: Map<string, number>;
        };
        tracker.lastEnsuredDate = null;
        tracker.pendingCosts.clear();
    },
};
