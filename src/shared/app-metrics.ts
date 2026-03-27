export interface AppMetricsSnapshot {
    translationsTotal: number;
    translationApiCallsTotal: number;
    translationCacheHitsTotal: number;
    translationFailuresTotal: number;
    budgetExceededTotal: number;
    webhookRecreateTotal: number;
    translationSuccessRate: number;
    translationFailureRate: number;
    translationCacheHitRate: number;
    translationApiCallRate: number;
}

export interface AppMetricsCollector {
    recordTranslationSuccess(options?: { cached?: boolean }): void;
    recordTranslationApiCall(): void;
    recordTranslationFailure(): void;
    recordBudgetExceeded(): void;
    recordWebhookRecreate(): void;
    snapshot(): AppMetricsSnapshot;
}

const EMPTY_APP_METRICS_SNAPSHOT: AppMetricsSnapshot = {
    translationsTotal: 0,
    translationApiCallsTotal: 0,
    translationCacheHitsTotal: 0,
    translationFailuresTotal: 0,
    budgetExceededTotal: 0,
    webhookRecreateTotal: 0,
    translationSuccessRate: 0,
    translationFailureRate: 0,
    translationCacheHitRate: 0,
    translationApiCallRate: 0,
};

export function createEmptyAppMetricsSnapshot(): AppMetricsSnapshot {
    return { ...EMPTY_APP_METRICS_SNAPSHOT };
}

export class AppMetrics implements AppMetricsCollector {
    private translationsTotal = 0;
    private translationApiCallsTotal = 0;
    private translationCacheHitsTotal = 0;
    private translationFailuresTotal = 0;
    private budgetExceededTotal = 0;
    private webhookRecreateTotal = 0;

    recordTranslationSuccess(options?: { cached?: boolean }): void {
        this.translationsTotal += 1;

        if (options?.cached) {
            this.translationCacheHitsTotal += 1;
        }
    }

    recordTranslationApiCall(): void {
        this.translationApiCallsTotal += 1;
    }

    recordTranslationFailure(): void {
        this.translationFailuresTotal += 1;
    }

    recordBudgetExceeded(): void {
        this.budgetExceededTotal += 1;
    }

    recordWebhookRecreate(): void {
        this.webhookRecreateTotal += 1;
    }

    snapshot(): AppMetricsSnapshot {
        const completedTranslationAttempts = this.translationsTotal + this.translationFailuresTotal;

        return {
            translationsTotal: this.translationsTotal,
            translationApiCallsTotal: this.translationApiCallsTotal,
            translationCacheHitsTotal: this.translationCacheHitsTotal,
            translationFailuresTotal: this.translationFailuresTotal,
            budgetExceededTotal: this.budgetExceededTotal,
            webhookRecreateTotal: this.webhookRecreateTotal,
            translationSuccessRate: completedTranslationAttempts > 0
                ? this.translationsTotal / completedTranslationAttempts
                : 0,
            translationFailureRate: completedTranslationAttempts > 0
                ? this.translationFailuresTotal / completedTranslationAttempts
                : 0,
            translationCacheHitRate: this.translationsTotal > 0
                ? this.translationCacheHitsTotal / this.translationsTotal
                : 0,
            translationApiCallRate: this.translationsTotal > 0
                ? this.translationApiCallsTotal / this.translationsTotal
                : 0,
        };
    }
}
