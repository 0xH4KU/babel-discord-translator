import type { TranslationProvider, TranslateOptions } from './provider-orchestrator.js';
import { configRepository, type RuntimeConfig } from '../modules/config/config-repository.js';
import { appLogger, type StructuredLogFields } from '../shared/structured-logger.js';
import {
    buildProviderHttpError,
    classifyProviderFailure,
    DEFAULT_PROVIDER_MAX_RETRIES,
    DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
    estimateTokenCount,
    fetchProviderWithRetry,
    normalizeProviderTokenCount,
} from './provider-http.js';
import type { TranslationPrompt, TranslationResult, VertexAIResponse } from '../shared/types.js';

export { ProviderHttpError } from './provider-errors.js';

const MAX_RETRIES = DEFAULT_PROVIDER_MAX_RETRIES;
const REQUEST_TIMEOUT_MS = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;

interface VertexAiConfig {
    apiKey: string;
    project: string;
    location: string;
    model: string;
}

export interface VertexAiHealthStatus {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
}

function getVertexAiConfig(runtimeConfig?: RuntimeConfig): VertexAiConfig {
    const config = runtimeConfig ?? configRepository.getRuntimeConfig();
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

const classifyVertexAiFailure = classifyProviderFailure;

async function buildVertexAiError(response: Response): Promise<Error> {
    return buildProviderHttpError('vertex', response);
}

async function requestGenerateContent(
    prompt: string | TranslationPrompt,
    {
        maxOutputTokens,
        temperature = 0.1,
        retries = MAX_RETRIES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        logPrefix = 'VertexAI',
        logContext,
        runtimeConfig,
        signal,
    }: {
        maxOutputTokens: number;
        temperature?: number;
        retries?: number;
        timeoutMs?: number;
        logPrefix?: string;
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
        runtimeConfig?: RuntimeConfig;
        signal?: AbortSignal;
    },
): Promise<{ data: VertexAIResponse; latencyMs: number }> {
    const logger = appLogger.child({
        component: 'vertex_ai',
        ...logContext,
    });
    const start = Date.now();
    let config: VertexAiConfig;

    try {
        config = getVertexAiConfig(runtimeConfig);
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
        response = await fetchProviderWithRetry(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': config.apiKey,
                },
                body: JSON.stringify({
                    ...(typeof prompt === 'string'
                        ? {}
                        : { systemInstruction: { parts: [{ text: prompt.system }] } }),
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: typeof prompt === 'string' ? prompt : prompt.user }],
                        },
                    ],
                    generationConfig: {
                        maxOutputTokens,
                        temperature,
                    },
                }),
            },
            {
                provider: 'vertex',
                retries,
                timeoutMs,
                signal,
                logPrefix,
                logContext,
            },
        );
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
    prompt: TranslationPrompt,
    maxOutputTokens: number,
    options?: TranslateOptions,
): Promise<TranslationResult> {
    const { data } = await requestGenerateContent(prompt, {
        maxOutputTokens,
        logPrefix: 'Translate',
        logContext: options?.logContext,
        runtimeConfig: options?.runtimeConfig,
        signal: options?.signal,
    });

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!result) {
        throw new Error('Empty response from Gemini');
    }

    const meta = data.usageMetadata || {};
    return {
        text: result,
        inputTokens: normalizeProviderTokenCount(
            meta.promptTokenCount,
            estimateTokenCount(`${prompt.system}\n${prompt.user}`),
        ),
        outputTokens: normalizeProviderTokenCount(
            meta.candidatesTokenCount,
            estimateTokenCount(result),
        ),
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

export function isVertexAiConfigured(runtimeConfig?: RuntimeConfig): boolean {
    const config = runtimeConfig ?? configRepository.getRuntimeConfig();
    return !!(config.vertexAiApiKey && config.gcpProject);
}

export function createVertexAiProvider(): TranslationProvider {
    return {
        name: 'vertex',
        async translate(
            prompt: TranslationPrompt,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<TranslationResult> {
            return generateTranslationContent(prompt, maxOutputTokens, options);
        },
        isConfigured(options?: TranslateOptions): boolean {
            return isVertexAiConfigured(options?.runtimeConfig);
        },
    };
}

export const _test = {
    buildGenerateContentUrl,
    getVertexAiConfig,
    buildVertexAiError,
    classifyVertexAiFailure,
};
