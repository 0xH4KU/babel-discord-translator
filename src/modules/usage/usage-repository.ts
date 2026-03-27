import { store } from '../../store.js';
import type { TokenUsage, UsageHistoryEntry } from '../../types.js';
import {
    cloneGuildDailyUsage,
    cloneGuildUsageHistory,
    cloneTokenUsage,
    cloneUsageHistory,
} from '../../repositories/store-data-normalizer.js';

export interface UsageRepository {
    getDailyUsage(): TokenUsage | null;
    saveDailyUsage(usage: TokenUsage): void;
    getUsageHistory(): UsageHistoryEntry[];
    saveUsageHistory(history: UsageHistoryEntry[]): void;
    getAllGuildDailyUsage(): Record<string, TokenUsage>;
    saveAllGuildDailyUsage(usage: Record<string, TokenUsage>): void;
    getAllGuildUsageHistory(): Record<string, UsageHistoryEntry[]>;
    saveAllGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): void;
}

class StoreBackedUsageRepository implements UsageRepository {
    getDailyUsage(): TokenUsage | null {
        const usage = store.get('tokenUsage');
        return usage ? cloneTokenUsage(usage) : null;
    }

    saveDailyUsage(usage: TokenUsage): void {
        store.set('tokenUsage', cloneTokenUsage(usage));
    }

    getUsageHistory(): UsageHistoryEntry[] {
        return cloneUsageHistory(store.get('usageHistory') ?? []);
    }

    saveUsageHistory(history: UsageHistoryEntry[]): void {
        store.set('usageHistory', cloneUsageHistory(history));
    }

    getAllGuildDailyUsage(): Record<string, TokenUsage> {
        return cloneGuildDailyUsage(store.get('guildTokenUsage') ?? {});
    }

    saveAllGuildDailyUsage(usage: Record<string, TokenUsage>): void {
        store.set('guildTokenUsage', cloneGuildDailyUsage(usage));
    }

    getAllGuildUsageHistory(): Record<string, UsageHistoryEntry[]> {
        return cloneGuildUsageHistory(store.get('guildUsageHistory') ?? {});
    }

    saveAllGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        store.set('guildUsageHistory', cloneGuildUsageHistory(history));
    }
}

export const usageRepository = new StoreBackedUsageRepository();
