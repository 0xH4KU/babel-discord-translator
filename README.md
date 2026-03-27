<div align="center">

<img src="assets/babel-logo-transparent.png" alt="Babel" width="120">

# Babel

**Discord translation bot with one-click context menu, powered by Vertex AI Gemini.**

Right-click any message → *Babel* → Get an ephemeral translation only you can see.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![CI](https://github.com/0xH4KU/babel-discord-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/0xH4KU/babel-discord-translator/actions)

</div>

## Features

- **Context Menu Translation** — Right-click → Apps → Babel
- **Ephemeral Messages** — Translations are private, only visible to you
- **Multi-language Support** — Auto-detects your Discord locale, or use `/setlang` to choose
- **Check Your Language** — Use `/mylang` to see your current translation language
- **LRU Cache** — Same message translated by 50 users = 1 API call (both context menu and `/translate`)
- **Versioned Cache Keys** — Cache entries are keyed by source content hash, target language, Gemini model, prompt fingerprint, and output token settings
- **Auto-Retry** — Exponential backoff for transient API errors (429, 503)
- **Per-User Cooldown** — Configurable rate limiting
- **Server Whitelist** — Control which servers can use the bot
- **Cost Tracking** — Real-time token usage with per-server budgets + 30-day history chart
- **Translation & Error Logs** — In-memory audit log with filter tabs
- **Custom Prompt** — Customize the translation prompt from the dashboard
- **Shared Vertex AI Client** — Translation and API health checks use one centralized client with unified timeout and retry handling
- **Repository Boundaries** — Commands, services, and dashboard routes talk to focused repositories instead of reaching into the raw JSON store directly
- **SQLite Persistence** — Config, usage, preferences, guild budgets, and dashboard sessions are stored in a migrated SQLite database
- **Structured Operational Logs** — JSON logs include request-scoped `requestId`, command, guild/user IDs, retry/error classification, and secret redaction
- **Application Metrics** — In-memory counters expose translations, API calls, cache hits, failures, budget blocks, and webhook re-creates through `/api/stats`
- **Runtime Translation Queue** — Cache misses flow through a bounded concurrency/queue limiter with per-user, per-guild, and global backpressure
- **Dedicated Webhook Service** — `/translate` public output uses a dedicated webhook delivery service with stale-webhook recovery, error classification, and bounded LRU channel caching
- **Governed Message Catalogs** — Discord user replies and dashboard/admin API errors are centralized into separate message catalogs instead of being scattered across handlers
- **Web Dashboard** — Login-protected admin panel with setup wizard
- **Modular Dashboard Auth** — Session, cookie, password, and CSRF handling live in dedicated auth modules instead of the route file
- **Unified Config Runtime Effects** — Dashboard config changes flow through one hook that applies immediate runtime updates and cache invalidation rules
- **API Health Check** — Dashboard shows translation readiness and Vertex AI probe status
- **Translation Test** — Test translations directly from the dashboard
- **User Preferences** — View and manage user language settings
- **Input Length Limit** — Configurable max input characters to prevent token waste (default: 2000)
- **Configurable Output Tokens** — Adjust Gemini `maxOutputTokens` from dashboard (default: 1000)
- **Same-Language Detection** — Skips translation when text is already in user's language
- **CSRF Protection** — All dashboard mutation endpoints require a CSRF token
- **Login Rate Limiting** — Brute-force protection (5 attempts / 15 min per IP)
- **Timing-Safe Auth** — SHA-256 hashed password comparison prevents timing attacks
- **Decoupled Dashboard Bootstrap** — Express app creation and HTTP server startup are separated for cleaner tests and lifecycle control
- **Graceful Shutdown** — Clean `SIGTERM`/`SIGINT` handling for Docker & PM2
- **Input Validation** — Config updates are sanitized and range-checked
- **Error Sanitization** — API keys and URLs stripped from user-facing error messages
- **Health Model** — `/livez`, `/readyz`, and `/healthz` separate local process liveness from translation readiness
- **Docker Health Check** — Built-in `/livez` endpoint for container orchestration
- **Webhook Auto-Recovery** — Automatically re-creates webhooks if deleted externally

## Quick Start

```bash
git clone https://github.com/0xH4KU/babel-discord-translator.git
cd babel-discord-translator
npm install
cp .env.example .env
```

Edit `.env` with your Discord bot token:

```bash
nano .env
```

Run in development:

```bash
npm run dev
```

For a production-like local run:

```bash
npm run build
npm start
```

Open `http://localhost:3000` → Login → Complete the setup wizard.
On first boot, Babel creates `data/babel.sqlite` and auto-imports `data/config.json` if a legacy JSON store exists.

## Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to **Bot** → Copy the token
4. No privileged intents are required

### 2. Register Commands

```bash
DISCORD_APP_ID=your_app_id DISCORD_BOT_TOKEN=your_token npm run register
```

This registers the **Babel** context menu, **/setlang**, **/translate**, **/mylang**, and **/help** commands.

### 3. Invite the Bot

Replace `YOUR_APP_ID` with your application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands
```

### 4. Configure via Dashboard

After starting the bot, open `http://localhost:3000`:

- **API Settings** — Vertex AI API key, GCP project, location
- **Model** — Choose your Gemini model
- **Pricing** — Set per-million-token prices for cost tracking
- **Global Budget** — Set default daily USD limit (0 = unlimited)
- **Per-Server Budget** — Override budget per server in the Access tab
- **Prompt** — Customize the translation system prompt
- **Limits** — Max input length (characters) and max output tokens
- **Whitelist** — Toggle servers on/off, manage per-server budgets
- **Translation Test** — Test API connectivity and translations
- **User Preferences** — View and manage per-user language settings
- **API Health** — Monitor API connectivity in real-time
- **Metrics & Stats** — Track cache hit rate, failure rate, API call volume, budget blocks, and webhook recovery events

## Multi-language Support

Babel automatically translates to the language that makes sense for you:

| Scenario | Behavior |
|---|---|
| Your Discord is set to Japanese | English messages → 日本語 |
| Your Discord is set to Korean | English messages → 한국어 |
| Chinese/English Discord users | Auto Chinese ↔ English (default behavior) |
| Used `/setlang ja` | Always translates to 日本語 regardless of locale |
| Used `/setlang auto` | Clears preference, reverts to locale detection |

**Priority**: User preference (`/setlang`) > Discord locale > Auto-detect

## Configuration

All configuration is managed through the web dashboard. The `.env` file only needs three required/runtime values, plus one optional data-path override:

| Variable | Description | Default |
|---|---|---|
| `DISCORD_TOKEN` | Discord bot token | *required* |
| `DASHBOARD_PORT` | Dashboard web server port | `3000` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `admin` |
| `BABEL_DB_PATH` | Optional SQLite database path | `data/babel.sqlite` |

### Migration And Rollback

If you are upgrading from the old JSON store manually, Babel will auto-import `data/config.json` into SQLite on first startup. You can also run the scripts directly:

```bash
# Import legacy data/config.json into SQLite
npm run db:migrate

# Export the current SQLite state back to data/config.json
npm run db:export:json
```

Use `npm run db:migrate -- --force` only if you intentionally want to overwrite an existing SQLite file.

## Project Structure

The runtime code now follows a module-oriented layout. The old top-level paths remain as thin compatibility re-exports while the real implementations live under `src/modules/` and `src/shared/`.

```
src/
├── index.ts                # Entry point wiring Discord, dashboard, metrics, and shutdown
├── commands/               # Discord command handlers and small command-specific helpers
├── modules/
│   ├── config/
│   │   ├── config.ts               # Environment validation and app-level env config
│   │   ├── config-repository.ts    # Runtime/dashboard config boundary over persistence
│   │   └── config-runtime-effects.ts # Immediate in-memory reactions to config edits
│   ├── dashboard/
│   │   ├── dashboard.ts            # Dashboard app factory + HTTP server bootstrap
│   │   └── auth/
│   │       ├── dashboard-auth.ts   # Cookie, session, and CSRF flow
│   │       ├── in-memory-session-repository.ts
│   │       ├── sqlite-session-repository.ts
│   │       └── session-repository.ts
│   ├── translation/
│   │   ├── cache.ts                # LRU translation cache
│   │   ├── cooldown.ts             # Per-user cooldown manager
│   │   ├── lang.ts                 # Locale/language detection helpers
│   │   ├── translate.ts            # Prompt assembly + translation entrypoint
│   │   ├── translation-runtime-limiter.ts # Global/guild/user backpressure policy
│   │   ├── translation-service.ts  # Shared translation application workflow
│   │   ├── webhook-service.ts      # /translate webhook lifecycle, recovery, and channel-scoped LRU cache
│   │   └── user-preference-repository.ts
│   └── usage/
│       ├── usage.ts                # Token cost, budget, and history tracker
│       ├── guild-budget-repository.ts
│       └── usage-repository.ts
├── shared/
│   ├── app-metrics.ts       # In-memory application metrics and derived rates
│   ├── health.ts            # Liveness/readiness/composite health model
│   ├── log.ts               # In-memory ring buffer audit log
│   ├── messages/            # Separate Discord and dashboard/admin message catalogs
│   ├── shutdown.ts          # Graceful shutdown orchestration
│   └── structured-logger.ts # JSON structured operational logging with request context
├── infra/
│   └── vertex-ai-client.ts     # Shared Vertex AI transport, retry, timeout, health
├── persistence/
│   ├── legacy-json-store.ts    # Legacy config.json import/export helpers
│   ├── sqlite-database.ts      # Shared SQLite connection + migrations
│   └── store-defaults.ts       # Canonical default StoreData values
├── repositories/
│   └── store-data-normalizer.ts # Shared normalization helpers for SQLite-backed store data
├── store.ts                # SQLite-backed store facade kept for repository compatibility
├── types.ts                # Shared TypeScript type definitions
├── locales/
│   └── help.json     # Help text in 16 languages
└── public/           # Dashboard frontend assets
```

## Development

```bash
# Run in watch mode
npm run dev

# Type check (no emit)
npm run typecheck

# Import legacy JSON into SQLite
npm run db:migrate

# Export SQLite state back to config.json for rollback
npm run db:export:json

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run linter
npm run lint

# Format code
npm run format

# Build for production
npm run build

# Run the production artifact locally
npm start
```

### Test Coverage

159 tests across 18 suites covering all modules:

| Suite | Tests | Covers |
|---|---|---|
| `cache.test.ts` | 9 | LRU eviction, hit/miss stats, versioned cache keys |
| `config-runtime-effects.test.ts` | 4 | Unified config side effects, cache invalidation, immediate runtime sync |
| `cooldown.test.ts` | 6 | Rate limiting, cleanup, per-user isolation |
| `app-metrics.test.ts` | 2 | Counter aggregation and derived success/failure/cache/api rates |
| `log.test.ts` | 14 | Ring buffer, addError, type filtering, defaults |
| `lang.test.ts` | 29 | Script detection (CJK/Cyrillic/Arabic/Thai/Hindi), locale mapping, same-language check |
| `dashboard-auth.test.ts` | 4 | Standalone auth flow, CSRF enforcement, session expiry cleanup |
| `translation-runtime-limiter.test.ts` | 3 | FIFO queueing, per-user outstanding cap, per-guild/global queue shedding |
| `translation-service.test.ts` | 9 | Shared workflow, cache hits, runtime shedding, budget/error handling, language decisions |
| `translate-command.test.ts` | 1 | Webhook stale recovery increments operational metrics |
| `vertex-ai-client.test.ts` | 4 | Shared transport, timeout wiring, health checks, endpoint resolution |
| `translate.test.ts` | 20 | Retry logic, prompt building, API errors, URL routing |
| `usage.test.ts` | 23 | Cost calculation, per-server budget enforcement, global fallback, day rollover, guild history |
| `store.test.ts` | 7 | SQLite persistence, legacy JSON import, defaults, copy safety |
| `structured-logger.test.ts` | 2 | JSON shape, inherited request context, secret redaction |
| `sqlite-session-repository.test.ts` | 2 | Persistent session storage, enumeration, delete/clear behavior |
| `dashboard.test.ts` | 17 | Auth flow, health endpoints, stats metrics, config protection, runtime cache invalidation |
| `shutdown.test.ts` | 3 | Shutdown order, timeout forcing, signal deduplication |

## Production Deployment

### PM2

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Docker

```bash
docker build -t babel .
docker run -d --name babel --env-file .env -p 3000:3000 -v babel-data:/app/data babel
```

The Docker image includes a built-in `HEALTHCHECK` that pings `/livez` every 30 seconds.
Both PM2 and Docker run the same built artifact as `npm start`: `dist/src/index.js`.
Dashboard sessions now share the same SQLite data file as the rest of the application state, and graceful shutdown closes the database connection before exit.

### Health Endpoints

- `GET /livez` checks only local process health and the in-process config repository. This is the container liveness probe.
- `GET /readyz` checks setup completeness plus a live Vertex AI probe before declaring the app ready for translation traffic.
- `GET /healthz` returns both liveness and readiness with a degraded/ok status so operators can see dependency strategy without conflating restart policy and readiness policy.

## Runtime Limiting Model

- Discord translation commands still enforce the per-user cooldown first, so repeat taps are rejected before they consume queue capacity.
- Dashboard login uses a separate `express-rate-limit` policy and does not share the translation queue, so admin access spikes do not steal translation permits.
- Cache hits bypass the runtime queue entirely; only cache misses compete for translation capacity.
- Cache misses are bounded by a shared runtime limiter with conservative defaults: `4` concurrent upstream translations, `25` queued globally, `5` queued per guild, and `1` outstanding miss per user.
- Vertex AI retry/backoff runs inside an already-acquired permit, which prevents retry storms from multiplying upstream concurrency during partial outages.
- Runtime pressure is exposed in `/api/stats` and the dashboard overview as `running`, `queued`, and `shed` counts.

## Cache Roadmap

As of March 27, 2026, the recommended cache strategy is:

- Keep the current in-memory LRU for the default single-process deployment.
- Move to Redis, not SQLite, when multiple bot workers need to share translation cache state.
- Consider SQLite cache only as a narrow single-host warm-start optimization if restart cold-cache pain becomes material.
- Use explicit semantic invalidation, not TTL alone, for model/prompt/output-token changes.

The full evaluation is documented in `docs/architecture/cache-evolution-roadmap.md`.

## Process Separation

As of March 27, 2026, the recommended deployment model is still a single Node.js process that hosts both the Discord gateway worker and the admin/dashboard HTTP server.

- SQLite-backed config, usage, preferences, guild budgets, and dashboard sessions are now stable enough to support a future split.
- Critical runtime state is still process-local: translation cache, cooldowns, runtime limiter, in-memory logs, metrics snapshots, and webhook cache ownership.
- A formal evaluation is documented in `docs/architecture/bot-admin-process-separation.md`.

Split the processes only when bot traffic and admin traffic need different scale, security boundaries, or SLA handling.

## Tech Stack

- [TypeScript](https://www.typescriptlang.org) 5.9 — Strict mode with `noUncheckedIndexedAccess`
- [node:sqlite](https://nodejs.org/api/sqlite.html) — Built-in SQLite engine, migrations, and persistent session/config storage
- [discord.js](https://discord.js.org) v14 — Discord gateway client
- [Express](https://expressjs.com) + [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) — Dashboard & API security
- [Vertex AI Gemini](https://cloud.google.com/vertex-ai) — Translation engine
- [tsx](https://tsx.is) — TypeScript execution for development
- [Vitest](https://vitest.dev) — Testing (159 tests, 18 suites, v8 coverage)
- [ESLint](https://eslint.org) + [Prettier](https://prettier.io) — Code quality

## License

[GPL-3.0](LICENSE)
