import sharp from 'sharp';
import type { VisionTextResult } from '../../infra/cloud-vision-client.js';

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_EDGE = 1600;

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

function orientDetectedText(detected: VisionTextResult, orientation = 1): VisionTextResult {
    if (orientation < 2 || orientation > 8) return detected;

    const { imageWidth: width, imageHeight: height } = detected;
    const regions = detected.regions.map((region) => {
        const right = region.x + region.width;
        const bottom = region.y + region.height;
        switch (orientation) {
            case 2:
                return { ...region, x: width - right };
            case 3:
                return { ...region, x: width - right, y: height - bottom };
            case 4:
                return { ...region, y: height - bottom };
            case 5:
                return {
                    ...region,
                    x: region.y,
                    y: region.x,
                    width: region.height,
                    height: region.width,
                };
            case 6:
                return {
                    ...region,
                    x: height - bottom,
                    y: region.x,
                    width: region.height,
                    height: region.width,
                };
            case 7:
                return {
                    ...region,
                    x: height - bottom,
                    y: width - right,
                    width: region.height,
                    height: region.width,
                };
            case 8:
                return {
                    ...region,
                    x: region.y,
                    y: width - right,
                    width: region.height,
                    height: region.width,
                };
            default:
                return region;
        }
    });

    return {
        ...detected,
        imageWidth: orientation >= 5 ? height : width,
        imageHeight: orientation >= 5 ? width : height,
        regions,
    };
}

function buildRegionBoxesSvg(
    width: number,
    height: number,
    detected: VisionTextResult,
): Buffer | null {
    if (detected.regions.length === 0 || detected.imageWidth <= 0 || detected.imageHeight <= 0) {
        return null;
    }

    const scaleX = width / detected.imageWidth;
    const scaleY = height / detected.imageHeight;
    const strokeWidth = clamp(Math.round(Math.min(width, height) / 400), 2, 4);
    const labelHeight = clamp(Math.round(Math.min(width, height) / 20), 24, 40);
    const boxes = detected.regions
        .map((region, index) => {
            const label = String(index + 1);
            const x = clamp(Math.round(region.x * scaleX), 1, width - 2);
            const y = clamp(Math.round(region.y * scaleY), 1, height - 2);
            const boxWidth = clamp(Math.round(region.width * scaleX), 1, width - x - 1);
            const boxHeight = clamp(Math.round(region.height * scaleY), 1, height - y - 1);
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

export async function renderLensImage(
    image: Buffer,
    translatedText: string,
    detected?: VisionTextResult,
): Promise<Buffer> {
    const { orientation } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
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
    const boxes = detected
        ? buildRegionBoxesSvg(width, height, orientDetectedText(detected, orientation))
        : null;
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

export const _test = { wrapCaption, buildCaptionSvg, buildRegionBoxesSvg, orientDetectedText };
