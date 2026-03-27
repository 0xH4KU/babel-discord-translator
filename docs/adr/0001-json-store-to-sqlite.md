# ADR 0001: Migrate Persistent State From JSON Store To SQLite

Status: accepted on March 27, 2026

## Context

- The original JSON store rewrote one file for many unrelated concerns: runtime config, usage, user preferences, budgets, and setup state.
- The project now also needs durable dashboard sessions, cleaner repository boundaries, and safer persistence semantics for production restarts.
- Whole-file JSON writes are simple, but they are a weak fit for incremental updates, concurrent reads/writes, schema evolution, and future process separation.
- The runtime already targets Node.js `22.5+`, which makes the built-in `node:sqlite` module a viable low-dependency persistence layer.

## Decision

- SQLite is the canonical persistent store for:
  - runtime/dashboard configuration
  - usage totals and usage history
  - user language preferences
  - per-guild budget overrides
  - dashboard sessions
- Legacy `data/config.json` is retained only as a migration and rollback compatibility path.
- Repositories must talk to normalized SQLite-backed data instead of reaching into the legacy JSON shape directly.

## Consequences

Positive:

- Updates become more structured and less error-prone than rewriting one shared JSON blob.
- Dashboard sessions can persist across restarts without a separate session store.
- Repository boundaries become easier to test and evolve because storage concerns are centralized.
- A future same-host process split is more realistic because durable state is already moved out of process memory.

Tradeoffs:

- The project now depends on migration logic and SQLite schema management.
- SQLite is still a single-machine file-based database, not a cross-host shared control plane.
- Operators need to care about database-file backup, file permissions, and migration safety.

## Follow-Up Notes

- The migration/import path lives in the repo so legacy JSON users can move forward without manual data rewriting.
- If deployment later requires cross-host admin/API separation, SQLite may remain acceptable only for same-host sharing; broader distribution would require a networked data store.
