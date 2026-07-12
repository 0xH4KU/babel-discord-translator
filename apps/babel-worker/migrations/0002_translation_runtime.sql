CREATE TABLE IF NOT EXISTS guild_budgets (
    guild_id TEXT PRIMARY KEY,
    daily_budget_usd REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS user_budgets (
    user_id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS user_daily_usage (
    user_id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    requests INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_glossary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    source_text TEXT NOT NULL,
    target_language TEXT NOT NULL DEFAULT 'auto',
    target_text TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guild_glossary_language_lookup
    ON guild_glossary (guild_id, target_language, source_text);
