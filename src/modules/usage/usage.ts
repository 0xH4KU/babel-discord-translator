/**
 * Daily token usage tracker with cost calculation, budget enforcement,
 * and 30-day history reporting. Supports global, per-guild, and per-user tracking.
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

export class UsageTracker {
    private readonly pendingCosts = new Map<string, number>();

    /** Record a translation's token usage (global + optional guild/user). */
    record(inputTokens: number, outputTokens: number, scope: UsageScope = {}): void {
        store.recordUsage(today(), inputTokens, outputTokens, scope);
    }

    /** Calculate today's cost for a specific user. */
    private getUserCost(
        userId: string,
        runtimeConfig = configRepository.getRuntimeConfig(),
    ): UsageCost {
        return currentCost(store.getUsage('user', userId, today()), runtimeConfig);
    }

    /** Calculate today's cost for a specific guild. */
    private getGuildCost(
        guildId: string,
        runtimeConfig = configRepository.getRuntimeConfig(),
    ): UsageCost {
        return currentCost(store.getUsage('guild', guildId, today()), runtimeConfig);
    }

    tryReserveBudget({
        estimatedInputTokens,
        estimatedOutputTokens,
        guildId,
        userId,
    }: UsageBudgetEstimate): UsageBudgetReservation | null {
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

    /** Get stats for dashboard display (global). */
    getStats(runtimeConfig = configRepository.getRuntimeConfig()): UsageStats {
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

    /** Get stats for multiple guilds with shared config, budget, and usage snapshots. */
    getGuildStatsForGuilds(
        guildIds: readonly string[],
        budgets = store.listGuildBudgets(),
        runtimeConfig = configRepository.getRuntimeConfig(),
    ): Record<string, UsageStats> {
        return this.getScopedStatsForIds(
            'guild',
            guildIds,
            budgets,
            runtimeConfig.dailyBudgetUsd || 0,
            runtimeConfig,
        );
    }

    /** Get stats for multiple users with one usage query. */
    getUserStatsForUsers(
        userIds: readonly string[],
        budgets = store.listUserBudgets(),
        runtimeConfig = configRepository.getRuntimeConfig(),
    ): Record<string, UsageStats> {
        return this.getScopedStatsForIds(
            'user',
            userIds,
            budgets,
            runtimeConfig.defaultUserDailyBudgetUsd || 0,
            runtimeConfig,
        );
    }

    private getScopedStatsForIds(
        scope: 'guild' | 'user',
        ids: readonly string[],
        budgets: Record<string, { dailyBudgetUsd: number }>,
        defaultBudget: number,
        runtimeConfig: RuntimeConfig,
    ): Record<string, UsageStats> {
        const todayValue = today();
        const scopedUsage = store.getUsageForIds(scope, ids, todayValue);

        return Object.fromEntries(
            ids.map((id) => {
                const usage = scopedUsage[id] ?? createEmptyUsage(todayValue);
                const cost = withCost(
                    usage,
                    runtimeConfig.inputPricePerMillion || 0,
                    runtimeConfig.outputPricePerMillion || 0,
                );
                const budget = budgets[id]?.dailyBudgetUsd ?? defaultBudget;

                return [id, toUsageStats(cost, budget)];
            }),
        );
    }

    /** Get global usage history (last 30 days) with cost calculations. */
    getHistory(): UsageHistoryDay[] {
        const history = store.getUsageHistory('global', today());
        const runtimeConfig = configRepository.getRuntimeConfig();

        return withHistoryCost(history, runtimeConfig);
    }

    /** Get usage history for a specific guild (last 30 days). */
    getGuildHistory(guildId: string): UsageHistoryDay[] {
        const history = store.getUsageHistory('guild', today(), [guildId]);
        const runtimeConfig = configRepository.getRuntimeConfig();

        return withHistoryCost(history, runtimeConfig);
    }

    /** Get aggregated usage history for selected guilds (last 30 days). */
    getGuildHistoryForGuilds(guildIds: readonly string[]): UsageHistoryDay[] {
        return withHistoryCost(
            store.getUsageHistory('guild', today(), guildIds),
            configRepository.getRuntimeConfig(),
        );
    }

    /** Get aggregated usage history for all user-install users (last 30 days). */
    getAllUserHistory(): UsageHistoryDay[] {
        return withHistoryCost(
            store.getUsageHistory('user', today()),
            configRepository.getRuntimeConfig(),
        );
    }

    getUsageExportRows(): UsageExportRow[] {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const rows = store.listUsageRows().map(({ scope, scopeId, ...day }) => ({
            scope,
            id: scopeId,
            date: day.date,
            requests: day.requests,
            inputTokens: day.inputTokens,
            outputTokens: day.outputTokens,
            totalTokens: day.inputTokens + day.outputTokens,
            costUsd: calculateCost(day, runtimeConfig),
        }));

        return rows.sort(compareUsageExportRows);
    }

    private getSharedGlobalBudgetCost(runtimeConfig: RuntimeConfig): UsageCost {
        return withCost(
            store.getSharedGlobalUsage(today()),
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
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

function compareUsageExportRows(a: UsageExportRow, b: UsageExportRow): number {
    const scopeOrder: Record<UsageExportScope, number> = { global: 0, guild: 1, user: 2 };
    return (
        scopeOrder[a.scope] - scopeOrder[b.scope] ||
        a.id.localeCompare(b.id) ||
        a.date.localeCompare(b.date)
    );
}

export const usage = new UsageTracker();
