import type { OcrTextUnit } from '../shared/types.js';

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const VISION_TIMEOUT_MS = 15_000;
const MIN_BLOCK_CONFIDENCE = 0.7;
const MAX_OCR_UNITS = 250;

interface VisionError {
    code?: number;
    message?: string;
}

interface VisionSymbol {
    text?: string;
    property?: { detectedBreak?: { type?: string } };
}

interface VisionParagraph {
    boundingBox?: { vertices?: Array<{ x?: number; y?: number }> };
    confidence?: number;
    words?: Array<{ symbols?: VisionSymbol[] }>;
}

interface VisionBlock {
    boundingBox?: { vertices?: Array<{ x?: number; y?: number }> };
    blockType?: string;
    confidence?: number;
    paragraphs?: VisionParagraph[];
}

interface VisionPage {
    width?: number;
    height?: number;
    blocks?: VisionBlock[];
}

interface VisionImageResponse {
    fullTextAnnotation?: { text?: string; pages?: VisionPage[] };
    textAnnotations?: Array<{ description?: string }>;
    error?: VisionError;
}

interface VisionResponse {
    responses?: VisionImageResponse[];
    error?: VisionError;
}

export interface VisionTextRegion {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface VisionTextResult {
    text: string;
    imageWidth: number;
    imageHeight: number;
    regions: VisionTextRegion[];
    units?: OcrTextUnit[];
}

interface DetectTextOptions {
    apiKey: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}

function detectedBreak(type?: string): string {
    if (type === 'SPACE' || type === 'SURE_SPACE') return ' ';
    if (type === 'EOL_SURE_SPACE' || type === 'LINE_BREAK') return '\n';
    if (type === 'HYPHEN') return '-';
    return '';
}

function paragraphText(paragraph: VisionParagraph): string {
    const words = paragraph.words ?? [];
    return words
        .map((word) =>
            (word.symbols ?? [])
                .map(
                    (symbol) =>
                        `${symbol.text ?? ''}${detectedBreak(symbol.property?.detectedBreak?.type)}`,
                )
                .join(''),
        )
        .join('')
        .trim();
}

function polygonBounds(
    vertices?: Array<{ x?: number; y?: number }>,
): Omit<VisionTextRegion, 'text'> | null {
    const points = (vertices ?? []).map((point) => ({
        x: point.x ?? 0,
        y: point.y ?? 0,
    }));
    if (points.length < 2) return null;

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function boundsToBox2d(
    bounds: Omit<VisionTextRegion, 'text'>,
    imageWidth: number,
    imageHeight: number,
): [number, number, number, number] | null {
    if (imageWidth <= 0 || imageHeight <= 0) return null;
    const scale = (value: number, size: number) =>
        Math.min(1000, Math.max(0, Math.round((value / size) * 1000)));
    const ymin = scale(bounds.y, imageHeight);
    const xmin = scale(bounds.x, imageWidth);
    const ymax = scale(bounds.y + bounds.height, imageHeight);
    const xmax = scale(bounds.x + bounds.width, imageWidth);
    return ymin < ymax && xmin < xmax ? [ymin, xmin, ymax, xmax] : null;
}

function isMeaningfulBlockText(text: string, confidence?: number): boolean {
    const compact = text.replace(/\s/gu, '');
    if (confidence !== undefined && confidence < MIN_BLOCK_CONFIDENCE) return false;
    return (
        compact.length > 1 || (/[^\u0000-\u007f]/u.test(compact) && /[\p{L}\p{N}]/u.test(compact))
    );
}

function parseVisionText(result?: VisionImageResponse): VisionTextResult {
    const annotation = result?.fullTextAnnotation;
    const page = annotation?.pages?.[0];
    const imageWidth = page?.width ?? 0;
    const imageHeight = page?.height ?? 0;
    const blocks =
        page?.blocks?.filter((block) => !block.blockType || block.blockType === 'TEXT') ?? [];

    const recognizedTexts: string[] = [];
    const regions: VisionTextRegion[] = [];
    const units: OcrTextUnit[] = [];
    let allRecognizedBounded = true;

    const pushBounded = (text: string, bounds: Omit<VisionTextRegion, 'text'> | null) => {
        recognizedTexts.push(text);
        if (!bounds || imageWidth <= 0 || imageHeight <= 0) {
            allRecognizedBounded = false;
            return;
        }
        const box2d = boundsToBox2d(bounds, imageWidth, imageHeight);
        if (!box2d) {
            allRecognizedBounded = false;
            return;
        }
        regions.push({ text, ...bounds });
        if (units.length < MAX_OCR_UNITS) {
            units.push({ id: units.length + 1, text, box_2d: box2d });
        }
    };

    for (const block of blocks) {
        if (block.confidence !== undefined && block.confidence < MIN_BLOCK_CONFIDENCE) continue;
        const paragraphs = block.paragraphs ?? [];
        const hasParagraphBoxes = paragraphs.some((p) => (p.boundingBox?.vertices?.length ?? 0) >= 2);

        if (hasParagraphBoxes) {
            for (const paragraph of paragraphs) {
                const text = paragraphText(paragraph);
                if (!isMeaningfulBlockText(text, paragraph.confidence ?? block.confidence)) continue;
                pushBounded(
                    text,
                    polygonBounds(paragraph.boundingBox?.vertices ?? block.boundingBox?.vertices),
                );
            }
        } else {
            const text = paragraphs.map(paragraphText).filter(Boolean).join('\n');
            if (!isMeaningfulBlockText(text, block.confidence)) continue;
            pushBounded(text, polygonBounds(block.boundingBox?.vertices));
        }
    }

    const text = (
        recognizedTexts.join('\n') ||
        (blocks.length === 0
            ? (annotation?.text ?? result?.textAnnotations?.[0]?.description ?? '')
            : '')
    ).trim();

    return {
        text,
        imageWidth,
        imageHeight,
        regions: allRecognizedBounded ? regions : [],
        units: allRecognizedBounded ? units : [],
    };
}

export async function detectTextWithCloudVision(
    image: Buffer,
    { apiKey, fetchImpl = fetch, signal }: DetectTextOptions,
): Promise<VisionTextResult> {
    if (!apiKey) throw new Error('Cloud Vision API key is not configured');
    if (image.length === 0) throw new Error('Image is empty');

    const timeoutSignal = AbortSignal.timeout(VISION_TIMEOUT_MS);
    const response = await fetchImpl(VISION_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            requests: [
                {
                    image: { content: image.toString('base64') },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                    imageContext: {
                        textDetectionParams: { enableTextDetectionConfidenceScore: true },
                    },
                },
            ],
        }),
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });

    let data: VisionResponse;
    try {
        data = (await response.json()) as VisionResponse;
    } catch {
        throw new Error(`Cloud Vision returned an invalid response (${response.status})`);
    }

    const providerError = data.error ?? data.responses?.[0]?.error;
    if (!response.ok || providerError) {
        const detail = providerError?.message?.trim();
        throw new Error(
            detail
                ? `Cloud Vision request failed: ${detail}`
                : `Cloud Vision request failed (${response.status})`,
        );
    }

    const result = data.responses?.[0];
    return parseVisionText(result);
}

export const _test = {
    VISION_ENDPOINT,
    VISION_TIMEOUT_MS,
    parseVisionText,
    isMeaningfulBlockText,
};
