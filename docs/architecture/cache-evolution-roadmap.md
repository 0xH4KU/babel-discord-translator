# Cache Evolution Roadmap

Status: evaluated on March 27, 2026

Decision:

- Keep the current in-memory LRU translation cache as the default for the current single-instance deployment model.
- If cross-instance cache sharing becomes necessary, move to Redis rather than trying to stretch the in-memory cache across workers.
- Do not add a SQLite-backed translation cache right now. Revisit it only if single-machine restart persistence becomes a real operational pain point.
- Adopt a documented TTL and invalidation policy before any cache backend upgrade.

## Current State

- Translation results are cached in-process with an LRU `Map`.
- Cache keys are already versioned by source content hash, target language, Gemini model, prompt fingerprint, and output token limit.
- Config changes already clear the cache when model, prompt, or output-token settings change.
- Cache state is not shared across processes and is lost on restart.

## Recommendation

For the repo's current single-machine, single-process operating model, the in-memory LRU remains the best default.

Why:

- It is simple, fast, and has no extra network or operational dependency.
- Current backpressure, metrics, and health assumptions are already process-local.
- The main value of the cache is suppressing duplicate upstream calls during hot traffic bursts inside one running process, which the in-memory LRU already does well.

## Redis Trigger

Move to Redis only when at least one of these becomes true:

- More than one bot worker must share translation cache state.
- Cache hit rate matters across deployments or rolling restarts.
- Cache ownership must be independent from a specific Node.js process.

Redis is the correct next step for that scenario because it solves shared-state distribution directly, while preserving a low-latency cache access pattern.

## SQLite Cache Trigger

SQLite cache is not the preferred next step for shared cache behavior.

Reconsider SQLite cache only when all of the following are true:

- Deployment remains single-host.
- Restart warm-up cost becomes noticeable.
- The team wants restart persistence but does not want to add Redis yet.

Even in that case, SQLite cache should be treated as a tactical warm-start layer, not as the general cross-instance cache strategy.

## TTL Policy

Recommended default TTL when a persistent or shared cache backend is introduced:

- Translation result TTL: 7 days
- Idle entries may still be evicted earlier by capacity pressure
- Manual cache clear remains available from the dashboard

Rationale:

- Translation outputs are deterministic enough to benefit from multi-day reuse.
- Prompt/model changes already create semantic invalidation points and should not rely on TTL alone.
- A shorter TTL would reduce hit rate without meaningfully improving correctness for this workload.

## Invalidation Policy

Keep or enforce the following invalidation rules:

- Cache key schema version bump invalidates all older logical entries.
- Changing `geminiModel` invalidates prior entries.
- Changing `translationPrompt` invalidates prior entries.
- Changing `maxOutputTokens` invalidates prior entries.
- Explicit admin cache clear invalidates current live entries immediately.

Do not invalidate on these inputs:

- `dailyBudgetUsd`
- `cooldownSeconds`
- guild budget changes
- login/session configuration

Those values affect control flow or policy, not translation output semantics.

## Bottom Line

The current in-memory LRU is still the right default.

The next cache upgrade should be Redis if multi-instance sharing is needed.
SQLite cache is only a narrow single-host warm-start option.
TTL and invalidation policy should stay explicit and semantic, not ad hoc.
