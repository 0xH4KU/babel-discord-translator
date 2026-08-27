# Changelog

## Unreleased

- Removed the Cloudflare Worker/D1 runtime and deployment tooling; Babel now ships one Node.js Gateway and SQLite runtime for Railway, Docker, VPS, and PM2 deployments.

## 0.2.2 - 2026-07-12

- Added a Cloudflare Workers runtime with signed Discord HTTP interactions, combined Guild/Pocket routing, static dashboard assets, and D1-backed config, sessions, usage, cache, cooldowns, logs, metrics, and runtime admission controls.
- Added SQLite-to-D1 migration tooling and production deployment guidance for Worker secrets, custom domains, health checks, and Discord interaction endpoints.
- Reused the shared translation prompt and glossary logic across Node and Worker runtimes, and added Worker/D1 regression coverage.
- Improved the dashboard's Worker compatibility, post-setup metadata refresh, avatar fallback, persistent log messaging, and narrow-mobile tab layout.
- Added Setup Doctor checks and dashboard diagnostics for database, Discord, provider, command, and webhook readiness.
- Added Pocket daily-budget and per-user budget views, 30-day CSV usage export, and guild-scoped user language preferences.
- Scoped combined dashboard metrics and translation tests by active app profile, and hardened config validation, metrics authentication, provider HTTP errors, and retry classification.

## 0.2.1 - 2026-06-22

- Added multilingual server glossary support and CSV/TSV glossary import workflows.
- Scoped combined dashboard logs and usage history by active app profile.
- Added optional metrics token authentication and safer dashboard error handling.
- Fixed Pocket history scope bypass and escaped stored glossary fields in dashboard rendering.
- Pinned `undici` through an npm override to satisfy the high-severity audit gate.

## 0.2.0 - 2026-06-13

- Added combined mode with one Node.js process, two Discord clients, one SQLite database, and separate dashboard entrypoints: `/` shows a product chooser, `/guild` manages Babel Guild, and `/pocket` manages Babel Pocket.
- Added Railway and Docker deployment guidance for `BABEL_APP=combined`, profile-specific Discord tokens, persistent SQLite volumes, and low-cost shared-fate hosting.
- Added health-only dashboard mode and Docker memory tuning for constrained hosts.
- Improved runtime performance with in-flight provider call deduplication, cached runtime config reads, queue/counter cleanup, prepared SQLite statement reuse, daily usage fast paths, and bounded Discord.js cache settings.
- Improved provider resilience by persisting circuit breaker state and avoiding extra exhausted-retry requests.
- Added OpenAI-compatible provider, config validation, dashboard capability, Discord profile, message extraction, command registration, and deployment regression coverage.
- Updated the read-only GitHub Pages dashboard demos for Guild and Pocket, including combined chooser-compatible frontend assets.

## 0.1.2 - 2026-06-01

- Added the Railway one-click deployment path with a public template button, `railway.json`, `/livez` healthcheck wiring, Railway `PORT` support, and `/app/data` SQLite persistence guidance.
- Added per-server glossary management so each Discord server can keep its own term mappings for names, brands, game terms, and community vocabulary.
- Added Docker self-host operations docs covering first deploy, updates, cleanup, and server migration.
- Improved self-hosting docs around Railway, Docker, setup flow, and optional Ko-fi support.
- Kept the README lean by moving release history into this changelog.

## 0.1.1 - 2026-06-01

- Added a read-only static dashboard demo for GitHub Pages.
- Added Ko-fi support links for optional upstream maintenance.
- Added dashboard update checks that turn the version badge yellow when a newer GitHub release is available.

## 0.1.0 - 2026-06-01

- First release-tagged operations build.
- Added visible version metadata in the README, dashboard, `/api/version`, and `/metrics`.
- Added provider fallback diagnostics.
- Added bounded translation queue controls.
- Added budget estimate guards.
- Added dashboard operations guidance.
- Added dashboard session revoke controls.
- Added Prometheus-ready metrics for release monitoring.
