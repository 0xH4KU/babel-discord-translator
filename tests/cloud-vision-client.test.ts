import { describe, expect, it, vi } from 'vitest';
import { detectTextWithCloudVision } from '../src/infra/cloud-vision-client.js';

describe('Cloud Vision client', () => {
    it('should return paragraph text and bounds from one TEXT_DETECTION request', async () => {
        const word = (text: string, breakType?: string) => ({
            symbols: [...text].map((character, index, symbols) => ({
                text: character,
                ...(index === symbols.length - 1 && breakType
                    ? { property: { detectedBreak: { type: breakType } } }
                    : {}),
            })),
        });
        const fetchImpl = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    responses: [
                        {
                            fullTextAnnotation: {
                                text: 'Hello image\n',
                                pages: [
                                    {
                                        width: 200,
                                        height: 100,
                                        blocks: [
                                            {
                                                paragraphs: [
                                                    {
                                                        boundingBox: {
                                                            vertices: [
                                                                { x: 10, y: 20 },
                                                                { x: 110, y: 20 },
                                                                { x: 110, y: 50 },
                                                                { x: 10, y: 50 },
                                                            ],
                                                        },
                                                        words: [
                                                            word('Hello', 'SPACE'),
                                                            word('image', 'LINE_BREAK'),
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        await expect(
            detectTextWithCloudVision(Buffer.from('image'), {
                apiKey: 'vision-key',
                fetchImpl: fetchImpl as typeof fetch,
            }),
        ).resolves.toEqual({
            text: 'Hello image',
            imageWidth: 200,
            imageHeight: 100,
            regions: [{ text: 'Hello image', x: 10, y: 20, width: 100, height: 30 }],
        });

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
