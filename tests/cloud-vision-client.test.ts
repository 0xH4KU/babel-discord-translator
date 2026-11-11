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
            units: [{ id: 1, text: 'Hello\nimage', box_2d: [200, 50, 800, 550] }],
        });

        const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
        const body = JSON.parse(String(init.body));
        expect(body.requests).toHaveLength(1);
        expect(body.requests[0].features).toEqual([{ type: 'DOCUMENT_TEXT_DETECTION' }]);
        expect(body.requests[0].imageContext).toEqual({
            textDetectionParams: { enableTextDetectionConfidenceScore: true },
        });
        expect(new Headers(init.headers).get('x-goog-api-key')).toBe('vision-key');
    });

    it('should extract paragraph-level OCR units when paragraph bounding boxes exist', () => {
        const result = _test.parseVisionText({
            fullTextAnnotation: {
                pages: [
                    {
                        width: 200,
                        height: 100,
                        blocks: [
                            {
                                blockType: 'TEXT',
                                confidence: 0.95,
                                boundingBox: {
                                    vertices: [
                                        { x: 10, y: 10 },
                                        { x: 190, y: 10 },
                                        { x: 190, y: 90 },
                                        { x: 10, y: 90 },
                                    ],
                                },
                                paragraphs: [
                                    {
                                        confidence: 0.96,
                                        boundingBox: {
                                            vertices: [
                                                { x: 10, y: 10 },
                                                { x: 190, y: 10 },
                                                { x: 190, y: 40 },
                                                { x: 10, y: 40 },
                                            ],
                                        },
                                        words: [{ symbols: [...'First'].map((text) => ({ text })) }],
                                    },
                                    {
                                        confidence: 0.92,
                                        boundingBox: {
                                            vertices: [
                                                { x: 10, y: 50 },
                                                { x: 150, y: 50 },
                                                { x: 150, y: 90 },
                                                { x: 10, y: 90 },
                                            ],
                                        },
                                        words: [{ symbols: [...'Second'].map((text) => ({ text })) }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        expect(result.text).toBe('First\nSecond');
        expect(result.units).toEqual([
            { id: 1, text: 'First', box_2d: [100, 50, 400, 950] },
            { id: 2, text: 'Second', box_2d: [500, 50, 900, 750] },
        ]);
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

    it('should reject low-confidence blocks and isolated OCR artifacts', () => {
        expect(_test.isMeaningfulBlockText('8')).toBe(false);
        expect(_test.isMeaningfulBlockText('。', 0.85)).toBe(false);
        expect(_test.isMeaningfulBlockText('tA', 0.52)).toBe(false);
        expect(_test.isMeaningfulBlockText('OK')).toBe(true);
        expect(_test.isMeaningfulBlockText('AI')).toBe(true);
        expect(_test.isMeaningfulBlockText('$5')).toBe(true);
        expect(_test.isMeaningfulBlockText('CODE')).toBe(true);
        expect(_test.isMeaningfulBlockText('程', 0.8)).toBe(true);
        expect(_test.isMeaningfulBlockText('程式')).toBe(true);
    });

    it('should preserve region bounds and OCR units for dense text', () => {
        const text = '文'.repeat(501);
        const result = _test.parseVisionText({
            fullTextAnnotation: {
                pages: [
                    {
                        width: 100,
                        height: 100,
                        blocks: [
                            {
                                blockType: 'TEXT',
                                confidence: 0.99,
                                boundingBox: {
                                    vertices: [
                                        { x: 1, y: 1 },
                                        { x: 99, y: 1 },
                                        { x: 99, y: 99 },
                                        { x: 1, y: 99 },
                                    ],
                                },
                                paragraphs: [
                                    {
                                        words: [
                                            {
                                                symbols: [...text].map((character) => ({
                                                    text: character,
                                                })),
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        expect(result.text).toBe(text);
        expect(result.regions).toEqual([{ text, x: 1, y: 1, width: 98, height: 98 }]);
        expect(result.units).toEqual([{ id: 1, text, box_2d: [10, 10, 990, 990] }]);
    });

    it('should use the full OCR text when any recognized block has no valid bounds', () => {
        const result = _test.parseVisionText({
            fullTextAnnotation: {
                pages: [
                    {
                        width: 100,
                        height: 100,
                        blocks: [
                            {
                                boundingBox: {
                                    vertices: [
                                        { x: 1, y: 1 },
                                        { x: 50, y: 1 },
                                        { x: 50, y: 20 },
                                        { x: 1, y: 20 },
                                    ],
                                },
                                paragraphs: [
                                    {
                                        words: [{ symbols: [...'kept'].map((text) => ({ text })) }],
                                    },
                                ],
                            },
                            {
                                paragraphs: [
                                    {
                                        words: [{ symbols: [...'lost'].map((text) => ({ text })) }],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        expect(result.text).toBe('kept\nlost');
        expect(result.regions).toEqual([]);
        expect(result.units).toEqual([]);
    });
});
