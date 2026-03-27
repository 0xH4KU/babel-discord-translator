import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ConfigStore', () => {
    let tempDir: string;
    let dbPath: string;
    let legacyConfigPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'babel-store-'));
        dbPath = join(tempDir, 'babel.sqlite');
        legacyConfigPath = join(tempDir, 'config.json');
    });

    afterEach(async () => {
        delete process.env.BABEL_DB_PATH;
        delete process.env.BABEL_LEGACY_CONFIG_PATH;

        vi.resetModules();
        const { closeSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        closeSqliteDatabase();

        rmSync(tempDir, { recursive: true, force: true });
    });

    async function importStoreModule() {
        vi.resetModules();
        process.env.BABEL_DB_PATH = dbPath;
        process.env.BABEL_LEGACY_CONFIG_PATH = legacyConfigPath;
        return import('../src/store.js');
    }

    it('should initialize with defaults when no database rows exist', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.get('cooldownSeconds')).toBe(5);
        expect(store.get('cacheMaxSize')).toBe(2000);
        expect(store.get('setupComplete')).toBe(false);

        store.close();
    });

    it('should persist values across store instances', async () => {
        const { ConfigStore } = await importStoreModule();

        const first = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        first.set('cooldownSeconds', 15);
        first.set('userLanguagePrefs', { user1: 'ja' });
        first.set('tokenUsage', {
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        first.close();

        const second = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        expect(second.get('cooldownSeconds')).toBe(15);
        expect(second.get('userLanguagePrefs')).toEqual({ user1: 'ja' });
        expect(second.get('tokenUsage')).toEqual({
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        second.close();
    });

    it('should update multiple values at once', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        store.update({ cooldownSeconds: 20, cacheMaxSize: 500, setupComplete: true });

        expect(store.get('cooldownSeconds')).toBe(20);
        expect(store.get('cacheMaxSize')).toBe(500);
        expect(store.get('setupComplete')).toBe(true);
        store.close();
    });

    it('should return a copy from getAll()', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        const all = store.getAll();
        all.cooldownSeconds = 999;
        all.allowedGuildIds.push('guild-1');

        expect(store.get('cooldownSeconds')).toBe(5);
        expect(store.get('allowedGuildIds')).toEqual([]);
        store.close();
    });

    it('should report isSetupComplete correctly', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.isSetupComplete()).toBe(false);

        store.set('setupComplete', true);
        expect(store.isSetupComplete()).toBe(true);
        store.close();
    });

    it('should import legacy JSON data into a fresh SQLite database', async () => {
        writeFileSync(legacyConfigPath, JSON.stringify({
            cooldownSeconds: 10,
            setupComplete: true,
            userLanguagePrefs: { user2: 'ko' },
        }));

        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, legacyConfigPath });

        expect(store.get('cooldownSeconds')).toBe(10);
        expect(store.get('setupComplete')).toBe(true);
        expect(store.get('userLanguagePrefs')).toEqual({ user2: 'ko' });
        store.close();
    });

    it('should fall back to defaults when legacy JSON is corrupt', async () => {
        writeFileSync(legacyConfigPath, 'not json at all {{{');
        const logger = {
            info: vi.fn(),
            error: vi.fn(),
        };

        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, legacyConfigPath, logger });

        expect(store.get('cooldownSeconds')).toBe(5);
        expect(logger.error).toHaveBeenCalledOnce();
        store.close();
    });
});
