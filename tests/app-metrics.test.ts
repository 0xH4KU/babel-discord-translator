import { describe, expect, it } from 'vitest';
import { AppMetrics, createEmptyAppMetricsSnapshot } from '../src/shared/app-metrics.js';

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
            providers: {},
            providerFallbackTotal: 0,
            lastProviderFallback: null,
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
            providers: {},
            providerFallbackTotal: 0,
            lastProviderFallback: null,
        });
    });

    it('should return isolated provider objects for empty snapshots', () => {
        const firstSnapshot = createEmptyAppMetricsSnapshot();
        const secondSnapshot = createEmptyAppMetricsSnapshot();

        firstSnapshot.providers.vertex = {
            successTotal: 1,
            failureTotal: 0,
            fallbackFromTotal: 0,
            fallbackToTotal: 0,
            lastLatencyMs: 120,
            lastErrorType: null,
            lastError: null,
        };

        expect(secondSnapshot.providers).toEqual({});
    });

    it('should record provider success, failure, and fallback metrics', () => {
        const metrics = new AppMetrics();

        metrics.recordProviderSuccess('vertex', { latencyMs: 120 });
        metrics.recordProviderFailure('vertex', {
            errorType: 'rate_limit',
            error: 'Vertex AI 429',
        });
        metrics.recordProviderFallback({
            from: 'vertex',
            to: 'openai',
            errorType: 'rate_limit',
            error: 'Vertex AI 429',
        });
        metrics.recordProviderSuccess('openai', { latencyMs: 80 });

        const snapshot = metrics.snapshot();

        expect(snapshot.providers.vertex).toMatchObject({
            successTotal: 1,
            failureTotal: 1,
            fallbackFromTotal: 1,
            fallbackToTotal: 0,
            lastLatencyMs: 120,
            lastErrorType: 'rate_limit',
            lastError: 'Vertex AI 429',
        });
        expect(snapshot.providers.openai).toMatchObject({
            successTotal: 1,
            failureTotal: 0,
            fallbackFromTotal: 0,
            fallbackToTotal: 1,
            lastLatencyMs: 80,
            lastErrorType: null,
            lastError: null,
        });
        expect(snapshot.providerFallbackTotal).toBe(1);
        expect(snapshot.lastProviderFallback).toMatchObject({
            from: 'vertex',
            to: 'openai',
            errorType: 'rate_limit',
            error: 'Vertex AI 429',
        });
    });

    it('should return profile-scoped snapshots without losing aggregate metrics', () => {
        const metrics = new AppMetrics();

        metrics.recordTranslationSuccess({ appProfileId: 'babel-guild' });
        metrics.recordTranslationSuccess({ appProfileId: 'babel-guild', cached: true });
        metrics.recordTranslationApiCall({ appProfileId: 'babel-guild' });
        metrics.recordProviderSuccess('vertex', {
            appProfileId: 'babel-guild',
            latencyMs: 120,
        });

        metrics.recordTranslationFailure({ appProfileId: 'babel-pocket' });
        metrics.recordBudgetExceeded({ appProfileId: 'babel-pocket' });
        metrics.recordProviderFailure('openai', {
            appProfileId: 'babel-pocket',
            errorType: 'auth',
            error: 'Pocket OpenAI 401',
        });
        metrics.recordProviderFallback({
            appProfileId: 'babel-pocket',
            from: 'openai',
            to: 'vertex',
            errorType: 'auth',
            error: 'Pocket OpenAI 401',
        });

        expect(metrics.snapshot()).toMatchObject({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
            translationCacheHitsTotal: 1,
            translationFailuresTotal: 1,
            budgetExceededTotal: 1,
            providerFallbackTotal: 1,
        });

        const guildSnapshot = metrics.snapshot({ appProfileId: 'babel-guild' });
        expect(guildSnapshot).toMatchObject({
            translationsTotal: 2,
            translationApiCallsTotal: 1,
            translationCacheHitsTotal: 1,
            translationFailuresTotal: 0,
            budgetExceededTotal: 0,
            providerFallbackTotal: 0,
        });
        expect(guildSnapshot.providers.vertex).toMatchObject({
            successTotal: 1,
            failureTotal: 0,
            fallbackFromTotal: 0,
            fallbackToTotal: 0,
            lastLatencyMs: 120,
        });
        expect(guildSnapshot.providers.openai).toBeUndefined();
        expect(guildSnapshot.lastProviderFallback).toBeNull();

        const pocketSnapshot = metrics.snapshot({ appProfileId: 'babel-pocket' });
        expect(pocketSnapshot).toMatchObject({
            translationsTotal: 0,
            translationApiCallsTotal: 0,
            translationCacheHitsTotal: 0,
            translationFailuresTotal: 1,
            budgetExceededTotal: 1,
            providerFallbackTotal: 1,
        });
        expect(pocketSnapshot.providers.openai).toMatchObject({
            successTotal: 0,
            failureTotal: 1,
            fallbackFromTotal: 1,
            fallbackToTotal: 0,
            lastErrorType: 'auth',
            lastError: 'Pocket OpenAI 401',
        });
        expect(pocketSnapshot.providers.vertex).toMatchObject({
            successTotal: 0,
            failureTotal: 0,
            fallbackFromTotal: 0,
            fallbackToTotal: 1,
        });
        expect(pocketSnapshot.lastProviderFallback).toMatchObject({
            from: 'openai',
            to: 'vertex',
            errorType: 'auth',
        });
    });

    it('should sanitize provider errors before exposing metric snapshots', () => {
        const metrics = new AppMetrics();
        const rawError =
            'Vertex AI 429 at https://vertex.googleapis.com/v1/projects/project-123/locations/global with token abcdefghijklmnopqrstuvwxyz1234567890';

        metrics.recordProviderFailure('vertex', {
            errorType: 'rate_limit',
            error: rawError,
        });
        metrics.recordProviderFallback({
            from: 'vertex',
            to: 'openai',
            errorType: 'rate_limit',
            error: rawError,
        });

        const snapshot = metrics.snapshot();

        expect(snapshot.providers.vertex?.lastError).toContain('[API endpoint]');
        expect(snapshot.providers.vertex?.lastError).toContain('***');
        expect(snapshot.providers.vertex?.lastError).not.toContain('vertex.googleapis.com');
        expect(snapshot.providers.vertex?.lastError).not.toContain(
            'abcdefghijklmnopqrstuvwxyz1234567890',
        );
        expect(snapshot.lastProviderFallback?.error).toContain('[API endpoint]');
        expect(snapshot.lastProviderFallback?.error).toContain('***');
        expect(snapshot.lastProviderFallback?.error).not.toContain('vertex.googleapis.com');
        expect(snapshot.lastProviderFallback?.error).not.toContain(
            'abcdefghijklmnopqrstuvwxyz1234567890',
        );
    });
});
