import { store } from '../../store.js';
import type { GuildBudgetConfig } from '../../types.js';
import { cloneGuildBudgets } from '../../repositories/store-data-normalizer.js';

export interface GuildBudgetRepository {
    getBudget(guildId: string): GuildBudgetConfig | null;
    listBudgets(): Record<string, GuildBudgetConfig>;
    setBudget(guildId: string, dailyBudgetUsd: number): void;
    clearBudget(guildId: string): boolean;
}

class StoreBackedGuildBudgetRepository implements GuildBudgetRepository {
    getBudget(guildId: string): GuildBudgetConfig | null {
        return store.getGuildBudget(guildId);
    }

    listBudgets(): Record<string, GuildBudgetConfig> {
        return cloneGuildBudgets(store.get('guildBudgets') ?? {});
    }

    setBudget(guildId: string, dailyBudgetUsd: number): void {
        store.setGuildBudget(guildId, dailyBudgetUsd);
    }

    clearBudget(guildId: string): boolean {
        return store.clearGuildBudget(guildId);
    }
}

export const guildBudgetRepository = new StoreBackedGuildBudgetRepository();
