import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { ImageTranslationRequest, LensRegion } from '../../shared/types.js';

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_NORMALIZED_EDGE = 3200;
const MAX_NORMALIZED_AREA = 1600 * 1600;
const MAX_OUTPUT_EDGE = 1600;
const MIME_BY_FORMAT = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
} as const;

sharp.cache({ memory: 16, files: 0, items: 16 });
sharp.concurrency(1);

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export interface RegionBoxLayoutItem {
    index: number;
    label: string;
    x: number;
    y: number;
    boxWidth: number;
    boxHeight: number;
    labelX: number;
    labelY: number;
    labelWidth: number;
    labelHeight: number;
    fontSize: number;
    strokeWidth: number;
    nudged: boolean;
}

function computeRegionBoxLayout(
    width: number,
    height: number,
    regions: LensRegion[],
): RegionBoxLayoutItem[] {
    if (regions.length === 0 || width <= 4 || height <= 4) return [];

    const strokeWidth = clamp(Math.round(Math.min(width, height) / 360), 2, 4);
    const labelHeight = clamp(Math.round(Math.min(width, height) / 20), 22, 36);
    const items: RegionBoxLayoutItem[] = [];

    regions.forEach((region, index) => {
        const label = String(index + 1);
        const [ymin, xmin, ymax, xmax] = region.box_2d;
        const x = clamp(Math.round((xmin / 1000) * width), 1, width - 2);
        const y = clamp(Math.round((ymin / 1000) * height), 1, height - 2);
        const boxWidth = clamp(Math.round(((xmax - xmin) / 1000) * width), 1, width - x - 1);
        const boxHeight = clamp(Math.round(((ymax - ymin) / 1000) * height), 1, height - y - 1);
        const labelWidth = Math.max(
            labelHeight,
            Math.round(labelHeight * (0.72 + label.length * 0.42)),
        );
        const maxLabelX = Math.max(1, width - labelWidth - 1);
        const maxLabelY = Math.max(1, height - labelHeight - 1);
        const hasLeftSpace = x >= labelWidth + 3;
        let labelX = clamp(hasLeftSpace ? x - labelWidth : x, 1, maxLabelX);
        let labelY = clamp(
            hasLeftSpace ? y : y >= labelHeight + 3 ? y - labelHeight : y,
            1,
            maxLabelY,
        );
        let nudged = false;

        for (let pass = 0; pass < 6; pass += 1) {
            const hit = items.find(
                (placed) =>
                    Math.abs(labelX - placed.labelX) < (labelWidth + placed.labelWidth) / 2 + 2 &&
                    Math.abs(labelY - placed.labelY) < labelHeight + 2,
            );
            if (!hit) break;
            nudged = true;
            const nextY = hit.labelY + labelHeight + 2;
            if (nextY <= maxLabelY) {
                labelY = nextY;
            } else {
                labelX = clamp(hit.labelX + hit.labelWidth + 2, 1, maxLabelX);
                labelY = clamp(y, 1, maxLabelY);
            }
        }

        const fontSize = Math.round(labelHeight * (label.length > 1 ? 0.45 : 0.55));
        items.push({
            index: index + 1,
            label,
            x,
            y,
            boxWidth,
            boxHeight,
            labelX,
            labelY,
            labelWidth,
            labelHeight,
            fontSize,
            strokeWidth,
            nudged,
        });
    });

    return items;
}

function buildRegionBoxesSvg(
    width: number,
    height: number,
    regions: LensRegion[],
): Buffer | null {
    const items = computeRegionBoxLayout(width, height, regions);
    if (items.length === 0) return null;

    const boxes = items
        .map(
            ({
                x,
                y,
                boxWidth,
                boxHeight,
                strokeWidth,
                labelX,
                labelY,
                labelWidth,
                labelHeight,
                fontSize,
                label,
            }) =>
                `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="3" fill="none" stroke="#5865f2" stroke-width="${strokeWidth}"/><rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="3" fill="#5865f2" stroke="#ffffff" stroke-width="${strokeWidth}"/><text x="${labelX + labelWidth / 2}" y="${labelY + labelHeight / 2 + Math.round(fontSize * 0.35)}" text-anchor="middle" fill="#ffffff" font-family="Noto Sans, sans-serif" font-size="${fontSize}" font-weight="700">${label}</text>`,
        )
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

    const swapped = (metadata.orientation ?? 0) >= 5 && (metadata.orientation ?? 0) <= 8;
    const orientedWidth = swapped ? metadata.height : metadata.width;
    const orientedHeight = swapped ? metadata.width : metadata.height;
    const edgeScale = Math.min(1, MAX_NORMALIZED_EDGE / Math.max(orientedWidth, orientedHeight));
    const areaScale = Math.min(1, Math.sqrt(MAX_NORMALIZED_AREA / (orientedWidth * orientedHeight)));
    const scale = Math.min(edgeScale, areaScale);

    let pipeline = source.rotate();
    if (scale < 1) {
        pipeline = pipeline.resize({
            width: Math.max(1, Math.round(orientedWidth * scale)),
            height: Math.max(1, Math.round(orientedHeight * scale)),
            fit: 'inside',
            withoutEnlargement: true,
        });
    }
    if (metadata.format === 'jpeg') pipeline = pipeline.jpeg({ quality: 90 });
    else if (metadata.format === 'png') pipeline = pipeline.png();
    else pipeline = pipeline.webp({ quality: 90 });
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
    if (!boxes) return normalized.data;

    return sharp(normalized.data)
        .composite([{ input: boxes, left: 0, top: 0 }])
        .jpeg({ quality: 88 })
        .toBuffer();
}

export const _test = {
    computeRegionBoxLayout,
    buildRegionBoxesSvg,
    MAX_NORMALIZED_EDGE,
    MAX_NORMALIZED_AREA,
};
