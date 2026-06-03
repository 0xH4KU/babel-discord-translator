import { describe, expect, it, vi } from 'vitest';
import { AppMetrics } from '../src/shared/app-metrics.js';
import {
    buildGlossaryVersion,
    classifyTranslationError,
    createTranslatorOptions,
    suggestedActionForErrorType,
} from '../src/modules/translation/translation-service-helpers.js';

describe('translation service helpers', () => {
    it('classifies translation errors with suggested actions', () => {
        expect(classifyTranslationError('Vertex AI 429 rate limit')).toEqual({
            errorType: 'rate_limit',
            suggestedAction:
                'Provider rate limit reached. Try fallback mode or reduce concurrency.',
        });
        expect(classifyTranslationError('OpenAI API key not configured')).toEqual({
            errorType: 'auth',
            suggestedAction: 'Check provider API key and provider configuration.',
        });
        expect(classifyTranslationError('Provider timeout')).toEqual({
            errorType: 'timeout',
            suggestedAction: 'Provider timed out. Check provider status or use fallback mode.',
        });
        expect(suggestedActionForErrorType('unknown')).toBe(
            'Check structured logs for this request id.',
        );
    });

    it('builds stable glossary versions from normalized entry fields', () => {
        expect(
            buildGlossaryVersion([
                {
                    id: 1,
                    guildId: 'guild-1',
                    sourceText: ' OpenAI ',
                    targetText: ' OpenAI ',
                    notes: ' Preserve brand ',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-02T00:00:00.000Z',
                },
            ]),
        ).toBe(
            [1, 'OpenAI', 'OpenAI', 'Preserve brand', '2026-06-02T00:00:00.000Z'].join('\u001f'),
        );
    });

    it('only includes optional translator fields when they are present', () => {
        const metrics = new AppMetrics();
        const logContext = {
            requestId: 'req-1',
            guildId: 'guild-1',
            userId: 'user-1',
            command: 'babel' as const,
        };

        expect(createTranslatorOptions(logContext)).toEqual({ logContext });
        expect(
            createTranslatorOptions(logContext, metrics, [
                { sourceText: 'raid', targetText: '團本', notes: '' },
            ]),
        ).toEqual({
            logContext,
            metrics,
            glossaryEntries: [{ sourceText: 'raid', targetText: '團本', notes: '' }],
        });
        expect(vi.isMockFunction(createTranslatorOptions)).toBe(false);
    });
});
