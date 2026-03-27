# Bot And Admin API Process Separation Evaluation

Status: evaluated on March 27, 2026

Decision: keep the Discord gateway worker and dashboard/admin API in a single process for now.

## Current State

- `src/index.ts` starts both the Discord gateway client and the Express dashboard in one Node.js process.
- Shared durable state already lives in SQLite: runtime config, usage history, user preferences, guild budgets, and dashboard sessions.
- The dashboard still reads live in-process state directly from the bot runtime: Discord client guild cache, translation cache, cooldown manager, in-memory audit log, app metrics, and runtime limiter snapshots.
- The `/translate` webhook cache also lives only inside the bot process.

## What Is Stable Enough To Share

- The SQLite-backed repositories are stable enough for same-host multi-process access if both processes intentionally point at the same database file.
- Dashboard session storage is no longer tied to in-memory state because sessions already persist in SQLite.
- Config reads and writes are repository-based, which means process boundaries no longer depend on the legacy JSON store API.

## What Still Assumes A Single Process

- Translation cache is in-memory only. Splitting processes would immediately reduce cache hit rate unless cache ownership is centralized or externalized.
- Cooldowns are in-memory only. Separate bot workers would let users bypass cooldowns by landing on different workers.
- App metrics, translation audit logs, runtime limiter state, and webhook cache are all process-local.
- The dashboard currently renders live operational data by direct object access, not via a bot-facing RPC or shared read model.

## Recommendation

Do not split yet.

The current architecture is operationally simpler and matches the repo's single-instance assumptions. A hard split today would add real deployment and observability cost while still leaving several important runtime concerns inconsistent across processes.

## When A Split Becomes Worthwhile

- The Discord gateway worker and admin API need different scaling profiles.
- The dashboard requires a different SLA, security boundary, or public/admin deployment topology than the bot worker.
- Operators need to deploy admin/API changes independently from gateway restarts.

## Cost Of Splitting Now

- Two deployable services instead of one, with separate health checks, startup order, logs, and incident surfaces.
- Clearer service-to-service authentication would be required if the dashboard needs live bot state.
- Shared runtime state would need redesign: cache, cooldowns, metrics, runtime limiter, logs, and webhook cache.
- SQLite remains acceptable only for same-host sharing. Cross-host separation would require a networked data store for admin state and probably a shared cache/queue.

## Recommended Migration Path If The Split Is Needed Later

1. Keep SQLite as the shared source of truth for config, sessions, usage, preferences, and guild budgets.
2. Introduce a bot-runtime status interface so the dashboard stops reading live in-process objects directly.
3. Externalize or centralize volatile state that must stay consistent across processes:
   - translation cache
   - cooldowns
   - runtime limiter / queue state
   - operational counters and logs
   - webhook cache ownership
4. Split into:
   - `bot-worker`: Discord gateway, translation execution, webhook ownership
   - `admin-api`: dashboard, auth, config/session management, bot-runtime status proxy

## Bottom Line

The data layer and session strategy are now good enough to support a future split, but the operational runtime model is still intentionally single-process. Keep the monolith until different scale, SLA, or deployment-boundary requirements actually appear.
