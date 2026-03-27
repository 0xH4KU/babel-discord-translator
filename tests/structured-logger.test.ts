import { describe, expect, it, vi } from 'vitest';
import { createStructuredLogger } from '../src/structured-logger.js';

describe('StructuredLogger', () => {
    it('should emit JSON logs with required fields and inherited context', () => {
        const sink = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const logger = createStructuredLogger({ sink }).child({
            requestId: 'req-1',
            guildId: 'guild-1',
            userId: 'user-1',
            command: 'translate',
        });

        logger.info('translation.request.started', { textLength: 42 });

        const payload = JSON.parse(sink.info.mock.calls[0][0] as string) as Record<string, unknown>;
        expect(payload.level).toBe('info');
        expect(payload.event).toBe('translation.request.started');
        expect(payload.requestId).toBe('req-1');
        expect(payload.guildId).toBe('guild-1');
        expect(payload.userId).toBe('user-1');
        expect(payload.command).toBe('translate');
        expect(payload.textLength).toBe(42);
        expect(payload.timestamp).toBeTypeOf('string');
    });

    it('should redact sensitive fields and sanitize URLs from error messages', () => {
        const sink = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const logger = createStructuredLogger({ sink });

        logger.error('vertex_ai.request.failed', {
            apiKey: 'secret-key-value',
            error: 'Vertex AI 500: https://example.com/projects/demo/very-secret-token-value',
        });

        const payload = JSON.parse(sink.error.mock.calls[0][0] as string) as Record<string, unknown>;
        expect(payload.apiKey).toBe('[REDACTED]');
        expect(payload.error).toContain('[REDACTED_URL]');
        expect(payload.error).not.toContain('https://example.com');
    });
});
