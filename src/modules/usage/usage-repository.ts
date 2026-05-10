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
    getGuildDailyUsage(guildId: string): TokenUsage | null;
    saveGuildDailyUsage(guildId: string, usage: TokenUsage): void;
    getAllGuildDailyUsage(): Record<string, TokenUsage>;
    saveAllGuildDailyUsage(usage: Record<string, TokenUsage>): void;
    getGuildUsageHistory(guildId: string): UsageHistoryEntry[];
    saveGuildUsageHistory(guildId: string, history: UsageHistoryEntry[]): void;
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

    getGuildDailyUsage(guildId: string): TokenUsage | null {
        return cloneTokenUsage(store.getGuildDailyUsage(guildId));
    }

    saveGuildDailyUsage(guildId: string, usage: TokenUsage): void {
        store.saveGuildDailyUsage(guildId, normalizeTokenUsage(usage));
    }

    getAllGuildDailyUsage(): Record<string, TokenUsage> {
        return cloneGuildDailyUsage(store.get('guildTokenUsage') ?? {});
    }

    saveAllGuildDailyUsage(usage: Record<string, TokenUsage>): void {
        store.set('guildTokenUsage', cloneGuildDailyUsage(usage));
    }

    getGuildUsageHistory(guildId: string): UsageHistoryEntry[] {
        return cloneUsageHistory(store.getGuildUsageHistory(guildId));
    }

    saveGuildUsageHistory(guildId: string, history: UsageHistoryEntry[]): void {
        store.saveGuildUsageHistory(guildId, cloneUsageHistory(history));
    }

    getAllGuildUsageHistory(): Record<string, UsageHistoryEntry[]> {
        return cloneGuildUsageHistory(store.get('guildUsageHistory') ?? {});
    }

    saveAllGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        store.set('guildUsageHistory', cloneGuildUsageHistory(history));
    }
}

function normalizeTokenUsage(usage: TokenUsage): TokenUsage {
    const cloned = cloneTokenUsage(usage);
    if (!cloned) {
        throw new Error('Cannot save empty guild usage entry');
    }
    return cloned;
}

export const usageRepository = new StoreBackedUsageRepository();
