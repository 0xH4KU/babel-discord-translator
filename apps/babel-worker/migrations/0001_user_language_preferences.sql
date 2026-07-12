CREATE TABLE IF NOT EXISTS user_language_preferences (
    guild_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    language TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
