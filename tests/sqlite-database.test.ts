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

    it('should create user-install usage and pending owner tables', async () => {
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
                          'user_daily_usage',
                          'user_usage_history',
                          'pending_user_install_owners'
                      )
                    ORDER BY name ASC
                `,
                )
                .all() as Array<{ name: string }>;

            expect(rows.map((row) => row.name)).toEqual([
                'pending_user_install_owners',
                'user_budgets',
                'user_daily_usage',
                'user_usage_history',
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
            expect(migrationIds.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
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
