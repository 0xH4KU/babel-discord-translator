const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const VISION_TIMEOUT_MS = 15_000;

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
    words?: Array<{ symbols?: VisionSymbol[] }>;
}

interface VisionBlock {
    boundingBox?: { vertices?: Array<{ x?: number; y?: number }> };
    blockType?: string;
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
}

interface DetectTextOptions {
    apiKey: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}

function detectedBreak(type?: string): string | undefined {
    if (type === 'SPACE' || type === 'SURE_SPACE') return ' ';
    if (type === 'EOL_SURE_SPACE' || type === 'LINE_BREAK') return '\n';
    if (type === 'HYPHEN') return '-';
    return undefined;
}

function paragraphText(paragraph: VisionParagraph): string {
    const words = paragraph.words ?? [];
    return words
        .map((word) => {
            const symbols = word.symbols ?? [];
            const text = symbols.map((symbol) => symbol.text ?? '').join('');
            const suffix = detectedBreak(symbols.at(-1)?.property?.detectedBreak?.type);
            return text + (suffix ?? '');
        })
        .join('')
        .trim();
}

function blockBounds(block: VisionBlock): Omit<VisionTextRegion, 'text'> | null {
    const points = (block.boundingBox?.vertices ?? []).map((point) => ({
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

function blockText(block: VisionBlock): string {
    return (block.paragraphs ?? []).map(paragraphText).filter(Boolean).join('\n');
}

function isMeaningfulBlockText(text: string): boolean {
    const compact = text.replace(/\s/gu, '');
    // ponytail: short ASCII UI labels are skipped; use OCR confidence if they become important.
    return compact.length > 2 || /[^\u0000-\u007f]/u.test(compact);
}

function parseVisionText(result?: VisionImageResponse): VisionTextResult {
    const annotation = result?.fullTextAnnotation;
    const page = annotation?.pages?.[0];
    const imageWidth = page?.width ?? 0;
    const imageHeight = page?.height ?? 0;
    const blocks =
        page?.blocks?.filter((block) => !block.blockType || block.blockType === 'TEXT') ?? [];
    const recognizedBlocks = blocks
        .map((block) => ({ text: blockText(block), bounds: blockBounds(block) }))
        .filter(({ text }) => isMeaningfulBlockText(text));
    const parsedRegions =
        imageWidth > 0 && imageHeight > 0
            ? recognizedBlocks.flatMap(({ text, bounds }) => {
                  return text && bounds ? [{ text, ...bounds }] : [];
              })
            : [];

    // ponytail: dense OCR falls back to the existing caption instead of drawing 100+ markers.
    const regions = parsedRegions.length <= 99 ? parsedRegions : [];
    const text = (
        recognizedBlocks.map((block) => block.text).join('\n') ||
        (blocks.length === 0
            ? (annotation?.text ?? result?.textAnnotations?.[0]?.description ?? '')
            : '')
    ).trim();
    return { text, imageWidth, imageHeight, regions };
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
                    features: [{ type: 'TEXT_DETECTION' }],
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
