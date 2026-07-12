CREATE TABLE IF NOT EXISTS runtime_leases (
    lease_id TEXT PRIMARY KEY,
    app_profile_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'active')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_leases_profile_status
    ON runtime_leases (app_profile_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_runtime_leases_user
    ON runtime_leases (app_profile_id, user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_runtime_leases_guild_queue
    ON runtime_leases (app_profile_id, guild_id, status, created_at);
