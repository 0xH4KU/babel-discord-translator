import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock store as an in-memory object ---
const mockData: Record<string, unknown> = vi.hoisted(() => ({}));

vi.mock('../src/persistence/store.js', () => ({
    store: {
        getConfigValues: vi.fn((keys: readonly string[]) =>
            Object.fromEntries(
                keys.map((key) => {
                    const value = mockData[key];
                    return [key, Array.isArray(value) ? [...value] : value];
                }),
            ),
        ),
        getDailyUsage: vi.fn(() => mockData.tokenUsage),
        saveDailyUsage: vi.fn((usage: unknown) => {
            mockData.tokenUsage = usage;
        }),
        getUsageHistory: vi.fn(() => mockData.usageHistory ?? []),
        saveUsageHistory: vi.fn((history: unknown) => {
            mockData.usageHistory = history;
        }),
        getGuildBudget: vi.fn((guildId: string) => {
            const budgets = mockData.guildBudgets as Record<string, unknown>;
            return budgets[guildId] ?? null;
        }),
        setGuildBudget: vi.fn((guildId: string, dailyBudgetUsd: number) => {
            const budgets = mockData.guildBudgets as Record<string, unknown>;
            budgets[guildId] = { dailyBudgetUsd };
        }),
        clearGuildBudget: vi.fn((guildId: string) => {
            const budgets = mockData.guildBudgets as Record<string, unknown>;
            if (!(guildId in budgets)) return false;
            delete budgets[guildId];
            return true;
        }),
        listGuildBudgets: vi.fn(() => mockData.guildBudgets ?? {}),
        getUserBudget: vi.fn((userId: string) => {
            const budgets = mockData.userBudgets as Record<string, unknown>;
            return budgets[userId] ?? null;
        }),
        setUserBudget: vi.fn((userId: string, dailyBudgetUsd: number) => {
            const budgets = mockData.userBudgets as Record<string, unknown>;
            budgets[userId] = { dailyBudgetUsd };
        }),
        clearUserBudget: vi.fn((userId: string) => {
            const budgets = mockData.userBudgets as Record<string, unknown>;
            if (!(userId in budgets)) return false;
            delete budgets[userId];
            return true;
        }),
        listUserBudgets: vi.fn(() => mockData.userBudgets ?? {}),
        getGuildDailyUsage: vi.fn((guildId: string) => {
            const usage = mockData.guildTokenUsage as Record<string, unknown>;
            return usage[guildId] ?? null;
        }),
        saveGuildDailyUsage: vi.fn((guildId: string, usage: unknown) => {
            const allUsage = mockData.guildTokenUsage as Record<string, unknown>;
            allUsage[guildId] = usage;
        }),
        getAllGuildDailyUsage: vi.fn(() => mockData.guildTokenUsage ?? {}),
        getGuildUsageHistory: vi.fn((guildId: string) => {
            const history = mockData.guildUsageHistory as Record<string, unknown>;
            return history[guildId] ?? [];
        }),
        saveGuildUsageHistory: vi.fn((guildId: string, history: unknown) => {
            const allHistory = mockData.guildUsageHistory as Record<string, unknown>;
            allHistory[guildId] = history;
        }),
        getAllGuildUsageHistory: vi.fn(() => mockData.guildUsageHistory ?? {}),
        getUserDailyUsage: vi.fn((userId: string) => {
            const usage = mockData.userTokenUsage as Record<string, unknown>;
            return usage[userId] ?? null;
        }),
        saveUserDailyUsage: vi.fn((userId: string, usage: unknown) => {
            const allUsage = mockData.userTokenUsage as Record<string, unknown>;
            allUsage[userId] = usage;
        }),
        getAllUserDailyUsage: vi.fn(() => mockData.userTokenUsage ?? {}),
        getUserUsageHistory: vi.fn((userId: string) => {
            const history = mockData.userUsageHistory as Record<string, unknown>;
            return history[userId] ?? [];
        }),
        saveUserUsageHistory: vi.fn((userId: string, history: unknown) => {
            const allHistory = mockData.userUsageHistory as Record<string, unknown>;
            allHistory[userId] = history;
        }),
        getAllUserUsageHistory: vi.fn(() => mockData.userUsageHistory ?? {}),
    },
}));

import { store } from '../src/persistence/store.js';
import { usage, _test as usageTest } from '../src/modules/usage/usage.js';
import type { TokenUsage } from '../src/shared/types.js';

describe('UsageTracker', () => {
    const mockedStore = store as unknown as {
        getConfigValues: ReturnType<typeof vi.fn>;
        getDailyUsage: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        // Forget the same-day rollover memo so each test exercises a fresh pass
        usageTest.resetRolloverMemo();
        // Reset mock store data
        const today = new Date().toISOString().slice(0, 10);
        mockData.tokenUsage = { date: today, inputTokens: 0, outputTokens: 0, requests: 0 };
        mockData.usageHistory = [];
        mockData.inputPricePerMillion = 0;
        mockData.outputPricePerMillion = 0;
        mockData.dailyBudgetUsd = 0;
        mockData.defaultUserDailyBudgetUsd = 0;
        mockData.allowedGuildIds = [];
        mockData.allowedUserIds = [];
        mockData.cooldownSeconds = 5;
        mockData.cacheMaxSize = 2000;
        mockData.setupComplete = true;
        mockData.translationPrompt = '';
        mockData.maxInputLength = 2000;
        mockData.maxOutputTokens = 1000;
        mockData.translationMaxConcurrent = 4;
        mockData.translationMaxGlobalQueue = 25;
        mockData.translationMaxGuildQueue = 5;
        mockData.translationMaxUserOutstanding = 1;
        mockData.translationMaxQueueWaitMs = 30000;
        mockData.guildBudgets = {};
        mockData.guildTokenUsage = {};
        mockData.guildUsageHistory = {};
        mockData.userBudgets = {};
        mockData.userTokenUsage = {};
        mockData.userUsageHistory = {};

        mockedStore.getConfigValues.mockClear();
    });

    it('should retry date rollover after a failed ensureToday pass', () => {
        mockedStore.getDailyUsage.mockImplementationOnce(() => {
            throw new Error('temporary sqlite failure');
        });
        mockData.tokenUsage = {
            date: '2025-01-01',
            inputTokens: 500,
            outputTokens: 300,
            requests: 5,
        };

        expect(() => usage.ensureToday()).toThrow('temporary sqlite failure');
        usage.ensureToday();

        const history = mockData.usageHistory as Array<{ date: string; inputTokens: number }>;
        expect(history).toHaveLength(1);
        expect(history[0].date).toBe('2025-01-01');
        expect(history[0].inputTokens).toBe(500);
    });

    it('should record token usage', () => {
        usage.record(100, 50);

        const data = mockData.tokenUsage as {
            inputTokens: number;
            outputTokens: number;
            requests: number;
        };
        expect(data.inputTokens).toBe(100);
        expect(data.outputTokens).toBe(50);
        expect(data.requests).toBe(1);
    });

    it('should accumulate multiple records', () => {
        usage.record(100, 50);
        usage.record(200, 100);

        const data = mockData.tokenUsage as {
            inputTokens: number;
            outputTokens: number;
            requests: number;
        };
        expect(data.inputTokens).toBe(300);
        expect(data.outputTokens).toBe(150);
        expect(data.requests).toBe(2);
    });

    it('should reserve pending global cost and release it without recording usage', () => {
        mockData.dailyBudgetUsd = 1.0;
        mockData.inputPricePerMillion = 1.0;

        const first = usage.tryReserveBudget({
            estimatedInputTokens: 600_000,
            estimatedOutputTokens: 0,
        });
        const blocked = usage.tryReserveBudget({
            estimatedInputTokens: 400_000,
            estimatedOutputTokens: 0,
        });

        expect(first).not.toBeNull();
        expect(blocked).toBeNull();

        first!.release();
        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 900_000,
                estimatedOutputTokens: 0,
            }),
        ).not.toBeNull();
        expect((mockData.tokenUsage as TokenUsage).requests).toBe(0);
    });

    it('should settle a reservation with actual token usage', () => {
        mockData.dailyBudgetUsd = 1.0;
        mockData.inputPricePerMillion = 1.0;

        const reservation = usage.tryReserveBudget({
            estimatedInputTokens: 600_000,
            estimatedOutputTokens: 0,
        });
        reservation!.settle(200_000, 0);

        expect(mockData.tokenUsage as TokenUsage).toMatchObject({
            inputTokens: 200_000,
            outputTokens: 0,
            requests: 1,
        });
        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 700_000,
                estimatedOutputTokens: 0,
            }),
        ).not.toBeNull();
    });

    it('should enforce both user and shared global pending budgets', () => {
        mockData.dailyBudgetUsd = 1.0;
        mockData.defaultUserDailyBudgetUsd = 0.8;
        mockData.inputPricePerMillion = 1.0;

        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 600_000,
                estimatedOutputTokens: 0,
                userId: 'user-a',
            }),
        ).not.toBeNull();
        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 200_000,
                estimatedOutputTokens: 0,
                userId: 'user-a',
            }),
        ).toBeNull();
        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 400_000,
                estimatedOutputTokens: 0,
                userId: 'user-b',
            }),
        ).toBeNull();
    });

    it('should keep custom guild reservations outside the shared global pool', () => {
        mockData.dailyBudgetUsd = 0.5;
        mockData.guildBudgets = { 'guild-custom': { dailyBudgetUsd: 1.0 } };
        mockData.inputPricePerMillion = 1.0;

        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 600_000,
                estimatedOutputTokens: 0,
                guildId: 'guild-custom',
            }),
        ).not.toBeNull();
        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 400_000,
                estimatedOutputTokens: 0,
                guildId: 'guild-shared',
            }),
        ).not.toBeNull();
        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 400_000,
                estimatedOutputTokens: 0,
                guildId: 'guild-custom',
            }),
        ).toBeNull();
    });

    it('should return complete stats for dashboard', () => {
        mockData.dailyBudgetUsd = 5.0;
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 2.0;

        usage.record(500_000, 250_000);

        const stats = usage.getStats();
        expect(stats).toHaveProperty('date');
        expect(stats).toHaveProperty('inputTokens', 500_000);
        expect(stats).toHaveProperty('outputTokens', 250_000);
        expect(stats).toHaveProperty('requests', 1);
        expect(stats).toHaveProperty('totalCost');
        expect(stats).toHaveProperty('dailyBudget', 5.0);
        expect(stats).toHaveProperty('budgetUsedPercent');
        expect(stats).toHaveProperty('budgetExceeded');
    });

    it('should read runtime config once for stats', () => {
        mockData.dailyBudgetUsd = 5.0;
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 2.0;

        usage.record(500_000, 250_000);
        usage.getStats();

        expect(mockedStore.getConfigValues).toHaveBeenCalledOnce();
    });

    it('should archive previous day when date changes', () => {
        // Simulate yesterday's data
        mockData.tokenUsage = {
            date: '2025-01-01',
            inputTokens: 500,
            outputTokens: 300,
            requests: 5,
        };

        // ensureToday() should detect date change and archive
        usage.ensureToday();

        const history = mockData.usageHistory as Array<{ date: string; inputTokens: number }>;
        expect(history).toHaveLength(1);
        expect(history[0].date).toBe('2025-01-01');
        expect(history[0].inputTokens).toBe(500);
    });

    it('should keep only 30 days of history', () => {
        // Fill with 30 days
        mockData.usageHistory = Array.from({ length: 30 }, (_, i) => ({
            date: `2025-01-${String(i + 1).padStart(2, '0')}`,
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        }));

        mockData.tokenUsage = {
            date: '2025-02-01',
            inputTokens: 999,
            outputTokens: 888,
            requests: 7,
        };

        usage.ensureToday();

        expect((mockData.usageHistory as unknown[]).length).toBeLessThanOrEqual(30);
    });

    it('should calculate history with costs', () => {
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 2.0;
        mockData.usageHistory = [
            { date: '2025-01-01', inputTokens: 1_000_000, outputTokens: 500_000, requests: 10 },
        ];

        const history = usage.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].totalTokens).toBe(1_500_000);
        expect(history[0].cost).toBe(2.0); // 1*1 + 0.5*2
    });

    it('should handle record with missing/zero values', () => {
        usage.record(0, 0);
        usage.record(undefined as unknown as number, undefined as unknown as number);

        const data = mockData.tokenUsage as {
            inputTokens: number;
            outputTokens: number;
            requests: number;
        };
        expect(data.inputTokens).toBe(0);
        expect(data.outputTokens).toBe(0);
        expect(data.requests).toBe(2);
    });

    // ===== Per-Guild Budget Tests =====

    describe('Per-Guild Budget', () => {
        it('should record both global and guild usage', () => {
            usage.record(100, 50, { guildId: 'guild-123' });

            const global = mockData.tokenUsage as { inputTokens: number; requests: number };
            expect(global.inputTokens).toBe(100);
            expect(global.requests).toBe(1);

            const guildUsage = mockData.guildTokenUsage as Record<
                string,
                { inputTokens: number; requests: number }
            >;
            expect(guildUsage['guild-123'].inputTokens).toBe(100);
            expect(guildUsage['guild-123'].requests).toBe(1);
        });

        it('should accumulate guild usage separately', () => {
            usage.record(100, 50, { guildId: 'guild-A' });
            usage.record(200, 100, { guildId: 'guild-B' });
            usage.record(50, 25, { guildId: 'guild-A' });

            const guildUsage = mockData.guildTokenUsage as Record<
                string,
                { inputTokens: number; outputTokens: number; requests: number }
            >;
            expect(guildUsage['guild-A'].inputTokens).toBe(150);
            expect(guildUsage['guild-A'].outputTokens).toBe(75);
            expect(guildUsage['guild-A'].requests).toBe(2);
            expect(guildUsage['guild-B'].inputTokens).toBe(200);
            expect(guildUsage['guild-B'].requests).toBe(1);

            // Global should have all
            const global = mockData.tokenUsage as { inputTokens: number; requests: number };
            expect(global.inputTokens).toBe(350);
            expect(global.requests).toBe(3);
        });

        it('should return correct guild stats', () => {
            mockData.guildBudgets = { 'guild-X': { dailyBudgetUsd: 2.0 } };
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(500_000, 0, { guildId: 'guild-X' });

            const stats = usage.getGuildStats('guild-X');
            expect(stats.inputTokens).toBe(500_000);
            expect(stats.requests).toBe(1);
            expect(stats.totalCost).toBe(0.5);
            expect(stats.dailyBudget).toBe(2.0);
            expect(stats.budgetUsedPercent).toBe(25);
        });

        it('should return empty stats for guild with no usage', () => {
            const stats = usage.getGuildStats('guild-new');
            expect(stats.inputTokens).toBe(0);
            expect(stats.requests).toBe(0);
            expect(stats.totalCost).toBe(0);
        });

        it('should archive guild history on date change', () => {
            const today = new Date().toISOString().slice(0, 10);
            mockData.guildTokenUsage = {
                'guild-A': { date: '2025-01-01', inputTokens: 300, outputTokens: 200, requests: 3 },
            };

            usage.ensureToday();

            const guildHistory = mockData.guildUsageHistory as Record<
                string,
                Array<{ date: string; inputTokens: number }>
            >;
            expect(guildHistory['guild-A']).toHaveLength(1);
            expect(guildHistory['guild-A'][0].date).toBe('2025-01-01');
            expect(guildHistory['guild-A'][0].inputTokens).toBe(300);

            // Current usage should be reset
            const guildUsage = mockData.guildTokenUsage as Record<
                string,
                { date: string; inputTokens: number }
            >;
            expect(guildUsage['guild-A'].date).toBe(today);
            expect(guildUsage['guild-A'].inputTokens).toBe(0);
        });

        it('should return guild history with costs', () => {
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 2.0;
            mockData.guildUsageHistory = {
                'guild-Y': [
                    {
                        date: '2025-01-01',
                        inputTokens: 1_000_000,
                        outputTokens: 500_000,
                        requests: 5,
                    },
                ],
            };

            const history = usage.getGuildHistory('guild-Y');
            expect(history).toHaveLength(1);
            expect(history[0].cost).toBe(2.0);
            expect(history[0].totalTokens).toBe(1_500_000);
        });

        it('should aggregate history across selected guilds by date', () => {
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 2.0;
            mockData.guildUsageHistory = {
                'guild-A': [
                    {
                        date: '2025-01-01',
                        inputTokens: 1_000_000,
                        outputTokens: 0,
                        requests: 2,
                    },
                    {
                        date: '2025-01-02',
                        inputTokens: 500_000,
                        outputTokens: 500_000,
                        requests: 1,
                    },
                ],
                'guild-B': [
                    {
                        date: '2025-01-01',
                        inputTokens: 0,
                        outputTokens: 500_000,
                        requests: 3,
                    },
                ],
                'guild-C': [
                    {
                        date: '2025-01-01',
                        inputTokens: 9_000_000,
                        outputTokens: 9_000_000,
                        requests: 9,
                    },
                ],
            };

            const history = usage.getGuildHistoryForGuilds(['guild-A', 'guild-B']);

            expect(history).toEqual([
                {
                    date: '2025-01-01',
                    inputTokens: 1_000_000,
                    outputTokens: 500_000,
                    totalTokens: 1_500_000,
                    requests: 5,
                    cost: 2,
                },
                {
                    date: '2025-01-02',
                    inputTokens: 500_000,
                    outputTokens: 500_000,
                    totalTokens: 1_000_000,
                    requests: 1,
                    cost: 1.5,
                },
            ]);
        });

        it('should export global, guild, and user history including current usage', () => {
            const today = new Date().toISOString().slice(0, 10);
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 2.0;
            mockData.tokenUsage = {
                date: today,
                inputTokens: 100,
                outputTokens: 50,
                requests: 1,
            };
            mockData.usageHistory = [
                {
                    date: '2025-01-01',
                    inputTokens: 1_000_000,
                    outputTokens: 0,
                    requests: 2,
                },
                {
                    date: today,
                    inputTokens: 999,
                    outputTokens: 999,
                    requests: 999,
                },
            ];
            mockData.guildUsageHistory = {
                'guild,1': [
                    {
                        date: '2025-01-02',
                        inputTokens: 0,
                        outputTokens: 500_000,
                        requests: 3,
                    },
                ],
            };
            mockData.guildTokenUsage = {
                'guild-current': {
                    date: today,
                    inputTokens: 200,
                    outputTokens: 100,
                    requests: 2,
                },
            };
            mockData.userUsageHistory = {
                'user-1': [
                    {
                        date: '2025-01-03',
                        inputTokens: 500_000,
                        outputTokens: 500_000,
                        requests: 1,
                    },
                ],
            };
            mockData.userTokenUsage = {
                'user-current': {
                    date: today,
                    inputTokens: 300,
                    outputTokens: 200,
                    requests: 3,
                },
            };

            expect(usage.getUsageExportRows()).toEqual([
                {
                    scope: 'global',
                    id: '',
                    date: '2025-01-01',
                    requests: 2,
                    inputTokens: 1_000_000,
                    outputTokens: 0,
                    totalTokens: 1_000_000,
                    costUsd: 1,
                },
                {
                    scope: 'global',
                    id: '',
                    date: today,
                    requests: 1,
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150,
                    costUsd: 0.0002,
                },
                {
                    scope: 'guild',
                    id: 'guild-current',
                    date: today,
                    requests: 2,
                    inputTokens: 200,
                    outputTokens: 100,
                    totalTokens: 300,
                    costUsd: 0.0004,
                },
                {
                    scope: 'guild',
                    id: 'guild,1',
                    date: '2025-01-02',
                    requests: 3,
                    inputTokens: 0,
                    outputTokens: 500_000,
                    totalTokens: 500_000,
                    costUsd: 1,
                },
                {
                    scope: 'user',
                    id: 'user-1',
                    date: '2025-01-03',
                    requests: 1,
                    inputTokens: 500_000,
                    outputTokens: 500_000,
                    totalTokens: 1_000_000,
                    costUsd: 1.5,
                },
                {
                    scope: 'user',
                    id: 'user-current',
                    date: today,
                    requests: 3,
                    inputTokens: 300,
                    outputTokens: 200,
                    totalTokens: 500,
                    costUsd: 0.0007,
                },
            ]);
        });

        it('should not record guild usage when scope is omitted', () => {
            usage.record(100, 50);

            const global = mockData.tokenUsage as { inputTokens: number; requests: number };
            expect(global.inputTokens).toBe(100);

            const guildUsage = mockData.guildTokenUsage as Record<string, unknown>;
            expect(Object.keys(guildUsage).length).toBe(0);
        });
    });

    describe('Per-User Budget', () => {
        it('should record both global and user usage', () => {
            usage.record(100, 50, { userId: 'user-123' });

            const global = mockData.tokenUsage as { inputTokens: number; requests: number };
            expect(global.inputTokens).toBe(100);
            expect(global.requests).toBe(1);

            const userUsage = mockData.userTokenUsage as Record<
                string,
                { inputTokens: number; requests: number }
            >;
            expect(userUsage['user-123'].inputTokens).toBe(100);
            expect(userUsage['user-123'].requests).toBe(1);
        });

        it('should return user stats with user budget', () => {
            mockData.userBudgets = { 'user-X': { dailyBudgetUsd: 2.0 } };
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(500_000, 0, { userId: 'user-X' });

            const stats = usage.getUserStats('user-X');
            expect(stats.inputTokens).toBe(500_000);
            expect(stats.requests).toBe(1);
            expect(stats.totalCost).toBe(0.5);
            expect(stats.dailyBudget).toBe(2.0);
            expect(stats.budgetUsedPercent).toBe(25);
        });

        it('should archive user history on date change', () => {
            const today = new Date().toISOString().slice(0, 10);
            mockData.userTokenUsage = {
                'user-A': { date: '2025-01-01', inputTokens: 300, outputTokens: 200, requests: 3 },
            };

            usage.ensureToday();

            const userHistory = mockData.userUsageHistory as Record<
                string,
                Array<{ date: string; inputTokens: number }>
            >;
            expect(userHistory['user-A']).toHaveLength(1);
            expect(userHistory['user-A'][0].date).toBe('2025-01-01');
            expect(userHistory['user-A'][0].inputTokens).toBe(300);

            const userUsage = mockData.userTokenUsage as Record<
                string,
                { date: string; inputTokens: number }
            >;
            expect(userUsage['user-A'].date).toBe(today);
            expect(userUsage['user-A'].inputTokens).toBe(0);
        });

        it('should aggregate history across all users by date', () => {
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 2.0;
            mockData.userUsageHistory = {
                'user-A': [
                    {
                        date: '2025-01-01',
                        inputTokens: 1_000_000,
                        outputTokens: 0,
                        requests: 2,
                    },
                ],
                'user-B': [
                    {
                        date: '2025-01-01',
                        inputTokens: 0,
                        outputTokens: 500_000,
                        requests: 3,
                    },
                    {
                        date: '2025-01-02',
                        inputTokens: 500_000,
                        outputTokens: 500_000,
                        requests: 1,
                    },
                ],
            };

            const history = usage.getAllUserHistory();

            expect(history).toEqual([
                {
                    date: '2025-01-01',
                    inputTokens: 1_000_000,
                    outputTokens: 500_000,
                    totalTokens: 1_500_000,
                    requests: 5,
                    cost: 2,
                },
                {
                    date: '2025-01-02',
                    inputTokens: 500_000,
                    outputTokens: 500_000,
                    totalTokens: 1_000_000,
                    requests: 1,
                    cost: 1.5,
                },
            ]);
        });
    });
});
