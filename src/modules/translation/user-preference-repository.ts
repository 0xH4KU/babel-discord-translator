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
        return store.getUserLanguage(userId);
    }

    listPreferences(): Record<string, string> {
        return cloneUserLanguagePrefs(store.get('userLanguagePrefs') ?? {});
    }

    setLanguage(userId: string, language: string): void {
        store.setUserLanguage(userId, language);
    }

    clearLanguage(userId: string): boolean {
        return store.deleteUserLanguage(userId);
    }
}

export const userPreferenceRepository = new StoreBackedUserPreferenceRepository();
