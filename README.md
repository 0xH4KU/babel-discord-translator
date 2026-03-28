<div align="center">

<img src="assets/babel-logo-transparent.png" alt="Babel" width="120">

# Babel

**Discord translation bot with one-click context menu, powered by Vertex AI Gemini.**

Right-click any message → *Babel* → Get an ephemeral translation only you can see.

[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPL--3.0--only-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![CI](https://github.com/0xH4KU/babel-discord-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/0xH4KU/babel-discord-translator/actions)

</div>

---

## Features

### Core Translation

- **Context Menu Translation** — Right-click → Apps → Babel
- **`/translate` Command** — Slash command with public webhook-based output
- **Ephemeral Messages** — Context menu translations are private, only visible to you
- **Multi-language Support** — Auto-detects your Discord locale, or use `/setlang` to choose
- **Same-Language Detection** — Skips translation when text is already in the user's language
- **Custom Prompt** — Fully customizable translation system prompt from the dashboard

### Performance & Reliability

- **LRU Cache** — Same message translated by 50 users = 1 API call, with versioned cache keys (content hash × language × model × prompt × output tokens)
- **Auto-Retry** — Exponential backoff for transient API errors (429, 5xx)
- **Runtime Translation Queue** — Bounded concurrency/queue limiter with per-user, per-guild, and global backpressure
- **Webhook Auto-Recovery** — Automatically re-creates webhooks if deleted externally

### Security

- **scrypt Password Hashing** — Dashboard password secured with `crypto.scryptSync` + random salt (timing-safe comparison)
- **CSRF Protection** — All dashboard mutation endpoints require a CSRF token
- **Login Rate Limiting** — Brute-force protection (5 attempts / 15 min per IP)
- **Error Sanitization** — API keys and URLs stripped from user-facing error messages
- **Global Error Handlers** — `unhandledRejection` and `uncaughtException` are caught, logged, and handled

### Observability

- **Structured Logging** — JSON logs with request-scoped `requestId`, command context, guild/user IDs, retry classification, and automatic secret redaction
- **Application Metrics** — In-memory counters for translations, API calls, cache hits, failures, budget blocks, and webhook re-creates via `/api/stats`
- **Health Model** — Kubernetes-style `/livez`, `/readyz`, and `/healthz` endpoints separate liveness from readiness
- **Translation & Error Logs** — In-memory audit ring buffer with O(1) error counter

### Dashboard

- **Web Dashboard** — Login-protected admin panel with setup wizard
- **Modular Auth** — Session, cookie, password, and CSRF handling in dedicated auth modules
- **Config Runtime Effects** — Config changes apply immediate runtime updates and cache invalidation
- **API Health Check** — Real-time Vertex AI probe status
- **Translation Test** — Test translations directly from the dashboard
- **User Preferences** — View and manage per-user language settings
- **Cost Tracking** — Real-time token usage with per-server budgets + 30-day history chart

### Infrastructure

- **SQLite Persistence** — Config, usage, preferences, guild budgets, and dashboard sessions stored in a migrated SQLite database
- **Repository Pattern** — Commands, services, and dashboard routes talk to focused repositories instead of reaching into the store directly
- **Governed Message Catalogs** — Discord and dashboard error messages centralized into separate message catalogs
- **Graceful Shutdown** — Clean `SIGTERM`/`SIGINT` handling with ordered teardown for Docker & PM2
- **Pre-commit Hooks** — `husky` + `lint-staged` ensure lint and format on every commit

---

## Quick Start

**Prerequisites:** Node.js `22.5+`, npm, a Discord bot token, and a Vertex AI project.

```bash
git clone https://github.com/0xH4KU/babel-discord-translator.git
cd babel-discord-translator
npm install
cp .env.example .env
```

Edit `.env` with your Discord bot token:

```env
DISCORD_TOKEN=your_bot_token_here
DASHBOARD_PORT=3000
DASHBOARD_PASSWORD=your_strong_password
```

> [!IMPORTANT]
> Use a strong, randomly generated password for `DASHBOARD_PASSWORD`. Babel logs a warning when local development falls back to `admin`, and refuses to start in production if the dashboard password is still `admin`.

Run in development:

```bash
npm run dev
```

For production:

```bash
npm run build
npm start
```

Open `http://localhost:3000` → Login → Complete the setup wizard.
On first boot, Babel creates `data/babel.sqlite` and auto-imports `data/config.json` if a legacy JSON store exists.

---

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

This registers the **Babel** context menu, **/translate**, **/setlang**, **/mylang**, and **/help** commands.

### 3. Invite the Bot

Replace `YOUR_APP_ID` with your application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands
```

### 4. Configure via Dashboard

After starting the bot, open `http://localhost:3000`:

| Tab | Settings |
|---|---|
| **Setup** | Vertex AI API key, GCP project, location, Gemini model |
| **Config** | Cooldown, cache size, max input length, max output tokens, custom prompt |
| **Pricing** | Per-million-token prices, global daily budget (0 = unlimited) |
| **Access** | Server whitelist, per-server budget overrides |
| **Users** | View and manage per-user language preferences |
| **Monitor** | API health, cache hit rate, failure rate, API call volume, translation test |

---

## Multi-language Support

Babel automatically translates to the language that makes sense for you:

| Scenario | Behavior |
|---|---|
| Your Discord is set to Japanese | English messages → 日本語 |
| Your Discord is set to Korean | English messages → 한국어 |
| Chinese/English Discord users | Auto Chinese ↔ English (default behavior) |
| Used `/setlang ja` | Always translates to 日本語 regardless of locale |
| Used `/setlang auto` | Clears preference, reverts to locale detection |

**Priority:** `/setlang` preference > Discord locale > Auto-detect

---

## Configuration

All configuration is managed through the web dashboard. The `.env` file only needs:

| Variable | Description | Default |
|---|---|---|
| `DISCORD_TOKEN` | Discord bot token | *required* |
| `DASHBOARD_PORT` | Dashboard web server port | `3000` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `admin` (development only; refused in production) |
| `BABEL_DB_PATH` | SQLite database path | `data/babel.sqlite` |

If `DASHBOARD_PASSWORD` is omitted, Babel warns in local development and test environments, but exits during startup when `NODE_ENV=production`.

### Migration & Rollback

Babel auto-imports `data/config.json` into SQLite on first startup. Manual scripts:

```bash
# Import legacy JSON → SQLite
npm run db:migrate

# Export SQLite → JSON for rollback
npm run db:export:json
```

Use `npm run db:migrate -- --force` to overwrite an existing SQLite file.

---

## Runtime Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Node.js Process                         │
│                                                             │
│  ┌──────────────┐    ┌────────────────────────────────────┐ │
│  │  Discord.js   │    │         Express Dashboard          │ │
│  │  Gateway       │    │  /livez  /readyz  /healthz        │ │
│  │               │    │  /api/config  /api/stats  ...      │ │
│  └───────┬───────┘    └──────────────┬─────────────────────┘ │
│          │                           │                       │
│  ┌───────▼───────────────────────────▼─────────────────────┐ │
│  │              Shared Application Layer                    │ │
│  │  TranslationService → Cache → RuntimeLimiter → Vertex AI│ │
│  │  CooldownManager    UsageTracker    WebhookService      │ │
│  │  ConfigRepository   AppMetrics      StructuredLogger     │ │
│  └───────────────────────────┬─────────────────────────────┘ │
│                              │                               │
│  ┌───────────────────────────▼─────────────────────────────┐ │
│  │                   SQLite (babel.sqlite)                  │ │
│  │  app_config │ daily_usage │ guild_budgets │ sessions ... │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Module Layout

| Layer | Path | Responsibility |
|---|---|---|
| **Entry** | `src/index.ts` | Wires Discord client, dashboard, metrics, shutdown, global error handlers |
| **Commands** | `src/commands/` | Discord interaction handlers (`babel`, `translate`, `setlang`, `mylang`, `help`) |
| **Translation** | `src/modules/translation/` | Cache, cooldowns, runtime limiter, language detection, webhook delivery |
| **Config** | `src/modules/config/` | Environment validation, runtime config repository, config change effects |
| **Usage** | `src/modules/usage/` | Token accounting, daily budgets, per-guild budgets, usage history |
| **Dashboard** | `src/modules/dashboard/` | Express app, auth/session flow, admin API surface |
| **Shared** | `src/shared/` | Structured logger, health model, graceful shutdown, app metrics, message catalogs |
| **Infra** | `src/infra/` | Vertex AI transport with retry, timeout, and health probes |
| **Persistence** | `src/persistence/` | SQLite connection, migrations, legacy JSON import/export |
| **Repositories** | `src/repositories/` | Data normalization helpers for store data |

### Persistence Model

| State | Storage | Survives Restart? |
|---|---|---|
| Config, usage, preferences, guild budgets, sessions | SQLite | ✅ |
| Translation cache, cooldowns, runtime limiter queues | In-memory | ❌ |
| Audit logs, metrics snapshots, webhook channel cache | In-memory | ❌ |

---

## Project Structure

```
src/
├── index.ts                # Entry point: Discord + dashboard + error handlers
├── commands/               # Discord command handlers
├── modules/
│   ├── config/
│   │   ├── config.ts               # Explicit env loading/validation with startup logging
│   │   ├── config-repository.ts    # Batch-read runtime config over persistence
│   │   └── config-runtime-effects.ts # Immediate in-memory reactions to config edits
│   ├── dashboard/
│   │   ├── dashboard.ts            # Express app factory + async handler wrapper
│   │   └── auth/
│   │       ├── dashboard-auth.ts   # scrypt password hashing, cookie, session, CSRF
│   │       ├── in-memory-session-repository.ts
│   │       ├── sqlite-session-repository.ts
│   │       └── session-repository.ts
│   ├── translation/
│   │   ├── cache.ts                # LRU translation cache with versioned keys
│   │   ├── cooldown.ts             # Per-user cooldown manager
│   │   ├── lang.ts                 # Locale/script detection helpers
│   │   ├── translate.ts            # Prompt assembly + translation entrypoint
│   │   ├── translation-runtime-limiter.ts # Global/guild/user backpressure
│   │   ├── translation-service.ts  # Translation application workflow
│   │   ├── webhook-service.ts      # /translate webhook lifecycle + recovery
│   │   └── user-preference-repository.ts
│   └── usage/
│       ├── usage.ts                # Token cost, budget, and history tracker
│       ├── guild-budget-repository.ts
│       └── usage-repository.ts
├── shared/
│   ├── app-metrics.ts       # In-memory counters and derived rates
│   ├── health.ts            # Liveness/readiness/composite health model
│   ├── log.ts               # Ring buffer audit log with O(1) error counter
│   ├── messages/            # Discord and dashboard message catalogs
│   ├── shutdown.ts          # Graceful shutdown orchestration
│   └── structured-logger.ts # JSON logging with auto secret redaction
├── infra/
│   └── vertex-ai-client.ts     # Vertex AI transport, retry, timeout, health
├── persistence/
│   ├── legacy-json-store.ts    # Legacy config.json import/export
│   ├── sqlite-database.ts      # SQLite connection + schema migrations
│   └── store-defaults.ts       # Default StoreData values
├── repositories/
│   └── store-data-normalizer.ts # Normalization helpers for store data
├── store.ts                # SQLite-backed store facade
├── types.ts                # Shared TypeScript type definitions
├── locales/
│   └── help.json           # Help text in 16 languages
└── public/                 # Dashboard frontend assets
```

---

## Development

```bash
npm run dev             # Run in watch mode (tsx)
npm run typecheck       # Type check (no emit)
npm test                # Run tests
npm run test:coverage   # Run tests with v8 coverage
npm run test:watch      # Run tests in watch mode
npm run lint            # Run ESLint
npm run format          # Format with Prettier
npm run build           # Build for production
npm start               # Run the production artifact
npm run db:migrate      # Import legacy JSON → SQLite
npm run db:export:json  # Export SQLite → JSON
```

### Pre-commit Hooks

This project uses **husky** + **lint-staged** to automatically run ESLint and Prettier on staged `.ts` files before every commit.

Hooks are installed automatically on normal local Git checkouts. The `prepare` step intentionally skips Husky installation in CI, in Docker/runtime images without Git metadata, or when you set `HUSKY=0`.

### Test Coverage

173 tests across 22 suites covering all modules:

| Suite | Tests | Covers |
|---|---|---|
| `cache.test.ts` | 10 | LRU eviction, hit/miss stats, versioned cache keys |
| `config.test.ts` | 4 | Env validation, structured startup logging, development warning, production password refusal |
| `config-repository.test.ts` | 1 | Runtime config reads stay off the full store snapshot path |
| `config-runtime-effects.test.ts` | 4 | Unified config side effects, cache invalidation, immediate runtime sync |
| `cooldown.test.ts` | 6 | Rate limiting, cleanup, per-user isolation |
| `app-metrics.test.ts` | 2 | Counter aggregation and derived success/failure/cache/api rates |
| `log.test.ts` | 14 | Ring buffer, addError, type filtering, O(1) error counter |
| `lang.test.ts` | 29 | Script detection (CJK/Cyrillic/Arabic/Thai/Hindi), locale mapping, same-language check |
| `dashboard-auth.test.ts` | 4 | scrypt auth flow, CSRF enforcement, session expiry cleanup |
| `translation-runtime-limiter.test.ts` | 3 | FIFO queueing, per-user outstanding cap, per-guild/global queue shedding |
| `translation-service.test.ts` | 9 | Shared workflow, cache hits, runtime shedding, budget/error handling |
| `translate-command.test.ts` | 1 | `/translate` delegates delivery to webhook service |
| `webhook-service.test.ts` | 4 | Stale webhook recovery, error classification, LRU webhook cache eviction |
| `vertex-ai-client.test.ts` | 4 | Shared transport, timeout wiring, health checks, endpoint resolution |
| `translate.test.ts` | 20 | Retry logic, prompt building, API errors, URL routing |
| `usage.test.ts` | 23 | Cost calculation, per-server budget enforcement, global fallback, day rollover |
| `store.test.ts` | 7 | SQLite persistence, legacy JSON import, defaults, copy safety |
| `structured-logger.test.ts` | 2 | JSON shape, inherited request context, secret redaction |
| `sqlite-session-repository.test.ts` | 2 | Persistent session storage, enumeration, delete/clear |
| `dashboard.test.ts` | 17 | Auth flow, health endpoints, stats, config protection, async error handling |
| `shutdown.test.ts` | 3 | Shutdown order, timeout forcing, signal deduplication |

---

## Production Deployment

### PM2

```bash
npm install -g pm2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

The PM2 config includes `max_memory_restart: '250M'` for resource-constrained environments (e.g., GCP e2-micro).

### Docker

```bash
docker build -t babel .
docker run -d \
  --name babel \
  --env-file .env \
  -p 3000:3000 \
  -v babel-data:/app/data \
  babel
```

The Dockerfile uses a **multi-stage build** with Node.js `22-alpine`:
- Build stage compiles TypeScript
- Runtime stage runs `npm ci --omit=dev` (no devDependencies in the image)
- Runs as non-root user `babel`
- Built-in `HEALTHCHECK` pings `/livez` every 30 seconds
- SQLite data persisted under `/app/data`

### Health Endpoints

| Endpoint | Purpose | Use As |
|---|---|---|
| `GET /livez` | Process health + config repository check | Container **liveness** probe |
| `GET /readyz` | Setup completeness + live Vertex AI probe | Container **readiness** probe |
| `GET /healthz` | Combined liveness + readiness with degraded/ok status | Operator **monitoring** |

---

## Runtime Limiting Model

```
User Request
    │
    ▼
┌─ Cooldown Check ─┐  ← Per-user rate limit (reject fast)
│                   │
└──────┬────────────┘
       ▼
┌─ Cache Lookup ────┐  ← Cache hit? Return immediately (bypass queue)
│                   │
└──────┬────────────┘
       ▼ (cache miss)
┌─ Runtime Limiter ─┐  ← Bounded: 4 concurrent, 25 global queue,
│  per-user: 1      │    5 per-guild queue, 1 per-user outstanding
│  per-guild: 5     │
│  global: 25       │
└──────┬────────────┘
       ▼
┌─ Vertex AI Call ──┐  ← Retry/backoff runs inside acquired permit
│  (with retry)     │    (prevents retry storms)
└───────────────────┘
```

- Dashboard login uses a separate `express-rate-limit` policy — admin traffic never steals translation permits
- Runtime pressure is exposed in `/api/stats` as `running`, `queued`, and `shed` counts

---

## Security Model

| Layer | Mechanism |
|---|---|
| **Password Storage** | `crypto.scryptSync` with random 16-byte salt, 64-byte key |
| **Password Comparison** | Timing-safe via `crypto.timingSafeEqual` |
| **Session Tokens** | `crypto.randomBytes(32)`, HttpOnly + SameSite=Strict cookies |
| **CSRF** | Per-session CSRF token required on all mutation endpoints |
| **Login Throttle** | `express-rate-limit` — 5 attempts / 15 min per IP |
| **Error Sanitization** | API keys, tokens, and URLs redacted from user-facing errors |
| **Log Redaction** | Automatic redaction of secrets matching known patterns |
| **Process Safety** | Global `unhandledRejection` / `uncaughtException` handlers |
| **SQL Safety** | Table name whitelist in dynamic queries; parameterized queries throughout |
| **Docker** | Non-root user, prod-only dependencies, no devDeps in image |

---

## Tech Stack

| Technology | Version | Role |
|---|---|---|
| [TypeScript](https://www.typescriptlang.org) | 5.9 | Strict mode with `noUncheckedIndexedAccess` |
| [Node.js](https://nodejs.org) | 22.5+ | Runtime with native `node:sqlite` |
| [discord.js](https://discord.js.org) | v14 | Discord gateway client |
| [Express](https://expressjs.com) | v4 | Dashboard & API server |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | v8 | Login throttling |
| [Vertex AI Gemini](https://cloud.google.com/vertex-ai) | — | Translation engine |
| [Vitest](https://vitest.dev) | v3 | 167 tests, 20 suites, v8 coverage |
| [ESLint](https://eslint.org) + [Prettier](https://prettier.io) | v9 / v3 | Code quality |
| [husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged) | v9 / v16 | Pre-commit hooks |

---

## License

This project is licensed under [GPL-3.0-only](LICENSE).
