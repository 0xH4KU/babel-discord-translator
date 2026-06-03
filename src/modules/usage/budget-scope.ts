import type { RuntimeConfig } from '../config/config-repository.js';
import { guildBudgetRepository } from './guild-budget-repository.js';
import { userBudgetRepository } from './user-budget-repository.js';
import type { UsageScope } from './usage-scope.js';

export type BudgetScopeKind = 'global' | 'guild' | 'user';

export interface BudgetScopeDecision {
    kind: BudgetScopeKind;
    budget: number;
    guildId?: string;
    userId?: string;
}

export function resolveBudgetScope(
    scope: UsageScope,
    runtimeConfig: RuntimeConfig,
): BudgetScopeDecision {
    if (scope.userId) {
        const userBudget = userBudgetRepository.getBudget(scope.userId);

        return {
            kind: 'user',
            userId: scope.userId,
            budget: userBudget?.dailyBudgetUsd ?? runtimeConfig.defaultUserDailyBudgetUsd ?? 0,
        };
    }

    if (scope.guildId) {
        const guildBudget = guildBudgetRepository.getBudget(scope.guildId);
        if (guildBudget) {
            return {
                kind: 'guild',
                guildId: scope.guildId,
                budget: guildBudget.dailyBudgetUsd,
            };
        }
    }

    return {
        kind: 'global',
        budget: runtimeConfig.dailyBudgetUsd || 0,
    };
}
