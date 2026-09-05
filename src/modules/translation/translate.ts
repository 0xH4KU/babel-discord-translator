/**
 * Translate text using the configured translation provider(s).
 */
import {
    createProviderOrchestrator,
    type ProviderImageOrchestratorResult,
    type VisionTranslationResolution,
} from '../../infra/provider-orchestrator.js';
import { createVertexAiProvider } from '../../infra/vertex-ai-client.js';
import { createOpenAiProvider } from '../../infra/openai-client.js';
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
import type { StructuredLogFields } from '../../shared/structured-logger.js';
import type { AppMetricsCollector } from '../../shared/app-metrics.js';
import type {
    ImageTranslationRequest,
    TranslationProviderMode,
    TranslationResult,
} from '../../shared/types.js';
import type { TranslationProvider } from '../../infra/provider-orchestrator.js';
import {
    buildGlossaryPromptSection,
    buildImageTranslationPrompt,
    buildTargetedPrompt,
    buildTranslationPrompt,
    DEFAULT_PROMPT,
    getLanguageName,
    LOCALE_MAP,
    resolveSystemPrompt,
    type TranslationGlossaryPromptEntry,
} from './translation-prompt.js';

export {
    buildGlossaryPromptSection,
    buildImageTranslationPrompt,
    buildTranslationPrompt,
    resolveSystemPrompt,
    type TranslationGlossaryPromptEntry,
} from './translation-prompt.js';

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
 * Rebuilt only when the provider mode changes.
 */
let orchestrator: ReturnType<typeof createProviderOrchestrator> | null = null;
let orchestratorMode: TranslationProviderMode | null = null;

export function resetTranslationProviderState(): void {
    providers = null;
    orchestrator = null;
    orchestratorMode = null;
}

function getOrchestrator(
    mode: TranslationProviderMode,
): ReturnType<typeof createProviderOrchestrator> {
    if (!orchestrator || orchestratorMode !== mode) {
        orchestrator = createProviderOrchestrator(mode, getProviders());
        orchestratorMode = mode;
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
        preserveNumberedMarkers?: boolean;
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
        options?.preserveNumberedMarkers,
    );
    const maxOutputTokens = config.maxOutputTokens || 4096;
    const mode = config.translationProvider || 'vertex';

    return getOrchestrator(mode).translate(prompt, maxOutputTokens, options);
}

export async function translateImage(
    image: Buffer,
    mimeType: ImageTranslationRequest['mimeType'],
    targetLanguage: string,
    resolveVision: () => Promise<VisionTranslationResolution>,
    options?: {
        logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
        metrics?: AppMetricsCollector;
        glossaryEntries?: TranslationGlossaryPromptEntry[];
        runtimeConfig?: RuntimeConfig;
    },
): Promise<ProviderImageOrchestratorResult> {
    const config = options?.runtimeConfig ?? configRepository.getRuntimeConfig();
    const prompt = buildImageTranslationPrompt(
        targetLanguage,
        config.translationPrompt,
        options?.glossaryEntries,
    );
    return getOrchestrator(config.translationProvider || 'vertex').translateImage(
        { image, mimeType, prompt, resolveVision },
        config.maxOutputTokens || 4096,
        options,
    );
}

export const _test = {
    getLanguageName,
    buildTargetedPrompt,
    LOCALE_MAP,
    DEFAULT_PROMPT,
    resolveSystemPrompt,
    buildGlossaryPromptSection,
    buildTranslationPrompt,
    buildImageTranslationPrompt,
    /** Reset providers for testing. */
    resetProviders: resetTranslationProviderState,
};
