import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
    _test,
    normalizeLensImage,
    renderLensImage,
} from '../src/modules/translation/lens-image.js';

describe('Babel Lens image rendering', () => {
    const sourceImage = () =>
        sharp({
            create: {
                width: 320,
                height: 180,
                channels: 3,
                background: '#d8d8d8',
            },
        })
            .png()
            .toBuffer();

    it('should draw numbered region boxes directly on the image without stretching height', async () => {
        const output = await renderLensImage(await sourceImage(), [
            { translation: 'Translated text', box_2d: [222, 188, 389, 563] },
        ]);
        const rendered = sharp(output);
        const metadata = await rendered.metadata();
        const { data, info } = await rendered.raw().toBuffer({ resolveWithObject: true });
        const pixel = (40 * info.width + 60) * info.channels;

        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(320);
        expect(metadata.height).toBe(180);
        expect([...data.subarray(pixel, pixel + 3)]).not.toEqual([216, 216, 216]);
    });

    it('should nudge colliding region badges so stacked boxes remain readable', () => {
        const layout = _test.computeRegionBoxLayout(400, 300, [
            { translation: 'First', box_2d: [100, 100, 150, 500] },
            { translation: 'Second', box_2d: [105, 100, 160, 500] },
        ]);

        expect(layout).toHaveLength(2);
        expect(layout[1]!.nudged).toBe(true);
        expect(Math.abs(layout[1]!.labelY - layout[0]!.labelY)).toBeGreaterThanOrEqual(
            layout[0]!.labelHeight,
        );
    });

    it('should pre-scale oversized images during normalization while preserving small images', async () => {
        const large = await sharp({
            create: {
                width: 3600,
                height: 2400,
                channels: 3,
                background: '#cccccc',
            },
        })
            .jpeg()
            .toBuffer();

        const normalized = await normalizeLensImage(large);
        expect(normalized.width).toBeLessThanOrEqual(_test.MAX_NORMALIZED_EDGE);
        expect(normalized.width * normalized.height).toBeLessThanOrEqual(
            _test.MAX_NORMALIZED_AREA + 4000,
        );
    });

    it('should keep region boxes aligned after EXIF auto-orientation', async () => {
        const image = await sharp({
            create: {
                width: 120,
                height: 60,
                channels: 3,
                background: '#d8d8d8',
            },
        })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();
        const normalized = await normalizeLensImage(image);
        expect(normalized).toMatchObject({ width: 60, height: 120, mimeType: 'image/jpeg' });
        expect((await sharp(normalized.image).metadata()).orientation).toBeUndefined();

        const output = await renderLensImage(normalized.image, [
            { translation: 'Translated text', box_2d: [83, 667, 333, 917] },
        ]);
        const rendered = sharp(output);
        const metadata = await rendered.metadata();
        const { data, info } = await rendered.raw().toBuffer({ resolveWithObject: true });
        const pixel = (10 * info.width + 40) * info.channels;

        expect(metadata.width).toBe(60);
        expect(metadata.height).toBe(120);
        expect([...data.subarray(pixel, pixel + 3)]).not.toEqual([216, 216, 216]);
    });
});
