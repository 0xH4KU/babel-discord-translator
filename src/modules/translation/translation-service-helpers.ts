import type { AppMetricsCollector } from '../../shared/app-metrics.js';
import type { GuildGlossaryEntry } from '../../shared/types.js';
import type { RuntimeConfig } from '../config/config-repository.js';

export type ServiceCommand = 'babel' | 'translate';

export type TranslatorOptions = {
    metrics?: AppMetricsCollector;
    glossaryEntries?: Array<Pick<GuildGlossaryEntry, 'sourceText' | 'targetText' | 'notes'>>;
    runtimeConfig?: RuntimeConfig;
    logContext: {
        requestId: string;
        guildId?: string | null;
        userId: string;
        command: ServiceCommand;
    };
};

export function createTranslatorOptions(
    logContext: TranslatorOptions['logContext'],
    metrics?: AppMetricsCollector,
    glossaryEntries: TranslatorOptions['glossaryEntries'] = [],
    runtimeConfig?: RuntimeConfig,
): TranslatorOptions {
    return {
        logContext,
        ...(metrics ? { metrics } : {}),
        ...(glossaryEntries.length > 0 ? { glossaryEntries } : {}),
        ...(runtimeConfig ? { runtimeConfig } : {}),
    };
}

export function suggestedActionForErrorType(errorType: string): string {
    switch (errorType) {
        case 'rate_limit':
            return 'Provider rate limit reached. Try fallback mode or reduce concurrency.';
        case 'auth':
            return 'Check provider API key and provider configuration.';
        case 'timeout':
            return 'Provider timed out. Check provider status or use fallback mode.';
        case 'budget':
            return 'Review global or server budget limits.';
        case 'server_error':
            return 'Provider returned a server error. Check provider status or use fallback mode.';
        default:
            return 'Check structured logs for this request id.';
    }
}

export function classifyTranslationError(message: string): {
    errorType: string;
    suggestedAction: string;
} {
    if (/429|rate/i.test(message)) {
        return {
            errorType: 'rate_limit',
            suggestedAction: suggestedActionForErrorType('rate_limit'),
        };
    }
    if (/401|403|auth|api key|not configured/i.test(message)) {
        return {
            errorType: 'auth',
            suggestedAction: suggestedActionForErrorType('auth'),
        };
    }
    if (/timeout|aborted/i.test(message)) {
        return {
            errorType: 'timeout',
            suggestedAction: suggestedActionForErrorType('timeout'),
        };
    }
    if (/budget/i.test(message)) {
        return {
            errorType: 'budget',
            suggestedAction: suggestedActionForErrorType('budget'),
        };
    }
    if (/5\d\d|server/i.test(message)) {
        return {
            errorType: 'server_error',
            suggestedAction: suggestedActionForErrorType('server_error'),
        };
    }

    return {
        errorType: 'unknown',
        suggestedAction: suggestedActionForErrorType('unknown'),
    };
}

export function buildGlossaryVersion(entries: GuildGlossaryEntry[]): string {
    return entries
        .map((entry) =>
            [
                entry.id,
                entry.sourceText.trim(),
                entry.targetText.trim(),
                entry.notes.trim(),
                entry.updatedAt,
            ].join('\u001f'),
        )
        .join('\u001e');
}
