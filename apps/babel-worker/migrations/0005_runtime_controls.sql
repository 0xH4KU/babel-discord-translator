CREATE TABLE IF NOT EXISTS translation_cache (
    app_profile_id TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    provider TEXT NOT NULL,
    last_accessed INTEGER NOT NULL,
    PRIMARY KEY (app_profile_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_lru
    ON translation_cache (app_profile_id, last_accessed DESC);

CREATE TABLE IF NOT EXISTS cooldowns (
    scope_key TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cooldowns_expiry ON cooldowns (expires_at);

CREATE TABLE IF NOT EXISTS pending_user_install_owners (
    user_id TEXT PRIMARY KEY,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_metrics (
    app_profile_id TEXT PRIMARY KEY,
    translations_total INTEGER NOT NULL DEFAULT 0,
    api_calls_total INTEGER NOT NULL DEFAULT 0,
    cache_hits_total INTEGER NOT NULL DEFAULT 0,
    cache_misses_total INTEGER NOT NULL DEFAULT 0,
    failures_total INTEGER NOT NULL DEFAULT 0,
    budget_exceeded_total INTEGER NOT NULL DEFAULT 0,
    rejected_total INTEGER NOT NULL DEFAULT 0,
    provider_fallback_total INTEGER NOT NULL DEFAULT 0,
    vertex_success_total INTEGER NOT NULL DEFAULT 0,
    vertex_failure_total INTEGER NOT NULL DEFAULT 0,
    vertex_fallback_from_total INTEGER NOT NULL DEFAULT 0,
    vertex_fallback_to_total INTEGER NOT NULL DEFAULT 0,
    openai_success_total INTEGER NOT NULL DEFAULT 0,
    openai_failure_total INTEGER NOT NULL DEFAULT 0,
    openai_fallback_from_total INTEGER NOT NULL DEFAULT 0,
    openai_fallback_to_total INTEGER NOT NULL DEFAULT 0
);
