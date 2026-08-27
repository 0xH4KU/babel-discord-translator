import { describe, it, expect } from 'vitest';
import { localeToLang } from '../src/modules/translation/lang.js';

describe('localeToLang', () => {
    it('should return null for null/undefined input', () => {
        expect(localeToLang(null as unknown as undefined)).toBeNull();
        expect(localeToLang(undefined)).toBeNull();
    });

    it('should return null for English locales (auto-detect)', () => {
        expect(localeToLang('en-US')).toBeNull();
        expect(localeToLang('en-GB')).toBeNull();
    });

    it('should return null for Chinese locales (auto-detect)', () => {
        expect(localeToLang('zh-TW')).toBeNull();
        expect(localeToLang('zh-CN')).toBeNull();
    });

    it('should extract base language code for other locales', () => {
        expect(localeToLang('ja')).toBe('ja');
        expect(localeToLang('ko')).toBe('ko');
        expect(localeToLang('es-ES')).toBe('es');
        expect(localeToLang('es-419')).toBe('es');
        expect(localeToLang('pt-BR')).toBe('pt');
        expect(localeToLang('fr')).toBe('fr');
        expect(localeToLang('de')).toBe('de');
    });
});
