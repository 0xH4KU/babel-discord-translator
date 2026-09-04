/**
 * Token usage tracker with monthly cost calculation, budget enforcement,
 * and 30-day history reporting. Supports global, per-guild, and per-user tracking.
 */
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import {
    GUILD_SHARED_BUDGET_POOL,
    POCKET_SHARED_BUDGET_POOL,
    store,
    type TranslationBudgetPoolId,
} from '../../persistence/store.js';
import { resolveBudgetScope } from './budget-scope.js';
import type { UsageScope } from './usage-scope.js';
import { calculateCost, createEmptyUsage, toUsageStats, withCost } from './usage-cost.js';
import type {
    UsageCost,
    UsageStats,
    UsageHistoryDay,
    UsageHistoryEntry,
} from '../../shared/types.js';
import { resolveBudgetLimits, type BudgetLimitSettings } from '../../shared/budget-limits.js';

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

interface UsagePeriod {
    key: string;
    start: string;
    end: string;
}

interface BudgetWindow extends UsagePeriod {
    fraction: number;
    rolling: boolean;
}

type BudgetSource = {
    key: string;
    budget: number;
} & ({ kind: 'pool'; poolId: TranslationBudgetPoolId } | { kind: 'user'; userId: string });

interface BudgetPlan {
    admissions: BudgetAdmission[];
    poolId: TranslationBudgetPoolId;
}

export class UsageTracker {
    private readonly pendingCosts = new Map<string, number>();

    /** Record a translation's token usage (global + optional guild/user). */
    record(inputTokens: number, outputTokens: number, scope: UsageScope = {}): void {
        store.recordUsage(new Date().toISOString(), inputTokens, outputTokens, scope);
    }

    tryReserveBudget({
        estimatedInputTokens,
        estimatedOutputTokens,
        guildId,
        userId,
        actorUserId,
    }: UsageBudgetEstimate): UsageBudgetReservation | null {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const scope = { guildId, userId, actorUserId };
        const estimatedCost = calculateCost(
            { inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens },
            runtimeConfig,
        );
        const { admissions, poolId } = this.getBudgetPlan(scope, runtimeConfig, new Date());

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
                this.recordInPool(inputTokens, outputTokens, scope, poolId, {
                    inputPricePerMillion: runtimeConfig.inputPricePerMillion,
                    outputPricePerMillion: runtimeConfig.outputPricePerMillion,
                });
            },
            release,
        };
    }

    private recordInPool(
        inputTokens: number,
        outputTokens: number,
        scope: UsageScope,
        budgetPoolId: TranslationBudgetPoolId,
        prices: Pick<RuntimeConfig, 'inputPricePerMillion' | 'outputPricePerMillion'>,
    ): void {
        store.recordUsage(
            new Date().toISOString(),
            inputTokens,
            outputTokens,
            {
                ...scope,
                budgetPoolId,
            },
            prices,
        );
    }

    private getBudgetPlan(scope: UsageScope, runtimeConfig: RuntimeConfig, now: Date): BudgetPlan {
        const decision = resolveBudgetScope(scope, runtimeConfig);
        const limits = resolveBudgetLimits(
            runtimeConfig,
            scope.guildId ? store.getGuildBudgetLimitOverrides(scope.guildId) : {},
        );
        const windows = budgetWindows(now, limits);
        const sources: BudgetSource[] = [];
        const poolId = budgetPoolForDecision(decision);

        if (decision.kind === 'user' && decision.userId) {
            sources.push(
                {
                    key: `user:${decision.userId}`,
                    budget: decision.budget,
                    kind: 'user',
                    userId: decision.userId,
                },
                {
                    key: POCKET_SHARED_BUDGET_POOL,
                    budget: runtimeConfig.pocketGlobalMonthlyBudgetUsd || 0,
                    kind: 'pool',
                    poolId,
                },
            );
        } else if (decision.kind === 'guild' && decision.guildId) {
            sources.push({
                key: `guild:${decision.guildId}`,
                budget: decision.budget,
                kind: 'pool',
                poolId,
            });
        } else {
            sources.push({
                key: GUILD_SHARED_BUDGET_POOL,
                budget: decision.budget,
                kind: 'pool',
                poolId,
            });
        }

        const admissions = sources.flatMap((source) =>
            windows.map((window) => ({
                key: `${window.key}:${source.key}`,
                budget: source.budget * window.fraction,
                cost: this.getBudgetSourceCost(source, window, runtimeConfig),
            })),
        );

        if (scope.guildId && scope.actorUserId && decision.budget > 0) {
            const activeWindow = windows[1]!;
            let activeUsers = store.countActiveGuildUsers(
                scope.guildId,
                activeWindow.start,
                activeWindow.end,
            );
            if (
                store.getGuildUserRollingUsage(
                    scope.guildId,
                    scope.actorUserId,
                    activeWindow.start,
                    activeWindow.end,
                ).requests === 0
            ) {
                activeUsers += 1;
            }
            const fairShare = Math.min(1, limits.budgetFairShareMultiplier / activeUsers);

            admissions.push(
                ...windows.map((window) => ({
                    key: `${window.key}:guild-user:${scope.guildId}:${scope.actorUserId}`,
                    budget: decision.budget * window.fraction * fairShare,
                    cost: withCost(
                        store.getGuildUserRollingUsage(
                            scope.guildId!,
                            scope.actorUserId!,
                            window.start,
                            window.end,
                        ),
                        runtimeConfig.inputPricePerMillion || 0,
                        runtimeConfig.outputPricePerMillion || 0,
                    ),
                })),
            );
        }

        return { admissions, poolId };
    }

    private getBudgetSourceCost(
        source: BudgetSource,
        window: BudgetWindow,
        runtimeConfig: RuntimeConfig,
    ): UsageCost {
        const tokens =
            source.kind === 'pool'
                ? window.rolling
                    ? store.getRollingBudgetPoolUsageBetween(
                          source.poolId,
                          window.start,
                          window.end,
                      )
                    : store.getBudgetPoolUsageBetween(source.poolId, window.start, window.end)
                : window.rolling
                  ? store.getRollingUsageBetween('user', source.userId, window.start, window.end)
                  : store.getUsageBetween('user', source.userId, window.start, window.end);

        return withCost(
            tokens,
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }

    /** Get stats for dashboard display (global). */
    getStats(runtimeConfig = configRepository.getRuntimeConfig()): UsageStats {
        const cost = this.getBudgetPoolCost(
            GUILD_SHARED_BUDGET_POOL,
            runtimeConfig,
            currentMonth(),
        );
        const budget = runtimeConfig.monthlyBudgetUsd || 0;

        return toUsageStats(cost, budget);
    }

    /** Get Babel Pocket's shared safety-budget stats. */
    getPocketStats(runtimeConfig = configRepository.getRuntimeConfig()): UsageStats {
        const cost = this.getBudgetPoolCost(
            POCKET_SHARED_BUDGET_POOL,
            runtimeConfig,
            currentMonth(),
        );
        return toUsageStats(cost, runtimeConfig.pocketGlobalMonthlyBudgetUsd || 0);
    }

    /** Get stats for a specific guild. */
    getGuildStats(guildId: string): UsageStats {
        const runtimeConfig = configRepository.getRuntimeConfig();
        const customBudget = store.getGuildBudget(guildId);
        if (!customBudget) return this.getStats(runtimeConfig);

        const cost = this.getBudgetPoolCost(`guild:${guildId}`, runtimeConfig, currentMonth());
        const budget = customBudget.monthlyBudgetUsd;

        return toUsageStats(cost, budget);
    }

    /** Get stats for multiple guilds with shared config, budget, and usage snapshots. */
    getGuildStatsForGuilds(
        guildIds: readonly string[],
        budgets = store.listGuildBudgets(),
        runtimeConfig = configRepository.getRuntimeConfig(),
    ): Record<string, UsageStats> {
        const period = currentMonth();
        const scopedUsage = store.getUsageForIdsBetween(
            'guild',
            guildIds,
            period.start,
            period.end,
        );
        const customPoolIds = guildIds.flatMap((guildId) =>
            budgets[guildId] ? ([`guild:${guildId}`] as const) : [],
        );
        const customUsage = store.getBudgetPoolUsageForIdsBetween(
            customPoolIds,
            period.start,
            period.end,
        );

        return Object.fromEntries(
            guildIds.map((guildId) => {
                const customBudget = budgets[guildId];
                const usage = customBudget ? customUsage[`guild:${guildId}`] : scopedUsage[guildId];
                const cost = withCost(
                    usage ?? createEmptyUsage(period.start),
                    runtimeConfig.inputPricePerMillion || 0,
                    runtimeConfig.outputPricePerMillion || 0,
                );
                const budget =
                    customBudget?.monthlyBudgetUsd ?? (runtimeConfig.monthlyBudgetUsd || 0);
                return [guildId, toUsageStats(cost, budget)];
            }),
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
            runtimeConfig.defaultUserMonthlyBudgetUsd || 0,
            runtimeConfig,
        );
    }

    private getScopedStatsForIds(
        scope: 'guild' | 'user',
        ids: readonly string[],
        budgets: Record<string, { monthlyBudgetUsd: number }>,
        defaultBudget: number,
        runtimeConfig: RuntimeConfig,
    ): Record<string, UsageStats> {
        const period = currentMonth();
        const scopedUsage = store.getUsageForIdsBetween(scope, ids, period.start, period.end);

        return Object.fromEntries(
            ids.map((id) => {
                const usage = scopedUsage[id] ?? createEmptyUsage(period.start);
                const cost = withCost(
                    usage,
                    runtimeConfig.inputPricePerMillion || 0,
                    runtimeConfig.outputPricePerMillion || 0,
                );
                const budget = budgets[id]?.monthlyBudgetUsd ?? defaultBudget;

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

    private getBudgetPoolCost(
        poolId: TranslationBudgetPoolId,
        runtimeConfig: RuntimeConfig,
        period = currentMonth(),
    ): UsageCost {
        return withCost(
            store.getBudgetPoolUsageBetween(poolId, period.start, period.end),
            runtimeConfig.inputPricePerMillion || 0,
            runtimeConfig.outputPricePerMillion || 0,
        );
    }
}

function budgetPoolForDecision(
    decision: ReturnType<typeof resolveBudgetScope>,
): TranslationBudgetPoolId {
    if (decision.kind === 'user') return POCKET_SHARED_BUDGET_POOL;
    if (decision.kind === 'guild') return `guild:${decision.guildId}`;
    return GUILD_SHARED_BUDGET_POOL;
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function currentMonth(now = new Date()): UsagePeriod {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
    return { key: start.slice(0, 7), start, end };
}

function budgetWindows(now: Date, settings: BudgetLimitSettings): BudgetWindow[] {
    const end = new Date(now.getTime() + 1).toISOString();
    const month = currentMonth(now);
    return [
        {
            key: '5h',
            start: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
            end,
            fraction: settings.budgetFiveHourPercent / 100,
            rolling: true,
        },
        {
            key: '7d',
            start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            end,
            fraction: settings.budgetSevenDayPercent / 100,
            rolling: true,
        },
        { ...month, key: `month:${month.key}`, fraction: 1, rolling: false },
    ];
}

function withHistoryCost(
    history: UsageHistoryEntry[],
    runtimeConfig: RuntimeConfig,
): UsageHistoryDay[] {
    return history.map(({ inputCost, outputCost, ...day }) => ({
        ...day,
        totalTokens: day.inputTokens + day.outputTokens,
        cost: calculateCost({ ...day, inputCost, outputCost }, runtimeConfig),
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
