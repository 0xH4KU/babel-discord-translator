import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DATA_DIR = join(process.cwd(), 'data');
const DEFAULT_DATABASE_PATH = join(DEFAULT_DATA_DIR, 'babel.sqlite');

interface Migration {
    id: number;
    name: string;
    up: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
    {
        id: 1,
        name: 'initial_sqlite_schema',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS user_language_preferences (
                    user_id TEXT PRIMARY KEY,
                    language TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS guild_budgets (
                    guild_id TEXT PRIMARY KEY,
                    daily_budget_usd REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS daily_usage (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS guild_daily_usage (
                    guild_id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS usage_history (
                    date TEXT PRIMARY KEY,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS guild_usage_history (
                    guild_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (guild_id, date)
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    expiry INTEGER NOT NULL,
                    csrf TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cache_metadata (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_expiry
                    ON sessions (expiry);

                CREATE INDEX IF NOT EXISTS idx_guild_usage_history_lookup
                    ON guild_usage_history (guild_id, date);
            `);
        },
    },
];

let sharedDatabase: DatabaseSync | null = null;

export function resolveDatabasePath(): string {
    if (process.env.BABEL_DB_PATH) {
        return process.env.BABEL_DB_PATH;
    }

    return process.env.NODE_ENV === 'test' ? ':memory:' : DEFAULT_DATABASE_PATH;
}

export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

export function runMigrations(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
    `);

    const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>;
    const appliedIds = new Set(appliedRows.map((row) => row.id));

    for (const migration of MIGRATIONS) {
        if (appliedIds.has(migration.id)) {
            continue;
        }

        inTransaction(db, () => {
            migration.up(db);
            db.prepare(`
                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES (?, ?, ?)
            `).run(migration.id, migration.name, new Date().toISOString());
        });
    }
}

export function createSqliteDatabase(path: string = resolveDatabasePath()): DatabaseSync {
    if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true });
    }

    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
    `);

    runMigrations(db);
    return db;
}

export function getSqliteDatabase(): DatabaseSync {
    if (!sharedDatabase) {
        sharedDatabase = createSqliteDatabase();
    }

    return sharedDatabase;
}

export function closeSqliteDatabase(): void {
    if (!sharedDatabase) {
        return;
    }

    if (sharedDatabase.isOpen) {
        sharedDatabase.close();
    }

    sharedDatabase = null;
}

export function isSqliteStoreEmpty(db: DatabaseSync): boolean {
    const tables = [
        'app_config',
        'user_language_preferences',
        'guild_budgets',
        'daily_usage',
        'guild_daily_usage',
        'usage_history',
        'guild_usage_history',
    ];

    const countStatement = db.prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type = ? AND name = ?');

    for (const table of tables) {
        const tableExists = countStatement.get('table', table) as { count: number } | undefined;
        if (!tableExists?.count) {
            continue;
        }

        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number } | undefined;
        if ((count?.count ?? 0) > 0) {
            return false;
        }
    }

    return true;
}
