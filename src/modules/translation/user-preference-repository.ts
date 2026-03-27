import { store } from '../../store.js';
import { cloneUserLanguagePrefs } from '../../repositories/store-data-normalizer.js';

export interface UserPreferenceRepository {
    getLanguage(userId: string): string | null;
    listPreferences(): Record<string, string>;
    setLanguage(userId: string, language: string): void;
    clearLanguage(userId: string): boolean;
}

class StoreBackedUserPreferenceRepository implements UserPreferenceRepository {
    getLanguage(userId: string): string | null {
        return this.listPreferences()[userId] ?? null;
    }

    listPreferences(): Record<string, string> {
        return cloneUserLanguagePrefs(store.get('userLanguagePrefs') ?? {});
    }

    setLanguage(userId: string, language: string): void {
        const prefs = this.listPreferences();
        prefs[userId] = language;
        store.set('userLanguagePrefs', prefs);
    }

    clearLanguage(userId: string): boolean {
        const prefs = this.listPreferences();
        if (!(userId in prefs)) {
            return false;
        }

        delete prefs[userId];
        store.set('userLanguagePrefs', prefs);
        return true;
    }
}

export const userPreferenceRepository = new StoreBackedUserPreferenceRepository();
