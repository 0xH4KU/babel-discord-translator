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
        first.recordUsage('2026-03-27', 100, 50);
        first.close();

        const second = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        expect(second.getConfigValues(['cooldownSeconds']).cooldownSeconds).toBe(15);
        expect(second.listUserLanguagePreferences()).toEqual([
            { guildId: '', userId: 'user1', language: 'ja' },
        ]);
        expect(second.getUsage('global', '', '2026-03-27')).toEqual({
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
        expect(snapshot.userVisionLimits).toEqual({});
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
        const replacedFirst = store.upsertGuildGlossaryEntry('guild-1', {
            sourceText: 'openai',
            targetLanguage: 'AUTO',
            targetText: 'Open AI',
            notes: 'Updated brand name',
        });

        expect(replacedFirst.id).toBe(first.id);

        expect(store.listGuildGlossary('guild-1')).toEqual([
            {
                id: first.id,
                guildId: 'guild-1',
                sourceText: 'openai',
                targetLanguage: 'AUTO',
                targetText: 'Open AI',
                notes: 'Updated brand name',
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
            'AUTO',
            'ja',
            'zh-TW',
        ]);
        expect(store.listGuildGlossary('guild-1').map((entry) => entry.targetText)).toEqual([
            'Open AI',
            'レイド',
            '團本',
        ]);
        expect(store.listGuildGlossary('guild-2')).toEqual([]);
        expect(store.deleteGuildGlossaryEntry('guild-1', first.id)).toBe(true);
        expect(store.deleteGuildGlossaryEntry('guild-1', first.id)).toBe(false);
        expect(store.listGuildGlossary('guild-1')).toHaveLength(2);

        store.close();
    });

    it('should roll back a glossary batch when any entry fails', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(() =>
            store.upsertGuildGlossaryEntries('guild-1', [
                { sourceText: 'raid', targetText: '團本' },
                { id: 999, sourceText: 'party', targetText: '隊伍' },
            ]),
        ).toThrow('Glossary entry not found');
        expect(store.listGuildGlossary('guild-1')).toEqual([]);

        store.close();
    });

    it('should record and query guild usage by date', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        store.recordUsage('2026-03-26', 80, 40, { guildId: 'guild-1' });
        store.recordUsage('2026-03-27', 100, 50, { guildId: 'guild-1' });

        expect(store.getUsage('guild', 'guild-1', '2026-03-27')).toEqual({
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        expect(store.getUsageHistory('guild', '2026-03-27', ['guild-1'])).toEqual([
            {
                date: '2026-03-26',
                inputTokens: 80,
                outputTokens: 40,
                requests: 1,
            },
        ]);
        expect(store.getUsage('guild', 'guild-2', '2026-03-27')).toBeNull();
        expect(store.getUsageForIds('guild', ['guild-1'], '2026-03-27')).toEqual({
            'guild-1': {
                date: '2026-03-27',
                inputTokens: 100,
                outputTokens: 50,
                requests: 1,
            },
        });
        store.close();
    });

    it('should enforce and persist the monthly Cloud Vision image limit', async () => {
        const { ConfigStore } = await importStoreModule();
        const first = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(first.getVisionMonthlyUsage('2026-08')).toBe(0);
        expect(first.tryConsumeVisionImage('2026-08', 2)).toEqual({
            consumed: true,
            globalUsed: 1,
            scopeUsed: null,
        });
        expect(first.tryConsumeVisionImage('2026-08', 2)).toEqual({
            consumed: true,
            globalUsed: 2,
            scopeUsed: null,
        });
        expect(first.tryConsumeVisionImage('2026-08', 2)).toEqual({
            consumed: false,
            blockedBy: 'global',
            used: 2,
            limit: 2,
        });
        first.close();

        const second = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        expect(second.getVisionMonthlyUsage('2026-08')).toBe(2);
        expect(second.tryConsumeVisionImage('2026-09', 2)).toMatchObject({
            consumed: true,
            globalUsed: 1,
        });
        second.close();
    });

    it('should enforce guild and user Vision limits without consuming the global quota', async () => {
        const { ConfigStore } = await importStoreModule();
        const first = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        first.setVisionScopeLimit('guild', 'guild-1', 1);
        first.setVisionScopeLimit('user', 'user-1', 0);

        expect(
            first.tryConsumeVisionImage('2026-08', 10, {
                scope: 'guild',
                scopeId: 'guild-1',
            }),
        ).toEqual({ consumed: true, globalUsed: 1, scopeUsed: 1 });
        expect(
            first.tryConsumeVisionImage('2026-08', 10, {
                scope: 'guild',
                scopeId: 'guild-1',
            }),
        ).toEqual({ consumed: false, blockedBy: 'guild', used: 1, limit: 1 });
        expect(
            first.tryConsumeVisionImage('2026-08', 10, {
                scope: 'user',
                scopeId: 'user-1',
            }),
        ).toEqual({ consumed: false, blockedBy: 'user', used: 0, limit: 0 });
        expect(first.getVisionMonthlyUsage('2026-08')).toBe(1);
        expect(first.listVisionMonthlyUsage('2026-08', 'guild')).toEqual({ 'guild-1': 1 });
        expect(first.exportSnapshot()).toMatchObject({
            guildVisionLimits: { 'guild-1': 1 },
            userVisionLimits: { 'user-1': 0 },
        });
        first.close();

        const second = new ConfigStore({ dbPath, autoImportLegacyJson: false });
        expect(second.getVisionScopeLimit('guild', 'guild-1')).toBe(1);
        expect(second.clearVisionScopeLimit('guild', 'guild-1')).toBe(true);
        expect(second.getVisionScopeLimit('guild', 'guild-1')).toBeNull();
        second.close();
    });

    it('should calculate shared global usage in SQLite', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        store.setGuildBudget('custom', 1);
        store.recordUsage('2026-03-27', 100, 50);
        store.recordUsage('2026-03-27', 40, 20, { guildId: 'custom' });
        store.recordUsage('2026-03-27', 30, 15, { guildId: 'shared' });

        expect(store.getSharedGlobalUsage('2026-03-27')).toEqual({
            date: '2026-03-27',
            inputTokens: 130,
            outputTokens: 65,
            requests: 2,
        });
        store.close();
    });

    it('should support user budgets and scoped usage', async () => {
        const { ConfigStore } = await importStoreModule();
        const store = new ConfigStore({ dbPath, autoImportLegacyJson: false });

        expect(store.getUserBudget('user-1')).toBeNull();

        store.setUserBudget('user-1', 1.5);
        store.recordUsage('2026-03-26', 80, 40, { userId: 'user-1' });
        store.recordUsage('2026-03-27', 100, 50, { userId: 'user-1' });

        expect(store.getUserBudget('user-1')).toEqual({ dailyBudgetUsd: 1.5 });
        expect(store.getUsage('user', 'user-1', '2026-03-27')).toEqual({
            date: '2026-03-27',
            inputTokens: 100,
            outputTokens: 50,
            requests: 1,
        });
        expect(store.getUsageHistory('user', '2026-03-27', ['user-1'])).toEqual([
            {
                date: '2026-03-26',
                inputTokens: 80,
                outputTokens: 40,
                requests: 1,
            },
        ]);
        expect(store.listUserBudgets()).toEqual({ 'user-1': { dailyBudgetUsd: 1.5 } });
        expect(store.getUsageForIds('user', ['user-1'], '2026-03-27')).toEqual({
            'user-1': {
                date: '2026-03-27',
                inputTokens: 100,
                outputTokens: 50,
                requests: 1,
            },
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
                tokenUsage: {
                    date: '2026-03-27',
                    inputTokens: 100,
                    outputTokens: 50,
                    requests: 1,
                },
                usageHistory: [
                    {
                        date: '2026-03-26',
                        inputTokens: 80,
                        outputTokens: 40,
                        requests: 2,
                    },
                ],
                guildTokenUsage: {
                    'guild-1': {
                        date: '2026-03-27',
                        inputTokens: 60,
                        outputTokens: 30,
                        requests: 1,
                    },
                },
                userTokenUsage: {
                    'user-1': {
                        date: '2026-03-27',
                        inputTokens: 40,
                        outputTokens: 20,
                        requests: 1,
                    },
                },
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
        expect(store.exportSnapshot()).toMatchObject({
            tokenUsage: {
                date: '2026-03-27',
                inputTokens: 100,
                outputTokens: 50,
                requests: 1,
            },
            usageHistory: [
                {
                    date: '2026-03-26',
                    inputTokens: 80,
                    outputTokens: 40,
                    requests: 2,
                },
            ],
            guildTokenUsage: {
                'guild-1': expect.objectContaining({ inputTokens: 60 }),
            },
            userTokenUsage: {
                'user-1': expect.objectContaining({ inputTokens: 40 }),
            },
        });
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
