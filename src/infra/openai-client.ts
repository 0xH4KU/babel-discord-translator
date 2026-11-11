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
import type { TranslationProvider, TranslateOptions } from './provider-orchestrator.js';
import type {
    ImageTranslationRequest,
    ImageTranslationResult,
    OpenAIChatResponse,
    TranslationPrompt,
    TranslationResult,
} from '../shared/types.js';
import {
    parseImageTranslationResponse,
    parseOcrImageTranslationResponse,
} from '../modules/translation/lens-model.js';
import { ProviderHttpError, ProviderResponseError } from './provider-errors.js';

const MAX_RETRIES = DEFAULT_PROVIDER_MAX_RETRIES;
const REQUEST_TIMEOUT_MS = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
const structuredOutputFallbackModels = new Set<string>();

const OPENAI_LENS_SCHEMA = {
    name: 'babel_lens_translation',
    strict: true,
    schema: {
        type: 'object',
        properties: {
            has_text: { type: 'boolean' },
            regions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        box_2d: { type: 'array', items: { type: 'integer' } },
                        translation: { type: 'string' },
                    },
                    required: ['box_2d', 'translation'],
                    additionalProperties: false,
                },
            },
        },
        required: ['has_text', 'regions'],
        additionalProperties: false,
    },
} as const;

const OPENAI_LENS_OCR_SCHEMA = {
    name: 'babel_lens_ocr_translation',
    strict: true,
    schema: {
        type: 'object',
        properties: {
            has_text: { type: 'boolean' },
            regions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        ids: { type: 'array', items: { type: 'integer' } },
                        translation: { type: 'string' },
                    },
                    required: ['ids', 'translation'],
                    additionalProperties: false,
                },
            },
        },
        required: ['has_text', 'regions'],
        additionalProperties: false,
    },
} as const;

interface OpenAiConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface OpenAiHealthStatus {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
}

function getOpenAiConfig(runtimeConfig?: RuntimeConfig): OpenAiConfig {
    const config = runtimeConfig ?? configRepository.getRuntimeConfig();
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
    if (base.endsWith('/chat/completions')) return base;
    if (base.endsWith('/v1')) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
}

function extractChatContent(choice?: NonNullable<OpenAIChatResponse['choices']>[number]): string {
    const raw = choice?.message?.content;
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
        return raw
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('')
            .trim();
    }
    return '';
}

function isStructuredOutputUnsupported(error: unknown): boolean {
    return (
        error instanceof ProviderHttpError &&
        (error.statusCode === 400 || error.statusCode === 422) &&
        /response[_ -]?format|json[_ -]?schema|structured outputs?/iu.test(error.message)
    );
}

const classifyOpenAiFailure = classifyProviderFailure;

async function buildOpenAiError(response: Response): Promise<Error> {
    return buildProviderHttpError('openai', response);
}

async function requestChatCompletion(
    prompt: string | TranslationPrompt,
    {
        maxOutputTokens,
        temperature = 0.1,
        retries = MAX_RETRIES,
        timeoutMs = REQUEST_TIMEOUT_MS,
        logPrefix = 'OpenAI',
        logContext,
        runtimeConfig,
        signal,
        image,
        jsonSchema,
    }: {
        maxOutputTokens: number;
        temperature?: number;
        retries?: number;
        timeoutMs?: number;
        logPrefix?: string;
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
        runtimeConfig?: RuntimeConfig;
        signal?: AbortSignal;
        image?: Pick<ImageTranslationRequest, 'image' | 'mimeType'>;
        jsonSchema?: typeof OPENAI_LENS_SCHEMA | typeof OPENAI_LENS_OCR_SCHEMA;
    },
): Promise<{ data: OpenAIChatResponse; latencyMs: number; config: OpenAiConfig }> {
    const logger = appLogger.child({
        component: 'openai',
        ...logContext,
    });
    const start = Date.now();
    let config: OpenAiConfig;

    try {
        config = getOpenAiConfig(runtimeConfig);
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
        response = await fetchProviderWithRetry(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages:
                        typeof prompt === 'string'
                            ? [{ role: 'user', content: prompt }]
                            : [
                                  { role: 'system', content: prompt.system },
                                  {
                                      role: 'user',
                                      content: image
                                          ? [
                                                { type: 'text', text: prompt.user },
                                                {
                                                    type: 'image_url',
                                                    image_url: {
                                                        url: `data:${image.mimeType};base64,${image.image.toString('base64')}`,
                                                    },
                                                },
                                            ]
                                          : prompt.user,
                                  },
                              ],
                    max_tokens: maxOutputTokens,
                    temperature,
                    ...(jsonSchema
                        ? {
                              response_format: {
                                  type: 'json_schema',
                                  json_schema: jsonSchema,
                              },
                          }
                        : {}),
                }),
            },
            {
                provider: 'openai',
                retries,
                timeoutMs,
                signal,
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
        config,
    };
}

export async function generateImageTranslationContent(
    request: ImageTranslationRequest,
    maxOutputTokens: number,
    options?: TranslateOptions,
): Promise<ImageTranslationResult> {
    const useOcrSchema = Boolean(request.ocrUnits?.length);
    const schema = useOcrSchema ? OPENAI_LENS_OCR_SCHEMA : OPENAI_LENS_SCHEMA;
    const config = getOpenAiConfig(options?.runtimeConfig);
    const modelKey = `${config.baseUrl}\u0000${config.model}\u0000${schema.name}`;

    const runAttempt = async (useSchema: boolean): Promise<ImageTranslationResult> => {
        const { data } = await requestChatCompletion(request.prompt, {
            maxOutputTokens,
            logPrefix: 'Babel Lens',
            logContext: options?.logContext,
            runtimeConfig: options?.runtimeConfig,
            signal: options?.signal,
            image: request,
            ...(useSchema ? { jsonSchema: schema } : {}),
        });

        const choice = data.choices?.[0];
        const result = extractChatContent(choice);
        const usage = data.usage || {};
        const inputTokens = normalizeProviderTokenCount(usage.prompt_tokens, 4096);
        const outputTokens = normalizeProviderTokenCount(
            usage.completion_tokens,
            result ? estimateTokenCount(result) : 0,
        );
        if (choice?.finish_reason === 'length') {
            throw new ProviderResponseError(
                'Babel Lens output was truncated by Max Output Tokens; increase it in Settings.',
                inputTokens,
                outputTokens,
            );
        }
        if (choice?.message?.refusal) {
            throw new ProviderResponseError(
                `OpenAI refused Babel Lens translation: ${choice.message.refusal}`,
                inputTokens,
                outputTokens,
            );
        }
        if (!result) {
            throw new ProviderResponseError(
                'Empty Babel Lens response from OpenAI',
                inputTokens,
                outputTokens,
            );
        }

        return useOcrSchema
            ? parseOcrImageTranslationResponse(result, request.ocrUnits!, inputTokens, outputTokens)
            : parseImageTranslationResponse(result, inputTokens, outputTokens);
    };

    const shouldUseSchema = !structuredOutputFallbackModels.has(modelKey);
    if (!shouldUseSchema) return runAttempt(false);

    try {
        return await runAttempt(true);
    } catch (error) {
        if (isStructuredOutputUnsupported(error)) {
            structuredOutputFallbackModels.add(modelKey);
            return runAttempt(false);
        }
        throw error;
    }
}

export async function generateTranslationContent(
    prompt: TranslationPrompt,
    maxOutputTokens: number,
    options?: TranslateOptions,
): Promise<TranslationResult> {
    const { data } = await requestChatCompletion(prompt, {
        maxOutputTokens,
        logPrefix: 'Translate',
        logContext: options?.logContext,
        runtimeConfig: options?.runtimeConfig,
        signal: options?.signal,
    });

    const result = extractChatContent(data.choices?.[0]);
    if (!result) {
        throw new Error('Empty response from OpenAI');
    }

    const usage = data.usage || {};
    return {
        text: result,
        inputTokens: normalizeProviderTokenCount(
            usage.prompt_tokens,
            estimateTokenCount(`${prompt.system}\n${prompt.user}`),
        ),
        outputTokens: normalizeProviderTokenCount(
            usage.completion_tokens,
            estimateTokenCount(result),
        ),
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

export function isOpenAiConfigured(runtimeConfig?: RuntimeConfig): boolean {
    const config = runtimeConfig ?? configRepository.getRuntimeConfig();
    return !!(config.openaiApiKey && config.openaiBaseUrl && config.openaiModel);
}

export function createOpenAiProvider(): TranslationProvider {
    return {
        name: 'openai',
        async translate(
            prompt: TranslationPrompt,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<TranslationResult> {
            return generateTranslationContent(prompt, maxOutputTokens, options);
        },
        isConfigured(options?: TranslateOptions): boolean {
            return isOpenAiConfigured(options?.runtimeConfig);
        },
        supportsImageInput(options?: TranslateOptions): boolean {
            return options?.runtimeConfig?.openaiSupportsImages === true;
        },
        translateImage(
            request: ImageTranslationRequest,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<ImageTranslationResult> {
            return generateImageTranslationContent(request, maxOutputTokens, options);
        },
    };
}

export const _test = {
    buildChatCompletionsUrl,
    getOpenAiConfig,
    buildOpenAiError,
    classifyOpenAiFailure,
    resetStructuredOutputFallbacks: () => structuredOutputFallbackModels.clear(),
};
