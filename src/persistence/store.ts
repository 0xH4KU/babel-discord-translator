/** SQLite-backed configuration and usage store. */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
    createSqliteDatabase,
    getSqliteDatabase,
    inTransaction,
    isSqliteStoreEmpty,
} from './sqlite-database.js';
import { readLegacyStoreData, resolveLegacyConfigPath } from './legacy-json-store.js';
import { CONFIG_VALUE_KEYS, DEFAULT_STORE_DATA, type ConfigValueKey } from './store-defaults.js';
import { appLogger, type StructuredLogger } from '../shared/structured-logger.js';
import type {
    GuildBudgetConfig,
    GuildGlossaryEntry,
    GuildGlossaryInput,
    StoreData,
    TokenUsage,
    UsageHistoryEntry,
    UserBudgetConfig,
    UserLanguagePreferenceEntry,
} from '../shared/types.js';

interface ConfigStoreOptions {
    db?: DatabaseSync;
    dbPath?: string;
    autoImportLegacyJson?: boolean;
    legacyConfigPath?: string;
    logger?: StructuredLogger;
}

export type UsageScopeKind = 'global' | 'guild' | 'user';

export interface ScopedUsageRow extends TokenUsage {
    scope: UsageScopeKind;
    scopeId: string;
}

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
     * database via config writes on this connection and via
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
                    this.importSnapshot(legacyData);
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

    updateConfigValues(updates: Partial<Pick<StoreData, ConfigValueKey>>): void {
        inTransaction(this.db, () => {
            for (const [key, value] of Object.entries(updates) as Array<
                [ConfigValueKey, StoreData[ConfigValueKey]]
            >) {
                this.setConfigValue(key, value);
            }
        });
    }

    exportSnapshot(): StoreData {
        const usageSnapshot = this.buildUsageSnapshot();
        return {
            ...this.getConfigValues(CONFIG_VALUE_KEYS),
            ...usageSnapshot,
            userLanguagePrefs: { ...this.getUserLanguagePrefs() },
            userLanguagePreferenceEntries: this.listUserLanguagePreferences(),
            guildBudgets: this.listGuildBudgets(),
            userBudgets: this.listUserBudgets(),
        };
    }

    importSnapshot(data: StoreData): void {
        inTransaction(this.db, () => {
            for (const key of CONFIG_VALUE_KEYS) this.setConfigValue(key, data[key]);
            this.replaceUsageSnapshot(data);
            this.replaceUserLanguagePrefs(data.userLanguagePrefs);
            this.replaceUserLanguagePreferenceEntries(data.userLanguagePreferenceEntries);
            this.replaceGuildBudgets(data.guildBudgets);
            this.replaceUserBudgets(data.userBudgets);
        });
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
        return this.stmt('DELETE FROM guild_budgets WHERE guild_id = ?').run(guildId).changes > 0;
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
        return this.stmt('DELETE FROM user_budgets WHERE user_id = ?').run(userId).changes > 0;
    }

    getUserLanguage(guildId: string, userId: string): string | null {
        const row = this.stmt(
            `
            SELECT language
            FROM user_language_preferences
            WHERE guild_id = ? AND user_id = ?
        `,
        ).get(guildId, userId) as { language: string } | undefined;

        return row?.language ?? null;
    }

    setUserLanguage(guildId: string, userId: string, language: string): void {
        this.stmt(
            `
            INSERT INTO user_language_preferences (guild_id, user_id, language)
            VALUES (?, ?, ?)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET language = excluded.language
        `,
        ).run(guildId, userId, language);
    }

    deleteUserLanguage(guildId: string, userId: string): boolean {
        const result = this.stmt(
            'DELETE FROM user_language_preferences WHERE guild_id = ? AND user_id = ?',
        ).run(guildId, userId);

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

        const row = this.stmt(
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
            ON CONFLICT DO UPDATE SET
                source_text = excluded.source_text,
                target_language = excluded.target_language,
                target_text = excluded.target_text,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            RETURNING id
        `,
        ).get(guildId, sourceText, targetLanguage, targetText, notes, now, now) as { id: number };

        return this.getGuildGlossaryEntry(guildId, row.id)!;
    }

    upsertGuildGlossaryEntries(
        guildId: string,
        inputs: readonly GuildGlossaryInput[],
    ): GuildGlossaryEntry[] {
        return inTransaction(this.db, () =>
            inputs.map((input) => this.upsertGuildGlossaryEntry(guildId, input)),
        );
    }

    deleteGuildGlossaryEntry(guildId: string, entryId: number): boolean {
        const result = this.stmt('DELETE FROM guild_glossary WHERE guild_id = ? AND id = ?').run(
            guildId,
            entryId,
        );

        return result.changes > 0;
    }

    getUsage(scope: UsageScopeKind, scopeId: string, date: string): TokenUsage | null {
        const row = this.stmt(
            `
            SELECT date, input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM scoped_usage
            WHERE scope = ? AND scope_id = ? AND date = ?
        `,
        ).get(scope, scopeId, date) as TokenUsage | undefined;

        return row ? { ...row } : null;
    }

    getUsageForIds(
        scope: Exclude<UsageScopeKind, 'global'>,
        scopeIds: readonly string[],
        date: string,
    ): Record<string, TokenUsage> {
        if (scopeIds.length === 0) return {};

        const placeholders = scopeIds.map(() => '?').join(', ');
        const rows = this.stmt(
            `
            SELECT scope_id as scopeId, date,
                   input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM scoped_usage
            WHERE scope = ? AND date = ? AND scope_id IN (${placeholders})
            ORDER BY scope_id ASC
        `,
        ).all(scope, date, ...scopeIds) as unknown as Array<{ scopeId: string } & TokenUsage>;

        return Object.fromEntries(rows.map(({ scopeId, ...usage }) => [scopeId, { ...usage }]));
    }

    getUsageHistory(
        scope: UsageScopeKind,
        beforeDate: string,
        scopeIds?: readonly string[],
    ): UsageHistoryEntry[] {
        if (scopeIds?.length === 0) return [];

        const idFilter = scopeIds ? `AND scope_id IN (${scopeIds.map(() => '?').join(', ')})` : '';
        const rows = this.stmt(
            `
            SELECT date,
                   SUM(input_tokens) as inputTokens,
                   SUM(output_tokens) as outputTokens,
                   SUM(requests) as requests
            FROM scoped_usage
            WHERE scope = ? AND date < ? ${idFilter}
            GROUP BY date
            ORDER BY date DESC
            LIMIT 30
        `,
        ).all(scope, beforeDate, ...(scopeIds ?? [])) as unknown as UsageHistoryEntry[];

        return rows.reverse().map((row) => ({ ...row }));
    }

    getSharedGlobalUsage(date: string): TokenUsage {
        const row = this.stmt(
            `
            WITH total AS (
                SELECT
                    COALESCE(SUM(input_tokens), 0) AS inputTokens,
                    COALESCE(SUM(output_tokens), 0) AS outputTokens,
                    COALESCE(SUM(requests), 0) AS requests
                FROM scoped_usage
                WHERE scope = 'global' AND scope_id = '' AND date = ?
            ), custom AS (
                SELECT
                    COALESCE(SUM(input_tokens), 0) AS inputTokens,
                    COALESCE(SUM(output_tokens), 0) AS outputTokens,
                    COALESCE(SUM(requests), 0) AS requests
                FROM scoped_usage
                JOIN guild_budgets ON guild_budgets.guild_id = scoped_usage.scope_id
                WHERE scope = 'guild' AND date = ?
            )
            SELECT
                MAX(total.inputTokens - custom.inputTokens, 0) AS inputTokens,
                MAX(total.outputTokens - custom.outputTokens, 0) AS outputTokens,
                MAX(total.requests - custom.requests, 0) AS requests
            FROM total, custom
        `,
        ).get(date, date) as Omit<TokenUsage, 'date'>;

        return { date, ...row };
    }

    recordUsage(
        date: string,
        inputTokens: number,
        outputTokens: number,
        scope: { guildId?: string | null; userId?: string | null } = {},
    ): void {
        const rows: Array<[UsageScopeKind, string]> = [['global', '']];
        if (scope.guildId) rows.push(['guild', scope.guildId]);
        if (scope.userId) rows.push(['user', scope.userId]);

        inTransaction(this.db, () => {
            const upsert = this.stmt(`
                INSERT INTO scoped_usage (
                    scope, scope_id, date, input_tokens, output_tokens, requests
                )
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(scope, scope_id, date) DO UPDATE SET
                    input_tokens = input_tokens + excluded.input_tokens,
                    output_tokens = output_tokens + excluded.output_tokens,
                    requests = requests + 1
            `);

            for (const [usageScope, scopeId] of rows) {
                upsert.run(usageScope, scopeId, date, inputTokens || 0, outputTokens || 0);
            }
        });
    }

    listUsageRows(): ScopedUsageRow[] {
        const rows = this.stmt(
            `
            SELECT scope, scope_id as scopeId, date,
                   input_tokens as inputTokens, output_tokens as outputTokens, requests
            FROM scoped_usage
            ORDER BY scope ASC, scope_id ASC, date ASC
        `,
        ).all() as unknown as ScopedUsageRow[];

        return rows.map((row) => ({ ...row }));
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

    private getUserLanguagePrefs(): Record<string, string> {
        const rows = this.stmt(
            `
            SELECT user_id as userId, language
            FROM user_language_preferences
            WHERE guild_id = ''
            ORDER BY user_id ASC
        `,
        ).all() as Array<{ userId: string; language: string }>;

        return Object.fromEntries(rows.map((row) => [row.userId, row.language]));
    }

    listUserLanguagePreferences(): UserLanguagePreferenceEntry[] {
        const rows = this.stmt(
            `
            SELECT guild_id as guildId, user_id as userId, language
            FROM user_language_preferences
            ORDER BY guild_id ASC, user_id ASC
        `,
        ).all() as unknown as UserLanguagePreferenceEntry[];

        return rows.map((row) => ({ ...row }));
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

    listGuildBudgets(): Record<string, GuildBudgetConfig> {
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

    listUserBudgets(): Record<string, UserBudgetConfig> {
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

    private setConfigValue<K extends ConfigValueKey>(key: K, value: StoreData[K]): void {
        this.stmt(
            `
            INSERT INTO app_config (key, value_json)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
        `,
        ).run(key, JSON.stringify(value));
        // Drop rather than overwrite so a rollback cannot leave an uncommitted cached value.
        this.configCache.delete(key);
    }

    private buildUsageSnapshot(): Pick<
        StoreData,
        | 'tokenUsage'
        | 'usageHistory'
        | 'guildTokenUsage'
        | 'guildUsageHistory'
        | 'userTokenUsage'
        | 'userUsageHistory'
    > {
        const rows = this.listUsageRows();
        const split = (entries: ScopedUsageRow[]) => {
            const usage = entries.map(({ date, inputTokens, outputTokens, requests }) => ({
                date,
                inputTokens,
                outputTokens,
                requests,
            }));
            return { current: usage.at(-1) ?? null, history: usage.slice(0, -1) };
        };
        const scoped = (scope: Exclude<UsageScopeKind, 'global'>) => {
            const grouped = new Map<string, ScopedUsageRow[]>();
            for (const row of rows) {
                if (row.scope !== scope) continue;
                const entries = grouped.get(row.scopeId) ?? [];
                entries.push(row);
                grouped.set(row.scopeId, entries);
            }

            const current: Record<string, TokenUsage> = {};
            const history: Record<string, UsageHistoryEntry[]> = {};
            for (const [id, entries] of grouped) {
                const splitUsage = split(entries);
                if (splitUsage.current) current[id] = splitUsage.current;
                if (splitUsage.history.length > 0) history[id] = splitUsage.history;
            }
            return { current, history };
        };

        const global = split(rows.filter((row) => row.scope === 'global'));
        const guild = scoped('guild');
        const user = scoped('user');
        return {
            tokenUsage: global.current,
            usageHistory: global.history,
            guildTokenUsage: guild.current,
            guildUsageHistory: guild.history,
            userTokenUsage: user.current,
            userUsageHistory: user.history,
        };
    }

    private replaceUsageSnapshot(data: StoreData): void {
        this.db.exec('DELETE FROM scoped_usage');
        const insert = this.stmt(`
            INSERT OR REPLACE INTO scoped_usage (
                scope, scope_id, date, input_tokens, output_tokens, requests
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const write = (scope: UsageScopeKind, scopeId: string, entry: TokenUsage) => {
            insert.run(
                scope,
                scopeId,
                entry.date,
                entry.inputTokens,
                entry.outputTokens,
                entry.requests,
            );
        };

        for (const entry of data.usageHistory) write('global', '', entry);
        if (data.tokenUsage) write('global', '', data.tokenUsage);
        for (const [guildId, entries] of Object.entries(data.guildUsageHistory)) {
            for (const entry of entries) write('guild', guildId, entry);
        }
        for (const [guildId, entry] of Object.entries(data.guildTokenUsage)) {
            write('guild', guildId, entry);
        }
        for (const [userId, entries] of Object.entries(data.userUsageHistory)) {
            for (const entry of entries) write('user', userId, entry);
        }
        for (const [userId, entry] of Object.entries(data.userTokenUsage)) {
            write('user', userId, entry);
        }
    }

    private replaceUserLanguagePrefs(prefs: Record<string, string>): void {
        this.stmt("DELETE FROM user_language_preferences WHERE guild_id = ''").run();
        const insert = this.stmt(`
            INSERT INTO user_language_preferences (guild_id, user_id, language)
            VALUES ('', ?, ?)
        `);

        for (const [userId, language] of Object.entries(prefs)) {
            insert.run(userId, language);
        }
    }

    private replaceUserLanguagePreferenceEntries(entries: UserLanguagePreferenceEntry[]): void {
        this.db.exec('DELETE FROM user_language_preferences');
        const insert = this.stmt(`
            INSERT INTO user_language_preferences (guild_id, user_id, language)
            VALUES (?, ?, ?)
        `);

        for (const entry of entries) {
            insert.run(entry.guildId, entry.userId, entry.language);
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
}

export const store = new ConfigStore({
    autoImportLegacyJson: process.env.NODE_ENV !== 'test',
});
