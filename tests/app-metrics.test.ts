import { describe, expect, it } from 'vitest';
import { AppMetrics } from '../src/app-metrics.js';

describe('AppMetrics', () => {
    it('should compute success, failure, cache, and api call rates from counters', () => {
        const metrics = new AppMetrics();

        metrics.recordTranslationSuccess();
        metrics.recordTranslationSuccess({ cached: true });
        metrics.recordTranslationApiCall();
        metrics.recordTranslationFailure();
        metrics.recordBudgetExceeded();
        metrics.recordWebhookRecreate();

        expect(metrics.snapshot()).toEqual({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
            translationCacheHitsTotal: 1,
            translationFailuresTotal: 1,
            budgetExceededTotal: 1,
            webhookRecreateTotal: 1,
            translationSuccessRate: 2 / 3,
            translationFailureRate: 1 / 3,
            translationCacheHitRate: 0.5,
            translationApiCallRate: 0.5,
        });
    });

    it('should return zeroed rates when no translations were recorded', () => {
        const metrics = new AppMetrics();

        expect(metrics.snapshot()).toEqual({
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
        });
    });
});
