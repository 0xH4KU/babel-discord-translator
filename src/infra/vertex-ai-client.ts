import { configRepository } from '../repositories/config-repository.js';
import { appLogger, type StructuredLogFields } from '../structured-logger.js';
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
    logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
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
    const config = configRepository.getRuntimeConfig();
    const project = config.gcpProject;
    const apiKey = config.vertexAiApiKey;

    if (!project || !apiKey) {
        throw new Error('API not configured. Please complete setup in the dashboard.');
    }

    return {
        apiKey,
        project,
        location: config.gcpLocation || 'global',
        model: config.geminiModel,
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

function classifyVertexAiFailure(value: number | Error): string {
    if (typeof value === 'number') {
        if (value === 429) return 'rate_limit';
        if (value === 401 || value === 403) return 'auth';
        if (value >= 500) return 'server_error';
        if (value >= 400) return 'client_error';
        return 'http_error';
    }

    if (value.name === 'TimeoutError') return 'timeout';
    if (value.message.includes('API not configured')) return 'configuration';
    return 'network_error';
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
        logContext,
    } = typeof config === 'number'
        ? { retries: config }
        : config;
    const logger = appLogger.child({
        component: 'vertex_ai',
        ...logContext,
    });

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
                logger.warn('vertex_ai.retry_scheduled', {
                    operation: logPrefix,
                    attempt: attempt + 1,
                    retries,
                    statusCode: response.status,
                    retryAfterMs: delay,
                    errorType: classifyVertexAiFailure(response.status),
                });
                await sleep(delay);
            }
        } catch (error) {
            if (attempt < retries) {
                const delay = Math.pow(2, attempt) * 500;
                const reason = (error as Error).name === 'TimeoutError' ? 'timeout' : 'network error';
                logger.warn('vertex_ai.retry_scheduled', {
                    operation: logPrefix,
                    attempt: attempt + 1,
                    retries,
                    retryAfterMs: delay,
                    errorType: classifyVertexAiFailure(error as Error),
                    retryReason: reason,
                });
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
        logContext,
    }: {
        maxOutputTokens: number;
        temperature?: number;
        retries?: number;
        timeoutMs?: number;
        logPrefix?: string;
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
    },
): Promise<{ data: VertexAIResponse; latencyMs: number }> {
    const logger = appLogger.child({
        component: 'vertex_ai',
        ...logContext,
    });
    const start = Date.now();
    let config: VertexAiConfig;

    try {
        config = getVertexAiConfig();
    } catch (error) {
        logger.error('vertex_ai.request.failed', {
            operation: logPrefix,
            error: (error as Error).message,
            errorType: classifyVertexAiFailure(error as Error),
            latencyMs: Date.now() - start,
        });
        throw error;
    }

    const url = buildGenerateContentUrl(config);
    logger.info('vertex_ai.request.started', {
        operation: logPrefix,
        model: config.model,
        location: config.location,
        maxOutputTokens,
    });

    let response: Response;
    try {
        response = await fetchWithRetry(url, {
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
        }, {
            retries,
            timeoutMs,
            logPrefix,
            logContext,
        });
    } catch (error) {
        logger.error('vertex_ai.request.failed', {
            operation: logPrefix,
            error: (error as Error).message,
            errorType: classifyVertexAiFailure(error as Error),
            latencyMs: Date.now() - start,
        });
        throw error;
    }

    if (!response.ok) {
        const error = await buildVertexAiError(response);
        logger.error('vertex_ai.request.failed', {
            operation: logPrefix,
            statusCode: response.status,
            error: error.message,
            errorType: classifyVertexAiFailure(response.status),
            latencyMs: Date.now() - start,
        });
        throw error;
    }

    const latencyMs = Date.now() - start;
    logger.info('vertex_ai.request.completed', {
        operation: logPrefix,
        model: config.model,
        location: config.location,
        latencyMs,
    });

    return {
        data: (await response.json()) as VertexAIResponse,
        latencyMs,
    };
}

export async function generateTranslationContent(
    prompt: string,
    maxOutputTokens: number,
    options?: { logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'> },
): Promise<TranslationResult> {
    const { data } = await requestGenerateContent(prompt, {
        maxOutputTokens,
        logPrefix: 'Translate',
        logContext: options?.logContext,
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
            logContext: { command: 'health_check' },
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
    classifyVertexAiFailure,
};
