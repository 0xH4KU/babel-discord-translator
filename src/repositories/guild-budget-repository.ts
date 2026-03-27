import { store } from '../store.js';
import type { GuildBudgetConfig } from '../types.js';
import { cloneGuildBudgets } from './store-data-normalizer.js';

export interface GuildBudgetRepository {
    getBudget(guildId: string): GuildBudgetConfig | null;
    listBudgets(): Record<string, GuildBudgetConfig>;
    setBudget(guildId: string, dailyBudgetUsd: number): void;
    clearBudget(guildId: string): boolean;
}

class StoreBackedGuildBudgetRepository implements GuildBudgetRepository {
    getBudget(guildId: string): GuildBudgetConfig | null {
        return this.listBudgets()[guildId] ?? null;
    }

    listBudgets(): Record<string, GuildBudgetConfig> {
        return cloneGuildBudgets(store.get('guildBudgets') ?? {});
    }

    setBudget(guildId: string, dailyBudgetUsd: number): void {
        const budgets = this.listBudgets();
        budgets[guildId] = { dailyBudgetUsd };
        store.set('guildBudgets', budgets);
    }

    clearBudget(guildId: string): boolean {
        const budgets = this.listBudgets();
        if (!(guildId in budgets)) {
            return false;
        }

        delete budgets[guildId];
        store.set('guildBudgets', budgets);
        return true;
    }
}

export const guildBudgetRepository = new StoreBackedGuildBudgetRepository();
