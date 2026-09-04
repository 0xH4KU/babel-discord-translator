import type { RuntimeConfig } from '../config/config-repository.js';
import { store } from '../../persistence/store.js';
import type { UsageScope } from './usage-scope.js';

export type BudgetScopeKind = 'global' | 'guild' | 'user';

export type BudgetScopeDecision =
    | { kind: 'global'; budget: number }
    | { kind: 'guild'; budget: number; guildId: string }
    | { kind: 'user'; budget: number; userId: string };

export function resolveBudgetScope(
    scope: UsageScope,
    runtimeConfig: RuntimeConfig,
): BudgetScopeDecision {
    if (scope.userId) {
        const userBudget = store.getUserBudget(scope.userId);

        return {
            kind: 'user',
            userId: scope.userId,
            budget: userBudget?.monthlyBudgetUsd ?? runtimeConfig.defaultUserMonthlyBudgetUsd ?? 0,
        };
    }

    if (scope.guildId) {
        const guildBudget = store.getGuildBudget(scope.guildId);
        if (guildBudget) {
            return {
                kind: 'guild',
                guildId: scope.guildId,
                budget: guildBudget.monthlyBudgetUsd,
            };
        }
    }

    return {
        kind: 'global',
        budget: runtimeConfig.monthlyBudgetUsd || 0,
    };
}
