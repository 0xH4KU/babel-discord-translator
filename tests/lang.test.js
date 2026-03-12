import { describe, it, expect } from 'vitest';
import { localeToLang, detectScript, langToScript, isSameLanguage } from '../src/lang.js';

describe('localeToLang', () => {
    it('should return null for null/undefined input', () => {
        expect(localeToLang(null)).toBeNull();
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

describe('detectScript', () => {
    it('should detect Chinese characters', () => {
        expect(detectScript('你好世界')).toBe('zh');
        expect(detectScript('這是繁體中文')).toBe('zh');
    });

    it('should detect Japanese (kana takes priority over kanji)', () => {
        expect(detectScript('こんにちは')).toBe('ja');
        expect(detectScript('カタカナ')).toBe('ja');
        // Mixed kanji + kana should detect as Japanese
        expect(detectScript('日本語のテスト')).toBe('ja');
    });

    it('should detect Korean', () => {
        expect(detectScript('안녕하세요')).toBe('ko');
    });

    it('should detect Cyrillic (Russian)', () => {
        expect(detectScript('Привет мир')).toBe('ru');
    });

    it('should detect Arabic', () => {
        expect(detectScript('مرحبا بالعالم')).toBe('ar');
    });

    it('should detect Thai', () => {
        expect(detectScript('สวัสดีครับ')).toBe('th');
    });

    it('should detect Hindi (Devanagari)', () => {
        expect(detectScript('नमस्ते')).toBe('hi');
    });

    it('should return null for Latin script', () => {
        expect(detectScript('Hello world')).toBeNull();
        expect(detectScript('Bonjour le monde')).toBeNull();
    });

    it('should return null for empty string', () => {
        expect(detectScript('')).toBeNull();
    });

    it('should return null for numbers and punctuation only', () => {
        expect(detectScript('12345!@#$%')).toBeNull();
    });

    it('should return null for emoji-only text', () => {
        expect(detectScript('😀🎉🔥')).toBeNull();
    });

    it('should handle mixed Latin + CJK (CJK detected)', () => {
        expect(detectScript('Hello 你好')).toBe('zh');
    });
});

describe('langToScript', () => {
    it('should return null for null/undefined input', () => {
        expect(langToScript(null)).toBeNull();
        expect(langToScript(undefined)).toBeNull();
    });

    it('should map Chinese locale codes to zh', () => {
        expect(langToScript('zh-TW')).toBe('zh');
        expect(langToScript('zh-CN')).toBe('zh');
        expect(langToScript('zh')).toBe('zh');
    });

    it('should map Japanese, Korean, Russian', () => {
        expect(langToScript('ja')).toBe('ja');
        expect(langToScript('ko')).toBe('ko');
        expect(langToScript('ru')).toBe('ru');
    });

    it('should map Arabic, Thai, Hindi', () => {
        expect(langToScript('ar')).toBe('ar');
        expect(langToScript('th')).toBe('th');
        expect(langToScript('hi')).toBe('hi');
    });

    it('should return null for Latin-script languages', () => {
        expect(langToScript('en')).toBeNull();
        expect(langToScript('fr')).toBeNull();
        expect(langToScript('de')).toBeNull();
        expect(langToScript('es')).toBeNull();
    });

    it('should fall back to base code for hyphenated codes', () => {
        // 'ja-JP' → base 'ja' → 'ja'
        expect(langToScript('ja-JP')).toBe('ja');
    });
});

describe('isSameLanguage', () => {
    it('should return false for Latin text (always pass through)', () => {
        expect(isSameLanguage('Hello world', 'en', 'en-US')).toBe(false);
        expect(isSameLanguage('Bonjour', 'fr', 'fr')).toBe(false);
    });

    it('should return true when Chinese content + Chinese target', () => {
        expect(isSameLanguage('你好世界', 'zh-TW', 'zh-TW')).toBe(true);
        expect(isSameLanguage('你好世界', 'zh-CN', 'zh-CN')).toBe(true);
    });

    it('should return false when Chinese content + Japanese target', () => {
        expect(isSameLanguage('你好世界', 'ja', 'ja')).toBe(false);
    });

    it('should return true when Korean content + Korean target', () => {
        expect(isSameLanguage('안녕하세요', 'ko', 'ko')).toBe(true);
    });

    it('should handle auto mode — match against user locale', () => {
        // Chinese content, auto mode, user locale is zh-TW → same
        expect(isSameLanguage('你好', 'auto', 'zh-TW')).toBe(true);
        // Chinese content, auto mode, user locale is ja → different
        expect(isSameLanguage('你好', 'auto', 'ja')).toBe(false);
        // Chinese content, auto mode, user locale is en-US → en has no script, false
        expect(isSameLanguage('你好', 'auto', 'en-US')).toBe(false);
    });

    it('should return false in auto mode for Latin content', () => {
        expect(isSameLanguage('Hello', 'auto', 'en-US')).toBe(false);
    });

    it('should detect Russian content matches Russian target', () => {
        expect(isSameLanguage('Привет', 'ru', 'ru')).toBe(true);
    });
});
