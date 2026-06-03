import { cloneUserBudgets } from '../../repositories/store-data-normalizer.js';
import { store } from '../../store.js';
import type { UserBudgetConfig } from '../../types.js';

export interface UserBudgetRepository {
    getBudget(userId: string): UserBudgetConfig | null;
    listBudgets(): Record<string, UserBudgetConfig>;
    setBudget(userId: string, dailyBudgetUsd: number): void;
    clearBudget(userId: string): boolean;
}

class StoreBackedUserBudgetRepository implements UserBudgetRepository {
    getBudget(userId: string): UserBudgetConfig | null {
        return store.getUserBudget(userId);
    }

    listBudgets(): Record<string, UserBudgetConfig> {
        return cloneUserBudgets(store.get('userBudgets') ?? {});
    }

    setBudget(userId: string, dailyBudgetUsd: number): void {
        store.setUserBudget(userId, dailyBudgetUsd);
    }

    clearBudget(userId: string): boolean {
        return store.clearUserBudget(userId);
    }
}

export const userBudgetRepository = new StoreBackedUserBudgetRepository();
