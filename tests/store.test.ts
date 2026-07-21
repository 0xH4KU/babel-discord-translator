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
        return import('../src/persistence/store.js');
    }

    it('should initialize with defaults when no database rows exist', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.getConfigValues(['cooldownSeconds', 'cacheMaxSize', 'setupComplete'])).toEqual(
            {
                cooldownSeconds: 5,
                cacheMaxSize: 2000,
                setupComplete: false,
            },
        );

        store.close();
    });

    it('should persist values across store instances', async () => {
        const { ConfigStore } = await importStoreModule();

        const first = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        first.updateConfigValues({ cooldownSeconds: 15 });
        first.setUserLanguage('', 'user1', 'ja');
        first.saveDailyUsage({
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        first.close();

        const second = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        expect(second.getConfigValues(['cooldownSeconds']).cooldownSeconds).toBe(15);
        expect(second.listUserLanguagePreferences()).toEqual([
            { guildId: '', userId: 'user1', language: 'ja' },
        ]);
        expect(second.getDailyUsage()).toEqual({
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

        store.updateConfigValues({ cooldownSeconds: 20, cacheMaxSize: 500, setupComplete: true });

        expect(store.getConfigValues(['cooldownSeconds', 'cacheMaxSize', 'setupComplete'])).toEqual(
            {
                cooldownSeconds: 20,
                cacheMaxSize: 500,
                setupComplete: true,
            },
        );
        store.close();
    });

    it('should return a defensive export snapshot', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        const all = store.exportSnapshot();
        all.cooldownSeconds = 999;
        all.allowedGuildIds.push('guild-1');

        expect(store.getConfigValues(['cooldownSeconds', 'allowedGuildIds'])).toEqual({
            cooldownSeconds: 5,
            allowedGuildIds: [],
        });
        store.close();
    });

    it('should include empty user-install collections in snapshots', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        const snapshot = store.exportSnapshot();

        expect(snapshot.userBudgets).toEqual({});
        expect(snapshot.userTokenUsage).toEqual({});
        expect(snapshot.userUsageHistory).toEqual({});
        store.close();
    });

    it('should return only requested config keys and preserve defensive copies', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        store.updateConfigValues({
            cooldownSeconds: 12,
            allowedGuildIds: ['guild-1'],
        });
        store.setUserLanguage('', 'user1', 'ja');

        const runtimeConfig = store.getConfigValues(['cooldownSeconds', 'allowedGuildIds']);
        runtimeConfig.allowedGuildIds.push('guild-2');

        expect(runtimeConfig).toEqual({
            cooldownSeconds: 12,
            allowedGuildIds: ['guild-1', 'guild-2'],
        });
        expect(Object.keys(runtimeConfig).sort()).toEqual(['allowedGuildIds', 'cooldownSeconds']);
        expect(store.getConfigValues(['cooldownSeconds', 'allowedGuildIds'])).toEqual({
            cooldownSeconds: 12,
            allowedGuildIds: ['guild-1'],
        });
        expect(store.getUserLanguage('', 'user1')).toBe('ja');
        store.close();
    });

    it('should support guild-scoped user language preferences', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.getUserLanguage('guild-1', 'user-1')).toBeNull();

        store.setUserLanguage('guild-1', 'user-1', 'ja');
        store.setUserLanguage('guild-2', 'user-1', 'ko');
        store.setUserLanguage('guild-1', 'user-2', 'zh-TW');

        expect(store.getUserLanguage('guild-1', 'user-1')).toBe('ja');
        expect(store.getUserLanguage('guild-2', 'user-1')).toBe('ko');
        expect(store.getUserLanguage('guild-3', 'user-1')).toBeNull();
        expect(store.listUserLanguagePreferences()).toEqual([
            { guildId: 'guild-1', userId: 'user-1', language: 'ja' },
            { guildId: 'guild-1', userId: 'user-2', language: 'zh-TW' },
            { guildId: 'guild-2', userId: 'user-1', language: 'ko' },
        ]);

        expect(store.deleteUserLanguage('guild-1', 'user-1')).toBe(true);
        expect(store.getUserLanguage('guild-1', 'user-1')).toBeNull();
        expect(store.getUserLanguage('guild-2', 'user-1')).toBe('ko');
        expect(store.deleteUserLanguage('guild-1', 'user-1')).toBe(false);
        store.close();
    });

    it('should report isSetupComplete correctly', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.isSetupComplete()).toBe(false);

        store.updateConfigValues({ setupComplete: true });
        expect(store.isSetupComplete()).toBe(true);
        store.close();
    });

    it('should support direct guild budget operations', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.getGuildBudget('guild-1')).toBeNull();

        store.setGuildBudget('guild-1', 2.5);
        expect(store.getGuildBudget('guild-1')).toEqual({ dailyBudgetUsd: 2.5 });
        expect(store.listGuildBudgets()).toEqual({ 'guild-1': { dailyBudgetUsd: 2.5 } });

        expect(store.clearGuildBudget('guild-1')).toBe(true);
        expect(store.getGuildBudget('guild-1')).toBeNull();
        expect(store.clearGuildBudget('guild-1')).toBe(false);
        store.close();
    });

    it('should support per-guild glossary operations', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.listGuildGlossary('guild-1')).toEqual([]);

        const first = store.upsertGuildGlossaryEntry('guild-1', {
            sourceText: 'OpenAI',
            targetText: 'OpenAI',
            notes: 'Preserve brand name',
        });
        const second = store.upsertGuildGlossaryEntry('guild-1', {
            sourceText: 'raid',
            targetText: '副本',
        });
        const third = store.upsertGuildGlossaryEntry('guild-1', {
            sourceText: 'raid',
            targetLanguage: 'ja',
            targetText: 'レイド',
            notes: 'Game term',
        });

        expect(store.listGuildGlossary('guild-1')).toEqual([
            {
                id: first.id,
                guildId: 'guild-1',
                sourceText: 'OpenAI',
                targetLanguage: 'auto',
                targetText: 'OpenAI',
                notes: 'Preserve brand name',
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            },
            {
                id: second.id,
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'auto',
                targetText: '副本',
                notes: '',
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            },
            {
                id: third.id,
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'ja',
                targetText: 'レイド',
                notes: 'Game term',
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            },
        ]);

        const updated = store.upsertGuildGlossaryEntry('guild-1', {
            id: second.id,
            sourceText: 'raid',
            targetLanguage: 'zh-TW',
            targetText: '團本',
            notes: 'Game term',
        });

        expect(updated.id).toBe(second.id);
        expect(store.listGuildGlossary('guild-1').map((entry) => entry.targetLanguage)).toEqual([
            'auto',
            'ja',
            'zh-TW',
        ]);
        expect(store.listGuildGlossary('guild-1').map((entry) => entry.targetText)).toEqual([
            'OpenAI',
            'レイド',
            '團本',
        ]);
        expect(store.listGuildGlossary('guild-2')).toEqual([]);
        expect(store.deleteGuildGlossaryEntry('guild-1', first.id)).toBe(true);
        expect(store.deleteGuildGlossaryEntry('guild-1', first.id)).toBe(false);
        expect(store.listGuildGlossary('guild-1')).toHaveLength(2);

        store.close();
    });

    it('should support direct guild usage operations', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        store.saveGuildDailyUsage('guild-1', {
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        store.saveGuildUsageHistory('guild-1', [
            {
                date: '2026-03-26',
                inputTokens: 80,
                outputTokens: 40,
                requests: 2,
            },
        ]);

        expect(store.getGuildDailyUsage('guild-1')).toEqual({
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        expect(store.getGuildUsageHistory('guild-1')).toEqual([
            {
                date: '2026-03-26',
                inputTokens: 80,
                outputTokens: 40,
                requests: 2,
            },
        ]);
        expect(store.getGuildDailyUsage('guild-2')).toBeNull();
        expect(store.getGuildUsageHistory('guild-2')).toEqual([]);
        store.close();
    });

    it('should support direct user budget and usage operations', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.getUserBudget('user-1')).toBeNull();

        store.setUserBudget('user-1', 1.5);
        store.saveUserDailyUsage('user-1', {
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        store.saveUserUsageHistory('user-1', [
            {
                date: '2026-03-26',
                inputTokens: 80,
                outputTokens: 40,
                requests: 2,
            },
        ]);

        expect(store.getUserBudget('user-1')).toEqual({ dailyBudgetUsd: 1.5 });
        expect(store.getUserDailyUsage('user-1')).toEqual({
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        expect(store.getUserUsageHistory('user-1')).toEqual([
            {
                date: '2026-03-26',
                inputTokens: 80,
                outputTokens: 40,
                requests: 2,
            },
        ]);
        expect(store.listUserBudgets()).toEqual({ 'user-1': { dailyBudgetUsd: 1.5 } });
        expect(store.getAllUserDailyUsage()).toEqual({
            'user-1': {
                date: '2026-03-27',
                inputTokens: 100,
                outputTokens: 50,
                requests: 1,
            },
        });
        expect(store.getAllUserUsageHistory()).toEqual({
            'user-1': [
                {
                    date: '2026-03-26',
                    inputTokens: 80,
                    outputTokens: 40,
                    requests: 2,
                },
            ],
        });

        expect(store.clearUserBudget('user-1')).toBe(true);
        expect(store.getUserBudget('user-1')).toBeNull();
        expect(store.clearUserBudget('user-1')).toBe(false);
        store.close();
    });

    it('should import legacy JSON data into a fresh SQLite database', async () => {
        writeFileSync(
            legacyConfigPath,
            JSON.stringify({
                cooldownSeconds: 10,
                setupComplete: true,
                userLanguagePrefs: { user2: 'ko' },
            }),
        );

        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, legacyConfigPath });

        expect(store.getConfigValues(['cooldownSeconds', 'setupComplete'])).toEqual({
            cooldownSeconds: 10,
            setupComplete: true,
        });
        expect(store.listUserLanguagePreferences()).toEqual([
            { guildId: '', userId: 'user2', language: 'ko' },
        ]);
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

        expect(store.getConfigValues(['cooldownSeconds']).cooldownSeconds).toBe(5);
        expect(logger.error).toHaveBeenCalledOnce();
        store.close();
    });
});
