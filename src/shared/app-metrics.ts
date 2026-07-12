import { sanitizeError } from './errors.js';
import type { AppProfile } from '../apps/app-profile.js';

export interface ProviderMetricsSnapshot {
    successTotal: number;
    failureTotal: number;
    fallbackFromTotal: number;
    fallbackToTotal: number;
    lastLatencyMs: number | null;
    lastErrorType: string | null;
    lastError: string | null;
}

export interface LastProviderFallback {
    from: string;
    to: string;
    errorType: string;
    error: string;
    timestamp: number;
}

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
    providers: Record<string, ProviderMetricsSnapshot>;
    providerFallbackTotal: number;
    lastProviderFallback: LastProviderFallback | null;
}

export interface AppMetricsCollector {
    recordTranslationSuccess(options?: { cached?: boolean; appProfileId?: AppProfile['id'] }): void;
    recordTranslationApiCall(options?: { appProfileId?: AppProfile['id'] }): void;
    recordTranslationFailure(options?: { appProfileId?: AppProfile['id'] }): void;
    recordBudgetExceeded(options?: { appProfileId?: AppProfile['id'] }): void;
    recordWebhookRecreate(options?: { appProfileId?: AppProfile['id'] }): void;
    recordProviderSuccess(
        provider: string,
        options?: { latencyMs?: number; appProfileId?: AppProfile['id'] },
    ): void;
    recordProviderFailure(
        provider: string,
        options: { errorType: string; error: string; appProfileId?: AppProfile['id'] },
    ): void;
    recordProviderFallback(options: {
        from: string;
        to: string;
        errorType: string;
        error: string;
        appProfileId?: AppProfile['id'];
    }): void;
    snapshot(options?: { appProfileId?: AppProfile['id'] }): AppMetricsSnapshot;
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
    providers: {},
    providerFallbackTotal: 0,
    lastProviderFallback: null,
};

export function createEmptyAppMetricsSnapshot(): AppMetricsSnapshot {
    return { ...EMPTY_APP_METRICS_SNAPSHOT, providers: {} };
}

export function createProfileMetricsCollector(
    metrics: AppMetricsCollector | undefined,
    appProfileId: AppProfile['id'] | undefined,
): AppMetricsCollector | undefined {
    if (!metrics || !appProfileId) {
        return metrics;
    }

    return {
        recordTranslationSuccess(options = {}) {
            metrics.recordTranslationSuccess({ ...options, appProfileId });
        },
        recordTranslationApiCall() {
            metrics.recordTranslationApiCall({ appProfileId });
        },
        recordTranslationFailure() {
            metrics.recordTranslationFailure({ appProfileId });
        },
        recordBudgetExceeded() {
            metrics.recordBudgetExceeded({ appProfileId });
        },
        recordWebhookRecreate() {
            metrics.recordWebhookRecreate({ appProfileId });
        },
        recordProviderSuccess(provider, options = {}) {
            metrics.recordProviderSuccess(provider, { ...options, appProfileId });
        },
        recordProviderFailure(provider, options) {
            metrics.recordProviderFailure(provider, { ...options, appProfileId });
        },
        recordProviderFallback(options) {
            metrics.recordProviderFallback({ ...options, appProfileId });
        },
        snapshot(options) {
            return metrics.snapshot(options ?? { appProfileId });
        },
    };
}

interface AppMetricsState {
    translationsTotal: number;
    translationApiCallsTotal: number;
    translationCacheHitsTotal: number;
    translationFailuresTotal: number;
    budgetExceededTotal: number;
    webhookRecreateTotal: number;
    providers: Map<string, ProviderMetricsSnapshot>;
    providerFallbackTotal: number;
    lastProviderFallback: LastProviderFallback | null;
}

function createAppMetricsState(): AppMetricsState {
    return {
        translationsTotal: 0,
        translationApiCallsTotal: 0,
        translationCacheHitsTotal: 0,
        translationFailuresTotal: 0,
        budgetExceededTotal: 0,
        webhookRecreateTotal: 0,
        providers: new Map<string, ProviderMetricsSnapshot>(),
        providerFallbackTotal: 0,
        lastProviderFallback: null,
    };
}

export class AppMetrics implements AppMetricsCollector {
    private aggregate = createAppMetricsState();
    private profileStates = new Map<AppProfile['id'], AppMetricsState>();

    recordTranslationSuccess(options?: {
        cached?: boolean;
        appProfileId?: AppProfile['id'];
    }): void {
        for (const state of this.recordingStates(options?.appProfileId)) {
            state.translationsTotal += 1;

            if (options?.cached) {
                state.translationCacheHitsTotal += 1;
            }
        }
    }

    recordTranslationApiCall(options?: { appProfileId?: AppProfile['id'] }): void {
        for (const state of this.recordingStates(options?.appProfileId)) {
            state.translationApiCallsTotal += 1;
        }
    }

    recordTranslationFailure(options?: { appProfileId?: AppProfile['id'] }): void {
        for (const state of this.recordingStates(options?.appProfileId)) {
            state.translationFailuresTotal += 1;
        }
    }

    recordBudgetExceeded(options?: { appProfileId?: AppProfile['id'] }): void {
        for (const state of this.recordingStates(options?.appProfileId)) {
            state.budgetExceededTotal += 1;
        }
    }

    recordWebhookRecreate(options?: { appProfileId?: AppProfile['id'] }): void {
        for (const state of this.recordingStates(options?.appProfileId)) {
            state.webhookRecreateTotal += 1;
        }
    }

    recordProviderSuccess(
        provider: string,
        options?: { latencyMs?: number; appProfileId?: AppProfile['id'] },
    ): void {
        for (const state of this.recordingStates(options?.appProfileId)) {
            const providerMetrics = this.providerMetrics(state, provider);

            providerMetrics.successTotal += 1;

            if (options?.latencyMs !== undefined) {
                providerMetrics.lastLatencyMs = options.latencyMs;
            }
        }
    }

    recordProviderFailure(
        provider: string,
        options: { errorType: string; error: string; appProfileId?: AppProfile['id'] },
    ): void {
        const sanitizedError = sanitizeError(options.error);
        for (const state of this.recordingStates(options.appProfileId)) {
            const providerMetrics = this.providerMetrics(state, provider);

            providerMetrics.failureTotal += 1;
            providerMetrics.lastErrorType = options.errorType;
            providerMetrics.lastError = sanitizedError;
        }
    }

    recordProviderFallback(options: {
        from: string;
        to: string;
        errorType: string;
        error: string;
        appProfileId?: AppProfile['id'];
    }): void {
        const sanitizedError = sanitizeError(options.error);
        const timestamp = Date.now();
        for (const state of this.recordingStates(options.appProfileId)) {
            const fromProviderMetrics = this.providerMetrics(state, options.from);
            const toProviderMetrics = this.providerMetrics(state, options.to);

            state.providerFallbackTotal += 1;
            fromProviderMetrics.fallbackFromTotal += 1;
            toProviderMetrics.fallbackToTotal += 1;
            state.lastProviderFallback = {
                from: options.from,
                to: options.to,
                errorType: options.errorType,
                error: sanitizedError,
                timestamp,
            };
        }
    }

    snapshot(options?: { appProfileId?: AppProfile['id'] }): AppMetricsSnapshot {
        const state = options?.appProfileId
            ? (this.profileStates.get(options.appProfileId) ?? createAppMetricsState())
            : this.aggregate;
        const completedTranslationAttempts =
            state.translationsTotal + state.translationFailuresTotal;

        return {
            translationsTotal: state.translationsTotal,
            translationApiCallsTotal: state.translationApiCallsTotal,
            translationCacheHitsTotal: state.translationCacheHitsTotal,
            translationFailuresTotal: state.translationFailuresTotal,
            budgetExceededTotal: state.budgetExceededTotal,
            webhookRecreateTotal: state.webhookRecreateTotal,
            translationSuccessRate:
                completedTranslationAttempts > 0
                    ? state.translationsTotal / completedTranslationAttempts
                    : 0,
            translationFailureRate:
                completedTranslationAttempts > 0
                    ? state.translationFailuresTotal / completedTranslationAttempts
                    : 0,
            translationCacheHitRate:
                state.translationsTotal > 0
                    ? state.translationCacheHitsTotal / state.translationsTotal
                    : 0,
            translationApiCallRate:
                state.translationsTotal > 0
                    ? state.translationApiCallsTotal / state.translationsTotal
                    : 0,
            providers: this.snapshotProviders(state),
            providerFallbackTotal: state.providerFallbackTotal,
            lastProviderFallback:
                state.lastProviderFallback === null ? null : { ...state.lastProviderFallback },
        };
    }

    private recordingStates(appProfileId?: AppProfile['id']): AppMetricsState[] {
        if (!appProfileId) {
            return [this.aggregate];
        }

        return [this.aggregate, this.profileState(appProfileId)];
    }

    private profileState(appProfileId: AppProfile['id']): AppMetricsState {
        const existing = this.profileStates.get(appProfileId);
        if (existing) {
            return existing;
        }

        const state = createAppMetricsState();
        this.profileStates.set(appProfileId, state);
        return state;
    }

    private providerMetrics(state: AppMetricsState, provider: string): ProviderMetricsSnapshot {
        const existingMetrics = state.providers.get(provider);

        if (existingMetrics !== undefined) {
            return existingMetrics;
        }

        const metrics = {
            successTotal: 0,
            failureTotal: 0,
            fallbackFromTotal: 0,
            fallbackToTotal: 0,
            lastLatencyMs: null,
            lastErrorType: null,
            lastError: null,
        };

        state.providers.set(provider, metrics);

        return metrics;
    }

    private snapshotProviders(state: AppMetricsState): Record<string, ProviderMetricsSnapshot> {
        return Object.fromEntries(
            Array.from(state.providers.entries()).map(([provider, metrics]) => [
                provider,
                { ...metrics },
            ]),
        );
    }
}
