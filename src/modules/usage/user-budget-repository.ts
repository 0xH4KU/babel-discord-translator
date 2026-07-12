import { cloneUserBudgets } from '../../persistence/store-data-normalizer.js';
import { store } from '../../persistence/store.js';
import type { UserBudgetConfig } from '../../shared/types.js';

export const userBudgetRepository = {
    getBudget(userId: string): UserBudgetConfig | null {
        return store.getUserBudget(userId);
    },

    listBudgets(): Record<string, UserBudgetConfig> {
        return cloneUserBudgets(store.get('userBudgets') ?? {});
    },

    setBudget(userId: string, dailyBudgetUsd: number): void {
        store.setUserBudget(userId, dailyBudgetUsd);
    },

    clearBudget(userId: string): boolean {
        return store.clearUserBudget(userId);
    },
};
