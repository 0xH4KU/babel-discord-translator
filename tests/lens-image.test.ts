import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderLensImage } from '../src/modules/translation/lens-image.js';

describe('Babel Lens image rendering', () => {
    it('should append a translated caption panel to a bounded JPEG', async () => {
        const source = await sharp({
            create: {
                width: 320,
                height: 180,
                channels: 3,
                background: '#d8d8d8',
            },
        })
            .png()
            .toBuffer();

        const output = await renderLensImage(source, 'Translated text\n第二行翻譯');
        const metadata = await sharp(output).metadata();

        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(320);
        expect(metadata.height).toBeGreaterThan(180);
    });
});
