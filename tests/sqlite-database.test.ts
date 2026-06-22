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

    it('should create multilingual guild glossary columns and lookup index', async () => {
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
        } finally {
            db.close();
        }
    });
});
