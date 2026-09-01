import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { ImageTranslationRequest, LensRegion } from '../../shared/types.js';

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_EDGE = 1600;
const MIME_BY_FORMAT = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
} as const;

sharp.cache({ memory: 16, files: 0, items: 16 });
sharp.concurrency(1);

function xmlEscape(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function characterWidth(character: string): number {
    if (/\s/u.test(character)) return 0.35;
    return /^[\u0000-\u024f\u0400-\u052f]$/u.test(character) ? 0.58 : 1;
}

function splitLongLine(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = '';
    let width = 0;
    let lastSpace = -1;

    for (const character of text) {
        const nextWidth = width + characterWidth(character);
        if (line && nextWidth > maxWidth) {
            if (lastSpace > 0) {
                lines.push(line.slice(0, lastSpace).trimEnd());
                line = line.slice(lastSpace + 1) + character;
            } else {
                lines.push(line);
                line = character;
            }
            width = [...line].reduce((total, item) => total + characterWidth(item), 0);
            lastSpace = line.lastIndexOf(' ');
            continue;
        }

        line += character;
        width = nextWidth;
        if (/\s/u.test(character)) lastSpace = line.length - 1;
    }

    lines.push(line.trimEnd());
    return lines;
}

function wrapCaption(text: string, maxWidth: number): string[] {
    return text.split(/\r?\n/u).flatMap((line) => (line ? splitLongLine(line, maxWidth) : ['']));
}

function buildCaptionSvg(width: number, text: string): { image: Buffer; height: number } {
    const padding = Math.max(20, Math.round(width * 0.04));
    const fontSize = Math.max(18, Math.min(36, Math.round(width / 40)));
    const lineHeight = Math.round(fontSize * 1.45);
    const maxLineWidth = Math.max((width - padding * 2) / fontSize, 1);
    const lines = wrapCaption(text.trim(), maxLineWidth);
    const height = Math.max(padding * 2 + lines.length * lineHeight, fontSize + padding * 2);
    const renderedLines = lines
        .map(
            (line, index) =>
                `<text x="${padding}" y="${padding + fontSize + index * lineHeight}">${xmlEscape(line)}</text>`,
        )
        .join('');

    return {
        height,
        image: Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                <rect width="100%" height="100%" fill="#111315"/>
                <g fill="#f7f7f5" font-family="Noto Sans, Noto Sans CJK TC, sans-serif"
                   font-size="${fontSize}" font-weight="500" xml:space="preserve">
                    ${renderedLines}
                </g>
            </svg>
        `),
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function buildRegionBoxesSvg(
    width: number,
    height: number,
    regions: LensRegion[],
): Buffer | null {
    if (regions.length === 0) return null;

    const strokeWidth = clamp(Math.round(Math.min(width, height) / 400), 2, 4);
    const labelHeight = clamp(Math.round(Math.min(width, height) / 20), 24, 40);
    const boxes = regions
        .map((region, index) => {
            const label = String(index + 1);
            const [ymin, xmin, ymax, xmax] = region.box_2d;
            const x = clamp(Math.round((xmin / 1000) * width), 1, width - 2);
            const y = clamp(Math.round((ymin / 1000) * height), 1, height - 2);
            const boxWidth = clamp(
                Math.round(((xmax - xmin) / 1000) * width),
                1,
                width - x - 1,
            );
            const boxHeight = clamp(
                Math.round(((ymax - ymin) / 1000) * height),
                1,
                height - y - 1,
            );
            const labelWidth = Math.max(
                labelHeight,
                Math.round(labelHeight * (0.75 + label.length * 0.45)),
            );
            const hasLeftSpace = x >= labelWidth + 3;
            const labelX = clamp(hasLeftSpace ? x - labelWidth : x, 1, width - labelWidth - 1);
            const labelY = hasLeftSpace ? y : y >= labelHeight + 3 ? y - labelHeight : y;
            const fontSize = Math.round(labelHeight * (label.length > 1 ? 0.43 : 0.55));
            return `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="3" fill="none" stroke="#5865f2" stroke-width="${strokeWidth}"/><rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="3" fill="#5865f2" stroke="#ffffff" stroke-width="${strokeWidth}"/><text x="${labelX + labelWidth / 2}" y="${labelY + labelHeight / 2 + Math.round(fontSize * 0.35)}" text-anchor="middle" fill="#ffffff" font-family="Noto Sans, sans-serif" font-size="${fontSize}" font-weight="700">${label}</text>`;
        })
        .join('');

    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${boxes}</svg>`,
    );
}

export interface NormalizedLensImage {
    image: Buffer;
    mimeType: ImageTranslationRequest['mimeType'];
    width: number;
    height: number;
    hash: string;
}

export async function normalizeLensImage(image: Buffer): Promise<NormalizedLensImage> {
    const source = sharp(image, { limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await source.metadata();
    const mimeType = MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT];
    if (!mimeType) throw new Error('Babel Lens only accepts PNG, JPEG, or WebP images.');
    if (!metadata.width || !metadata.height) throw new Error('Could not read the image dimensions.');
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
        throw new Error('Babel Lens supports images up to 16 megapixels.');
    }

    let pipeline = source.rotate();
    if (metadata.format === 'jpeg') pipeline = pipeline.jpeg({ quality: 92 });
    else if (metadata.format === 'png') pipeline = pipeline.png();
    else pipeline = pipeline.webp({ quality: 92 });
    const normalized = await pipeline.toBuffer({ resolveWithObject: true });

    return {
        image: normalized.data,
        mimeType,
        width: normalized.info.width,
        height: normalized.info.height,
        hash: createHash('sha256').update(normalized.data).digest('hex'),
    };
}

export async function renderLensImage(
    image: Buffer,
    translatedText: string,
    regions: LensRegion[] = [],
): Promise<Buffer> {
    const normalized = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({
            width: MAX_OUTPUT_EDGE,
            height: MAX_OUTPUT_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .jpeg({ quality: 88 })
        .toBuffer({ resolveWithObject: true });
    const { width, height } = normalized.info;
    const boxes = buildRegionBoxesSvg(width, height, regions);
    const caption = buildCaptionSvg(width, translatedText);

    return sharp({
        create: {
            width,
            height: height + caption.height,
            channels: 3,
            background: '#111315',
        },
    })
        .composite([
            { input: normalized.data, left: 0, top: 0 },
            ...(boxes ? [{ input: boxes, left: 0, top: 0 }] : []),
            { input: caption.image, left: 0, top: height },
        ])
        .jpeg({ quality: 88 })
        .toBuffer();
}

export const _test = { wrapCaption, buildCaptionSvg, buildRegionBoxesSvg };
