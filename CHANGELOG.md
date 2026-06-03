# Changelog

## Unreleased

- Added the Babel Guild and Babel Pocket monorepo app split so server/guild install and user-install products share translation, provider, cache, usage, metrics, logging, and persistence foundations.
- Added app-specific command registration scripts and workspace builds for Guild and Pocket deployments.
- Added user-install persistence, access control, pending owner tracking, and per-user budget/usage support for Babel Pocket.

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
