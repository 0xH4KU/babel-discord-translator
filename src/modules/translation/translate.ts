/**
 * Translate text using Vertex AI Gemini REST API.
 */
import { fetchWithRetry, generateTranslationContent } from '../../infra/vertex-ai-client.js';
import { configRepository } from '../config/config-repository.js';
import type { StructuredLogFields } from '../../shared/structured-logger.js';
import type { TranslationResult } from '../../types.js';

/** Map Discord locale code to a human-readable language name for the prompt. */
const LOCALE_MAP: Record<string, string> = {
    'zh-TW': 'Traditional Chinese (繁體中文)',
    'zh-CN': 'Simplified Chinese (简体中文)',
    'en-US': 'English',
    'en-GB': 'English',
    ja: 'Japanese (日本語)',
    ko: 'Korean (한국어)',
    es: 'Spanish (Español)',
    'es-ES': 'Spanish (Español)',
    'es-419': 'Spanish (Español)',
    fr: 'French (Français)',
    de: 'German (Deutsch)',
    pt: 'Portuguese (Português)',
    'pt-BR': 'Brazilian Portuguese (Português Brasileiro)',
    ru: 'Russian (Русский)',
    it: 'Italian (Italiano)',
    pl: 'Polish (Polski)',
    nl: 'Dutch (Nederlands)',
    tr: 'Turkish (Türkçe)',
    vi: 'Vietnamese (Tiếng Việt)',
    th: 'Thai (ไทย)',
    ar: 'Arabic (العربية)',
    hi: 'Hindi (हिन्दी)',
    id: 'Indonesian (Bahasa Indonesia)',
};

function getLanguageName(code: string | null | undefined): string | null {
    if (!code || code === 'auto') return null;
    return LOCALE_MAP[code] ?? LOCALE_MAP[code.split('-')[0]!] ?? code;
}

const DEFAULT_PROMPT = `You are a translator. Detect the language of the following text and translate it.

Rules:
- If the text is Chinese (Traditional or Simplified) → translate to English
- If the text is English → translate to Traditional Chinese (繁體中文)
- If the text contains both Chinese and English → translate each part to the other language
- If the text is in another language → translate to both English and Traditional Chinese
- Output ONLY the translation. No explanations, no labels, no extra text.
- Preserve the original formatting (line breaks, punctuation, etc.)`;

/** Build a prompt tailored for a specific target language. */
function buildTargetedPrompt(targetLang: string): string {
    const langName = getLanguageName(targetLang);
    return `You are a translator. Detect the language of the following text and translate it.

Rules:
- Translate the text to ${langName}.
- If the text is already in ${langName}, translate it to English instead.
- If the text contains multiple languages, translate all parts to ${langName}.
- Output ONLY the translation. No explanations, no labels, no extra text.
- Preserve the original formatting (line breaks, punctuation, etc.)`;
}

export function resolveSystemPrompt(targetLanguage: string = 'auto', customPrompt?: string | null): string {
    if (customPrompt?.trim()) {
        return customPrompt.trim();
    }

    if (targetLanguage && targetLanguage !== 'auto') {
        return buildTargetedPrompt(targetLanguage);
    }

    return DEFAULT_PROMPT;
}

export function buildTranslationPrompt(text: string, targetLanguage: string = 'auto', customPrompt?: string | null): string {
    return `${resolveSystemPrompt(targetLanguage, customPrompt)}

Text:
${text}`;
}

/**
 * Translate text using Vertex AI Gemini REST API.
 * @param text - Text to translate.
 * @param targetLanguage - Target language code (e.g. 'ja', 'zh-TW') or 'auto'.
 */
export async function translate(
    text: string,
    targetLanguage: string = 'auto',
    options?: { logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'> },
): Promise<TranslationResult> {
    const config = configRepository.getRuntimeConfig();
    const customPrompt = config.translationPrompt;
    const prompt = buildTranslationPrompt(text, targetLanguage, customPrompt);
    const maxOutputTokens = config.maxOutputTokens || 1000;
    return generateTranslationContent(prompt, maxOutputTokens, options);
}

export const _test = {
    getLanguageName,
    buildTargetedPrompt,
    fetchWithRetry,
    LOCALE_MAP,
    DEFAULT_PROMPT,
    resolveSystemPrompt,
    buildTranslationPrompt,
};
