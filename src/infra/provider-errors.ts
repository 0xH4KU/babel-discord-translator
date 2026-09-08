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

export class ProviderResponseError extends Error {
    readonly inputTokens: number;
    readonly outputTokens: number;

    constructor(
        message: string,
        inputTokens: number,
        outputTokens: number,
        options?: { cause?: Error },
    ) {
        super(message, options);
        this.name = 'ProviderResponseError';
        this.inputTokens = inputTokens;
        this.outputTokens = outputTokens;
    }
}

export function classifyProviderError(error: Error | null): string {
    if (error && 'errorType' in error && typeof error.errorType === 'string') {
        return error.errorType;
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';

    const message = error?.message ?? '';
    if (/429|rate/i.test(message)) return 'rate_limit';
    if (/401|403|auth|api key|not configured/i.test(message)) return 'auth';
    if (/timeout|aborted/i.test(message)) return 'timeout';
    if (/budget/i.test(message)) return 'budget';
    if (/5\d\d|server/i.test(message)) return 'server_error';
    return 'unknown';
}
