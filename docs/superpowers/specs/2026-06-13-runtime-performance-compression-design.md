# Runtime Performance Compression Design

## Goal

Reduce Babel's memory footprint and improve burst tolerance without changing core translation behavior.

This design targets three operator-visible outcomes:

- Lower resident memory for small VPS, Railway, and Docker deployments.
- Fewer duplicate provider calls during bursts of identical translation requests.
- More predictable queue behavior under high concurrency.

Provider network latency is explicitly out of scope. Translation latency is dominated by the configured AI provider and deployment network path. Local changes should focus on avoiding unnecessary provider calls and keeping the process stable when traffic spikes.

## Current Context

Babel already has a lean runtime shape:

- Runtime dependencies are limited to `discord.js`, `express`, `express-rate-limit`, `dotenv`, and workspace packages.
- Docker runs Node directly instead of keeping an npm wrapper process resident.
- Docker exposes V8 heap caps through `BABEL_NODE_MAX_OLD_SPACE_MB` and `BABEL_NODE_MAX_SEMI_SPACE_MB`.
- Discord.js cache limits disable message, reaction, and presence caches and bound member/user caches.
- SQLite access already uses prepared statement reuse and runtime config caching.
- The current `scripts/benchmark-runtime-config.ts` result shows `configRepository.getRuntimeConfig()` at roughly 542k ops/sec for 100k local iterations, about 6.2x faster than a full `store.getAll()` snapshot.

The remaining useful work is not broad refactoring. It is targeted runtime pressure reduction.

## Non-Goals

- Do not replace `discord.js`, Express, or SQLite.
- Do not change provider prompt semantics, fallback behavior, budgets, access control, or dashboard authentication.
- Do not rewrite provider clients or introduce a worker pool.
- Do not optimize for Docker image size in this pass. Runtime RSS and burst behavior matter more.
- Do not remove the full dashboard. Operators should be able to choose a smaller mode.

## Approach

Implement a conservative performance pass with four pieces:

1. Add dashboard runtime modes.
2. Add in-flight translation request deduplication.
3. Reduce avoidable hot-path reads in the translation flow.
4. Make the runtime limiter queue friendlier to bursts.

Each piece should be independently testable and safe to ship without forcing existing deployments to change configuration.

## Dashboard Runtime Modes

Add `BABEL_DASHBOARD_MODE` with these values:

| Value | Behavior |
| --- | --- |
| `full` | Current behavior. Start the full dashboard, static assets, auth, API routes, metrics, and health routes. Default. |
| `health-only` | Start a minimal HTTP server with `/livez`, `/readyz`, `/healthz`, and `/metrics`. Do not construct full dashboard auth, static assets, user routes, config routes, logs routes, or dashboard-only repositories. |
| `off` | Do not start any HTTP server. Discord bot operation continues. Docker/Railway users should not use this mode unless their host healthcheck is changed. |

`full` remains the default for backward compatibility.

The minimal health server should reuse existing health and Prometheus rendering helpers where practical, but avoid constructing the full Express dashboard app. It can still use Express if that keeps the implementation small; the main win is avoiding dashboard route graph construction and dashboard-only state.

Configuration docs should warn that `off` disables `/livez`, `/readyz`, `/healthz`, and `/metrics`.

## In-Flight Translation Deduplication

Add an in-memory in-flight map keyed by the existing translation cache key.

Behavior:

- If a request has a cache miss and another request is already translating the same cache key, await the existing in-flight promise instead of acquiring another provider slot.
- The first request remains responsible for the provider call, usage recording, and cache write.
- Followers should mark the result as cached-like for user-facing duplicate avoidance, but metrics should distinguish true cache hits from in-flight joins if the existing metrics model can do that cleanly.
- The in-flight entry must be deleted in `finally` on both success and failure.
- If the provider call fails, followers receive the same sanitized error path as the leader and future requests may retry normally.

This improves burst behavior when many users translate the same Discord message at once. It also reduces queue depth and duplicate provider spend.

The dedupe should happen after access, budget, cooldown, input length, target language, same-language, prompt, and glossary resolution, because those inputs affect whether a request is allowed and what cache key it uses.

## Hot-Path Read Reduction

The translation flow currently reads runtime config in the service layer, and `translate()` reads it again to build the provider prompt. Keep behavior the same while avoiding the second read:

- Extend translator options to accept the already resolved runtime config or the specific fields needed by `translate()`.
- Preserve existing default behavior for tests and direct calls that do not pass config.
- Keep cache key construction and provider prompt construction based on the same config snapshot.

For glossary handling:

- Do not add a global time-based glossary cache in the first pass unless evidence shows `guild_glossary` reads are material.
- If adding a glossary optimization, prefer a repository-level version snapshot invalidated by glossary writes, not a stale TTL that can make operators wait for changes to apply.

Budget and usage reads should remain correct before being optimized further. Any reduction must preserve per-guild, per-user, and shared global budget semantics.

## Runtime Limiter Queue

The current queue defaults are small, so array operations are acceptable for normal traffic. For burst tolerance, replace queue operations with a structure that avoids repeated full-array scans:

- Maintain queue order with a head index or linked entries.
- Maintain an id-to-entry map for cancel and timeout lookup.
- Preserve current admission semantics:
  - user outstanding limit
  - guild queue limit
  - global queue limit
  - max concurrent active translations
  - queue wait timeout
- Preserve current snapshots and rejection counts.

This is primarily a stability improvement for high burst settings. It should not change default operator behavior.

## Configuration And Docs

Update:

- `.env.example` with `BABEL_DASHBOARD_MODE=full`.
- Docker docs with memory-oriented examples:
  - `BABEL_DASHBOARD_MODE=health-only`
  - lower `cacheMaxSize` for very small instances
  - avoid `BABEL_APP=combined` unless both products are needed
- Deployment docs to explain that full dashboard is the default and health-only is for constrained hosts.

No default runtime behavior should change.

## Testing

Add or update focused tests:

- Full dashboard remains default.
- `health-only` exposes health and metrics endpoints without registering full dashboard API routes.
- `off` does not start a dashboard server and shutdown still completes.
- Two concurrent same-cache-key translation requests perform one provider call and both resolve successfully.
- Failed in-flight translations clean up the map and allow a later retry.
- Non-identical cache keys do not dedupe.
- Runtime config passed through translator options avoids the second config read while preserving direct `translate()` usage.
- Limiter queue behavior remains compatible for acquire, cancel, timeout, activation order, and rejection counts.

Verification commands:

```bash
npm run typecheck
npm test
npm run benchmark:runtime-config -- 100000
```

If dashboard server behavior changes materially, also run a quick local smoke test against `/livez`, `/readyz`, and `/metrics` in `full` and `health-only` modes.

## Risks

In-flight dedupe has the highest behavioral risk. The implementation must ensure usage is not double-counted while still giving followers a complete response. The safest rule is: one provider call records one usage event, while all joined requests count as successful served translations in app metrics.

Dashboard modes can break deployment healthchecks if misconfigured. Keeping `full` as the default and documenting `off` clearly limits that risk.

Limiter queue changes can introduce subtle accounting bugs. Tests must cover user and guild counters after cancel, timeout, success, and provider failure.

## Rollout

Ship this as a single conservative performance pass with defaults unchanged. Operators who want minimum memory can opt into `BABEL_DASHBOARD_MODE=health-only` first. Operators facing bursts benefit from in-flight dedupe and queue improvements without changing settings.
