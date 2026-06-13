import { describe, expect, it } from 'vitest';
import {
    ProviderHttpError,
    classifyStatusCode,
    parseRetryAfterMs,
} from '../src/infra/provider-errors.js';

describe('classifyStatusCode', () => {
    it('should map status codes to provider error types', () => {
        expect(classifyStatusCode(429)).toBe('rate_limit');
        expect(classifyStatusCode(401)).toBe('auth');
        expect(classifyStatusCode(403)).toBe('auth');
        expect(classifyStatusCode(500)).toBe('server_error');
        expect(classifyStatusCode(503)).toBe('server_error');
        expect(classifyStatusCode(400)).toBe('client_error');
        expect(classifyStatusCode(404)).toBe('client_error');
        expect(classifyStatusCode(302)).toBe('http_error');
    });
});

describe('parseRetryAfterMs', () => {
    it('should return undefined for missing or unparseable values', () => {
        expect(parseRetryAfterMs(null)).toBeUndefined();
        expect(parseRetryAfterMs('')).toBeUndefined();
        expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
    });

    it('should convert numeric seconds to milliseconds and clamp at zero', () => {
        expect(parseRetryAfterMs('2')).toBe(2000);
        expect(parseRetryAfterMs('0.5')).toBe(500);
        expect(parseRetryAfterMs('-3')).toBe(0);
    });

    it('should convert HTTP dates to a delay relative to now', () => {
        const future = new Date(Date.now() + 5000).toUTCString();
        const delay = parseRetryAfterMs(future);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(5000);

        const past = new Date(Date.now() - 5000).toUTCString();
        expect(parseRetryAfterMs(past)).toBe(0);
    });
});

describe('ProviderHttpError', () => {
    it('should label messages per provider and classify the status', () => {
        const vertex = new ProviderHttpError('vertex', 429, 'slow down', 1000);
        expect(vertex.message).toBe('Vertex AI 429: slow down');
        expect(vertex).toMatchObject({
            name: 'ProviderHttpError',
            provider: 'vertex',
            errorType: 'rate_limit',
            statusCode: 429,
            retryAfterMs: 1000,
        });

        const openai = new ProviderHttpError('openai', 500, 'oops');
        expect(openai.message).toBe('OpenAI 500: oops');
        expect(openai.errorType).toBe('server_error');
        expect(openai.retryAfterMs).toBeUndefined();
    });
});
