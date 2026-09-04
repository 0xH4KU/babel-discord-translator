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

function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    return columns.some((row) => row.name === column);
}

function tableExists(db: DatabaseSync, table: string): boolean {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

export function rebuildTranslationBudgetPools(db: DatabaseSync): void {
    db.exec(`
        DELETE FROM budget_usage;
        DELETE FROM rolling_budget_usage;

        INSERT INTO budget_usage (
            pool_id, date, input_tokens, output_tokens, requests,
            input_cost_usd, output_cost_usd
        )
        SELECT 'pocket:shared', date, SUM(input_tokens), SUM(output_tokens), SUM(requests),
               SUM(input_cost_usd), SUM(output_cost_usd)
        FROM scoped_usage
        WHERE scope = 'user'
        GROUP BY date;

        INSERT INTO budget_usage (
            pool_id, date, input_tokens, output_tokens, requests,
            input_cost_usd, output_cost_usd
        )
        SELECT 'guild:' || scoped_usage.scope_id, date, input_tokens, output_tokens, requests,
               input_cost_usd, output_cost_usd
        FROM scoped_usage
        JOIN guild_budgets ON guild_budgets.guild_id = scoped_usage.scope_id
        WHERE scope = 'guild';

        WITH pocket AS (
            SELECT date, SUM(input_tokens) AS input_tokens,
                   SUM(output_tokens) AS output_tokens, SUM(requests) AS requests,
                   SUM(input_cost_usd) AS input_cost_usd,
                   SUM(output_cost_usd) AS output_cost_usd
            FROM scoped_usage
            WHERE scope = 'user'
            GROUP BY date
        ), custom AS (
            SELECT date, SUM(input_tokens) AS input_tokens,
                   SUM(output_tokens) AS output_tokens, SUM(requests) AS requests,
                   SUM(input_cost_usd) AS input_cost_usd,
                   SUM(output_cost_usd) AS output_cost_usd
            FROM scoped_usage
            JOIN guild_budgets ON guild_budgets.guild_id = scoped_usage.scope_id
            WHERE scope = 'guild'
            GROUP BY date
        )
        INSERT INTO budget_usage (
            pool_id, date, input_tokens, output_tokens, requests,
            input_cost_usd, output_cost_usd
        )
        SELECT
            'guild:shared',
            total.date,
            MAX(total.input_tokens - COALESCE(pocket.input_tokens, 0) -
                COALESCE(custom.input_tokens, 0), 0),
            MAX(total.output_tokens - COALESCE(pocket.output_tokens, 0) -
                COALESCE(custom.output_tokens, 0), 0),
            MAX(total.requests - COALESCE(pocket.requests, 0) -
                COALESCE(custom.requests, 0), 0),
            MAX(total.input_cost_usd - COALESCE(pocket.input_cost_usd, 0) -
                COALESCE(custom.input_cost_usd, 0), 0),
            MAX(total.output_cost_usd - COALESCE(pocket.output_cost_usd, 0) -
                COALESCE(custom.output_cost_usd, 0), 0)
        FROM scoped_usage AS total
        LEFT JOIN pocket ON pocket.date = total.date
        LEFT JOIN custom ON custom.date = total.date
        WHERE total.scope = 'global' AND total.scope_id = '';

        INSERT INTO rolling_budget_usage (
            pool_id, bucket_start, input_tokens, output_tokens, requests,
            input_cost_usd, output_cost_usd
        )
        SELECT
            'pocket:shared', bucket_start, SUM(input_tokens), SUM(output_tokens), SUM(requests),
            SUM(input_cost_usd), SUM(output_cost_usd)
        FROM rolling_usage
        WHERE scope = 'user'
        GROUP BY bucket_start;

        INSERT INTO rolling_budget_usage (
            pool_id, bucket_start, input_tokens, output_tokens, requests,
            input_cost_usd, output_cost_usd
        )
        SELECT
            'guild:' || rolling_usage.scope_id,
            bucket_start,
            input_tokens,
            output_tokens,
            requests,
            input_cost_usd,
            output_cost_usd
        FROM rolling_usage
        JOIN guild_budgets ON guild_budgets.guild_id = rolling_usage.scope_id
        WHERE scope = 'guild';

        WITH pocket AS (
            SELECT bucket_start, SUM(input_tokens) AS input_tokens,
                   SUM(output_tokens) AS output_tokens, SUM(requests) AS requests,
                   SUM(input_cost_usd) AS input_cost_usd,
                   SUM(output_cost_usd) AS output_cost_usd
            FROM rolling_usage
            WHERE scope = 'user'
            GROUP BY bucket_start
        ), custom AS (
            SELECT bucket_start, SUM(input_tokens) AS input_tokens,
                   SUM(output_tokens) AS output_tokens, SUM(requests) AS requests,
                   SUM(input_cost_usd) AS input_cost_usd,
                   SUM(output_cost_usd) AS output_cost_usd
            FROM rolling_usage
            JOIN guild_budgets ON guild_budgets.guild_id = rolling_usage.scope_id
            WHERE scope = 'guild'
            GROUP BY bucket_start
        )
        INSERT INTO rolling_budget_usage (
            pool_id, bucket_start, input_tokens, output_tokens, requests,
            input_cost_usd, output_cost_usd
        )
        SELECT
            'guild:shared',
            total.bucket_start,
            MAX(total.input_tokens - COALESCE(pocket.input_tokens, 0) -
                COALESCE(custom.input_tokens, 0), 0),
            MAX(total.output_tokens - COALESCE(pocket.output_tokens, 0) -
                COALESCE(custom.output_tokens, 0), 0),
            MAX(total.requests - COALESCE(pocket.requests, 0) -
                COALESCE(custom.requests, 0), 0),
            MAX(total.input_cost_usd - COALESCE(pocket.input_cost_usd, 0) -
                COALESCE(custom.input_cost_usd, 0), 0),
            MAX(total.output_cost_usd - COALESCE(pocket.output_cost_usd, 0) -
                COALESCE(custom.output_cost_usd, 0), 0)
        FROM rolling_usage AS total
        LEFT JOIN pocket ON pocket.bucket_start = total.bucket_start
        LEFT JOIN custom ON custom.bucket_start = total.bucket_start
        WHERE total.scope = 'global' AND total.scope_id = '';
    `);
}

function backfillSettledUsageCosts(db: DatabaseSync): void {
    for (const table of [
        'scoped_usage',
        'rolling_usage',
        'budget_usage',
        'rolling_budget_usage',
    ]) {
        if (!tableHasColumn(db, table, 'input_cost_usd')) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN input_cost_usd REAL NOT NULL DEFAULT 0;`);
        }
        if (!tableHasColumn(db, table, 'output_cost_usd')) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN output_cost_usd REAL NOT NULL DEFAULT 0;`);
        }
    }

    const readPrice = (key: string): number => {
        const row = db
            .prepare('SELECT value_json AS valueJson FROM app_config WHERE key = ?')
            .get(key) as { valueJson: string } | undefined;
        if (!row) return 0;

        try {
            const value = JSON.parse(row.valueJson) as unknown;
            return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
        } catch {
            return 0;
        }
    };
    const inputPrice = readPrice('inputPricePerMillion');
    const outputPrice = readPrice('outputPricePerMillion');

    for (const table of ['scoped_usage', 'rolling_usage']) {
        db.prepare(
            `UPDATE ${table}
             SET input_cost_usd = input_tokens / 1000000.0 * ?,
                 output_cost_usd = output_tokens / 1000000.0 * ?`,
        ).run(inputPrice, outputPrice);
    }
}

function tablePrimaryKeyColumns(db: DatabaseSync, table: string): string[] {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
        pk: number;
    }>;

    return columns
        .filter((row) => row.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((row) => row.name);
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
                    guild_id TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL,
                    language TEXT NOT NULL,
                    PRIMARY KEY (guild_id, user_id)
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
    {
        id: 2,
        name: 'guild_glossary',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS guild_glossary (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    source_text TEXT NOT NULL,
                    target_text TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_guild_glossary_lookup
                    ON guild_glossary (guild_id, source_text);
            `);
        },
    },
    {
        id: 3,
        name: 'user_budgets_and_usage',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS user_budgets (
                    user_id TEXT PRIMARY KEY,
                    daily_budget_usd REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS user_daily_usage (
                    user_id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS user_usage_history (
                    user_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (user_id, date)
                );

                CREATE INDEX IF NOT EXISTS idx_user_usage_history_lookup
                    ON user_usage_history (user_id, date);
            `);
        },
    },
    {
        id: 4,
        name: 'discord_user_profiles',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS discord_user_profiles (
                    user_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    global_name TEXT,
                    display_name TEXT NOT NULL,
                    avatar_url TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    last_seen_at TEXT
                );
            `);
        },
    },
    {
        id: 5,
        name: 'pending_user_install_owners',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS pending_user_install_owners (
                    user_id TEXT PRIMARY KEY,
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    source TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_pending_user_install_owners_last_seen
                    ON pending_user_install_owners (last_seen_at);
            `);
        },
    },
    {
        id: 6,
        name: 'guild_glossary_target_language',
        up(db) {
            if (!tableHasColumn(db, 'guild_glossary', 'target_language')) {
                db.exec(`
                    ALTER TABLE guild_glossary
                    ADD COLUMN target_language TEXT NOT NULL DEFAULT 'auto';
                `);
            }

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_guild_glossary_language_lookup
                    ON guild_glossary (guild_id, target_language, source_text);
            `);
        },
    },
    {
        id: 7,
        name: 'guild_scoped_user_language_preferences',
        up(db) {
            const primaryKeyColumns = tablePrimaryKeyColumns(db, 'user_language_preferences');
            if (
                primaryKeyColumns.length === 2 &&
                primaryKeyColumns[0] === 'guild_id' &&
                primaryKeyColumns[1] === 'user_id'
            ) {
                return;
            }

            db.exec(`
                CREATE TABLE user_language_preferences_new (
                    guild_id TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL,
                    language TEXT NOT NULL,
                    PRIMARY KEY (guild_id, user_id)
                );

                INSERT INTO user_language_preferences_new (guild_id, user_id, language)
                SELECT '', user_id, language
                FROM user_language_preferences;

                DROP TABLE user_language_preferences;
                ALTER TABLE user_language_preferences_new RENAME TO user_language_preferences;
            `);
        },
    },
    {
        id: 8,
        name: 'remove_unused_schema_and_enforce_glossary_keys',
        up(db) {
            db.exec(`
                DELETE FROM guild_glossary
                WHERE id NOT IN (
                    SELECT MAX(id)
                    FROM guild_glossary
                    GROUP BY
                        guild_id,
                        source_text COLLATE NOCASE,
                        target_language COLLATE NOCASE
                );

                DROP TABLE IF EXISTS cache_metadata;
                DROP INDEX IF EXISTS idx_guild_usage_history_lookup;
                DROP INDEX IF EXISTS idx_user_usage_history_lookup;
                DROP INDEX IF EXISTS idx_guild_glossary_lookup;

                CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_glossary_unique_key
                    ON guild_glossary (
                        guild_id,
                        source_text COLLATE NOCASE,
                        target_language COLLATE NOCASE
                    );
            `);
        },
    },
    {
        id: 9,
        name: 'consolidate_scoped_usage',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS scoped_usage (
                    scope TEXT NOT NULL CHECK (scope IN ('global', 'guild', 'user')),
                    scope_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (scope, scope_id, date)
                );
            `);

            const sources = [
                ['usage_history', 'global', "''"],
                ['daily_usage', 'global', "''"],
                ['guild_usage_history', 'guild', 'guild_id'],
                ['guild_daily_usage', 'guild', 'guild_id'],
                ['user_usage_history', 'user', 'user_id'],
                ['user_daily_usage', 'user', 'user_id'],
            ] as const;

            for (const [table, scope, scopeId] of sources) {
                if (!tableExists(db, table)) continue;
                db.exec(`
                    INSERT OR REPLACE INTO scoped_usage (
                        scope, scope_id, date, input_tokens, output_tokens, requests
                    )
                    SELECT '${scope}', ${scopeId}, date, input_tokens, output_tokens, requests
                    FROM ${table};
                `);
            }

            for (const [table] of sources) db.exec(`DROP TABLE IF EXISTS ${table};`);

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_scoped_usage_date
                ON scoped_usage (scope, date, scope_id);
            `);
        },
    },
    {
        id: 10,
        name: 'vision_monthly_usage',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS vision_monthly_usage (
                    month TEXT PRIMARY KEY,
                    images INTEGER NOT NULL CHECK (images >= 0)
                );
            `);
        },
    },
    {
        id: 11,
        name: 'scoped_vision_quotas',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS vision_scope_limits (
                    scope TEXT NOT NULL CHECK (scope IN ('guild', 'user')),
                    scope_id TEXT NOT NULL,
                    monthly_image_limit INTEGER NOT NULL CHECK (monthly_image_limit >= 0),
                    PRIMARY KEY (scope, scope_id)
                );

                CREATE TABLE vision_monthly_usage_new (
                    scope TEXT NOT NULL CHECK (scope IN ('global', 'guild', 'user')),
                    scope_id TEXT NOT NULL,
                    month TEXT NOT NULL,
                    images INTEGER NOT NULL CHECK (images >= 0),
                    PRIMARY KEY (scope, scope_id, month)
                );

                INSERT INTO vision_monthly_usage_new (scope, scope_id, month, images)
                SELECT 'global', '', month, images
                FROM vision_monthly_usage;

                DROP TABLE vision_monthly_usage;
                ALTER TABLE vision_monthly_usage_new RENAME TO vision_monthly_usage;
            `);
        },
    },
    {
        id: 12,
        name: 'monthly_translation_budgets',
        up(db) {
            for (const table of ['guild_budgets', 'user_budgets']) {
                if (!tableExists(db, table) || !tableHasColumn(db, table, 'daily_budget_usd')) {
                    continue;
                }

                db.exec(`
                    ALTER TABLE ${table}
                    RENAME COLUMN daily_budget_usd TO monthly_budget_usd;

                    UPDATE ${table}
                    SET monthly_budget_usd = monthly_budget_usd * 30;
                `);
            }

            if (!tableExists(db, 'app_config')) return;

            for (const [dailyKey, monthlyKey] of [
                ['dailyBudgetUsd', 'monthlyBudgetUsd'],
                ['defaultUserDailyBudgetUsd', 'defaultUserMonthlyBudgetUsd'],
            ] as const) {
                const monthly = db
                    .prepare('SELECT 1 FROM app_config WHERE key = ?')
                    .get(monthlyKey);
                const daily = db
                    .prepare('SELECT value_json as valueJson FROM app_config WHERE key = ?')
                    .get(dailyKey) as { valueJson: string } | undefined;

                if (!monthly && daily) {
                    const value = JSON.parse(daily.valueJson) as unknown;
                    const converted = typeof value === 'number' ? value * 30 : value;
                    db.prepare('INSERT INTO app_config (key, value_json) VALUES (?, ?)').run(
                        monthlyKey,
                        JSON.stringify(converted),
                    );
                }

                db.prepare('DELETE FROM app_config WHERE key = ?').run(dailyKey);
            }
        },
    },
    {
        id: 13,
        name: 'rolling_translation_usage',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS rolling_usage (
                    scope TEXT NOT NULL CHECK (
                        scope IN ('global', 'guild', 'user', 'guild_user')
                    ),
                    scope_id TEXT NOT NULL,
                    bucket_start TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (scope, scope_id, bucket_start)
                );

                CREATE INDEX IF NOT EXISTS idx_rolling_usage_window
                ON rolling_usage (scope, bucket_start, scope_id);
            `);
        },
    },
    {
        id: 14,
        name: 'guild_budget_limit_overrides',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS guild_budget_limit_overrides (
                    guild_id TEXT PRIMARY KEY,
                    five_hour_percent REAL CHECK (
                        five_hour_percent IS NULL OR
                        (five_hour_percent > 0 AND five_hour_percent <= 100)
                    ),
                    seven_day_percent REAL CHECK (
                        seven_day_percent IS NULL OR
                        (seven_day_percent > 0 AND seven_day_percent <= 100)
                    ),
                    fair_share_multiplier REAL CHECK (
                        fair_share_multiplier IS NULL OR fair_share_multiplier >= 1
                    ),
                    CHECK (
                        five_hour_percent IS NULL OR seven_day_percent IS NULL OR
                        five_hour_percent <= seven_day_percent
                    )
                );
            `);
        },
    },
    {
        id: 15,
        name: 'persist_translation_budget_pools',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS guild_budgets (
                    guild_id TEXT PRIMARY KEY,
                    monthly_budget_usd REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS scoped_usage (
                    scope TEXT NOT NULL CHECK (scope IN ('global', 'guild', 'user')),
                    scope_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (scope, scope_id, date)
                );
                CREATE TABLE IF NOT EXISTS rolling_usage (
                    scope TEXT NOT NULL CHECK (
                        scope IN ('global', 'guild', 'user', 'guild_user')
                    ),
                    scope_id TEXT NOT NULL,
                    bucket_start TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (scope, scope_id, bucket_start)
                );
                CREATE TABLE IF NOT EXISTS budget_usage (
                    pool_id TEXT NOT NULL CHECK (pool_id <> ''),
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (pool_id, date)
                );

                CREATE TABLE IF NOT EXISTS rolling_budget_usage (
                    pool_id TEXT NOT NULL CHECK (pool_id <> ''),
                    bucket_start TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    requests INTEGER NOT NULL,
                    PRIMARY KEY (pool_id, bucket_start)
                );

                CREATE INDEX IF NOT EXISTS idx_budget_usage_date
                    ON budget_usage (date, pool_id);
                CREATE INDEX IF NOT EXISTS idx_rolling_budget_usage_window
                    ON rolling_budget_usage (bucket_start, pool_id);

                INSERT OR IGNORE INTO app_config (key, value_json)
                SELECT 'pocketGlobalMonthlyBudgetUsd', value_json
                FROM app_config
                WHERE key = 'monthlyBudgetUsd';
            `);
            backfillSettledUsageCosts(db);
            rebuildTranslationBudgetPools(db);
        },
    },
    {
        id: 16,
        name: 'persist_settled_translation_costs',
        up(db) {
            backfillSettledUsageCosts(db);
            rebuildTranslationBudgetPools(db);
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

    const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{
        id: number;
    }>;
    const appliedIds = new Set(appliedRows.map((row) => row.id));

    for (const migration of MIGRATIONS) {
        if (appliedIds.has(migration.id)) {
            continue;
        }

        inTransaction(db, () => {
            migration.up(db);
            db.prepare(
                `
                INSERT INTO schema_migrations (id, name, applied_at)
                VALUES (?, ?, ?)
            `,
            ).run(migration.id, migration.name, new Date().toISOString());
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

/** Safe table names that are allowed to be queried in isSqliteStoreEmpty. */
const STORE_TABLES = new Set([
    'app_config',
    'user_language_preferences',
    'guild_budgets',
    'guild_budget_limit_overrides',
    'scoped_usage',
    'rolling_usage',
    'budget_usage',
    'rolling_budget_usage',
    'guild_glossary',
    'user_budgets',
    'discord_user_profiles',
    'pending_user_install_owners',
    'vision_scope_limits',
    'vision_monthly_usage',
]);

export function isSqliteStoreEmpty(db: DatabaseSync): boolean {
    const countStatement = db.prepare(
        'SELECT COUNT(*) as count FROM sqlite_master WHERE type = ? AND name = ?',
    );

    // Pre-build parameterized statements for each known table.
    // This is safe because table names come from the STORE_TABLES constant, not user input.
    const countStatements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
    for (const table of STORE_TABLES) {
        const tableExists = countStatement.get('table', table) as { count: number } | undefined;
        if (tableExists?.count) {
            countStatements.set(table, db.prepare(`SELECT COUNT(*) as count FROM "${table}"`));
        }
    }

    for (const [, stmt] of countStatements) {
        const count = stmt.get() as { count: number } | undefined;
        if ((count?.count ?? 0) > 0) {
            return false;
        }
    }

    return true;
}
