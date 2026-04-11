import { configRepository } from '../modules/config/config-repository.js';
import { appLogger, type StructuredLogFields } from '../shared/structured-logger.js';
import type { TranslationProvider, TranslateOptions } from './provider-orchestrator.js';
import type { OpenAIChatResponse, TranslationResult } from '../types.js';

const RETRY_CODES = [429, 500, 502, 503];
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10_000;

interface OpenAiConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

interface FetchWithRetryOptions {
    retries?: number;
    timeoutMs?: number;
    logPrefix?: string;
    logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
}

export interface OpenAiHealthStatus {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOpenAiConfig(): OpenAiConfig {
    const config = configRepository.getRuntimeConfig();
    const apiKey = config.openaiApiKey;
    const baseUrl = config.openaiBaseUrl;
    const model = config.openaiModel;

    if (!apiKey || !baseUrl || !model) {
        throw new Error('OpenAI provider not configured. Please complete setup in the dashboard.');
    }

    return { apiKey, baseUrl, model };
}

function buildChatCompletionsUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    return `${base}/v1/chat/completions`;
}

function buildTimeoutSignal(timeoutMs: number): AbortSignal {
    return AbortSignal.timeout(timeoutMs);
}

function classifyOpenAiFailure(value: number | Error): string {
    if (typeof value === 'number') {
        if (value === 429) return 'rate_limit';
        if (value === 401 || value === 403) return 'auth';
        if (value >= 500) return 'server_error';
        if (value >= 400) return 'client_error';
        return 'http_error';
    }

    if (value.name === 'TimeoutError') return 'timeout';
    if (value.message.includes('not configured')) return 'configuration';
    return 'network_error';
}

async function fetchWithRetry(
    url: string,
    options: RequestInit,
    config: FetchWithRetryOptions = {},
): Promise<Response> {
    const {
        retries = MAX_RETRIES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        logPrefix = 'OpenAI',
        logContext,
    } = config;
    const logger = appLogger.child({
        component: 'openai',
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
                logger.warn('openai.retry_scheduled', {
                    operation: logPrefix,
                    attempt: attempt + 1,
                    retries,
                    statusCode: response.status,
                    retryAfterMs: delay,
                    errorType: classifyOpenAiFailure(response.status),
                });
                await sleep(delay);
            }
        } catch (error) {
            if (attempt < retries) {
                const delay = Math.pow(2, attempt) * 500;
                const reason =
                    (error as Error).name === 'TimeoutError' ? 'timeout' : 'network error';
                logger.warn('openai.retry_scheduled', {
                    operation: logPrefix,
                    attempt: attempt + 1,
                    retries,
                    retryAfterMs: delay,
                    errorType: classifyOpenAiFailure(error as Error),
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

async function buildOpenAiError(response: Response): Promise<Error> {
    const body = (await response.text()).replace(/\s+/g, ' ').trim();
    const detail = body || response.statusText || 'Request failed';
    return new Error(`OpenAI ${response.status}: ${detail.slice(0, 200)}`);
}

async function requestChatCompletion(
    prompt: string,
    {
        maxOutputTokens,
        temperature = 0.1,
        retries = MAX_RETRIES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        logPrefix = 'OpenAI',
        logContext,
    }: {
        maxOutputTokens: number;
        temperature?: number;
        retries?: number;
        timeoutMs?: number;
        logPrefix?: string;
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
    },
): Promise<{ data: OpenAIChatResponse; latencyMs: number }> {
    const logger = appLogger.child({
        component: 'openai',
        ...logContext,
    });
    const start = Date.now();
    let config: OpenAiConfig;

    try {
        config = getOpenAiConfig();
    } catch (error) {
        logger.error('openai.request.failed', {
            operation: logPrefix,
            error: (error as Error).message,
            errorType: classifyOpenAiFailure(error as Error),
            latencyMs: Date.now() - start,
        });
        throw error;
    }

    const url = buildChatCompletionsUrl(config.baseUrl);
    logger.info('openai.request.started', {
        operation: logPrefix,
        model: config.model,
        baseUrl: config.baseUrl,
        maxOutputTokens,
    });

    let response: Response;
    try {
        response = await fetchWithRetry(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: maxOutputTokens,
                    temperature,
                }),
            },
            {
                retries,
                timeoutMs,
                logPrefix,
                logContext,
            },
        );
    } catch (error) {
        logger.error('openai.request.failed', {
            operation: logPrefix,
            error: (error as Error).message,
            errorType: classifyOpenAiFailure(error as Error),
            latencyMs: Date.now() - start,
        });
        throw error;
    }

    if (!response.ok) {
        const error = await buildOpenAiError(response);
        logger.error('openai.request.failed', {
            operation: logPrefix,
            statusCode: response.status,
            error: error.message,
            errorType: classifyOpenAiFailure(response.status),
            latencyMs: Date.now() - start,
        });
        throw error;
    }

    const latencyMs = Date.now() - start;
    logger.info('openai.request.completed', {
        operation: logPrefix,
        model: config.model,
        latencyMs,
    });

    return {
        data: (await response.json()) as OpenAIChatResponse,
        latencyMs,
    };
}

export async function generateTranslationContent(
    prompt: string,
    maxOutputTokens: number,
    options?: {
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
    },
): Promise<TranslationResult> {
    const { data } = await requestChatCompletion(prompt, {
        maxOutputTokens,
        logPrefix: 'Translate',
        logContext: options?.logContext,
    });

    const result = data.choices?.[0]?.message?.content?.trim();
    if (!result) {
        throw new Error('Empty response from OpenAI');
    }

    const usage = data.usage || {};
    return {
        text: result,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
    };
}

export async function checkOpenAiHealth(): Promise<OpenAiHealthStatus> {
    try {
        const { latencyMs } = await requestChatCompletion('hi', {
            maxOutputTokens: 5,
            retries: 0,
            timeoutMs: REQUEST_TIMEOUT_MS,
            logPrefix: 'OpenAI Health',
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

export function isOpenAiConfigured(): boolean {
    const config = configRepository.getRuntimeConfig();
    return !!(config.openaiApiKey && config.openaiBaseUrl && config.openaiModel);
}

export function createOpenAiProvider(): TranslationProvider {
    return {
        name: 'openai',
        async translate(
            prompt: string,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<TranslationResult> {
            return generateTranslationContent(prompt, maxOutputTokens, options);
        },
        isConfigured(): boolean {
            return isOpenAiConfigured();
        },
    };
}

export const _test = {
    buildChatCompletionsUrl,
    getOpenAiConfig,
    buildOpenAiError,
    classifyOpenAiFailure,
};
