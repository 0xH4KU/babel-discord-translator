import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveDatabasePath', () => {
    afterEach(async () => {
        delete process.env.BABEL_DB_PATH;
        delete process.env.NODE_ENV;
        vi.resetModules();

        const { closeSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        closeSqliteDatabase();
    });

    it('should prefer the explicit BABEL_DB_PATH override', async () => {
        process.env.BABEL_DB_PATH = '/tmp/custom-babel.sqlite';

        const { resolveDatabasePath } = await import('../src/persistence/sqlite-database.js');

        expect(resolveDatabasePath()).toBe('/tmp/custom-babel.sqlite');
    });

    it('should use an in-memory database during tests when no override is set', async () => {
        process.env.NODE_ENV = 'test';

        const { resolveDatabasePath } = await import('../src/persistence/sqlite-database.js');

        expect(resolveDatabasePath()).toBe(':memory:');
    });

    it('should resolve the production default relative to the current working directory', async () => {
        process.env.NODE_ENV = 'production';

        const { resolveDatabasePath } = await import('../src/persistence/sqlite-database.js');

        expect(resolveDatabasePath()).toBe(join(process.cwd(), 'data', 'babel.sqlite'));
    });
});

describe('createSqliteDatabase', () => {
    it('should create the Discord user profile cache table', async () => {
        const { createSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        const db = createSqliteDatabase(':memory:');

        try {
            const row = db
                .prepare(
                    `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table' AND name = 'discord_user_profiles'
                `,
                )
                .get() as { name: string } | undefined;

            expect(row?.name).toBe('discord_user_profiles');
        } finally {
            db.close();
        }
    });

    it('should create consolidated usage and pending owner tables', async () => {
        const { createSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        const db = createSqliteDatabase(':memory:');

        try {
            const rows = db
                .prepare(
                    `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table'
                      AND name IN (
                          'user_budgets',
                          'guild_budget_limit_overrides',
                          'scoped_usage',
                          'rolling_usage',
                          'pending_user_install_owners'
                      )
                    ORDER BY name ASC
                `,
                )
                .all() as Array<{ name: string }>;

            expect(rows.map((row) => row.name)).toEqual([
                'guild_budget_limit_overrides',
                'pending_user_install_owners',
                'rolling_usage',
                'scoped_usage',
                'user_budgets',
            ]);
        } finally {
            db.close();
        }
    });

    it('should create multilingual guild glossary columns and required indexes', async () => {
        const { createSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        const db = createSqliteDatabase(':memory:');

        try {
            const columns = db.prepare('PRAGMA table_info(guild_glossary)').all() as Array<{
                name: string;
                dflt_value: string | null;
            }>;
            const targetLanguage = columns.find((column) => column.name === 'target_language');

            expect(targetLanguage).toMatchObject({
                name: 'target_language',
                dflt_value: "'auto'",
            });

            const index = db
                .prepare(
                    `
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'index'
                      AND name = 'idx_guild_glossary_language_lookup'
                `,
                )
                .get() as { name: string } | undefined;

            expect(index?.name).toBe('idx_guild_glossary_language_lookup');

            const schemaNames = db
                .prepare(
                    `
                    SELECT name
                    FROM sqlite_master
                    WHERE name IN (
                        'cache_metadata',
                        'idx_guild_usage_history_lookup',
                        'idx_user_usage_history_lookup',
                        'idx_guild_glossary_lookup',
                        'idx_guild_glossary_unique_key'
                    )
                    ORDER BY name ASC
                `,
                )
                .all() as Array<{ name: string }>;
            expect(schemaNames.map((row) => row.name)).toEqual(['idx_guild_glossary_unique_key']);
        } finally {
            db.close();
        }
    });

    it('should scope user language preferences by guild id and user id', async () => {
        const { createSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        const db = createSqliteDatabase(':memory:');

        try {
            const columns = db
                .prepare('PRAGMA table_info(user_language_preferences)')
                .all() as Array<{
                name: string;
                pk: number;
            }>;

            expect(columns).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'guild_id', pk: 1 }),
                    expect.objectContaining({ name: 'user_id', pk: 2 }),
                    expect.objectContaining({ name: 'language' }),
                ]),
            );
        } finally {
            db.close();
        }
    });

    it('should migrate a legacy v5 database while preserving glossary and user preferences', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { runMigrations } = await import('../src/persistence/sqlite-database.js');
        const db = new DatabaseSync(':memory:');

        try {
            db.exec(`
                CREATE TABLE schema_migrations (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );

                CREATE TABLE app_config (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                CREATE TABLE user_language_preferences (
                    user_id TEXT PRIMARY KEY,
                    language TEXT NOT NULL
                );

                CREATE TABLE guild_glossary (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    target_text TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES
                    (1, 'initial_sqlite_schema', '2026-01-01T00:00:00.000Z'),
                    (2, 'guild_glossary', '2026-01-01T00:00:00.000Z'),
                    (3, 'user_budgets_and_usage', '2026-01-01T00:00:00.000Z'),
                    (4, 'discord_user_profiles', '2026-01-01T00:00:00.000Z'),
                    (5, 'pending_user_install_owners', '2026-01-01T00:00:00.000Z');

                INSERT INTO user_language_preferences (user_id, language)
                VALUES ('user-1', 'ja');

                INSERT INTO guild_glossary (
                    guild_id,
                    source_text,
                    target_text,
                    notes,
                    created_at,
                    updated_at
                )
                VALUES (
                    'guild-1',
                    'raid',
                    '團本',
                    'game term',
                    '2026-01-01T00:00:00.000Z',
                    '2026-01-01T00:00:00.000Z'
                );
            `);

            runMigrations(db);

            const prefs = db
                .prepare(
                    `
                    SELECT guild_id as guildId, user_id as userId, language
                    FROM user_language_preferences
                `,
                )
                .all() as Array<{ guildId: string; userId: string; language: string }>;
            expect(prefs).toEqual([{ guildId: '', userId: 'user-1', language: 'ja' }]);

            const glossary = db
                .prepare(
                    `
                    SELECT
                        guild_id as guildId,
                        source_text as sourceText,
                        target_language as targetLanguage,
                        target_text as targetText,
                        notes
                    FROM guild_glossary
                `,
                )
                .get() as {
                guildId: string;
                sourceText: string;
                targetLanguage: string;
                targetText: string;
                notes: string;
            };
            expect(glossary).toEqual({
                guildId: 'guild-1',
                sourceText: 'raid',
                targetLanguage: 'auto',
                targetText: '團本',
                notes: 'game term',
            });
        } finally {
            db.close();
        }
    });

    it('should tolerate legacy databases that already have a migration column but missed its migration row', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { runMigrations } = await import('../src/persistence/sqlite-database.js');
        const db = new DatabaseSync(':memory:');

        try {
            db.exec(`
                CREATE TABLE schema_migrations (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );

                CREATE TABLE app_config (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                CREATE TABLE user_language_preferences (
                    guild_id TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL,
                    language TEXT NOT NULL,
                    PRIMARY KEY (guild_id, user_id)
                );

                CREATE TABLE guild_glossary (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    target_language TEXT NOT NULL DEFAULT 'auto',
                    target_text TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES
                    (1, 'initial_sqlite_schema', '2026-01-01T00:00:00.000Z'),
                    (2, 'guild_glossary', '2026-01-01T00:00:00.000Z'),
                    (3, 'user_budgets_and_usage', '2026-01-01T00:00:00.000Z'),
                    (4, 'discord_user_profiles', '2026-01-01T00:00:00.000Z'),
                    (5, 'pending_user_install_owners', '2026-01-01T00:00:00.000Z');
            `);

            expect(() => runMigrations(db)).not.toThrow();

            const migrationIds = db
                .prepare('SELECT id FROM schema_migrations ORDER BY id ASC')
                .all() as Array<{ id: number }>;
            expect(migrationIds.map((row) => row.id)).toEqual([
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
            ]);
        } finally {
            db.close();
        }
    });

    it('should convert legacy daily budgets to monthly budgets', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { runMigrations } = await import('../src/persistence/sqlite-database.js');
        const db = new DatabaseSync(':memory:');

        try {
            db.exec(`
                CREATE TABLE schema_migrations (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES
                    (1, 'one', '2026-01-01'), (2, 'two', '2026-01-01'),
                    (3, 'three', '2026-01-01'), (4, 'four', '2026-01-01'),
                    (5, 'five', '2026-01-01'), (6, 'six', '2026-01-01'),
                    (7, 'seven', '2026-01-01'), (8, 'eight', '2026-01-01'),
                    (9, 'nine', '2026-01-01'), (10, 'ten', '2026-01-01'),
                    (11, 'eleven', '2026-01-01');

                CREATE TABLE app_config (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
                INSERT INTO app_config (key, value_json) VALUES
                    ('dailyBudgetUsd', '2'),
                    ('defaultUserDailyBudgetUsd', '0.5');

                CREATE TABLE guild_budgets (
                    guild_id TEXT PRIMARY KEY,
                    daily_budget_usd REAL NOT NULL
                );
                CREATE TABLE user_budgets (
                    user_id TEXT PRIMARY KEY,
                    daily_budget_usd REAL NOT NULL
                );
                INSERT INTO guild_budgets VALUES ('guild-1', 3);
                INSERT INTO user_budgets VALUES ('user-1', 0.25);
            `);

            runMigrations(db);

            expect(
                db.prepare('SELECT monthly_budget_usd as budget FROM guild_budgets').get(),
            ).toEqual({ budget: 90 });
            expect(
                db.prepare('SELECT monthly_budget_usd as budget FROM user_budgets').get(),
            ).toEqual({ budget: 7.5 });
            expect(
                db.prepare(`SELECT key, value_json as value FROM app_config ORDER BY key`).all(),
            ).toEqual([
                { key: 'defaultUserMonthlyBudgetUsd', value: '15' },
                { key: 'monthlyBudgetUsd', value: '60' },
            ]);
        } finally {
            db.close();
        }
    });

    it('should preserve global Vision usage when adding scoped quotas', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { runMigrations } = await import('../src/persistence/sqlite-database.js');
        const db = new DatabaseSync(':memory:');

        try {
            db.exec(`
                CREATE TABLE schema_migrations (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES
                    (1, 'one', '2026-01-01'), (2, 'two', '2026-01-01'),
                    (3, 'three', '2026-01-01'), (4, 'four', '2026-01-01'),
                    (5, 'five', '2026-01-01'), (6, 'six', '2026-01-01'),
                    (7, 'seven', '2026-01-01'), (8, 'eight', '2026-01-01'),
                    (9, 'nine', '2026-01-01'), (10, 'ten', '2026-01-01');

                CREATE TABLE vision_monthly_usage (
                    month TEXT PRIMARY KEY,
                    images INTEGER NOT NULL CHECK (images >= 0)
                );
                INSERT INTO vision_monthly_usage (month, images) VALUES ('2026-08', 7);
            `);

            runMigrations(db);

            expect(
                db
                    .prepare(
                        `
                        SELECT scope, scope_id as scopeId, month, images
                        FROM vision_monthly_usage
                    `,
                    )
                    .get(),
            ).toEqual({ scope: 'global', scopeId: '', month: '2026-08', images: 7 });
        } finally {
            db.close();
        }
    });

    it('should consolidate legacy usage tables without losing rows', async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { runMigrations } = await import('../src/persistence/sqlite-database.js');
        const db = new DatabaseSync(':memory:');

        try {
            db.exec(`
                CREATE TABLE schema_migrations (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                );
                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES
                    (1, 'one', '2026-01-01'), (2, 'two', '2026-01-01'),
                    (3, 'three', '2026-01-01'), (4, 'four', '2026-01-01'),
                    (5, 'five', '2026-01-01'), (6, 'six', '2026-01-01'),
                    (7, 'seven', '2026-01-01'), (8, 'eight', '2026-01-01');

                CREATE TABLE usage_history (
                    date TEXT, input_tokens INTEGER, output_tokens INTEGER, requests INTEGER
                );
                CREATE TABLE daily_usage (
                    date TEXT, input_tokens INTEGER, output_tokens INTEGER, requests INTEGER
                );
                CREATE TABLE guild_usage_history (
                    guild_id TEXT, date TEXT, input_tokens INTEGER,
                    output_tokens INTEGER, requests INTEGER
                );
                CREATE TABLE guild_daily_usage (
                    guild_id TEXT, date TEXT, input_tokens INTEGER,
                    output_tokens INTEGER, requests INTEGER
                );
                CREATE TABLE user_usage_history (
                    user_id TEXT, date TEXT, input_tokens INTEGER,
                    output_tokens INTEGER, requests INTEGER
                );
                CREATE TABLE user_daily_usage (
                    user_id TEXT, date TEXT, input_tokens INTEGER,
                    output_tokens INTEGER, requests INTEGER
                );

                INSERT INTO usage_history VALUES ('2026-01-01', 1, 2, 3);
                INSERT INTO daily_usage VALUES ('2026-01-02', 4, 5, 6);
                INSERT INTO guild_usage_history VALUES ('guild-1', '2026-01-01', 7, 8, 9);
                INSERT INTO guild_daily_usage VALUES ('guild-1', '2026-01-02', 10, 11, 12);
                INSERT INTO user_usage_history VALUES ('user-1', '2026-01-01', 13, 14, 15);
                INSERT INTO user_daily_usage VALUES ('user-1', '2026-01-02', 16, 17, 18);
            `);

            runMigrations(db);

            const rows = db
                .prepare(
                    `
                    SELECT scope, scope_id as scopeId, date,
                           input_tokens as inputTokens,
                           output_tokens as outputTokens,
                           requests
                    FROM scoped_usage
                    ORDER BY scope, scope_id, date
                `,
                )
                .all();
            expect(rows).toEqual([
                {
                    scope: 'global',
                    scopeId: '',
                    date: '2026-01-01',
                    inputTokens: 1,
                    outputTokens: 2,
                    requests: 3,
                },
                {
                    scope: 'global',
                    scopeId: '',
                    date: '2026-01-02',
                    inputTokens: 4,
                    outputTokens: 5,
                    requests: 6,
                },
                {
                    scope: 'guild',
                    scopeId: 'guild-1',
                    date: '2026-01-01',
                    inputTokens: 7,
                    outputTokens: 8,
                    requests: 9,
                },
                {
                    scope: 'guild',
                    scopeId: 'guild-1',
                    date: '2026-01-02',
                    inputTokens: 10,
                    outputTokens: 11,
                    requests: 12,
                },
                {
                    scope: 'user',
                    scopeId: 'user-1',
                    date: '2026-01-01',
                    inputTokens: 13,
                    outputTokens: 14,
                    requests: 15,
                },
                {
                    scope: 'user',
                    scopeId: 'user-1',
                    date: '2026-01-02',
                    inputTokens: 16,
                    outputTokens: 17,
                    requests: 18,
                },
            ]);

            const legacyTableCount = db
                .prepare(
                    `
                    SELECT COUNT(*) as count
                    FROM sqlite_master
                    WHERE type = 'table'
                      AND name IN (
                          'daily_usage', 'usage_history',
                          'guild_daily_usage', 'guild_usage_history',
                          'user_daily_usage', 'user_usage_history'
                      )
                `,
                )
                .get() as { count: number };
            expect(legacyTableCount.count).toBe(0);
        } finally {
            db.close();
        }
    });

    it('should deduplicate legacy glossary keys before adding the unique index', async () => {
        const { createSqliteDatabase, runMigrations } =
            await import('../src/persistence/sqlite-database.js');
        const db = createSqliteDatabase(':memory:');

        try {
            db.exec(`
                DROP INDEX idx_guild_glossary_unique_key;
                DELETE FROM schema_migrations WHERE id = 8;

                INSERT INTO guild_glossary (
                    guild_id,
                    source_text,
                    target_language,
                    target_text,
                    notes,
                    created_at,
                    updated_at
                )
                VALUES
                    ('guild-1', 'OpenAI', 'auto', 'old', '', '2026-01-01', '2026-01-01'),
                    ('guild-1', 'openai', 'AUTO', 'new', '', '2026-01-02', '2026-01-02');
            `);

            runMigrations(db);

            const rows = db
                .prepare(
                    `
                    SELECT source_text as sourceText, target_language as targetLanguage, target_text as targetText
                    FROM guild_glossary
                    WHERE guild_id = 'guild-1'
                `,
                )
                .all();
            expect(rows).toEqual([
                { sourceText: 'openai', targetLanguage: 'AUTO', targetText: 'new' },
            ]);
        } finally {
            db.close();
        }
    });
});
