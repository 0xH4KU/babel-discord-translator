/**
 * Translate text using Vertex AI Gemini REST API.
 */
import { store } from './store.js';
import type { TranslationResult, VertexAIResponse } from './types.js';

const RETRY_CODES = [429, 500, 502, 503];
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with exponential backoff retry for transient errors. */
async function fetchWithRetry(url: string, options: RequestInit, retries: number = MAX_RETRIES): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok || !RETRY_CODES.includes(response.status)) {
                return response;
            }
            if (i < retries) {
                const delay = Math.pow(2, i) * 500;
                console.warn(`[Translate] Retry ${i + 1}/${retries} after ${response.status}, waiting ${delay}ms`);
                await sleep(delay);
            }
        } catch (err) {
            if (i < retries) {
                const delay = Math.pow(2, i) * 500;
                console.warn(`[Translate] Retry ${i + 1}/${retries} after network error, waiting ${delay}ms`);
                await sleep(delay);
            } else {
                throw err;
            }
        }
    }
    return fetch(url, options);
}

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

/**
 * Translate text using Vertex AI Gemini REST API.
 * @param text - Text to translate.
 * @param targetLanguage - Target language code (e.g. 'ja', 'zh-TW') or 'auto'.
 */
export async function translate(text: string, targetLanguage: string = 'auto'): Promise<TranslationResult> {
    const model = store.get('geminiModel');
    const project = store.get('gcpProject');
    const location = store.get('gcpLocation');
    const apiKey = store.get('vertexAiApiKey');

    if (!project || !apiKey) {
        throw new Error('API not configured. Please complete setup in the dashboard.');
    }

    const baseUrl =
        location === 'global'
            ? 'https://aiplatform.googleapis.com'
            : `https://${location}-aiplatform.googleapis.com`;

    const url = `${baseUrl}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

    // Determine which prompt to use
    let systemPrompt: string;
    const customPrompt = store.get('translationPrompt');

    if (customPrompt?.trim()) {
        // User-defined custom prompt always takes priority
        systemPrompt = customPrompt.trim();
    } else if (targetLanguage && targetLanguage !== 'auto') {
        // Dynamic target language prompt
        systemPrompt = buildTargetedPrompt(targetLanguage);
    } else {
        // Default auto-detect prompt
        systemPrompt = DEFAULT_PROMPT;
    }

    const prompt = `${systemPrompt}

Text:
${text}`;

    const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: store.get('maxOutputTokens') || 1000,
                temperature: 0.1,
            },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vertex AI ${response.status}: ${error}`);
    }

    const data = (await response.json()) as VertexAIResponse;
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!result) {
        throw new Error('Empty response from Gemini');
    }

    const meta = data.usageMetadata || {};

    return {
        text: result,
        inputTokens: meta.promptTokenCount || 0,
        outputTokens: meta.candidatesTokenCount || 0,
    };
}

// Exports for testing internals
export const _test = { getLanguageName, buildTargetedPrompt, fetchWithRetry, LOCALE_MAP, DEFAULT_PROMPT };
