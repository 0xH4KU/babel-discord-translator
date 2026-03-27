/**
 * SQLite-backed configuration store.
 * Keeps the legacy get/set/update/getAll API so repository callers stay stable
 * while persistence moves away from the old JSON file.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createSqliteDatabase, getSqliteDatabase, inTransaction, isSqliteStoreEmpty } from './persistence/sqlite-database.js';
import { readLegacyStoreData, resolveLegacyConfigPath } from './persistence/legacy-json-store.js';
import { CONFIG_VALUE_KEYS, DEFAULT_STORE_DATA, type ConfigValueKey } from './persistence/store-defaults.js';
import type { GuildBudgetConfig, StoreData, TokenUsage, UsageHistoryEntry } from './types.js';

interface ConfigStoreOptions {
    db?: DatabaseSync;
    dbPath?: string;
    autoImportLegacyJson?: boolean;
    legacyConfigPath?: string;
    logger?: Pick<Console, 'log' | 'error'>;
}

const CONFIG_KEYS = new Set<keyof StoreData>(CONFIG_VALUE_KEYS);

function cloneTokenUsage(usage: TokenUsage | null): TokenUsage | null {
    return usage ? { ...usage } : null;
}

function cloneUsageHistory(history: UsageHistoryEntry[]): UsageHistoryEntry[] {
    return history.map((entry) => ({ ...entry }));
}

function cloneGuildBudgets(budgets: Record<string, GuildBudgetConfig>): Record<string, GuildBudgetConfig> {
    return Object.fromEntries(
        Object.entries(budgets).map(([guildId, budget]) => [guildId, { ...budget }]),
    );
}

function cloneGuildUsage(usage: Record<string, TokenUsage>): Record<string, TokenUsage> {
    return Object.fromEntries(
        Object.entries(usage).map(([guildId, entry]) => [guildId, { ...entry }]),
    );
}

function cloneGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): Record<string, UsageHistoryEntry[]> {
    return Object.fromEntries(
        Object.entries(history).map(([guildId, entries]) => [guildId, cloneUsageHistory(entries)]),
    );
}

export class ConfigStore {
    private readonly db: DatabaseSync;

    private readonly ownsDatabase: boolean;

    private readonly logger: Pick<Console, 'log' | 'error'>;

    constructor({
        db,
        dbPath,
        autoImportLegacyJson = true,
        legacyConfigPath = resolveLegacyConfigPath(),
        logger = console,
    }: ConfigStoreOptions = {}) {
        this.ownsDatabase = !db && !!dbPath;
        this.db = db ?? (dbPath ? createSqliteDatabase(dbPath) : getSqliteDatabase());
        this.logger = logger;

        if (autoImportLegacyJson && isSqliteStoreEmpty(this.db)) {
            try {
                const legacyData = readLegacyStoreData(legacyConfigPath);
                if (legacyData) {
                    this.update(legacyData);
                    this.logger.log(`[Store] Imported legacy JSON data from ${legacyConfigPath}`);
                }
            } catch (error) {
                this.logger.error(`[Store] Legacy JSON import failed: ${(error as Error).message}`);
            }
        }
    }

    get<K extends keyof StoreData>(key: K): StoreData[K] {
        if (CONFIG_KEYS.has(key)) {
            return this.getConfigValue(key as ConfigValueKey) as StoreData[K];
        }

        switch (key) {
            case 'tokenUsage':
                return this.getDailyUsage() as StoreData[K];
            case 'usageHistory':
                return this.getUsageHistory() as StoreData[K];
            case 'userLanguagePrefs':
                return this.getUserLanguagePrefs() as StoreData[K];
            case 'guildBudgets':
                return this.getGuildBudgets() as StoreData[K];
            case 'guildTokenUsage':
                return this.getGuildTokenUsage() as StoreData[K];
            case 'guildUsageHistory':
                return this.getGuildUsageHistory() as StoreData[K];
            default:
                return DEFAULT_STORE_DATA[key];
        }
    }

    set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
        inTransaction(this.db, () => {
            this.setValue(key, value);
        });
    }

    update(obj: Partial<StoreData>): void {
        inTransaction(this.db, () => {
            for (const [key, value] of Object.entries(obj) as Array<[keyof StoreData, StoreData[keyof StoreData]]>) {
                this.setValue(key, value);
            }
        });
    }

    getAll(): StoreData {
        return {
            vertexAiApiKey: this.getConfigValue('vertexAiApiKey'),
            gcpProject: this.getConfigValue('gcpProject'),
            gcpLocation: this.getConfigValue('gcpLocation'),
            geminiModel: this.getConfigValue('geminiModel'),
            allowedGuildIds: [...this.getConfigValue('allowedGuildIds')],
            cooldownSeconds: this.getConfigValue('cooldownSeconds'),
            cacheMaxSize: this.getConfigValue('cacheMaxSize'),
            setupComplete: this.getConfigValue('setupComplete'),
            inputPricePerMillion: this.getConfigValue('inputPricePerMillion'),
            outputPricePerMillion: this.getConfigValue('outputPricePerMillion'),
            dailyBudgetUsd: this.getConfigValue('dailyBudgetUsd'),
            tokenUsage: cloneTokenUsage(this.getDailyUsage()),
            usageHistory: cloneUsageHistory(this.getUsageHistory()),
            translationPrompt: this.getConfigValue('translationPrompt'),
            userLanguagePrefs: { ...this.getUserLanguagePrefs() },
            maxInputLength: this.getConfigValue('maxInputLength'),
            maxOutputTokens: this.getConfigValue('maxOutputTokens'),
            guildBudgets: cloneGuildBudgets(this.getGuildBudgets()),
            guildTokenUsage: cloneGuildUsage(this.getGuildTokenUsage()),
            guildUsageHistory: cloneGuildUsageHistory(this.getGuildUsageHistory()),
        };
    }

    isSetupComplete(): boolean {
        return this.getConfigValue('setupComplete') === true;
    }

    close(): void {
        if (this.ownsDatabase && this.db.isOpen) {
            this.db.close();
        }
    }

    private getConfigValue<K extends ConfigValueKey>(key: K): StoreData[K] {
        const row = this.db.prepare(`
            SELECT value_json
            FROM app_config
            WHERE key = ?
        `).get(key) as { value_json: string } | undefined;

        if (!row) {
            return structuredClone(DEFAULT_STORE_DATA[key]);
        }

        return JSON.parse(row.value_json) as StoreData[K];
    }

    private getDailyUsage(): TokenUsage | null {
        const row = this.db.prepare(`
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM daily_usage
            WHERE id = 1
        `).get() as TokenUsage | undefined;

        return row ? { ...row } : null;
    }

    private getUsageHistory(): UsageHistoryEntry[] {
        const rows = this.db.prepare(`
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM usage_history
            ORDER BY date ASC
        `).all() as unknown as UsageHistoryEntry[];

        return rows.map((row) => ({ ...row }));
    }

    private getUserLanguagePrefs(): Record<string, string> {
        const rows = this.db.prepare(`
            SELECT user_id as userId, language
            FROM user_language_preferences
            ORDER BY user_id ASC
        `).all() as Array<{ userId: string; language: string }>;

        return Object.fromEntries(rows.map((row) => [row.userId, row.language]));
    }

    private getGuildBudgets(): Record<string, GuildBudgetConfig> {
        const rows = this.db.prepare(`
            SELECT guild_id as guildId, daily_budget_usd as dailyBudgetUsd
            FROM guild_budgets
            ORDER BY guild_id ASC
        `).all() as Array<{ guildId: string; dailyBudgetUsd: number }>;

        return Object.fromEntries(
            rows.map((row) => [row.guildId, { dailyBudgetUsd: row.dailyBudgetUsd }]),
        );
    }

    private getGuildTokenUsage(): Record<string, TokenUsage> {
        const rows = this.db.prepare(`
            SELECT guild_id as guildId, date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM guild_daily_usage
            ORDER BY guild_id ASC
        `).all() as unknown as Array<{ guildId: string } & TokenUsage>;

        return Object.fromEntries(
            rows.map(({ guildId, ...usage }) => [guildId, { ...usage }]),
        );
    }

    private getGuildUsageHistory(): Record<string, UsageHistoryEntry[]> {
        const rows = this.db.prepare(`
            SELECT guild_id as guildId, date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM guild_usage_history
            ORDER BY guild_id ASC, date ASC
        `).all() as unknown as Array<{ guildId: string } & UsageHistoryEntry>;

        const history: Record<string, UsageHistoryEntry[]> = {};
        for (const { guildId, ...entry } of rows) {
            history[guildId] ??= [];
            history[guildId].push({ ...entry });
        }

        return history;
    }

    private setValue<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
        if (CONFIG_KEYS.has(key)) {
            this.db.prepare(`
                INSERT INTO app_config (key, value_json)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
            `).run(key, JSON.stringify(value));
            return;
        }

        switch (key) {
            case 'tokenUsage':
                this.replaceDailyUsage(value as StoreData['tokenUsage']);
                return;
            case 'usageHistory':
                this.replaceUsageHistory(value as StoreData['usageHistory']);
                return;
            case 'userLanguagePrefs':
                this.replaceUserLanguagePrefs(value as StoreData['userLanguagePrefs']);
                return;
            case 'guildBudgets':
                this.replaceGuildBudgets(value as StoreData['guildBudgets']);
                return;
            case 'guildTokenUsage':
                this.replaceGuildTokenUsage(value as StoreData['guildTokenUsage']);
                return;
            case 'guildUsageHistory':
                this.replaceGuildUsageHistory(value as StoreData['guildUsageHistory']);
                return;
        }
    }

    private replaceDailyUsage(usage: TokenUsage | null): void {
        this.db.exec('DELETE FROM daily_usage');
        if (!usage) {
            return;
        }

        this.db.prepare(`
            INSERT INTO daily_usage (id, date, input_tokens, output_tokens, requests)
            VALUES (1, ?, ?, ?, ?)
        `).run(usage.date, usage.inputTokens, usage.outputTokens, usage.requests);
    }

    private replaceUsageHistory(history: UsageHistoryEntry[]): void {
        this.db.exec('DELETE FROM usage_history');
        const insert = this.db.prepare(`
            INSERT INTO usage_history (date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?)
        `);

        for (const entry of history) {
            insert.run(entry.date, entry.inputTokens, entry.outputTokens, entry.requests);
        }
    }

    private replaceUserLanguagePrefs(prefs: Record<string, string>): void {
        this.db.exec('DELETE FROM user_language_preferences');
        const insert = this.db.prepare(`
            INSERT INTO user_language_preferences (user_id, language)
            VALUES (?, ?)
        `);

        for (const [userId, language] of Object.entries(prefs)) {
            insert.run(userId, language);
        }
    }

    private replaceGuildBudgets(budgets: Record<string, GuildBudgetConfig>): void {
        this.db.exec('DELETE FROM guild_budgets');
        const insert = this.db.prepare(`
            INSERT INTO guild_budgets (guild_id, daily_budget_usd)
            VALUES (?, ?)
        `);

        for (const [guildId, budget] of Object.entries(budgets)) {
            insert.run(guildId, budget.dailyBudgetUsd);
        }
    }

    private replaceGuildTokenUsage(usage: Record<string, TokenUsage>): void {
        this.db.exec('DELETE FROM guild_daily_usage');
        const insert = this.db.prepare(`
            INSERT INTO guild_daily_usage (guild_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const [guildId, entry] of Object.entries(usage)) {
            insert.run(guildId, entry.date, entry.inputTokens, entry.outputTokens, entry.requests);
        }
    }

    private replaceGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        this.db.exec('DELETE FROM guild_usage_history');
        const insert = this.db.prepare(`
            INSERT INTO guild_usage_history (guild_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const [guildId, entries] of Object.entries(history)) {
            for (const entry of entries) {
                insert.run(guildId, entry.date, entry.inputTokens, entry.outputTokens, entry.requests);
            }
        }
    }
}

export const store = new ConfigStore({
    autoImportLegacyJson: process.env.NODE_ENV !== 'test',
});
