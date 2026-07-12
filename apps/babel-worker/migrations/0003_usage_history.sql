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

CREATE TABLE IF NOT EXISTS user_usage_history (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    requests INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_guild_usage_history_lookup
    ON guild_usage_history (guild_id, date);

CREATE INDEX IF NOT EXISTS idx_user_usage_history_lookup
    ON user_usage_history (user_id, date);
