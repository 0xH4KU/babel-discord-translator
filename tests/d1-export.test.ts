import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildD1ImportSql } from '../scripts/export-sqlite-to-d1.js';

describe('D1 data export', () => {
    it('maps persisted SQLite config and user data into the Worker schema', () => {
        const db = new DatabaseSync(':memory:');
        try {
            db.exec(`
                CREATE TABLE app_config (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
                CREATE TABLE user_language_preferences (
                    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, language TEXT NOT NULL,
                    PRIMARY KEY (guild_id, user_id)
                );
                CREATE TABLE guild_glossary (
                    id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, source_text TEXT NOT NULL,
                    target_text TEXT NOT NULL, notes TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                INSERT INTO app_config VALUES ('gcpProject', '"project''one"');
                INSERT INTO user_language_preferences VALUES ('guild', 'user', 'zh-TW');
                INSERT INTO guild_glossary VALUES (
                    1, 'guild', 'raid', '團本', '', '2026-01-01', '2026-01-01'
                );
            `);

            const sql = buildD1ImportSql(db);
            const target = new DatabaseSync(':memory:');
            try {
                target.exec(`
                    CREATE TABLE app_config (
                        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    CREATE TABLE user_language_preferences (
                        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, language TEXT NOT NULL,
                        PRIMARY KEY (guild_id, user_id)
                    );
                    CREATE TABLE guild_glossary (
                        id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, source_text TEXT NOT NULL,
                        target_language TEXT NOT NULL, target_text TEXT NOT NULL,
                        notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                    );
                    ${sql}
                `);

                expect(
                    target.prepare("SELECT value FROM app_config WHERE key = 'gcpProject'").get(),
                ).toEqual({
                    value: '"project\'one"',
                });
                expect(target.prepare('SELECT * FROM user_language_preferences').get()).toEqual({
                    guild_id: 'guild',
                    user_id: 'user',
                    language: 'zh-TW',
                });
                expect(
                    target
                        .prepare(
                            'SELECT source_text, target_language, target_text FROM guild_glossary',
                        )
                        .get(),
                ).toEqual({ source_text: 'raid', target_language: 'auto', target_text: '團本' });
            } finally {
                target.close();
            }
            expect(sql).not.toContain('sessions');
        } finally {
            db.close();
        }
    });
});
