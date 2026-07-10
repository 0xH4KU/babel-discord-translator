import { appLogger, type StructuredLogFields } from '../shared/structured-logger.js';
import { ProviderHttpError, classifyStatusCode, parseRetryAfterMs } from './provider-errors.js';

export const DEFAULT_PROVIDER_MAX_RETRIES = 3;
export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 10_000;

type ProviderId = 'vertex' | 'openai';

export interface ProviderFetchOptions {
    provider: ProviderId;
    retries?: number;
    timeoutMs?: number;
    logPrefix: string;
    logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
}

export function classifyProviderFailure(value: number | Error): string {
    if (typeof value === 'number') return classifyStatusCode(value);
    if ('errorType' in value && typeof value.errorType === 'string') return value.errorType;
    if (value.name === 'TimeoutError') return 'timeout';
    if (value.message.toLowerCase().includes('not configured')) return 'configuration';
    return 'network_error';
}

export async function fetchProviderWithRetry(
    url: string,
    options: RequestInit,
    {
        provider,
        retries = DEFAULT_PROVIDER_MAX_RETRIES,
        timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
        logPrefix,
        logContext,
    }: ProviderFetchOptions,
): Promise<Response> {
    const component = provider === 'vertex' ? 'vertex_ai' : 'openai';
    const logger = appLogger.child({ component, ...logContext });

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(timeoutMs),
            });

            if (
                response.ok ||
                ![429, 500, 502, 503].includes(response.status) ||
                attempt === retries
            ) {
                return response;
            }

            const delay =
                parseRetryAfterMs(response.headers?.get('retry-after') ?? null) ??
                Math.pow(2, attempt) * 500;
            logger.warn(`${component}.retry_scheduled`, {
                operation: logPrefix,
                attempt: attempt + 1,
                retries,
                statusCode: response.status,
                retryAfterMs: delay,
                errorType: classifyProviderFailure(response.status),
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (error) {
            if (attempt === retries) throw error;

            const delay = Math.pow(2, attempt) * 500;
            const reason = (error as Error).name === 'TimeoutError' ? 'timeout' : 'network error';
            logger.warn(`${component}.retry_scheduled`, {
                operation: logPrefix,
                attempt: attempt + 1,
                retries,
                retryAfterMs: delay,
                errorType: classifyProviderFailure(error as Error),
                retryReason: reason,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    throw new Error('fetchProviderWithRetry exhausted retries without a response');
}

export async function buildProviderHttpError(
    provider: ProviderId,
    response: Response,
): Promise<ProviderHttpError> {
    const body = (await response.text()).replace(/\s+/g, ' ').trim();
    return new ProviderHttpError(
        provider,
        response.status,
        (body || response.statusText || 'Request failed').slice(0, 200),
        parseRetryAfterMs(response.headers?.get('retry-after') ?? null),
    );
}
