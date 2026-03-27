# ADR 0003: Use Semantic Translation Cache Keys With Explicit Invalidation Rules

Status: accepted on March 27, 2026

## Context

- Translation output correctness depends on more than the source text alone.
- Changing the target language, Gemini model, translation prompt, or `maxOutputTokens` can change the output even when the input text is unchanged.
- The cache remains intentionally in-memory for the current single-process deployment, so correctness must come from key design and invalidation rather than backend sophistication.

## Decision

- Build translation cache keys from:
  - source text hash
  - target language
  - Gemini model
  - prompt fingerprint
  - max output token setting
  - cache schema version
- Invalidate current live cache entries when:
  - `geminiModel` changes
  - `translationPrompt` changes
  - `maxOutputTokens` changes
  - an operator clears cache manually
  - the cache schema version is bumped
- Do not invalidate translation cache for policy-only changes such as budgets, cooldowns, or auth settings.

## Consequences

Positive:

- Cache reuse remains correct across the configuration dimensions that materially change translation output.
- Invalidation rules are explicit and semantic instead of relying on guesswork or TTL alone.
- The same policy can be preserved if the cache backend later moves from in-memory LRU to Redis.

Tradeoffs:

- Operators must understand that some config edits intentionally clear hot cache state.
- Schema versioning adds a maintenance step whenever key semantics change.

## Follow-Up Notes

- TTL can still exist later as an operational eviction tool, but it is not the primary correctness mechanism.
- The broader cache backend roadmap is documented separately in `docs/architecture/cache-evolution-roadmap.md`.
