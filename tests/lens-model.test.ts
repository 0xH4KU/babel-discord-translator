import { describe, expect, it } from 'vitest';
import { parseImageTranslationResponse } from '../src/modules/translation/lens-model.js';

describe('parseImageTranslationResponse', () => {
    it('normalizes fenced JSON and valid coordinates', () => {
        const result = parseImageTranslationResponse(
            '```json\n{"has_text":true,"translation":"[[BABEL_REGION_1]] 完整翻譯","regions":[[1.2,2.6,900,999]]}\n```',
            12,
            8,
        );

        expect(result).toEqual({
            text: '[1] 完整翻譯',
            hasText: true,
            regions: [{ translation: '', box_2d: [1, 3, 900, 999] }],
            inputTokens: 12,
            outputTokens: 8,
        });
    });

    it('keeps accepting the previous region object format', () => {
        const result = parseImageTranslationResponse(
            '{"has_text":true,"translation":"caption","regions":[{"translation":"region","box_2d":[1,2,3,4]}]}',
            1,
            1,
        );

        expect(result.text).toBe('[1] region');
        expect(result.regions).toEqual([{ translation: 'region', box_2d: [1, 2, 3, 4] }]);
    });

    it('drops numbered boxes when compact translations omit their matching markers', () => {
        const result = parseImageTranslationResponse(
            '{"has_text":true,"translation":"caption","regions":[[1,2,3,4]]}',
            1,
            1,
        );

        expect(result).toMatchObject({
            text: 'caption',
            regions: [],
            warnings: ['invalid_regions'],
        });
    });

    it('treats has_text false as a valid terminal result', () => {
        expect(parseImageTranslationResponse('{"has_text":false}', 4, 2)).toEqual({
            text: '',
            hasText: false,
            regions: [],
            inputTokens: 4,
            outputTokens: 2,
        });
    });

    it('keeps a valid caption but drops an invalid region set', () => {
        const result = parseImageTranslationResponse(
            '{"has_text":true,"translation":"caption","regions":[{"translation":"x","box_2d":[0,0,1001,10]}]}',
            1,
            1,
        );

        expect(result).toMatchObject({
            text: 'caption',
            hasText: true,
            regions: [],
            warnings: ['invalid_regions'],
        });
    });

    it('rejects malformed primary output', () => {
        expect(() => parseImageTranslationResponse('not json', 1, 1)).toThrow(
            'Invalid Babel Lens JSON response',
        );
        expect(() =>
            parseImageTranslationResponse('{"has_text":true,"regions":[]}', 1, 1),
        ).toThrow('translation is required');
    });
});
