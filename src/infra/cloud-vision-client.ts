const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const VISION_TIMEOUT_MS = 15_000;

interface VisionError {
    code?: number;
    message?: string;
}

interface VisionResponse {
    responses?: Array<{
        fullTextAnnotation?: { text?: string };
        textAnnotations?: Array<{ description?: string }>;
        error?: VisionError;
    }>;
    error?: VisionError;
}

interface DetectTextOptions {
    apiKey: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}

export async function detectTextWithCloudVision(
    image: Buffer,
    { apiKey, fetchImpl = fetch, signal }: DetectTextOptions,
): Promise<string> {
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
    return (
        result?.fullTextAnnotation?.text ?? result?.textAnnotations?.[0]?.description ?? ''
    ).trim();
}

export const _test = { VISION_ENDPOINT, VISION_TIMEOUT_MS };
