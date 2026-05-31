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
}

function quoteOriginalPreview(originalText: string): string {
    const preview =
        originalText.length > MAX_ORIGINAL_PREVIEW_LENGTH
            ? `${originalText.slice(0, MAX_ORIGINAL_PREVIEW_LENGTH)}...`
            : originalText;

    return `> ${preview.replace(/\n/g, '\n> ')}`;
}

function metadataLine({
    targetLanguage,
    cached,
    provider,
    inputTokens,
    outputTokens,
}: TranslationMessageOptions): string {
    const parts = [`Target: \`${targetLanguage}\``, `Cache: \`${cached ? 'hit' : 'miss'}\``];

    if (provider) {
        parts.push(`Provider: \`${provider}\``);
    }

    if (inputTokens !== undefined && outputTokens !== undefined) {
        parts.push(`Tokens: \`${inputTokens} in / ${outputTokens} out\``);
    }

    return parts.join(' | ');
}

function chunkText(text: string, firstLimit: number, continuationLimit: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    let limit = firstLimit;

    while (remaining.length > 0) {
        const chunk = remaining.slice(0, limit);
        chunks.push(chunk);
        remaining = remaining.slice(limit);
        limit = continuationLimit;
    }

    return chunks.length > 0 ? chunks : [''];
}

export function buildTranslationMessages(options: TranslationMessageOptions): string[] {
    const header = `${quoteOriginalPreview(options.originalText)}\n\n${metadataLine(options)}\n\n`;
    const firstLimit = Math.max(DISCORD_MESSAGE_LIMIT - header.length, 1);
    const continuationLimit = DISCORD_MESSAGE_LIMIT;
    const chunks = chunkText(options.translatedText, firstLimit, continuationLimit);

    return chunks.map((chunk, index) => {
        if (index === 0) {
            return `${header}${chunk}`;
        }

        return chunk;
    });
}
