CREATE TABLE IF NOT EXISTS budget_reservations (
    reservation_id TEXT PRIMARY KEY,
    app_profile_id TEXT NOT NULL,
    guild_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    estimated_cost_usd REAL NOT NULL,
    uses_global_budget INTEGER NOT NULL CHECK (uses_global_budget IN (0, 1)),
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_expiry
    ON budget_reservations (expires_at);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_global
    ON budget_reservations (uses_global_budget, expires_at);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_user
    ON budget_reservations (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_guild
    ON budget_reservations (guild_id, uses_global_budget, expires_at);
