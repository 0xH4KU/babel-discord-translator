# ADR 0004: Keep The Runtime Monolithic Instead Of Splitting Into Microservices

Status: accepted on March 27, 2026

## Context

- The current deployment model is one Node.js process hosting both the Discord gateway worker and the dashboard/admin HTTP server.
- Durable state is already in SQLite, but critical runtime coordination is still process-local:
  - translation cache
  - cooldowns
  - runtime limiter queues and counters
  - in-memory logs and metrics
  - `/translate` webhook cache ownership
- The project does not yet have a concrete requirement for separate scale profiles, separate SLAs, or separate security boundaries between bot traffic and admin traffic.

## Decision

- Keep the application as one deployable monolith for now.
- Do not introduce microservices or a hard bot/admin process split until an operational requirement clearly justifies the added complexity.

## Consequences

Positive:

- One deployment artifact, one startup path, and one incident surface remain easier to operate.
- Process-local optimizations such as the translation cache and runtime limiter keep their current semantics without extra infrastructure.
- The team avoids premature RPC, service discovery, cross-service auth, and shared-state redesign.

Tradeoffs:

- Bot runtime and admin/dashboard traffic still share one process boundary.
- A future split will require externalizing or redesigning process-local state before correctness is preserved across workers.

## Follow-Up Notes

- The repo is intentionally moving toward cleaner boundaries so a future split stays possible.
- The formal evaluation of bot/admin process separation lives in `docs/architecture/bot-admin-process-separation.md`.
