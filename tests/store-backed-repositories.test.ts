import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guildBudgetRepository } from '../src/modules/usage/guild-budget-repository.js';
import { userBudgetRepository } from '../src/modules/usage/user-budget-repository.js';
import { userPreferenceRepository } from '../src/modules/translation/user-preference-repository.js';
import { store } from '../src/persistence/store.js';

vi.mock('../src/persistence/store.js', () => ({
    store: {
        get: vi.fn(),
        getGuildBudget: vi.fn(),
        setGuildBudget: vi.fn(),
        clearGuildBudget: vi.fn(),
        getUserBudget: vi.fn(),
        setUserBudget: vi.fn(),
        clearUserBudget: vi.fn(),
        getUserLanguage: vi.fn(),
        setUserLanguage: vi.fn(),
        deleteUserLanguage: vi.fn(),
    },
}));

const mockStore = vi.mocked(store);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('guildBudgetRepository', () => {
    it('should delegate reads and writes to the store', () => {
        mockStore.getGuildBudget.mockReturnValue({ dailyBudgetUsd: 2 });
        mockStore.clearGuildBudget.mockReturnValue(true);

        expect(guildBudgetRepository.getBudget('guild-1')).toEqual({ dailyBudgetUsd: 2 });
        guildBudgetRepository.setBudget('guild-1', 5);
        expect(mockStore.setGuildBudget).toHaveBeenCalledWith('guild-1', 5);
        expect(guildBudgetRepository.clearBudget('guild-1')).toBe(true);
        expect(mockStore.clearGuildBudget).toHaveBeenCalledWith('guild-1');
    });

    it('should list cloned budgets and tolerate a missing store entry', () => {
        const stored = { 'guild-1': { dailyBudgetUsd: 3 } };
        mockStore.get.mockReturnValue(stored);

        const budgets = guildBudgetRepository.listBudgets();
        expect(budgets).toEqual(stored);
        expect(budgets['guild-1']).not.toBe(stored['guild-1']);

        mockStore.get.mockReturnValue(undefined);
        expect(guildBudgetRepository.listBudgets()).toEqual({});
    });
});

describe('userBudgetRepository', () => {
    it('should delegate reads and writes to the store', () => {
        mockStore.getUserBudget.mockReturnValue({ dailyBudgetUsd: 1 });
        mockStore.clearUserBudget.mockReturnValue(false);

        expect(userBudgetRepository.getBudget('user-1')).toEqual({ dailyBudgetUsd: 1 });
        userBudgetRepository.setBudget('user-1', 4);
        expect(mockStore.setUserBudget).toHaveBeenCalledWith('user-1', 4);
        expect(userBudgetRepository.clearBudget('user-1')).toBe(false);
        expect(mockStore.clearUserBudget).toHaveBeenCalledWith('user-1');
    });

    it('should list cloned budgets and tolerate a missing store entry', () => {
        const stored = { 'user-1': { dailyBudgetUsd: 0.5 } };
        mockStore.get.mockReturnValue(stored);

        const budgets = userBudgetRepository.listBudgets();
        expect(budgets).toEqual(stored);
        expect(budgets['user-1']).not.toBe(stored['user-1']);

        mockStore.get.mockReturnValue(undefined);
        expect(userBudgetRepository.listBudgets()).toEqual({});
    });
});

describe('userPreferenceRepository', () => {
    it('should delegate reads and writes to the store', () => {
        mockStore.getUserLanguage.mockReturnValue('ja');
        mockStore.deleteUserLanguage.mockReturnValue(true);

        expect(userPreferenceRepository.getLanguage('guild-1', 'user-1')).toBe('ja');
        expect(mockStore.getUserLanguage).toHaveBeenCalledWith('guild-1', 'user-1');
        userPreferenceRepository.setLanguage('guild-1', 'user-1', 'ko');
        expect(mockStore.setUserLanguage).toHaveBeenCalledWith('guild-1', 'user-1', 'ko');
        expect(userPreferenceRepository.clearLanguage('guild-1', 'user-1')).toBe(true);
        expect(mockStore.deleteUserLanguage).toHaveBeenCalledWith('guild-1', 'user-1');
    });

    it('should list cloned preferences and tolerate a missing store entry', () => {
        mockStore.get.mockReturnValue([{ guildId: 'guild-1', userId: 'user-1', language: 'ja' }]);
        expect(userPreferenceRepository.listPreferences()).toEqual([
            { guildId: 'guild-1', userId: 'user-1', language: 'ja' },
        ]);

        mockStore.get.mockReturnValue(undefined);
        expect(userPreferenceRepository.listPreferences()).toEqual([]);
    });
});
