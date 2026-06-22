/**
 * SQLite-backed configuration store.
 * Keeps the legacy get/set/update/getAll API so repository callers stay stable
 * while persistence moves away from the old JSON file.
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
    createSqliteDatabase,
    getSqliteDatabase,
    inTransaction,
    isSqliteStoreEmpty,
} from './sqlite-database.js';
import { readLegacyStoreData, resolveLegacyConfigPath } from './legacy-json-store.js';
import { CONFIG_VALUE_KEYS, DEFAULT_STORE_DATA, type ConfigValueKey } from './store-defaults.js';
import {
    cloneGuildBudgets,
    cloneGuildDailyUsage,
    cloneGuildUsageHistory,
    cloneTokenUsage,
    cloneUsageHistory,
    cloneUserBudgets,
    cloneUserDailyUsage,
    cloneUserUsageHistory,
} from './store-data-normalizer.js';
import { appLogger, type StructuredLogger } from '../shared/structured-logger.js';
import type {
    GuildBudgetConfig,
    GuildGlossaryEntry,
    GuildGlossaryInput,
    StoreData,
    TokenUsage,
    UsageHistoryEntry,
    UserBudgetConfig,
} from '../shared/types.js';

interface ConfigStoreOptions {
    db?: DatabaseSync;
    dbPath?: string;
    autoImportLegacyJson?: boolean;
    legacyConfigPath?: string;
    logger?: StructuredLogger;
}

const CONFIG_KEYS = new Set<keyof StoreData>(CONFIG_VALUE_KEYS);

function cloneConfigValue<K extends ConfigValueKey>(value: StoreData[K]): StoreData[K] {
    return Array.isArray(value) ? ([...value] as StoreData[K]) : value;
}

export class ConfigStore {
    private readonly db: DatabaseSync;

    private readonly ownsDatabase: boolean;

    private readonly logger: StructuredLogger;

    private readonly statements = new Map<string, StatementSync>();

    /**
     * In-memory cache of parsed app_config values. Kept consistent with the
     * database via setValue() for writes on this connection and via
     * PRAGMA data_version for writes from other connections/processes.
     */
    private readonly configCache = new Map<ConfigValueKey, StoreData[ConfigValueKey]>();

    private lastDataVersion: number | null = null;

    constructor({
        db,
        dbPath,
        autoImportLegacyJson = true,
        legacyConfigPath = resolveLegacyConfigPath(),
        logger = appLogger.child({ component: 'store' }),
    }: ConfigStoreOptions = {}) {
        this.ownsDatabase = !db && !!dbPath;
        this.db = db ?? (dbPath ? createSqliteDatabase(dbPath) : getSqliteDatabase());
        this.logger = logger;

        if (autoImportLegacyJson && isSqliteStoreEmpty(this.db)) {
            try {
                const legacyData = readLegacyStoreData(legacyConfigPath);
                if (legacyData) {
                    this.update(legacyData);
                    this.logger.info('store.legacy_import.completed', {
                        legacyConfigPath,
                    });
                }
            } catch (error) {
                this.logger.error('store.legacy_import.failed', {
                    legacyConfigPath,
                    error: (error as Error).message,
                });
            }
        }
    }

    /** Prepare a statement once per SQL string and reuse it for later calls. */
    private stmt(sql: string): StatementSync {
        let statement = this.statements.get(sql);
        if (!statement) {
            statement = this.db.prepare(sql);
            this.statements.set(sql, statement);
        }
        return statement;
    }

    /**
     * Drop cached config values when another connection has written to the
     * database. SQLite bumps data_version only for external commits, so this
     * stays a no-op (one cheap PRAGMA read) in the common single-process case.
     */
    private invalidateConfigCacheIfExternallyChanged(): void {
        const row = this.stmt('PRAGMA data_version').get() as { data_version: number };
        if (this.lastDataVersion !== row.data_version) {
            this.lastDataVersion = row.data_version;
            this.configCache.clear();
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
                return this.getAllGuildBudgets() as StoreData[K];
            case 'guildTokenUsage':
                return this.getGuildTokenUsage() as StoreData[K];
            case 'guildUsageHistory':
                return this.getAllGuildUsageHistory() as StoreData[K];
            case 'userBudgets':
                return this.getAllUserBudgets() as StoreData[K];
            case 'userTokenUsage':
                return this.getUserTokenUsage() as StoreData[K];
            case 'userUsageHistory':
                return this.getAllUserUsageHistory() as StoreData[K];
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
            for (const [key, value] of Object.entries(obj) as Array<
                [keyof StoreData, StoreData[keyof StoreData]]
            >) {
                this.setValue(key, value);
            }
        });
    }

    getConfigValues<K extends ConfigValueKey>(keys: readonly K[]): Pick<StoreData, K> {
        if (keys.length === 0) {
            return {} as Pick<StoreData, K>;
        }

        this.invalidateConfigCacheIfExternallyChanged();

        const missing = keys.filter((key) => !this.configCache.has(key));
        if (missing.length > 0) {
            const placeholders = missing.map(() => '?').join(', ');
            const rows = this.stmt(
                `
            SELECT key, value_json
            FROM app_config
            WHERE key IN (${placeholders})
        `,
            ).all(...missing) as Array<{ key: K; value_json: string }>;

            const valuesByKey = new Map(rows.map((row) => [row.key, row.value_json]));
            for (const key of missing) {
                const valueJson = valuesByKey.get(key);
                this.configCache.set(
                    key,
                    valueJson === undefined
                        ? structuredClone(DEFAULT_STORE_DATA[key])
                        : (JSON.parse(valueJson) as StoreData[K]),
                );
            }
        }

        const result = {} as Pick<StoreData, K>;
        for (const key of keys) {
            result[key] = cloneConfigValue(this.configCache.get(key) as StoreData[K]);
        }

        return result;
    }

    getAll(): StoreData {
        return {
            ...this.getConfigValues(CONFIG_VALUE_KEYS),
            tokenUsage: cloneTokenUsage(this.getDailyUsage()),
            usageHistory: cloneUsageHistory(this.getUsageHistory()),
            userLanguagePrefs: { ...this.getUserLanguagePrefs() },
            guildBudgets: cloneGuildBudgets(this.getAllGuildBudgets()),
            guildTokenUsage: cloneGuildDailyUsage(this.getGuildTokenUsage()),
            guildUsageHistory: cloneGuildUsageHistory(this.getAllGuildUsageHistory()),
            userBudgets: cloneUserBudgets(this.getAllUserBudgets()),
            userTokenUsage: cloneUserDailyUsage(this.getUserTokenUsage()),
            userUsageHistory: cloneUserUsageHistory(this.getAllUserUsageHistory()),
        };
    }

    isSetupComplete(): boolean {
        return this.getConfigValue('setupComplete') === true;
    }

    getGuildBudget(guildId: string): GuildBudgetConfig | null {
        const row = this.stmt(
            `
            SELECT daily_budget_usd as dailyBudgetUsd
            FROM guild_budgets
            WHERE guild_id = ?
        `,
        ).get(guildId) as GuildBudgetConfig | undefined;

        return row ? { ...row } : null;
    }

    setGuildBudget(guildId: string, dailyBudgetUsd: number): void {
        this.stmt(
            `
            INSERT INTO guild_budgets (guild_id, daily_budget_usd)
            VALUES (?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET daily_budget_usd = excluded.daily_budget_usd
        `,
        ).run(guildId, dailyBudgetUsd);
    }

    clearGuildBudget(guildId: string): boolean {
        if (!this.getGuildBudget(guildId)) {
            return false;
        }

        this.stmt('DELETE FROM guild_budgets WHERE guild_id = ?').run(guildId);
        return true;
    }

    getUserBudget(userId: string): UserBudgetConfig | null {
        const row = this.stmt(
            `
            SELECT daily_budget_usd as dailyBudgetUsd
            FROM user_budgets
            WHERE user_id = ?
        `,
        ).get(userId) as UserBudgetConfig | undefined;

        return row ? { ...row } : null;
    }

    setUserBudget(userId: string, dailyBudgetUsd: number): void {
        this.stmt(
            `
            INSERT INTO user_budgets (user_id, daily_budget_usd)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET daily_budget_usd = excluded.daily_budget_usd
        `,
        ).run(userId, dailyBudgetUsd);
    }

    clearUserBudget(userId: string): boolean {
        if (!this.getUserBudget(userId)) {
            return false;
        }

        this.stmt('DELETE FROM user_budgets WHERE user_id = ?').run(userId);
        return true;
    }

    getUserLanguage(userId: string): string | null {
        const row = this.stmt(
            'SELECT language FROM user_language_preferences WHERE user_id = ?',
        ).get(userId) as { language: string } | undefined;

        return row?.language ?? null;
    }

    setUserLanguage(userId: string, language: string): void {
        this.stmt(
            `
            INSERT INTO user_language_preferences (user_id, language)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET language = excluded.language
        `,
        ).run(userId, language);
    }

    deleteUserLanguage(userId: string): boolean {
        const result = this.stmt('DELETE FROM user_language_preferences WHERE user_id = ?').run(
            userId,
        );

        return result.changes > 0;
    }

    listGuildGlossary(guildId: string): GuildGlossaryEntry[] {
        const rows = this.stmt(
            `
            SELECT
                id,
                guild_id as guildId,
                source_text as sourceText,
                target_language as targetLanguage,
                target_text as targetText,
                notes,
                created_at as createdAt,
                updated_at as updatedAt
            FROM guild_glossary
            WHERE guild_id = ?
            ORDER BY target_language COLLATE NOCASE ASC, source_text COLLATE NOCASE ASC, id ASC
        `,
        ).all(guildId) as unknown as GuildGlossaryEntry[];

        return rows.map((row) => ({ ...row }));
    }

    upsertGuildGlossaryEntry(guildId: string, input: GuildGlossaryInput): GuildGlossaryEntry {
        const sourceText = input.sourceText.trim();
        const targetLanguage = input.targetLanguage?.trim() || 'auto';
        const targetText = input.targetText.trim();
        const notes = input.notes?.trim() ?? '';
        const now = new Date().toISOString();

        if (!sourceText) {
            throw new Error('Glossary source text is required');
        }

        if (!targetText) {
            throw new Error('Glossary target text is required');
        }

        if (input.id !== undefined) {
            const existing = this.getGuildGlossaryEntry(guildId, input.id);
            if (!existing) {
                throw new Error('Glossary entry not found');
            }

            this.db
                .prepare(
                    `
                UPDATE guild_glossary
                SET source_text = ?, target_language = ?, target_text = ?, notes = ?, updated_at = ?
                WHERE guild_id = ? AND id = ?
            `,
                )
                .run(sourceText, targetLanguage, targetText, notes, now, guildId, input.id);

            return this.getGuildGlossaryEntry(guildId, input.id)!;
        }

        const result = this.stmt(
            `
            INSERT INTO guild_glossary (
                guild_id,
                source_text,
                target_language,
                target_text,
                notes,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(guildId, sourceText, targetLanguage, targetText, notes, now, now);

        return this.getGuildGlossaryEntry(guildId, Number(result.lastInsertRowid))!;
    }

    deleteGuildGlossaryEntry(guildId: string, entryId: number): boolean {
        const result = this.stmt('DELETE FROM guild_glossary WHERE guild_id = ? AND id = ?').run(
            guildId,
            entryId,
        );

        return result.changes > 0;
    }

    getGuildDailyUsage(guildId: string): TokenUsage | null {
        const row = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM guild_daily_usage
            WHERE guild_id = ?
        `,
        ).get(guildId) as TokenUsage | undefined;

        return row ? { ...row } : null;
    }

    saveGuildDailyUsage(guildId: string, usage: TokenUsage): void {
        this.stmt(
            `
            INSERT INTO guild_daily_usage (guild_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                date = excluded.date,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                requests = excluded.requests
        `,
        ).run(guildId, usage.date, usage.inputTokens, usage.outputTokens, usage.requests);
    }

    getGuildUsageHistory(guildId: string): UsageHistoryEntry[] {
        const rows = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM guild_usage_history
            WHERE guild_id = ?
            ORDER BY date ASC
        `,
        ).all(guildId) as unknown as UsageHistoryEntry[];

        return rows.map((row) => ({ ...row }));
    }

    saveGuildUsageHistory(guildId: string, history: UsageHistoryEntry[]): void {
        inTransaction(this.db, () => {
            this.stmt('DELETE FROM guild_usage_history WHERE guild_id = ?').run(guildId);
            const insert = this.stmt(`
                INSERT INTO guild_usage_history (guild_id, date, input_tokens, output_tokens, requests)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const entry of history) {
                insert.run(
                    guildId,
                    entry.date,
                    entry.inputTokens,
                    entry.outputTokens,
                    entry.requests,
                );
            }
        });
    }

    getUserDailyUsage(userId: string): TokenUsage | null {
        const row = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM user_daily_usage
            WHERE user_id = ?
        `,
        ).get(userId) as TokenUsage | undefined;

        return row ? { ...row } : null;
    }

    saveUserDailyUsage(userId: string, usage: TokenUsage): void {
        this.stmt(
            `
            INSERT INTO user_daily_usage (user_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                date = excluded.date,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                requests = excluded.requests
        `,
        ).run(userId, usage.date, usage.inputTokens, usage.outputTokens, usage.requests);
    }

    getUserUsageHistory(userId: string): UsageHistoryEntry[] {
        const rows = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM user_usage_history
            WHERE user_id = ?
            ORDER BY date ASC
        `,
        ).all(userId) as unknown as UsageHistoryEntry[];

        return rows.map((row) => ({ ...row }));
    }

    saveUserUsageHistory(userId: string, history: UsageHistoryEntry[]): void {
        inTransaction(this.db, () => {
            this.stmt('DELETE FROM user_usage_history WHERE user_id = ?').run(userId);
            const insert = this.stmt(`
                INSERT INTO user_usage_history (user_id, date, input_tokens, output_tokens, requests)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const entry of history) {
                insert.run(
                    userId,
                    entry.date,
                    entry.inputTokens,
                    entry.outputTokens,
                    entry.requests,
                );
            }
        });
    }

    close(): void {
        if (this.ownsDatabase && this.db.isOpen) {
            this.db.close();
        }
    }

    private getConfigValue<K extends ConfigValueKey>(key: K): StoreData[K] {
        this.invalidateConfigCacheIfExternallyChanged();

        const cached = this.configCache.get(key);
        if (cached !== undefined || this.configCache.has(key)) {
            return cloneConfigValue(cached as StoreData[K]);
        }

        const row = this.stmt(
            `
            SELECT value_json
            FROM app_config
            WHERE key = ?
        `,
        ).get(key) as { value_json: string } | undefined;

        const value = row
            ? (JSON.parse(row.value_json) as StoreData[K])
            : structuredClone(DEFAULT_STORE_DATA[key]);
        this.configCache.set(key, value);

        return cloneConfigValue(value);
    }

    private getDailyUsage(): TokenUsage | null {
        const row = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM daily_usage
            WHERE id = 1
        `,
        ).get() as TokenUsage | undefined;

        return row ? { ...row } : null;
    }

    private getUsageHistory(): UsageHistoryEntry[] {
        const rows = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM usage_history
            ORDER BY date ASC
        `,
        ).all() as unknown as UsageHistoryEntry[];

        return rows.map((row) => ({ ...row }));
    }

    private getUserLanguagePrefs(): Record<string, string> {
        const rows = this.stmt(
            `
            SELECT user_id as userId, language
            FROM user_language_preferences
            ORDER BY user_id ASC
        `,
        ).all() as Array<{ userId: string; language: string }>;

        return Object.fromEntries(rows.map((row) => [row.userId, row.language]));
    }

    private getGuildGlossaryEntry(guildId: string, entryId: number): GuildGlossaryEntry | null {
        const row = this.stmt(
            `
            SELECT
                id,
                guild_id as guildId,
                source_text as sourceText,
                target_language as targetLanguage,
                target_text as targetText,
                notes,
                created_at as createdAt,
                updated_at as updatedAt
            FROM guild_glossary
            WHERE guild_id = ? AND id = ?
        `,
        ).get(guildId, entryId) as GuildGlossaryEntry | undefined;

        return row ? { ...row } : null;
    }

    private getAllGuildBudgets(): Record<string, GuildBudgetConfig> {
        const rows = this.stmt(
            `
            SELECT guild_id as guildId, daily_budget_usd as dailyBudgetUsd
            FROM guild_budgets
            ORDER BY guild_id ASC
        `,
        ).all() as Array<{ guildId: string; dailyBudgetUsd: number }>;

        return Object.fromEntries(
            rows.map((row) => [row.guildId, { dailyBudgetUsd: row.dailyBudgetUsd }]),
        );
    }

    private getAllUserBudgets(): Record<string, UserBudgetConfig> {
        const rows = this.stmt(
            `
            SELECT user_id as userId, daily_budget_usd as dailyBudgetUsd
            FROM user_budgets
            ORDER BY user_id ASC
        `,
        ).all() as Array<{ userId: string; dailyBudgetUsd: number }>;

        return Object.fromEntries(
            rows.map((row) => [row.userId, { dailyBudgetUsd: row.dailyBudgetUsd }]),
        );
    }

    private getGuildTokenUsage(): Record<string, TokenUsage> {
        const rows = this.stmt(
            `
            SELECT guild_id as guildId, date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM guild_daily_usage
            ORDER BY guild_id ASC
        `,
        ).all() as unknown as Array<{ guildId: string } & TokenUsage>;

        return Object.fromEntries(rows.map(({ guildId, ...usage }) => [guildId, { ...usage }]));
    }

    private getUserTokenUsage(): Record<string, TokenUsage> {
        const rows = this.stmt(
            `
            SELECT user_id as userId, date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM user_daily_usage
            ORDER BY user_id ASC
        `,
        ).all() as unknown as Array<{ userId: string } & TokenUsage>;

        return Object.fromEntries(rows.map(({ userId, ...usage }) => [userId, { ...usage }]));
    }

    private getAllGuildUsageHistory(): Record<string, UsageHistoryEntry[]> {
        const rows = this.stmt(
            `
            SELECT guild_id as guildId, date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM guild_usage_history
            ORDER BY guild_id ASC, date ASC
        `,
        ).all() as unknown as Array<{ guildId: string } & UsageHistoryEntry>;

        const history: Record<string, UsageHistoryEntry[]> = {};
        for (const { guildId, ...entry } of rows) {
            history[guildId] ??= [];
            history[guildId].push({ ...entry });
        }

        return history;
    }

    private getAllUserUsageHistory(): Record<string, UsageHistoryEntry[]> {
        const rows = this.stmt(
            `
            SELECT user_id as userId, date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM user_usage_history
            ORDER BY user_id ASC, date ASC
        `,
        ).all() as unknown as Array<{ userId: string } & UsageHistoryEntry>;

        const history: Record<string, UsageHistoryEntry[]> = {};
        for (const { userId, ...entry } of rows) {
            history[userId] ??= [];
            history[userId].push({ ...entry });
        }

        return history;
    }

    private setValue<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
        if (CONFIG_KEYS.has(key)) {
            this.stmt(
                `
                INSERT INTO app_config (key, value_json)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
            `,
            ).run(key, JSON.stringify(value));
            // Drop (rather than overwrite) the cached value so a transaction
            // rollback can never leave a value in cache that never committed.
            this.configCache.delete(key as ConfigValueKey);
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
            case 'userBudgets':
                this.replaceUserBudgets(value as StoreData['userBudgets']);
                return;
            case 'userTokenUsage':
                this.replaceUserTokenUsage(value as StoreData['userTokenUsage']);
                return;
            case 'userUsageHistory':
                this.replaceUserUsageHistory(value as StoreData['userUsageHistory']);
                return;
        }
    }

    private replaceDailyUsage(usage: TokenUsage | null): void {
        this.db.exec('DELETE FROM daily_usage');
        if (!usage) {
            return;
        }

        this.stmt(
            `
            INSERT INTO daily_usage (id, date, input_tokens, output_tokens, requests)
            VALUES (1, ?, ?, ?, ?)
        `,
        ).run(usage.date, usage.inputTokens, usage.outputTokens, usage.requests);
    }

    private replaceUsageHistory(history: UsageHistoryEntry[]): void {
        this.db.exec('DELETE FROM usage_history');
        const insert = this.stmt(`
            INSERT INTO usage_history (date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?)
        `);

        for (const entry of history) {
            insert.run(entry.date, entry.inputTokens, entry.outputTokens, entry.requests);
        }
    }

    private replaceUserLanguagePrefs(prefs: Record<string, string>): void {
        this.db.exec('DELETE FROM user_language_preferences');
        const insert = this.stmt(`
            INSERT INTO user_language_preferences (user_id, language)
            VALUES (?, ?)
        `);

        for (const [userId, language] of Object.entries(prefs)) {
            insert.run(userId, language);
        }
    }

    private replaceGuildBudgets(budgets: Record<string, GuildBudgetConfig>): void {
        this.db.exec('DELETE FROM guild_budgets');
        const insert = this.stmt(`
            INSERT INTO guild_budgets (guild_id, daily_budget_usd)
            VALUES (?, ?)
        `);

        for (const [guildId, budget] of Object.entries(budgets)) {
            insert.run(guildId, budget.dailyBudgetUsd);
        }
    }

    private replaceUserBudgets(budgets: Record<string, UserBudgetConfig>): void {
        this.db.exec('DELETE FROM user_budgets');
        const insert = this.stmt(`
            INSERT INTO user_budgets (user_id, daily_budget_usd)
            VALUES (?, ?)
        `);

        for (const [userId, budget] of Object.entries(budgets)) {
            insert.run(userId, budget.dailyBudgetUsd);
        }
    }

    private replaceGuildTokenUsage(usage: Record<string, TokenUsage>): void {
        this.db.exec('DELETE FROM guild_daily_usage');
        const insert = this.stmt(`
            INSERT INTO guild_daily_usage (guild_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const [guildId, entry] of Object.entries(usage)) {
            insert.run(guildId, entry.date, entry.inputTokens, entry.outputTokens, entry.requests);
        }
    }

    private replaceUserTokenUsage(usage: Record<string, TokenUsage>): void {
        this.db.exec('DELETE FROM user_daily_usage');
        const insert = this.stmt(`
            INSERT INTO user_daily_usage (user_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const [userId, entry] of Object.entries(usage)) {
            insert.run(userId, entry.date, entry.inputTokens, entry.outputTokens, entry.requests);
        }
    }

    private replaceGuildUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        this.db.exec('DELETE FROM guild_usage_history');
        const insert = this.stmt(`
            INSERT INTO guild_usage_history (guild_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const [guildId, entries] of Object.entries(history)) {
            for (const entry of entries) {
                insert.run(
                    guildId,
                    entry.date,
                    entry.inputTokens,
                    entry.outputTokens,
                    entry.requests,
                );
            }
        }
    }

    private replaceUserUsageHistory(history: Record<string, UsageHistoryEntry[]>): void {
        this.db.exec('DELETE FROM user_usage_history');
        const insert = this.stmt(`
            INSERT INTO user_usage_history (user_id, date, input_tokens, output_tokens, requests)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const [userId, entries] of Object.entries(history)) {
            for (const entry of entries) {
                insert.run(
                    userId,
                    entry.date,
                    entry.inputTokens,
                    entry.outputTokens,
                    entry.requests,
                );
            }
        }
    }
}

export const store = new ConfigStore({
    autoImportLegacyJson: process.env.NODE_ENV !== 'test',
});
