/**
 * Translate text using the configured translation provider(s).
 */
import { createProviderOrchestrator } from '../../infra/provider-orchestrator.js';
import { createVertexAiProvider } from '../../infra/vertex-ai-client.js';
import { createOpenAiProvider } from '../../infra/openai-client.js';
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import type { StructuredLogFields } from '../../shared/structured-logger.js';
import type { AppMetricsCollector } from '../../shared/app-metrics.js';
import type { TranslationProviderMode, TranslationResult } from '../../shared/types.js';
import type { TranslationProvider } from '../../infra/provider-orchestrator.js';

export interface TranslationGlossaryPromptEntry {
    sourceText: string;
    targetLanguage?: string;
    targetText: string;
    notes?: string;
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

export function resolveSystemPrompt(
    targetLanguage: string = 'auto',
    customPrompt?: string | null,
): string {
    if (customPrompt?.trim()) {
        return customPrompt.trim();
    }

    if (targetLanguage && targetLanguage !== 'auto') {
        return buildTargetedPrompt(targetLanguage);
    }

    return DEFAULT_PROMPT;
}

export function buildTranslationPrompt(
    text: string,
    targetLanguage: string = 'auto',
    customPrompt?: string | null,
    glossaryEntries: TranslationGlossaryPromptEntry[] = [],
): string {
    return `${resolveSystemPrompt(targetLanguage, customPrompt)}${buildGlossaryPromptSection(glossaryEntries, targetLanguage)}

Text:
${text}`;
}

export function buildGlossaryPromptSection(
    entries: TranslationGlossaryPromptEntry[],
    targetLanguage: string = 'auto',
): string {
    const shouldLabelLanguage = targetLanguage === 'auto';
    const usableEntries = entries
        .map((entry) => ({
            sourceText: entry.sourceText.trim(),
            targetLanguage: entry.targetLanguage?.trim() || 'auto',
            targetText: entry.targetText.trim(),
            notes: entry.notes?.trim() ?? '',
        }))
        .filter((entry) => entry.sourceText && entry.targetText);

    if (usableEntries.length === 0) {
        return '';
    }

    const rules = usableEntries
        .map((entry) => {
            const notes = entry.notes ? ` (${entry.notes})` : '';
            const language = shouldLabelLanguage ? ` [${entry.targetLanguage}]` : '';
            return `- ${entry.sourceText}${language} => ${entry.targetText}${notes}`;
        })
        .join('\n');

    return `

Server glossary:
Use these server-specific term mappings when they appear in the source text. If source and target are identical, preserve the term exactly.
${rules}`;
}

/**
 * Lazily-initialized provider instances (created once, reused).
 */
let providers: Map<string, TranslationProvider> | null = null;

function getProviders(): Map<string, TranslationProvider> {
    if (!providers) {
        providers = new Map<string, TranslationProvider>([
            ['vertex', createVertexAiProvider()],
            ['openai', createOpenAiProvider()],
        ]);
    }
    return providers;
}

/**
 * Memoized orchestrator so circuit-breaker state survives across requests.
 * Rebuilt only when the provider mode or metrics collector changes.
 */
let orchestrator: ReturnType<typeof createProviderOrchestrator> | null = null;
let orchestratorMode: TranslationProviderMode | null = null;
let orchestratorMetrics: AppMetricsCollector | undefined;

export function resetTranslationProviderState(): void {
    providers = null;
    orchestrator = null;
    orchestratorMode = null;
    orchestratorMetrics = undefined;
}

function getOrchestrator(
    mode: TranslationProviderMode,
    metrics?: AppMetricsCollector,
): ReturnType<typeof createProviderOrchestrator> {
    if (!orchestrator || orchestratorMode !== mode || orchestratorMetrics !== metrics) {
        orchestrator = createProviderOrchestrator(mode, getProviders(), { metrics });
        orchestratorMode = mode;
        orchestratorMetrics = metrics;
    }
    return orchestrator;
}

/**
 * Translate text using the configured translation provider(s).
 * @param text - Text to translate.
 * @param targetLanguage - Target language code (e.g. 'ja', 'zh-TW') or 'auto'.
 */
export async function translate(
    text: string,
    targetLanguage: string = 'auto',
    options?: {
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
        metrics?: AppMetricsCollector;
        glossaryEntries?: TranslationGlossaryPromptEntry[];
        runtimeConfig?: RuntimeConfig;
    },
): Promise<TranslationResult> {
    const config = options?.runtimeConfig ?? configRepository.getRuntimeConfig();
    const customPrompt = config.translationPrompt;
    const prompt = buildTranslationPrompt(
        text,
        targetLanguage,
        customPrompt,
        options?.glossaryEntries,
    );
    const maxOutputTokens = config.maxOutputTokens || 1000;
    const mode = config.translationProvider || 'vertex';

    return getOrchestrator(mode, options?.metrics).translate(prompt, maxOutputTokens, options);
}

export const _test = {
    getLanguageName,
    buildTargetedPrompt,
    LOCALE_MAP,
    DEFAULT_PROMPT,
    resolveSystemPrompt,
    buildGlossaryPromptSection,
    buildTranslationPrompt,
    /** Reset providers for testing. */
    resetProviders: resetTranslationProviderState,
};
