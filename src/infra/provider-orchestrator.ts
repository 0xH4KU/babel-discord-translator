import type { StructuredLogFields } from '../shared/structured-logger.js';
import { appLogger } from '../shared/structured-logger.js';
import type { TranslationProviderMode, TranslationResult } from '../types.js';

export interface TranslateOptions {
    logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
}

export interface TranslationProvider {
    /** Human-readable provider name for logging. */
    name: string;
    /** Translate a prompt. */
    translate(
        prompt: string,
        maxOutputTokens: number,
        options?: TranslateOptions,
    ): Promise<TranslationResult>;
    /** Whether the provider has enough config to attempt a call. */
    isConfigured(): boolean;
}

export interface ProviderOrchestratorResult extends TranslationResult {
    /** Which provider produced this result. */
    provider: string;
    /** Whether a fallback provider was used. */
    fallback: boolean;
}

function resolveProviderOrder(
    mode: TranslationProviderMode,
    providers: Map<string, TranslationProvider>,
): TranslationProvider[] {
    switch (mode) {
        case 'vertex':
            return [providers.get('vertex')].filter(Boolean) as TranslationProvider[];
        case 'openai':
            return [providers.get('openai')].filter(Boolean) as TranslationProvider[];
        case 'vertex+openai':
            return [providers.get('vertex'), providers.get('openai')].filter(
                Boolean,
            ) as TranslationProvider[];
        case 'openai+vertex':
            return [providers.get('openai'), providers.get('vertex')].filter(
                Boolean,
            ) as TranslationProvider[];
        default:
            return [providers.get('vertex')].filter(Boolean) as TranslationProvider[];
    }
}

export function createProviderOrchestrator(
    mode: TranslationProviderMode,
    providers: Map<string, TranslationProvider>,
) {
    const logger = appLogger.child({ component: 'provider_orchestrator' });

    return {
        async translate(
            prompt: string,
            maxOutputTokens: number,
            options?: TranslateOptions,
        ): Promise<ProviderOrchestratorResult> {
            const ordered = resolveProviderOrder(mode, providers);
            const configured = ordered.filter((p) => p.isConfigured());

            if (configured.length === 0) {
                throw new Error(
                    'No translation provider is configured. Please complete setup in the dashboard.',
                );
            }

            let lastError: Error | null = null;

            for (let i = 0; i < configured.length; i++) {
                const provider = configured[i]!;
                const isFallback = i > 0;

                try {
                    if (isFallback) {
                        logger.warn('provider_orchestrator.fallback', {
                            from: configured[i - 1]!.name,
                            to: provider.name,
                            error: lastError?.message,
                            ...options?.logContext,
                        });
                    }

                    const result = await provider.translate(prompt, maxOutputTokens, options);
                    return {
                        ...result,
                        provider: provider.name,
                        fallback: isFallback,
                    };
                } catch (error) {
                    lastError = error as Error;
                    logger.error('provider_orchestrator.provider_failed', {
                        provider: provider.name,
                        error: lastError.message,
                        hasNextProvider: i < configured.length - 1,
                        ...options?.logContext,
                    });
                }
            }

            // All providers failed — throw the last error
            throw lastError!;
        },
    };
}

export const _test = { resolveProviderOrder };
