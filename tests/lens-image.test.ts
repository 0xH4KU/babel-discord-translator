import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderLensImage } from '../src/modules/translation/lens-image.js';

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

    it('should mark numbered OCR regions without changing the image layout', async () => {
        const output = await renderLensImage(await sourceImage(), '[1] Translated text', {
            text: 'Source text',
            imageWidth: 320,
            imageHeight: 180,
            regions: [{ text: 'Source text', x: 60, y: 40, width: 120, height: 30 }],
        });
        const rendered = sharp(output);
        const metadata = await rendered.metadata();
        const { data, info } = await rendered.raw().toBuffer({ resolveWithObject: true });
        const pixel = (51 * info.width + 43) * info.channels;

        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(320);
        expect(metadata.height).toBe(180);
        expect([...data.subarray(pixel, pixel + 3)]).not.toEqual([216, 216, 216]);
    });

    it('should append the caption when Vision returns no reliable regions', async () => {
        const output = await renderLensImage(
            await sourceImage(),
            'Translated text\n第二行翻譯',
        );
        const metadata = await sharp(output).metadata();

        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(320);
        expect(metadata.height).toBeGreaterThan(180);
    });
});
