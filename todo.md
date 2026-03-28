# TODO

Follow-up work after reviewing commits `d0bfe53` and `e8399b7`.

## P0: Remove the runtime-config hot-path regression

- [x] Replace `configRepository.getRuntimeConfig()` so it does not call `store.getAll()`.
  Files:
  `src/modules/config/config-repository.ts`
  `src/store.ts`
- [x] Read only the runtime keys required by translation, usage, health, and dashboard code paths.
- [x] Keep defensive copying for mutable values such as `allowedGuildIds`, but do not load usage history, guild usage history, user preferences, or budget tables unless they are explicitly needed.
- [x] Re-check the hot paths that call `getRuntimeConfig()` frequently.
  Files:
  `src/modules/translation/translation-service.ts`
  `src/modules/translation/translate.ts`
  `src/modules/usage/usage.ts`
  `src/shared/health.ts`
  `src/infra/vertex-ai-client.ts`
- [x] Add or update tests so this regression is hard to reintroduce.
  Suggested coverage:
  `getRuntimeConfig()` returns the same public shape as before
  `getRuntimeConfig()` does not depend on `store.getAll()`
  request-path tests still pass with runtime config reads

Acceptance criteria:

- `getRuntimeConfig()` no longer loads full store snapshots.
- Translation requests do not trigger reads for usage history or user preference tables unless that data is actually required.
- `npm run typecheck`, `npm test`, and `npm run test:coverage` pass.

## P1: Restore startup security and observability

- [x] Reintroduce a clear warning when `DASHBOARD_PASSWORD` falls back to the default `admin`.
  Files:
  `src/modules/config/config.ts`
  `README.md`
- [x] Decide the final policy for the default dashboard password.
  Recommended:
  warn in local development
  fail fast in production
- [x] Make startup config failures produce structured logs before process exit.
  Problem:
  `config` is evaluated at import time, so invalid env values fail before the process-level logging path is established.
  Files:
  `src/index.ts`
  `src/modules/config/config.ts`
  `src/shared/structured-logger.ts`
- [x] Add tests for environment validation behavior.
  Suggested coverage:
  missing `DISCORD_TOKEN`
  invalid `DASHBOARD_PORT`
  default password warning or production failure path

Acceptance criteria:

- Operators get an explicit signal when the dashboard password is unsafe.
- Invalid startup config is logged in a structured way, not just thrown.
- Config validation behavior is covered by tests.

## P1: Tighten Husky installation behavior

- [x] Replace `"prepare": "husky || true"` with a narrower non-blocking strategy.
  File:
  `package.json`
- [x] Allow `prepare` to succeed in environments where Husky should be skipped, such as Docker runtime images or CI checkouts without usable Git metadata.
- [x] Do not silently swallow genuine Husky install failures on a normal local Git checkout.
- [x] Document the expected behavior for contributors.
  Files:
  `package.json`
  `README.md`

Acceptance criteria:

- Local developers notice real Husky installation problems.
- Docker and CI builds still complete without requiring Git hooks.
- Pre-commit hooks remain active on normal contributor machines.

## P2: Add regression-focused test coverage

- [ ] Add tests around the runtime-config access pattern.
  Suggested files:
  `tests/store.test.ts`
  `tests/translation-service.test.ts`
  `tests/usage.test.ts`
- [ ] Add tests for config validation and startup warnings.
  Suggested file:
  `tests/config.test.ts`
- [ ] If the Husky prepare behavior moves into a helper script, add tests for the script or at least document manual verification steps.

Acceptance criteria:

- The regressions found in review are represented by tests or explicit manual verification steps.
- Future refactors can change structure without losing the behavioral guarantees above.

## P2: Optional cleanup after the fixes land

- [ ] Re-check whether `usage.ts` should memoize a runtime config snapshot inside multi-step calculations to avoid repeated reads within one request.
- [ ] Review README wording after the security and hook behavior are finalized so the documentation matches the implemented policy exactly.
- [ ] Consider a small benchmark or debug log to compare runtime-config access before and after the fix if translation latency matters under load.

## Verification checklist

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run test:coverage`
- [x] `npm run build`

Note:

- In restricted sandboxes, dashboard integration tests can fail because they cannot bind a local port. Re-run the test commands in a normal local environment before treating those failures as product regressions.
