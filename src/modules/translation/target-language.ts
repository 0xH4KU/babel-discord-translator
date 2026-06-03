import type { TranslationServiceRequest } from './translation-service.js';
import { localeToLang } from './lang.js';

export type LangSource = 'option' | 'setlang' | 'locale' | 'auto';

export interface UserPreferenceRepositoryLike {
    getLanguage(userId: string): string | null;
}

export interface TargetLanguageDecision {
    targetLanguage: string;
    langSource: LangSource;
}

export function resolveTargetLanguage(
    request: Pick<TranslationServiceRequest, 'locale' | 'targetLanguageOption' | 'userId'>,
    preferenceStore: UserPreferenceRepositoryLike,
): TargetLanguageDecision {
    const userPreference = preferenceStore.getLanguage(request.userId);
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
