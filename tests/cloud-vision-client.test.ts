import { describe, expect, it, vi } from 'vitest';
import { _test, detectTextWithCloudVision } from '../src/infra/cloud-vision-client.js';

describe('Cloud Vision client', () => {
    it('should group paragraphs into one numbered text block', async () => {
        const word = (text: string, breakType?: string) => ({
            symbols: [...text].map((character, index, symbols) => ({
                text: character,
                ...(index === symbols.length - 1 && breakType
                    ? { property: { detectedBreak: { type: breakType } } }
                    : {}),
            })),
        });
        const fetchImpl = vi.fn(
            async () =>
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
                                                    blockType: 'TEXT',
                                                    boundingBox: {
                                                        vertices: [
                                                            { x: 10, y: 20 },
                                                            { x: 110, y: 20 },
                                                            { x: 110, y: 80 },
                                                            { x: 10, y: 80 },
                                                        ],
                                                    },
                                                    paragraphs: [
                                                        {
                                                            words: [word('Hello', 'LINE_BREAK')],
                                                        },
                                                        {
                                                            words: [word('image', 'LINE_BREAK')],
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
            text: 'Hello\nimage',
            imageWidth: 200,
            imageHeight: 100,
            regions: [{ text: 'Hello\nimage', x: 10, y: 20, width: 100, height: 60 }],
        });

        const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
        const body = JSON.parse(String(init.body));
        expect(body.requests).toHaveLength(1);
        expect(body.requests[0].features).toEqual([{ type: 'TEXT_DETECTION' }]);
        expect(new Headers(init.headers).get('x-goog-api-key')).toBe('vision-key');
    });

    it('should surface per-image API errors', async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        responses: [{ error: { code: 403, message: 'API disabled' } }],
                    }),
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

    it('should ignore short ASCII logo misreads without dropping short CJK text', () => {
        expect(_test.isMeaningfulBlockText('8')).toBe(false);
        expect(_test.isMeaningfulBlockText('tA')).toBe(false);
        expect(_test.isMeaningfulBlockText('CODE')).toBe(true);
        expect(_test.isMeaningfulBlockText('程式')).toBe(true);
    });
});
