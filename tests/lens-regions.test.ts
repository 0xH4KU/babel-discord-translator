import { describe, expect, it } from 'vitest';
import {
    formatDetectedText,
    extractRegionTranslations,
    normalizeRegionTranslation,
    visionRegionsToBoxes,
    visionResultToOcrUnits,
} from '../src/modules/translation/lens-regions.js';

describe('Babel Lens region markers', () => {
    it('should preserve numbered text without confusing it with region markers', () => {
        const detected = {
            text: 'First [2]\nSecond',
            imageWidth: 100,
            imageHeight: 100,
            regions: [
                { text: 'First [2]', x: 0, y: 0, width: 50, height: 20 },
                { text: 'Second', x: 0, y: 30, width: 50, height: 20 },
            ],
        };

        expect(formatDetectedText(detected)).toBe(
            '[[BABEL_REGION_1]] First [2]\n\n[[BABEL_REGION_2]] Second',
        );
        expect(
            normalizeRegionTranslation('[[BABEL_REGION_1]] 第一 [2]\n[[BABEL_REGION_2]] 第二', 2),
        ).toEqual({
            markersMatch: true,
            displayText: '[1] 第一 [2]\n\n[2] 第二',
        });
    });

    it('should remove protocol markers when the translated sequence is incomplete', () => {
        expect(normalizeRegionTranslation('[[BABEL_REGION_1]] 第一 [9]', 2)).toEqual({
            markersMatch: false,
            displayText: '第一 [9]',
        });
        expect(normalizeRegionTranslation('[[BABEL_REGION_1]] orphaned', 0).displayText).toBe(
            'orphaned',
        );
    });

    it('should normalize Vision boxes and pair translated markers', () => {
        const boxes = visionRegionsToBoxes({
            text: 'one',
            imageWidth: 200,
            imageHeight: 100,
            regions: [{ text: 'one', x: 20, y: 10, width: 80, height: 30 }],
        });

        expect(boxes).toEqual([[100, 100, 400, 500]]);
        expect(extractRegionTranslations('[[BABEL_REGION_1]] translated', boxes)).toEqual([
            { translation: 'translated', box_2d: [100, 100, 400, 500] },
        ]);
        expect(extractRegionTranslations('missing marker', boxes)).toEqual([]);
    });

    it('should derive OCR units from Vision units or regions', () => {
        expect(
            visionResultToOcrUnits({
                text: 'one',
                imageWidth: 200,
                imageHeight: 100,
                regions: [{ text: 'one', x: 20, y: 10, width: 80, height: 30 }],
            }),
        ).toEqual([{ id: 1, text: 'one', box_2d: [100, 100, 400, 500] }]);

        expect(
            visionResultToOcrUnits({
                text: 'preset',
                imageWidth: 100,
                imageHeight: 100,
                regions: [],
                units: [{ id: 1, text: 'preset', box_2d: [10, 20, 30, 40] }],
            }),
        ).toEqual([{ id: 1, text: 'preset', box_2d: [10, 20, 30, 40] }]);
    });
});
