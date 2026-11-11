import { describe, expect, it } from 'vitest';
import {
    isUsefulImageRegion,
    isUsefulImageText,
    mergeDenseImageRegions,
    parseImageTranslationResponse,
    parseOcrImageTranslationResponse,
} from '../src/modules/translation/lens-model.js';

describe('Babel Lens model response parser', () => {
    it('normalizes fenced JSON and valid region objects', () => {
        const result = parseImageTranslationResponse(
            '```json\n{"has_text":true,"regions":[{"box_2d":[1.2,2.6,900,999],"translation":" 完整翻譯 "}]}\n```',
            12,
            8,
        );

        expect(result).toEqual({
            text: '[1] 完整翻譯',
            hasText: true,
            regions: [{ translation: '完整翻譯', box_2d: [1, 3, 900, 999] }],
            inputTokens: 12,
            outputTokens: 8,
        });
    });

    it('treats has_text false as a valid terminal result', () => {
        expect(parseImageTranslationResponse('{"has_text":false,"regions":[]}', 4, 2)).toEqual({
            text: '',
            hasText: false,
            regions: [],
            inputTokens: 4,
            outputTokens: 2,
        });
    });

    it('filters peripheral UI noise, tiny boxes, handles, URLs, and numeric metrics', () => {
        expect(isUsefulImageText('https://example.com/post')).toBe(false);
        expect(isUsefulImageText('@babel_bot')).toBe(false);
        expect(isUsefulImageText('12.4K')).toBe(false);
        expect(isUsefulImageText('60fps')).toBe(false);
        expect(isUsefulImageText('5G')).toBe(false);
        expect(isUsefulImageText('12:30 PM')).toBe(false);
        expect(isUsefulImageRegion({ box_2d: [10, 10, 15, 200], translation: '太矮的框' })).toBe(
            false,
        );

        const result = parseImageTranslationResponse(
            JSON.stringify({
                has_text: true,
                regions: [
                    { box_2d: [5, 10, 25, 80], translation: '5G' },
                    { box_2d: [5, 900, 25, 980], translation: '98%' },
                    { box_2d: [40, 20, 70, 200], translation: '@author_handle' },
                    { box_2d: [120, 40, 260, 880], translation: '這才是真正需要閱讀的正文內容' },
                ],
            }),
            15,
            10,
        );

        expect(result).toEqual({
            text: '[1] 這才是真正需要閱讀的正文內容',
            hasText: true,
            regions: [{ box_2d: [120, 40, 260, 880], translation: '這才是真正需要閱讀的正文內容' }],
            inputTokens: 15,
            outputTokens: 10,
        });
    });

    it('returns hasText false when only UI noise regions were predicted', () => {
        const result = parseImageTranslationResponse(
            JSON.stringify({
                has_text: true,
                regions: [
                    { box_2d: [10, 10, 30, 90], translation: '1080p' },
                    { box_2d: [10, 100, 30, 260], translation: 'https://discord.gg/test' },
                ],
            }),
            8,
            4,
        );

        expect(result).toEqual({
            text: '',
            hasText: false,
            regions: [],
            inputTokens: 8,
            outputTokens: 4,
        });
    });

    it('merges vertically stacked same-column fragments while keeping separate columns apart', () => {
        const merged = mergeDenseImageRegions([
            { box_2d: [100, 50, 140, 450], translation: '第一行標題' },
            { box_2d: [148, 55, 188, 440], translation: '第二行補充說明' },
            { box_2d: [100, 550, 160, 920], translation: '右側獨立欄位' },
        ]);

        expect(merged).toEqual([
            {
                box_2d: [100, 50, 188, 450],
                translation: '第一行標題\n第二行補充說明',
            },
            {
                box_2d: [100, 550, 160, 920],
                translation: '右側獨立欄位',
            },
        ]);
    });

    it('groups OCR unit IDs into union boxes and omits echoed source text', () => {
        const units = [
            { id: 1, text: 'おはようございます', box_2d: [100, 600, 180, 720] as [number, number, number, number] },
            { id: 2, text: '今日もいい天気ですね', box_2d: [185, 580, 280, 710] as [number, number, number, number] },
            { id: 3, text: 'SONY', box_2d: [900, 450, 940, 550] as [number, number, number, number] },
        ];
        const result = parseOcrImageTranslationResponse(
            JSON.stringify({
                has_text: true,
                regions: [
                    { ids: [1, 2], translation: '早安，今天天氣真好呢' },
                    { ids: [3], translation: 'SONY' },
                ],
            }),
            units,
            30,
            12,
        );

        expect(result).toEqual({
            text: '[1] 早安，今天天氣真好呢',
            hasText: true,
            regions: [
                {
                    box_2d: [100, 580, 280, 720],
                    source: 'おはようございます\n今日もいい天気ですね',
                    translation: '早安，今天天氣真好呢',
                },
            ],
            inputTokens: 30,
            outputTokens: 12,
        });
    });

    it('rejects malformed primary or region output', () => {
        expect(() => parseImageTranslationResponse('not json', 1, 1)).toThrow(
            'Invalid Babel Lens JSON response',
        );
        expect(() =>
            parseImageTranslationResponse('{"has_text":true,"regions":[]}', 1, 1),
        ).toThrow('regions array is required');
        expect(() =>
            parseImageTranslationResponse(
                '{"has_text":true,"regions":[{"box_2d":[0,0,1001,10],"translation":"x"}]}',
                1,
                1,
            ),
        ).toThrow('Invalid Babel Lens region');
        expect(() =>
            parseOcrImageTranslationResponse('{"has_text":true,"regions":["bad"]}', [], 1, 1),
        ).toThrow('Invalid Babel Lens OCR region');
    });
});
