import sharp from 'sharp';

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_EDGE = 1600;
const MAX_CAPTION_LINES = 60;
const MAX_RENDERED_TEXT_CHARS = 2000;

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
    const renderText =
        text.length > MAX_RENDERED_TEXT_CHARS
            ? `${text.slice(0, MAX_RENDERED_TEXT_CHARS)}...`
            : text;
    const lines = renderText
        .split(/\r?\n/u)
        .flatMap((line) => (line ? splitLongLine(line, maxWidth) : ['']));

    if (lines.length <= MAX_CAPTION_LINES) return lines;

    // ponytail: keep the image bounded; the Discord reply still contains the full translation.
    return [...lines.slice(0, MAX_CAPTION_LINES - 1), '...'];
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

export async function renderLensImage(image: Buffer, translatedText: string): Promise<Buffer> {
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
            { input: caption.image, left: 0, top: height },
        ])
        .jpeg({ quality: 88 })
        .toBuffer();
}

export const _test = { wrapCaption, buildCaptionSvg };
