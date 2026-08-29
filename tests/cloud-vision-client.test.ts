import { describe, expect, it, vi } from 'vitest';
import { detectTextWithCloudVision } from '../src/infra/cloud-vision-client.js';

describe('Cloud Vision client', () => {
    it('should send one TEXT_DETECTION feature and return extracted text', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    responses: [{ fullTextAnnotation: { text: 'Hello image\n' } }],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(
            detectTextWithCloudVision(Buffer.from('image'), {
                apiKey: 'vision-key',
                fetchImpl: fetchImpl as typeof fetch,
            }),
        ).resolves.toBe('Hello image');

        const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
        const body = JSON.parse(String(init.body));
        expect(body.requests).toHaveLength(1);
        expect(body.requests[0].features).toEqual([{ type: 'TEXT_DETECTION' }]);
        expect(new Headers(init.headers).get('x-goog-api-key')).toBe('vision-key');
    });

    it('should surface per-image API errors', async () => {
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({ responses: [{ error: { code: 403, message: 'API disabled' } }] }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(
            detectTextWithCloudVision(Buffer.from('image'), {
                apiKey: 'vision-key',
                fetchImpl: fetchImpl as typeof fetch,
            }),
        ).rejects.toThrow('Cloud Vision request failed: API disabled');
    });
});
