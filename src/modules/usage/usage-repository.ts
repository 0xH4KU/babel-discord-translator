import { store } from '../../persistence/store.js';
import type { TokenUsage, UsageHistoryEntry } from '../../shared/types.js';
import {
    cloneGuildDailyUsage,
    cloneGuildUsageHistory,
    cloneTokenUsage,
    cloneUserDailyUsage,
    cloneUserUsageHistory,
    cloneUsageHistory,
} from '../../persistence/store-data-normalizer.js';

export const usageRepository = {
    getDailyUsage(): TokenUsage | null {
        const usage = store.get('tokenUsage');
        return usage ? cloneTokenUsage(usage) : null;
    },

    saveDailyUsage(usage: TokenUsage): void {
        store.set('tokenUsage', cloneTokenUsage(usage));
    },

    getUsageHistory(): UsageHistoryEntry[] {
        return cloneUsageHistory(store.get('usageHistory') ?? []);
    },

    saveUsageHistory(history: UsageHistoryEntry[]): void {
        store.set('usageHistory', cloneUsageHistory(history));
    },

    getGuildDailyUsage(guildId: string): TokenUsage | null {
        return cloneTokenUsage(store.getGuildDailyUsage(guildId));
    },

    saveGuildDailyUsage(guildId: string, usage: TokenUsage): void {
        store.saveGuildDailyUsage(guildId, normalizeTokenUsage(usage));
    },

    getAllGuildDailyUsage(): Record<string, TokenUsage> {
        return cloneGuildDailyUsage(store.get('guildTokenUsage') ?? {});
    },

    saveAllGuildDailyUsage(usage: Record<string, TokenUsage>): void {
        store.set('guildTokenUsage', cloneGuildDailyUsage(usage));
    },

    getGuildUsageHistory(guildId: string): UsageHistoryEntry[] {
        return cloneUsageHistory(store.getGuildUsageHistory(guildId));
    },

    saveGuildUsageHistory(guildId: string, history: UsageHistoryEntry[]): void {
        store.saveGuildUsageHistory(guildId, cloneUsageHistory(history));
    },

    getAllGuildUsageHistory(): Record<string, UsageHistoryEntry[]> {
        return cloneGuildUsageHistory(store.get('guildUsageHistory') ?? {});
    },

    saveAllGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        store.set('guildUsageHistory', cloneGuildUsageHistory(history));
    },

    getUserDailyUsage(userId: string): TokenUsage | null {
        return cloneTokenUsage(store.getUserDailyUsage(userId));
    },

    saveUserDailyUsage(userId: string, usage: TokenUsage): void {
        store.saveUserDailyUsage(userId, normalizeTokenUsage(usage, 'user'));
    },

    getAllUserDailyUsage(): Record<string, TokenUsage> {
        return cloneUserDailyUsage(store.get('userTokenUsage') ?? {});
    },

    saveAllUserDailyUsage(usage: Record<string, TokenUsage>): void {
        store.set('userTokenUsage', cloneUserDailyUsage(usage));
    },

    getUserUsageHistory(userId: string): UsageHistoryEntry[] {
        return cloneUsageHistory(store.getUserUsageHistory(userId));
    },

    saveUserUsageHistory(userId: string, history: UsageHistoryEntry[]): void {
        store.saveUserUsageHistory(userId, cloneUsageHistory(history));
    },

    getAllUserUsageHistory(): Record<string, UsageHistoryEntry[]> {
        return cloneUserUsageHistory(store.get('userUsageHistory') ?? {});
    },

    saveAllUserUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        store.set('userUsageHistory', cloneUserUsageHistory(history));
    },
};

function normalizeTokenUsage(usage: TokenUsage, scopeName = 'guild'): TokenUsage {
    const cloned = cloneTokenUsage(usage);
    if (!cloned) {
        throw new Error(`Cannot save empty ${scopeName} usage entry`);
    }
    return cloned;
}
