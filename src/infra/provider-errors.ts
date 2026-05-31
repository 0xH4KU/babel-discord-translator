export type ProviderErrorType =
    | 'rate_limit'
    | 'auth'
    | 'server_error'
    | 'client_error'
    | 'timeout'
    | 'configuration'
    | 'network_error'
    | 'http_error'
    | 'budget'
    | 'unknown';

export function classifyStatusCode(statusCode: number): ProviderErrorType {
    if (statusCode === 429) return 'rate_limit';
    if (statusCode === 401 || statusCode === 403) return 'auth';
    if (statusCode >= 500) return 'server_error';
    if (statusCode >= 400) return 'client_error';
    return 'http_error';
}

export function parseRetryAfterMs(value: string | null): number | undefined {
    if (!value) {
        return undefined;
    }

    const seconds = Number.parseFloat(value);
    if (Number.isFinite(seconds)) {
        return Math.max(Math.round(seconds * 1000), 0);
    }

    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) {
        return Math.max(dateMs - Date.now(), 0);
    }

    return undefined;
}

export class ProviderHttpError extends Error {
    readonly provider: string;
    readonly errorType: ProviderErrorType;
    readonly statusCode: number;
    readonly retryAfterMs?: number;

    constructor(provider: string, statusCode: number, detail: string, retryAfterMs?: number) {
        super(`${provider === 'vertex' ? 'Vertex AI' : 'OpenAI'} ${statusCode}: ${detail}`);
        this.name = 'ProviderHttpError';
        this.provider = provider;
        this.errorType = classifyStatusCode(statusCode);
        this.statusCode = statusCode;
        this.retryAfterMs = retryAfterMs;
    }
}
