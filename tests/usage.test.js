import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock store as an in-memory object ---
// vi.hoisted ensures the data object is available when vi.mock runs (hoisted to top)
const mockData = vi.hoisted(() => ({}));

vi.mock('../src/store.js', () => ({
    store: {
        get: vi.fn((key) => mockData[key]),
        set: vi.fn((key, val) => { mockData[key] = val; }),
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
    });

    it('should record token usage', () => {
        usage.record(100, 50);

        const data = mockData.tokenUsage;
        expect(data.inputTokens).toBe(100);
        expect(data.outputTokens).toBe(50);
        expect(data.requests).toBe(1);
    });

    it('should accumulate multiple records', () => {
        usage.record(100, 50);
        usage.record(200, 100);

        const data = mockData.tokenUsage;
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

        expect(mockData.usageHistory).toHaveLength(1);
        expect(mockData.usageHistory[0].date).toBe('2025-01-01');
        expect(mockData.usageHistory[0].inputTokens).toBe(500);
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

        expect(mockData.usageHistory.length).toBeLessThanOrEqual(30);
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
        usage.record(undefined, undefined);

        const data = mockData.tokenUsage;
        expect(data.inputTokens).toBe(0);
        expect(data.outputTokens).toBe(0);
        expect(data.requests).toBe(2);
    });
});
