import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { _test, renderLensImage } from '../src/modules/translation/lens-image.js';

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

    it('should draw a numbered region box above the translated caption', async () => {
        const output = await renderLensImage(await sourceImage(), '[1] Translated text', {
            text: 'Source text',
            imageWidth: 320,
            imageHeight: 180,
            regions: [{ text: 'Source text', x: 60, y: 40, width: 120, height: 30 }],
        });
        const rendered = sharp(output);
        const metadata = await rendered.metadata();
        const { data, info } = await rendered.raw().toBuffer({ resolveWithObject: true });
        const pixel = (40 * info.width + 60) * info.channels;

        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(320);
        expect(metadata.height).toBeGreaterThan(180);
        expect([...data.subarray(pixel, pixel + 3)]).not.toEqual([216, 216, 216]);
    });

    it('should append the caption when Vision returns no reliable regions', async () => {
        const output = await renderLensImage(await sourceImage(), 'Translated text\n第二行翻譯');
        const metadata = await sharp(output).metadata();

        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(320);
        expect(metadata.height).toBeGreaterThan(180);
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
        const detected = {
            text: 'Source text',
            imageWidth: 120,
            imageHeight: 60,
            regions: [{ text: 'Source text', x: 10, y: 5, width: 30, height: 15 }],
        };

        expect(_test.orientDetectedText(detected, 6)).toMatchObject({
            imageWidth: 60,
            imageHeight: 120,
            regions: [{ x: 40, y: 10, width: 15, height: 30 }],
        });

        const output = await renderLensImage(image, '[1] Translated text', detected);
        const rendered = sharp(output);
        const metadata = await rendered.metadata();
        const { data, info } = await rendered.raw().toBuffer({ resolveWithObject: true });
        const pixel = (10 * info.width + 40) * info.channels;

        expect(metadata.width).toBe(60);
        expect([...data.subarray(pixel, pixel + 3)]).not.toEqual([216, 216, 216]);
    });
});
