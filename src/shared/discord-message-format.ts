export const DISCORD_MESSAGE_LIMIT = 2000;

const MAX_ORIGINAL_PREVIEW_LENGTH = 200;

export interface TranslationMessageOptions {
    originalText: string;
    translatedText: string;
    targetLanguage: string;
    cached: boolean;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    includeOriginalPreview?: boolean;
}

function safeSliceEnd(text: string, limit: number): number {
    const end = Math.min(limit, text.length);
    return end < text.length && (text.codePointAt(end - 1) ?? 0) > 0xffff ? end - 1 : end;
}

function quoteOriginalPreview(originalText: string): string {
    const preview =
        originalText.length > MAX_ORIGINAL_PREVIEW_LENGTH
            ? `${originalText.slice(0, safeSliceEnd(originalText, MAX_ORIGINAL_PREVIEW_LENGTH))}...`
            : originalText;

    return `> ${preview.replace(/\n/g, '\n> ')}`;
}

function findChunkEnd(text: string, limit: number): number {
    const hardEnd = safeSliceEnd(text, limit);
    if (hardEnd === text.length) return hardEnd;

    const newline = text.lastIndexOf('\n', hardEnd - 1);
    if (newline > 0) return newline + 1;

    for (let index = hardEnd - 1; index > 0; index--) {
        if (text[index]?.trim() === '') return index + 1;
    }

    return hardEnd;
}

function chunkText(text: string, firstLimit: number, continuationLimit: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    let limit = firstLimit;

    while (remaining.length > 0) {
        const end = findChunkEnd(remaining, limit);
        const chunk = remaining.slice(0, end);
        chunks.push(chunk);
        remaining = remaining.slice(end);
        limit = continuationLimit;
    }

    return chunks.length > 0 ? chunks : [''];
}

export function buildTranslationMessages(options: TranslationMessageOptions): string[] {
    if (!options.includeOriginalPreview) {
        return chunkText(options.translatedText, DISCORD_MESSAGE_LIMIT, DISCORD_MESSAGE_LIMIT);
    }

    const header = `${quoteOriginalPreview(options.originalText)}\n\n`;
    const firstLimit = Math.max(DISCORD_MESSAGE_LIMIT - header.length, 1);
    const chunks = chunkText(options.translatedText, firstLimit, DISCORD_MESSAGE_LIMIT);

    return chunks.map((chunk, index) => (index === 0 ? `${header}${chunk}` : chunk));
}
