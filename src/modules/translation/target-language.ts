import type { AccessMode } from '../../apps/app-profile.js';
import type { TranslationServiceRequest } from './translation-service.js';
import { localeToLang } from './lang.js';

export type LangSource = 'option' | 'setlang' | 'locale' | 'auto';

export interface UserPreferenceRepositoryLike {
    getLanguage(guildId: string, userId: string): string | null;
}

export interface TargetLanguageDecision {
    targetLanguage: string;
    langSource: LangSource;
}

export interface TargetLanguageOptions {
    accessMode?: AccessMode;
}

function resolvePreferenceGuildId(
    request: Pick<TranslationServiceRequest, 'guildId'>,
    options: TargetLanguageOptions,
): string | null {
    return options.accessMode === 'user-install' ? '' : (request.guildId ?? null);
}

export function resolveTargetLanguage(
    request: Pick<
        TranslationServiceRequest,
        'guildId' | 'locale' | 'targetLanguageOption' | 'userId'
    >,
    preferenceStore: UserPreferenceRepositoryLike,
    options: TargetLanguageOptions = {},
): TargetLanguageDecision {
    const preferenceGuildId = resolvePreferenceGuildId(request, options);
    const userPreference =
        preferenceGuildId !== null
            ? preferenceStore.getLanguage(preferenceGuildId, request.userId)
            : null;
    const localeLanguage = localeToLang(request.locale);

    if (request.targetLanguageOption && request.targetLanguageOption !== 'auto') {
        return {
            targetLanguage: request.targetLanguageOption,
            langSource: 'option',
        };
    }

    if (userPreference) {
        return {
            targetLanguage: userPreference,
            langSource: 'setlang',
        };
    }

    if (localeLanguage) {
        return {
            targetLanguage: localeLanguage,
            langSource: 'locale',
        };
    }

    return {
        targetLanguage: 'auto',
        langSource: 'auto',
    };
}
