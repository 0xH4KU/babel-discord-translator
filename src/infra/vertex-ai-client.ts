import { store } from '../store.js';
import type { TranslationResult, VertexAIResponse } from '../types.js';

const RETRY_CODES = [429, 500, 502, 503];
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;

interface VertexAiConfig {
    apiKey: string;
    project: string;
    location: string;
    model: string;
}

interface FetchWithRetryOptions {
    retries?: number;
    timeoutMs?: number;
    logPrefix?: string;
}

export interface VertexAiHealthStatus {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVertexAiConfig(): VertexAiConfig {
    const project = store.get('gcpProject');
    const apiKey = store.get('vertexAiApiKey');

    if (!project || !apiKey) {
        throw new Error('API not configured. Please complete setup in the dashboard.');
    }

    return {
        apiKey,
        project,
        location: store.get('gcpLocation') || 'global',
        model: store.get('geminiModel'),
    };
}

function buildGenerateContentUrl({ project, location, model }: VertexAiConfig): string {
    const baseUrl =
        location === 'global'
            ? 'https://aiplatform.googleapis.com'
            : `https://${location}-aiplatform.googleapis.com`;

    return `${baseUrl}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function buildTimeoutSignal(timeoutMs: number): AbortSignal {
    return AbortSignal.timeout(timeoutMs);
}

export async function fetchWithRetry(
    url: string,
    options: RequestInit,
    config: FetchWithRetryOptions | number = {},
): Promise<Response> {
    const {
        retries = MAX_RETRIES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        logPrefix = 'VertexAI',
    } = typeof config === 'number'
        ? { retries: config }
        : config;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: buildTimeoutSignal(timeoutMs),
            });

            if (response.ok || !RETRY_CODES.includes(response.status)) {
                return response;
            }

            if (attempt < retries) {
                const delay = Math.pow(2, attempt) * 500;
                console.warn(`[${logPrefix}] Retry ${attempt + 1}/${retries} after ${response.status}, waiting ${delay}ms`);
                await sleep(delay);
            }
        } catch (error) {
            if (attempt < retries) {
                const delay = Math.pow(2, attempt) * 500;
                const reason = (error as Error).name === 'TimeoutError' ? 'timeout' : 'network error';
                console.warn(`[${logPrefix}] Retry ${attempt + 1}/${retries} after ${reason}, waiting ${delay}ms`);
                await sleep(delay);
            } else {
                throw error;
            }
        }
    }

    return fetch(url, {
        ...options,
        signal: buildTimeoutSignal(timeoutMs),
    });
}

async function buildVertexAiError(response: Response): Promise<Error> {
    const body = (await response.text()).replace(/\s+/g, ' ').trim();
    const detail = body || response.statusText || 'Request failed';
    return new Error(`Vertex AI ${response.status}: ${detail.slice(0, 200)}`);
}

async function requestGenerateContent(
    prompt: string,
    {
        maxOutputTokens,
        temperature = 0.1,
        retries = MAX_RETRIES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        logPrefix = 'VertexAI',
    }: {
        maxOutputTokens: number;
        temperature?: number;
        retries?: number;
        timeoutMs?: number;
        logPrefix?: string;
    },
): Promise<{ data: VertexAIResponse; latencyMs: number }> {
    const config = getVertexAiConfig();
    const url = buildGenerateContentUrl(config);
    const start = Date.now();

    const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens,
                temperature,
            },
        }),
    }, { retries, timeoutMs, logPrefix });

    if (!response.ok) {
        throw await buildVertexAiError(response);
    }

    return {
        data: (await response.json()) as VertexAIResponse,
        latencyMs: Date.now() - start,
    };
}

export async function generateTranslationContent(prompt: string, maxOutputTokens: number): Promise<TranslationResult> {
    const { data } = await requestGenerateContent(prompt, {
        maxOutputTokens,
        logPrefix: 'Translate',
    });

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!result) {
        throw new Error('Empty response from Gemini');
    }

    const meta = data.usageMetadata || {};
    return {
        text: result,
        inputTokens: meta.promptTokenCount || 0,
        outputTokens: meta.candidatesTokenCount || 0,
    };
}

export async function checkVertexAiHealth(): Promise<VertexAiHealthStatus> {
    try {
        const { latencyMs } = await requestGenerateContent('hi', {
            maxOutputTokens: 5,
            retries: 0,
            timeoutMs: REQUEST_TIMEOUT_MS,
            logPrefix: 'VertexAI Health',
        });

        return {
            healthy: true,
            latencyMs,
        };
    } catch (error) {
        return {
            healthy: false,
            error: (error as Error).message,
        };
    }
}

export const _test = {
    buildGenerateContentUrl,
    getVertexAiConfig,
    buildVertexAiError,
};
