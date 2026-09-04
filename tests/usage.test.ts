import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock store as an in-memory object ---
const mockData: Record<string, unknown> = vi.hoisted(() => ({}));

vi.mock('../src/persistence/store.js', () => {
    type MockUsage = { date: string; inputTokens: number; outputTokens: number; requests: number };
    type Scope = 'global' | 'guild' | 'user';
    type RollingScope = Scope | 'guild_user';
    type MockRollingUsage = MockUsage & { scope: RollingScope; scopeId: string };

    const currentUsage = (scope: Scope, id: string): MockUsage | null => {
        if (scope === 'global') return (mockData.tokenUsage as MockUsage | null) ?? null;
        const key = scope === 'guild' ? 'guildTokenUsage' : 'userTokenUsage';
        return ((mockData[key] as Record<string, MockUsage>)[id] as MockUsage | undefined) ?? null;
    };
    const histories = (scope: Scope): Record<string, MockUsage[]> => {
        if (scope === 'global') return { '': (mockData.usageHistory as MockUsage[]) ?? [] };
        const key = scope === 'guild' ? 'guildUsageHistory' : 'userUsageHistory';
        return (mockData[key] as Record<string, MockUsage[]>) ?? {};
    };
    const usageBetween = (scope: Scope, id: string, start: string, end: string): MockUsage => {
        const entries = [...(histories(scope)[id] ?? [])];
        const current = currentUsage(scope, id);
        if (current) entries.push(current);

        return entries
            .filter((entry) => entry.date >= start && entry.date < end)
            .reduce(
                (total, entry) => ({
                    date: start,
                    inputTokens: total.inputTokens + entry.inputTokens,
                    outputTokens: total.outputTokens + entry.outputTokens,
                    requests: total.requests + entry.requests,
                }),
                { date: start, inputTokens: 0, outputTokens: 0, requests: 0 },
            );
    };
    const record = (scope: Scope, id: string, date: string, input: number, output: number) => {
        const next =
            currentUsage(scope, id)?.date === date
                ? { ...currentUsage(scope, id)! }
                : { date, inputTokens: 0, outputTokens: 0, requests: 0 };
        next.inputTokens += input;
        next.outputTokens += output;
        next.requests += 1;

        if (scope === 'global') mockData.tokenUsage = next;
        else {
            const key = scope === 'guild' ? 'guildTokenUsage' : 'userTokenUsage';
            (mockData[key] as Record<string, MockUsage>)[id] = next;
        }
    };
    const rollingUsageBetween = (
        scope: RollingScope,
        id: string,
        start: string,
        end: string,
    ): MockUsage =>
        ((mockData.rollingUsage as MockRollingUsage[]) ?? [])
            .filter(
                (entry) =>
                    entry.scope === scope &&
                    entry.scopeId === id &&
                    entry.date >= start &&
                    entry.date < end,
            )
            .reduce(
                (total, entry) => ({
                    date: start,
                    inputTokens: total.inputTokens + entry.inputTokens,
                    outputTokens: total.outputTokens + entry.outputTokens,
                    requests: total.requests + entry.requests,
                }),
                { date: start, inputTokens: 0, outputTokens: 0, requests: 0 },
            );
    const recordRolling = (
        scope: RollingScope,
        scopeId: string,
        date: string,
        inputTokens: number,
        outputTokens: number,
    ) => {
        (mockData.rollingUsage as MockRollingUsage[]).push({
            scope,
            scopeId,
            date,
            inputTokens,
            outputTokens,
            requests: 1,
        });
    };

    return {
        store: {
            getConfigValues: vi.fn((keys: readonly string[]) =>
                Object.fromEntries(
                    keys.map((key) => {
                        const value = mockData[key];
                        return [key, Array.isArray(value) ? [...value] : value];
                    }),
                ),
            ),
            getGuildBudget: vi.fn((guildId: string) => {
                const budgets = mockData.guildBudgets as Record<string, unknown>;
                return budgets[guildId] ?? null;
            }),
            setGuildBudget: vi.fn((guildId: string, monthlyBudgetUsd: number) => {
                const budgets = mockData.guildBudgets as Record<string, unknown>;
                budgets[guildId] = { monthlyBudgetUsd };
            }),
            clearGuildBudget: vi.fn((guildId: string) => {
                const budgets = mockData.guildBudgets as Record<string, unknown>;
                if (!(guildId in budgets)) return false;
                delete budgets[guildId];
                return true;
            }),
            listGuildBudgets: vi.fn(() => mockData.guildBudgets ?? {}),
            getGuildBudgetLimitOverrides: vi.fn(
                (guildId: string) =>
                    (mockData.guildBudgetLimitOverrides as Record<string, unknown>)[guildId] ?? {},
            ),
            getUserBudget: vi.fn((userId: string) => {
                const budgets = mockData.userBudgets as Record<string, unknown>;
                return budgets[userId] ?? null;
            }),
            setUserBudget: vi.fn((userId: string, monthlyBudgetUsd: number) => {
                const budgets = mockData.userBudgets as Record<string, unknown>;
                budgets[userId] = { monthlyBudgetUsd };
            }),
            clearUserBudget: vi.fn((userId: string) => {
                const budgets = mockData.userBudgets as Record<string, unknown>;
                if (!(userId in budgets)) return false;
                delete budgets[userId];
                return true;
            }),
            listUserBudgets: vi.fn(() => mockData.userBudgets ?? {}),
            getUsage: vi.fn((scope: Scope, id: string, date: string) => {
                const usage = currentUsage(scope, id);
                return usage?.date === date ? { ...usage } : null;
            }),
            getUsageForIds: vi.fn(
                (scope: Exclude<Scope, 'global'>, ids: string[], date: string) => {
                    return Object.fromEntries(
                        ids.flatMap((id) => {
                            const usage = currentUsage(scope, id);
                            return usage?.date === date ? [[id, { ...usage }]] : [];
                        }),
                    );
                },
            ),
            getUsageBetween: vi.fn(usageBetween),
            getRollingUsageBetween: vi.fn(rollingUsageBetween),
            getGuildUserRollingUsage: vi.fn(
                (guildId: string, userId: string, start: string, end: string) =>
                    rollingUsageBetween('guild_user', `${guildId}:${userId}`, start, end),
            ),
            countActiveGuildUsers: vi.fn((guildId: string, start: string, end: string) => {
                const users = new Set(
                    ((mockData.rollingUsage as MockRollingUsage[]) ?? [])
                        .filter(
                            (entry) =>
                                entry.scope === 'guild_user' &&
                                entry.scopeId.startsWith(`${guildId}:`) &&
                                entry.date >= start &&
                                entry.date < end,
                        )
                        .map((entry) => entry.scopeId),
                );
                return users.size;
            }),
            getUsageForIdsBetween: vi.fn(
                (scope: Exclude<Scope, 'global'>, ids: string[], start: string, end: string) =>
                    Object.fromEntries(
                        ids.flatMap((id) => {
                            const usage = usageBetween(scope, id, start, end);
                            return usage.requests > 0 ? [[id, usage]] : [];
                        }),
                    ),
            ),
            getUsageHistory: vi.fn((scope: Scope, beforeDate: string, ids?: string[]) => {
                const byDate = new Map<string, MockUsage>();
                for (const [id, entries] of Object.entries(histories(scope))) {
                    if (ids && !ids.includes(id)) continue;
                    for (const entry of entries) {
                        if (entry.date >= beforeDate) continue;
                        const aggregate = byDate.get(entry.date) ?? {
                            date: entry.date,
                            inputTokens: 0,
                            outputTokens: 0,
                            requests: 0,
                        };
                        aggregate.inputTokens += entry.inputTokens;
                        aggregate.outputTokens += entry.outputTokens;
                        aggregate.requests += entry.requests;
                        byDate.set(entry.date, aggregate);
                    }
                }
                return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
            }),
            getSharedGlobalUsage: vi.fn((date: string) => {
                const total = currentUsage('global', '');
                const shared =
                    total?.date === date
                        ? { ...total }
                        : { date, inputTokens: 0, outputTokens: 0, requests: 0 };
                const budgets = mockData.guildBudgets as Record<string, unknown>;
                for (const guildId of Object.keys(budgets)) {
                    const usage = currentUsage('guild', guildId);
                    if (usage?.date !== date) continue;
                    shared.inputTokens = Math.max(0, shared.inputTokens - usage.inputTokens);
                    shared.outputTokens = Math.max(0, shared.outputTokens - usage.outputTokens);
                    shared.requests = Math.max(0, shared.requests - usage.requests);
                }
                return shared;
            }),
            getSharedGlobalUsageBetween: vi.fn((start: string, end: string) => {
                const shared = usageBetween('global', '', start, end);
                const budgets = mockData.guildBudgets as Record<string, unknown>;
                for (const guildId of Object.keys(budgets)) {
                    const usage = usageBetween('guild', guildId, start, end);
                    shared.inputTokens = Math.max(0, shared.inputTokens - usage.inputTokens);
                    shared.outputTokens = Math.max(0, shared.outputTokens - usage.outputTokens);
                    shared.requests = Math.max(0, shared.requests - usage.requests);
                }
                return shared;
            }),
            getSharedRollingUsageBetween: vi.fn((start: string, end: string) => {
                const shared = rollingUsageBetween('global', '', start, end);
                const budgets = mockData.guildBudgets as Record<string, unknown>;
                for (const guildId of Object.keys(budgets)) {
                    const usage = rollingUsageBetween('guild', guildId, start, end);
                    shared.inputTokens = Math.max(0, shared.inputTokens - usage.inputTokens);
                    shared.outputTokens = Math.max(0, shared.outputTokens - usage.outputTokens);
                    shared.requests = Math.max(0, shared.requests - usage.requests);
                }
                return shared;
            }),
            recordUsage: vi.fn((timestamp: string, input: number, output: number, scope = {}) => {
                const ids = scope as {
                    guildId?: string;
                    userId?: string;
                    actorUserId?: string;
                };
                const date = timestamp.slice(0, 10);
                const tokens = [input || 0, output || 0] as const;
                record('global', '', date, ...tokens);
                recordRolling('global', '', timestamp, ...tokens);
                if (ids.guildId) record('guild', ids.guildId, date, ...tokens);
                if (ids.userId) record('user', ids.userId, date, ...tokens);
                if (ids.guildId) recordRolling('guild', ids.guildId, timestamp, ...tokens);
                if (ids.userId) recordRolling('user', ids.userId, timestamp, ...tokens);
                if (ids.guildId && ids.actorUserId) {
                    recordRolling(
                        'guild_user',
                        `${ids.guildId}:${ids.actorUserId}`,
                        timestamp,
                        ...tokens,
                    );
                }
            }),
            listUsageRows: vi.fn(() => {
                const rows = new Map<string, MockUsage & { scope: Scope; scopeId: string }>();
                const add = (scope: Scope, scopeId: string, entry: MockUsage) => {
                    rows.set(`${scope}:${scopeId}:${entry.date}`, { scope, scopeId, ...entry });
                };
                for (const scope of ['global', 'guild', 'user'] as const) {
                    for (const [id, entries] of Object.entries(histories(scope))) {
                        for (const entry of entries) add(scope, id, entry);
                    }
                }
                const global = currentUsage('global', '');
                if (global) add('global', '', global);
                for (const [id, entry] of Object.entries(
                    mockData.guildTokenUsage as Record<string, MockUsage>,
                ))
                    add('guild', id, entry);
                for (const [id, entry] of Object.entries(
                    mockData.userTokenUsage as Record<string, MockUsage>,
                ))
                    add('user', id, entry);
                return [...rows.values()];
            }),
        },
    };
});

import { store } from '../src/persistence/store.js';
import { UsageTracker } from '../src/modules/usage/usage.js';
import type { TokenUsage } from '../src/shared/types.js';

describe('UsageTracker', () => {
    let usage: UsageTracker;
    const mockedStore = store as unknown as {
        getConfigValues: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        usage = new UsageTracker();
        // Reset mock store data
        const today = new Date().toISOString().slice(0, 10);
        mockData.tokenUsage = { date: today, inputTokens: 0, outputTokens: 0, requests: 0 };
        mockData.usageHistory = [];
        mockData.inputPricePerMillion = 0;
        mockData.outputPricePerMillion = 0;
        mockData.monthlyBudgetUsd = 0;
        mockData.defaultUserMonthlyBudgetUsd = 0;
        mockData.budgetFiveHourPercent = 100;
        mockData.budgetSevenDayPercent = 100;
        mockData.budgetFairShareMultiplier = 1.5;
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
        mockData.guildBudgetLimitOverrides = {};
        mockData.rollingUsage = [];
        mockData.guildTokenUsage = {};
        mockData.guildUsageHistory = {};
        mockData.userBudgets = {};
        mockData.userTokenUsage = {};
        mockData.userUsageHistory = {};

        mockedStore.getConfigValues.mockClear();
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
        mockData.monthlyBudgetUsd = 1.0;
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
        mockData.monthlyBudgetUsd = 1.0;
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
        mockData.monthlyBudgetUsd = 1.0;
        mockData.defaultUserMonthlyBudgetUsd = 0.8;
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
        mockData.monthlyBudgetUsd = 0.5;
        mockData.guildBudgets = { 'guild-custom': { monthlyBudgetUsd: 1.0 } };
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

    it('should enforce the rolling five-hour budget limit', () => {
        mockData.monthlyBudgetUsd = 100;
        mockData.budgetFiveHourPercent = 5;
        mockData.budgetSevenDayPercent = 30;
        mockData.inputPricePerMillion = 1;
        mockData.rollingUsage = [
            {
                scope: 'global',
                scopeId: '',
                date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                inputTokens: 4_750_000,
                outputTokens: 0,
                requests: 1,
            },
        ];

        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 250_000,
                estimatedOutputTokens: 0,
            }),
        ).toBeNull();
    });

    it('should enforce the rolling seven-day budget after five-hour usage expires', () => {
        mockData.monthlyBudgetUsd = 100;
        mockData.budgetFiveHourPercent = 5;
        mockData.budgetSevenDayPercent = 30;
        mockData.inputPricePerMillion = 1;
        mockData.rollingUsage = [
            {
                scope: 'global',
                scopeId: '',
                date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
                inputTokens: 29_750_000,
                outputTokens: 0,
                requests: 1,
            },
        ];

        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 250_000,
                estimatedOutputTokens: 0,
            }),
        ).toBeNull();
    });

    it('should retain the hard monthly budget limit', () => {
        mockData.monthlyBudgetUsd = 100;
        mockData.budgetFiveHourPercent = 5;
        mockData.budgetSevenDayPercent = 30;
        mockData.inputPricePerMillion = 1;
        mockData.tokenUsage = {
            date: new Date().toISOString().slice(0, 10),
            inputTokens: 99_750_000,
            outputTokens: 0,
            requests: 1,
        };

        expect(
            usage.tryReserveBudget({
                estimatedInputTokens: 250_000,
                estimatedOutputTokens: 0,
            }),
        ).toBeNull();
    });

    it('should apply per-guild rolling limit overrides', () => {
        mockData.guildBudgets = { guild: { monthlyBudgetUsd: 100 } };
        mockData.guildBudgetLimitOverrides = {
            guild: { budgetFiveHourPercent: 10, budgetSevenDayPercent: 40 },
        };
        mockData.budgetFiveHourPercent = 5;
        mockData.budgetSevenDayPercent = 30;
        mockData.inputPricePerMillion = 1;
        mockData.rollingUsage = [
            {
                scope: 'guild',
                scopeId: 'guild',
                date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                inputTokens: 8_000_000,
                outputTokens: 0,
                requests: 1,
            },
        ];

        expect(
            usage.tryReserveBudget({
                guildId: 'guild',
                estimatedInputTokens: 1_000_000,
                estimatedOutputTokens: 0,
            }),
        ).not.toBeNull();
    });

    it('should include a new requester in the guild fair-share divisor', () => {
        mockData.guildBudgets = { guild: { monthlyBudgetUsd: 100 } };
        mockData.budgetFiveHourPercent = 5;
        mockData.budgetSevenDayPercent = 30;
        mockData.budgetFairShareMultiplier = 1.5;
        mockData.inputPricePerMillion = 1;
        const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        mockData.rollingUsage = ['user-b', 'user-c'].map((userId) => ({
            scope: 'guild_user',
            scopeId: `guild:${userId}`,
            date: recent,
            inputTokens: 1,
            outputTokens: 0,
            requests: 1,
        }));

        expect(
            usage.tryReserveBudget({
                guildId: 'guild',
                actorUserId: 'user-a',
                estimatedInputTokens: 2_500_000,
                estimatedOutputTokens: 0,
            }),
        ).toBeNull();
    });

    it('should include pending requests in rolling limits', () => {
        mockData.monthlyBudgetUsd = 100;
        mockData.budgetFiveHourPercent = 5;
        mockData.budgetSevenDayPercent = 30;
        mockData.inputPricePerMillion = 1;

        const first = usage.tryReserveBudget({
            estimatedInputTokens: 2_600_000,
            estimatedOutputTokens: 0,
        });
        const second = usage.tryReserveBudget({
            estimatedInputTokens: 2_400_000,
            estimatedOutputTokens: 0,
        });

        expect(first).not.toBeNull();
        expect(second).toBeNull();
        first!.release();
    });

    it('should return complete stats for dashboard', () => {
        mockData.monthlyBudgetUsd = 5.0;
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 2.0;

        usage.record(500_000, 250_000);

        const stats = usage.getStats();
        expect(stats).toHaveProperty('date');
        expect(stats).toHaveProperty('inputTokens', 500_000);
        expect(stats).toHaveProperty('outputTokens', 250_000);
        expect(stats).toHaveProperty('requests', 1);
        expect(stats).toHaveProperty('totalCost');
        expect(stats).toHaveProperty('monthlyBudget', 5.0);
        expect(stats).toHaveProperty('budgetUsedPercent');
        expect(stats).toHaveProperty('budgetExceeded');
    });

    it('should aggregate the current UTC month without charging prior months', () => {
        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7);
        const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
            .toISOString()
            .slice(0, 7);
        mockData.inputPricePerMillion = 1;
        mockData.monthlyBudgetUsd = 10;
        mockData.usageHistory = [
            {
                date: `${priorMonth}-28`,
                inputTokens: 9_000_000,
                outputTokens: 0,
                requests: 1,
            },
            {
                date: `${currentMonth}-01`,
                inputTokens: 1_000_000,
                outputTokens: 0,
                requests: 1,
            },
        ];
        mockData.tokenUsage = {
            date: now.toISOString().slice(0, 10),
            inputTokens: 500_000,
            outputTokens: 0,
            requests: 1,
        };

        expect(usage.getStats()).toMatchObject({
            inputTokens: 1_500_000,
            totalCost: 1.5,
            monthlyBudget: 10,
        });
    });

    it('should read runtime config once for stats', () => {
        mockData.monthlyBudgetUsd = 5.0;
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 2.0;

        usage.record(500_000, 250_000);
        usage.getStats();

        expect(mockedStore.getConfigValues).toHaveBeenCalledOnce();
    });

    it('should keep only 30 days of history', () => {
        mockData.usageHistory = Array.from({ length: 31 }, (_, i) => ({
            date: `2025-01-${String(i + 1).padStart(2, '0')}`,
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        }));

        const history = usage.getHistory();
        expect(history).toHaveLength(30);
        expect(history[0]?.date).toBe('2025-01-02');
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
            mockData.guildBudgets = { 'guild-X': { monthlyBudgetUsd: 2.0 } };
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(500_000, 0, { guildId: 'guild-X' });

            const stats = usage.getGuildStats('guild-X');
            expect(stats.inputTokens).toBe(500_000);
            expect(stats.requests).toBe(1);
            expect(stats.totalCost).toBe(0.5);
            expect(stats.monthlyBudget).toBe(2.0);
            expect(stats.budgetUsedPercent).toBe(25);
        });

        it('should return empty stats for guild with no usage', () => {
            const stats = usage.getGuildStats('guild-new');
            expect(stats.inputTokens).toBe(0);
            expect(stats.requests).toBe(0);
            expect(stats.totalCost).toBe(0);
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
            mockData.userBudgets = { 'user-X': { monthlyBudgetUsd: 2.0 } };
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(500_000, 0, { userId: 'user-X' });

            const stats = usage.getUserStatsForUsers(['user-X'])['user-X']!;
            expect(stats.inputTokens).toBe(500_000);
            expect(stats.requests).toBe(1);
            expect(stats.totalCost).toBe(0.5);
            expect(stats.monthlyBudget).toBe(2.0);
            expect(stats.budgetUsedPercent).toBe(25);
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
