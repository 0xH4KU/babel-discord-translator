import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock store as an in-memory object ---
const mockData: Record<string, unknown> = vi.hoisted(() => ({}));

vi.mock('../src/store.js', () => ({
    store: {
        get: vi.fn((key: string) => mockData[key]),
        set: vi.fn((key: string, val: unknown) => { mockData[key] = val; }),
    },
}));

import { usage } from '../src/usage.js';

describe('UsageTracker', () => {
    beforeEach(() => {
        // Reset mock store data
        const today = new Date().toISOString().slice(0, 10);
        mockData.tokenUsage = { date: today, inputTokens: 0, outputTokens: 0, requests: 0 };
        mockData.usageHistory = [];
        mockData.inputPricePerMillion = 0;
        mockData.outputPricePerMillion = 0;
        mockData.dailyBudgetUsd = 0;
        mockData.guildBudgets = {};
        mockData.guildTokenUsage = {};
        mockData.guildUsageHistory = {};
    });

    it('should record token usage', () => {
        usage.record(100, 50);

        const data = mockData.tokenUsage as { inputTokens: number; outputTokens: number; requests: number };
        expect(data.inputTokens).toBe(100);
        expect(data.outputTokens).toBe(50);
        expect(data.requests).toBe(1);
    });

    it('should accumulate multiple records', () => {
        usage.record(100, 50);
        usage.record(200, 100);

        const data = mockData.tokenUsage as { inputTokens: number; outputTokens: number; requests: number };
        expect(data.inputTokens).toBe(300);
        expect(data.outputTokens).toBe(150);
        expect(data.requests).toBe(2);
    });

    it('should calculate cost correctly', () => {
        mockData.inputPricePerMillion = 1.0;  // $1/M input tokens
        mockData.outputPricePerMillion = 2.0; // $2/M output tokens

        usage.record(1_000_000, 500_000);

        const cost = usage.getCost();
        expect(cost.inputCost).toBe(1.0);
        expect(cost.outputCost).toBe(1.0);
        expect(cost.totalCost).toBe(2.0);
    });

    it('should return zero cost when prices are zero', () => {
        usage.record(1000, 500);

        const cost = usage.getCost();
        expect(cost.totalCost).toBe(0);
    });

    it('should report budget not exceeded when budget is 0 (unlimited)', () => {
        mockData.dailyBudgetUsd = 0;
        usage.record(1_000_000, 1_000_000);

        expect(usage.isBudgetExceeded()).toBe(false);
    });

    it('should report budget exceeded when cost >= budget', () => {
        mockData.dailyBudgetUsd = 1.0;
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 0;

        usage.record(1_000_000, 0); // $1 cost = $1 budget

        expect(usage.isBudgetExceeded()).toBe(true);
    });

    it('should report budget not exceeded when under budget', () => {
        mockData.dailyBudgetUsd = 10.0;
        mockData.inputPricePerMillion = 1.0;
        mockData.outputPricePerMillion = 0;

        usage.record(1_000_000, 0); // $1 cost < $10 budget

        expect(usage.isBudgetExceeded()).toBe(false);
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

        const data = mockData.tokenUsage as { inputTokens: number; outputTokens: number; requests: number };
        expect(data.inputTokens).toBe(0);
        expect(data.outputTokens).toBe(0);
        expect(data.requests).toBe(2);
    });

    // ===== Per-Guild Budget Tests =====

    describe('Per-Guild Budget', () => {
        it('should record both global and guild usage', () => {
            usage.record(100, 50, 'guild-123');

            const global = mockData.tokenUsage as { inputTokens: number; requests: number };
            expect(global.inputTokens).toBe(100);
            expect(global.requests).toBe(1);

            const guildUsage = mockData.guildTokenUsage as Record<string, { inputTokens: number; requests: number }>;
            expect(guildUsage['guild-123'].inputTokens).toBe(100);
            expect(guildUsage['guild-123'].requests).toBe(1);
        });

        it('should accumulate guild usage separately', () => {
            usage.record(100, 50, 'guild-A');
            usage.record(200, 100, 'guild-B');
            usage.record(50, 25, 'guild-A');

            const guildUsage = mockData.guildTokenUsage as Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
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

        it('should use guild budget when set', () => {
            mockData.guildBudgets = { 'guild-123': { dailyBudgetUsd: 1.0 } };
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(1_000_000, 0, 'guild-123'); // $1 cost = $1 guild budget

            expect(usage.isBudgetExceeded('guild-123')).toBe(true);
        });

        it('should fallback to global budget when guild has no budget', () => {
            mockData.dailyBudgetUsd = 1.0;
            mockData.guildBudgets = {}; // No guild-specific budget
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(1_000_000, 0, 'guild-456'); // $1 cost = $1 global budget

            expect(usage.isBudgetExceeded('guild-456')).toBe(true);
        });

        it('should allow guild with separate budget even if global is exceeded', () => {
            mockData.dailyBudgetUsd = 0.5; // global $0.50
            mockData.guildBudgets = { 'guild-rich': { dailyBudgetUsd: 5.0 } }; // guild $5
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(1_000_000, 0, 'guild-rich'); // $1 cost < $5 guild budget

            expect(usage.isBudgetExceeded('guild-rich')).toBe(false);
        });

        it('should report guild budget not exceeded when guild budget is 0 (unlimited)', () => {
            mockData.dailyBudgetUsd = 1.0; // global has limit
            mockData.guildBudgets = { 'guild-free': { dailyBudgetUsd: 0 } }; // guild unlimited
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(10_000_000, 0, 'guild-free'); // $10 cost

            expect(usage.isBudgetExceeded('guild-free')).toBe(false);
        });

        it('should return correct guild stats', () => {
            mockData.guildBudgets = { 'guild-X': { dailyBudgetUsd: 2.0 } };
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 0;

            usage.record(500_000, 0, 'guild-X');

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

            const guildHistory = mockData.guildUsageHistory as Record<string, Array<{ date: string; inputTokens: number }>>;
            expect(guildHistory['guild-A']).toHaveLength(1);
            expect(guildHistory['guild-A'][0].date).toBe('2025-01-01');
            expect(guildHistory['guild-A'][0].inputTokens).toBe(300);

            // Current usage should be reset
            const guildUsage = mockData.guildTokenUsage as Record<string, { date: string; inputTokens: number }>;
            expect(guildUsage['guild-A'].date).toBe(today);
            expect(guildUsage['guild-A'].inputTokens).toBe(0);
        });

        it('should return guild history with costs', () => {
            mockData.inputPricePerMillion = 1.0;
            mockData.outputPricePerMillion = 2.0;
            mockData.guildUsageHistory = {
                'guild-Y': [
                    { date: '2025-01-01', inputTokens: 1_000_000, outputTokens: 500_000, requests: 5 },
                ],
            };

            const history = usage.getGuildHistory('guild-Y');
            expect(history).toHaveLength(1);
            expect(history[0].cost).toBe(2.0);
            expect(history[0].totalTokens).toBe(1_500_000);
        });

        it('should not record guild usage when guildId is null', () => {
            usage.record(100, 50, null);

            const global = mockData.tokenUsage as { inputTokens: number; requests: number };
            expect(global.inputTokens).toBe(100);

            const guildUsage = mockData.guildTokenUsage as Record<string, unknown>;
            expect(Object.keys(guildUsage).length).toBe(0);
        });
    });
});
