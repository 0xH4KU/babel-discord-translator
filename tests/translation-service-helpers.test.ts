import { describe, expect, it } from 'vitest';
import {
    buildGlossaryVersion,
    classifyTranslationError,
    selectGlossaryEntriesForTarget,
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
                    targetLanguage: ' auto ',
                    targetText: ' OpenAI ',
                    notes: ' Preserve brand ',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-02T00:00:00.000Z',
                },
            ]),
        ).toBe(
            [1, 'OpenAI', 'auto', 'OpenAI', 'Preserve brand', '2026-06-02T00:00:00.000Z'].join(
                '\u001f',
            ),
        );
    });

    it('selects exact target-language glossary entries before auto fallbacks', () => {
        const entries = [
            {
                id: 1,
                guildId: 'guild-1',
                sourceText: 'OpenAI',
                targetLanguage: 'auto',
                targetText: 'OpenAI',
                notes: 'Preserve brand',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            },
            {
                id: 2,
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'auto',
                targetText: '團本',
                notes: 'Legacy term',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            },
            {
                id: 3,
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'ja',
                targetText: 'レイド',
                notes: 'Japanese term',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
            },
        ];

        expect(selectGlossaryEntriesForTarget(entries, 'ja')).toEqual([entries[2], entries[0]]);
        expect(selectGlossaryEntriesForTarget(entries, 'ko')).toEqual([entries[0], entries[1]]);
        expect(selectGlossaryEntriesForTarget(entries, 'auto')).toEqual(entries);
    });
});
