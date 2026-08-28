import { appLogger, type StructuredLogFields } from '../shared/structured-logger.js';
import { ProviderHttpError, classifyStatusCode, parseRetryAfterMs } from './provider-errors.js';

export const DEFAULT_PROVIDER_MAX_RETRIES = 3;
export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_PROVIDER_RETRY_DELAY_MS = 10_000;
const RETRY_JITTER_MS = 250;

type ProviderId = 'vertex' | 'openai';

export interface ProviderFetchOptions {
    provider: ProviderId;
    retries?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
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

export function estimateTokenCount(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}

export function normalizeProviderTokenCount(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : fallback;
}

function retryDelay(baseMs: number): number {
    const jitter = Math.floor(Math.random() * RETRY_JITTER_MS);
    return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.max(0, baseMs) + jitter);
}

function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);

        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export async function fetchProviderWithRetry(
    url: string,
    options: RequestInit,
    {
        provider,
        retries = DEFAULT_PROVIDER_MAX_RETRIES,
        timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
        signal,
        logPrefix,
        logContext,
    }: ProviderFetchOptions,
): Promise<Response> {
    const component = provider === 'vertex' ? 'vertex_ai' : 'openai';
    const logger = appLogger.child({ component, ...logContext });

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            signal?.throwIfAborted();
            const response = await fetch(url, {
                ...options,
                signal: signal
                    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
                    : AbortSignal.timeout(timeoutMs),
            });

            if (
                response.ok ||
                ![429, 500, 502, 503, 504].includes(response.status) ||
                attempt === retries
            ) {
                return response;
            }

            const delay = retryDelay(
                parseRetryAfterMs(response.headers?.get('retry-after') ?? null) ??
                    Math.pow(2, attempt) * 500,
            );
            logger.warn(`${component}.retry_scheduled`, {
                operation: logPrefix,
                attempt: attempt + 1,
                retries,
                statusCode: response.status,
                retryAfterMs: delay,
                errorType: classifyProviderFailure(response.status),
            });
            try {
                await response.body?.cancel();
            } catch {
                // The retry still proceeds when an implementation cannot cancel its body.
            }
            await sleep(delay, signal);
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            if (attempt === retries) throw error;

            const delay = retryDelay(Math.pow(2, attempt) * 500);
            const reason = (error as Error).name === 'TimeoutError' ? 'timeout' : 'network error';
            logger.warn(`${component}.retry_scheduled`, {
                operation: logPrefix,
                attempt: attempt + 1,
                retries,
                retryAfterMs: delay,
                errorType: classifyProviderFailure(error as Error),
                retryReason: reason,
            });
            await sleep(delay, signal);
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
