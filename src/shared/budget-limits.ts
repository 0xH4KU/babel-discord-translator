export interface BudgetLimitSettings {
    budgetFiveHourPercent: number;
    budgetSevenDayPercent: number;
    budgetFairShareMultiplier: number;
}

export type BudgetLimitOverrides = Partial<BudgetLimitSettings>;

export const DEFAULT_BUDGET_LIMITS: BudgetLimitSettings = {
    budgetFiveHourPercent: 5,
    budgetSevenDayPercent: 30,
    budgetFairShareMultiplier: 1.5,
};

export function resolveBudgetLimits(
    defaults: BudgetLimitSettings,
    overrides: BudgetLimitOverrides = {},
): BudgetLimitSettings {
    return {
        budgetFiveHourPercent: overrides.budgetFiveHourPercent ?? defaults.budgetFiveHourPercent,
        budgetSevenDayPercent: overrides.budgetSevenDayPercent ?? defaults.budgetSevenDayPercent,
        budgetFairShareMultiplier:
            overrides.budgetFairShareMultiplier ?? defaults.budgetFairShareMultiplier,
    };
}

export function validateBudgetLimits(settings: BudgetLimitSettings): string | null {
    const { budgetFiveHourPercent, budgetSevenDayPercent, budgetFairShareMultiplier } = settings;

    if (
        !Number.isFinite(budgetFiveHourPercent) ||
        !Number.isFinite(budgetSevenDayPercent) ||
        budgetFiveHourPercent <= 0 ||
        budgetFiveHourPercent > budgetSevenDayPercent ||
        budgetSevenDayPercent > 100
    ) {
        return 'Budget limits must satisfy 0 < five-hour percent <= seven-day percent <= 100';
    }
    if (!Number.isFinite(budgetFairShareMultiplier) || budgetFairShareMultiplier < 1) {
        return 'Budget fair-share multiplier must be at least 1';
    }

    return null;
}
