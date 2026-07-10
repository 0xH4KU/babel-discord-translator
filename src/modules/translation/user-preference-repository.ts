import { store } from '../../persistence/store.js';
import { cloneUserLanguagePreferenceEntries } from '../../persistence/store-data-normalizer.js';
import type { UserLanguagePreferenceEntry } from '../../shared/types.js';

export const userPreferenceRepository = {
    getLanguage(guildId: string, userId: string): string | null {
        return store.getUserLanguage(guildId, userId);
    },

    listPreferences(): UserLanguagePreferenceEntry[] {
        return cloneUserLanguagePreferenceEntries(store.get('userLanguagePreferenceEntries'));
    },

    setLanguage(guildId: string, userId: string, language: string): void {
        store.setUserLanguage(guildId, userId, language);
    },

    clearLanguage(guildId: string, userId: string): boolean {
        return store.deleteUserLanguage(guildId, userId);
    },
};
