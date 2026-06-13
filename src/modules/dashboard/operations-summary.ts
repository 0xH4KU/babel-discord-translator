import type { ProviderMetricsSnapshot } from '../../shared/app-metrics.js';
import type { TranslationProviderMode } from '../../shared/types.js';

const BUDGET_WARNING_THRESHOLD = 0.8;
const EMPTY_PROVIDER_METRICS: ProviderMetricsSnapshot = {
    successTotal: 0,
    failureTotal: 0,
    fallbackFromTotal: 0,
    fallbackToTotal: 0,
    lastLatencyMs: null,
    lastErrorType: null,
    lastError: null,
};

type BudgetRiskItem = {
    id: string;
    name: string;
    budget: number;
    totalCost: number;
    usedPercent: number;
};

export type OperationsGuidanceItem = {
    area: 'provider' | 'runtime' | 'budget';
    severity: 'info' | 'warning' | 'critical';
    title: string;
    action: string;
};

export function providerModeIncludes(
    mode: TranslationProviderMode,
    provider: 'vertex' | 'openai',
): boolean {
    return mode.split('+').includes(provider);
}

export function budgetRiskForGuilds(
    guildBudgetList: Array<{
        id: string;
        name: string;
        budget: number;
        totalCost: number;
        exceeded: boolean;
    }>,
): {
    warningCount: number;
    exceededCount: number;
    warnings: BudgetRiskItem[];
    exceeded: BudgetRiskItem[];
} {
    const warnings: BudgetRiskItem[] = [];
    const exceeded: BudgetRiskItem[] = [];

    for (const guildBudget of guildBudgetList) {
        if (guildBudget.budget <= 0) {
            continue;
        }

        const usedPercent = guildBudget.totalCost / guildBudget.budget;
        const item = {
            id: guildBudget.id,
            name: guildBudget.name,
            budget: guildBudget.budget,
            totalCost: guildBudget.totalCost,
            usedPercent,
        };

        if (guildBudget.exceeded) {
            exceeded.push(item);
        } else if (usedPercent >= BUDGET_WARNING_THRESHOLD) {
            warnings.push(item);
        }
    }

    return {
        warningCount: warnings.length,
        exceededCount: exceeded.length,
        warnings,
        exceeded,
    };
}

export function providerSummary(
    metrics: Record<string, ProviderMetricsSnapshot>,
    provider: 'vertex' | 'openai',
    options: { enabled: boolean; configured: boolean },
): ProviderMetricsSnapshot & { enabled: boolean; configured: boolean } {
    return {
        enabled: options.enabled,
        configured: options.configured,
        ...(metrics[provider] ?? EMPTY_PROVIDER_METRICS),
    };
}

export function buildOperationsGuidance({
    providers,
    runtimePressure,
    budgetRisk,
}: {
    providers: Record<
        'vertex' | 'openai',
        ProviderMetricsSnapshot & { enabled: boolean; configured: boolean }
    >;
    runtimePressure: {
        queued: number;
        rejectedTotal: number;
    };
    budgetRisk: {
        warningCount: number;
        exceededCount: number;
    };
}): OperationsGuidanceItem[] {
    const guidance: OperationsGuidanceItem[] = [];

    for (const [provider, summary] of Object.entries(providers)) {
        if (summary.enabled && !summary.configured) {
            guidance.push({
                area: 'provider',
                severity: 'critical',
                title: `${provider} setup is incomplete`,
                action: 'Open Settings and complete the enabled provider configuration.',
            });
            continue;
        }

        if (summary.enabled && summary.lastErrorType) {
            guidance.push({
                area: 'provider',
                severity: summary.lastErrorType === 'auth' ? 'warning' : 'info',
                title: `${provider} reported ${summary.lastErrorType}`,
                action: 'Review provider credentials, fallback mode, and recent error logs.',
            });
        }
    }

    if (runtimePressure.rejectedTotal > 0) {
        guidance.push({
            area: 'runtime',
            severity: runtimePressure.queued > 0 ? 'warning' : 'info',
            title: 'Translation queue rejected requests',
            action: 'Review runtime pressure and reduce concurrency or raise queue limits.',
        });
    }

    if (budgetRisk.exceededCount > 0) {
        guidance.push({
            area: 'budget',
            severity: 'critical',
            title: 'Server budget exceeded',
            action: 'Raise the affected server budget or wait for the daily reset.',
        });
    } else if (budgetRisk.warningCount > 0) {
        guidance.push({
            area: 'budget',
            severity: 'warning',
            title: 'Server budget nearing limit',
            action: 'Review per-server usage and adjust budgets before translations are blocked.',
        });
    }

    return guidance;
}
