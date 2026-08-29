<div align="center">

<table>
  <tr>
    <td align="center" width="220">
      <img src="assets/logos/babel-guild/babel-guild-logo-transparent.png" alt="Babel Guild logo" width="96"><br>
      <strong>Babel Guild</strong><br>
      <sub>Server/Guild Install</sub>
    </td>
    <td align="center" width="220">
      <img src="assets/logos/babel-pocket/babel-pocket-logo-transparent.png" alt="Babel Pocket logo" width="96"><br>
      <strong>Babel Pocket</strong><br>
      <sub>User Install</sub>
    </td>
  </tr>
</table>

# babel-discord-translator

**A self-hosted Discord translation monorepo for server installs and user installs.**

Babel now ships as two product profiles on one shared core: translation providers, cache, language detection, usage accounting, metrics, logging, persistence, and dashboard foundations are implemented once and reused by both apps.

| App          | Install Model        | Best For                        | Command Surface                                                     |
| ------------ | -------------------- | ------------------------------- | ------------------------------------------------------------------- |
| Babel Guild  | Server/Guild Install | Communities and servers         | `Babel`, `Babel Lens`, `/translate`, `/setlang`, `/mylang`, `/help` |
| Babel Pocket | User Install         | Individuals and trusted friends | `Babel Pocket`, `Babel Lens`, `/setlang`, `/mylang`, `/help`        |

Right-click any message → **Apps** → **Babel** or **Babel Pocket** for text, or **Babel Lens** for an attached image. Results are ephemeral and only visible to you. Operators keep control of hosting, provider keys, access policy, and token costs instead of paying for a shared hosted bot.

[![License: GPL-3.0-only](https://img.shields.io/badge/License-GPL--3.0--only-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![Version](https://img.shields.io/badge/version-0.2.3-brightgreen.svg)](package.json)
[![CI](https://github.com/0xH4KU/babel-discord-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/0xH4KU/babel-discord-translator/actions)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/babel-discord-tran-1?referralCode=euhy-o&utm_medium=integration&utm_source=template&utm_campaign=generic)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/0xh4ku)

[Live Dashboard Demo](https://0xh4ku.github.io/babel-discord-translator/demo/) ·
[Deployment Guide](docs/operations/deployment.md) ·
[Railway](docs/operations/railway.md) ·
[Docker Ops](docs/operations/docker.md) ·
[Changelog](CHANGELOG.md)

</div>

---

## Why Babel

Babel is for Discord communities and trusted individual installs that want translation without handing control to a paid shared bot. Many Discord translation bots charge a subscription for workflows your own AI provider key can already power. Babel keeps that workflow self-hosted: you deploy your own instance, use your own provider key, and pay only your provider usage.

- **Self-hosted** — your Discord token, provider keys, SQLite data, and logs stay in your deployment
- **No privileged intents** — Babel uses context menu and slash commands, not full message-content access
- **Cost controls** — global, per-server, and per-user budgets with cache hit tracking and usage history
- **Guild glossaries** — Babel Guild can define server-specific term mappings for names, brands, game terms, and community vocabulary
- **Operations ready** — health endpoints, Prometheus metrics, runtime queue limits, provider fallback diagnostics, and backup docs

Try the [read-only dashboard demos](https://0xh4ku.github.io/babel-discord-translator/demo/) with Guild and Pocket mock data before deploying.

## Products

### Babel Guild

Babel Guild is the original server-install product. It is built for community operators who want a bot installed in a Discord server, with guild access controls, per-server budgets, server glossaries, and `/translate` webhook output for public translation workflows.

```bash
npm run dev:guild
npm run register:guild
npm run build:guild
npm run start:guild
```

### Babel Pocket

Babel Pocket is the user-install product. It is built for individuals, small trusted groups, and private workflows where the installing user owns the budget and access policy. Pocket keeps translations private and does not register the public `/translate` command.

```bash
npm run dev:pocket
npm run register:pocket
npm run build:pocket
npm run start:pocket
```

## Support

Babel is free and self-hosted. If it saves you setup time or helps your community or private install avoid a hosted bot subscription, you can support upstream maintenance on [Ko-fi](https://ko-fi.com/P5P51QB1B7).

Sponsorship is optional and does not unlock private features. Supporting maintenance helps fund docs, fixes, deployment templates, and provider updates for everyone.

## Features

### Core Translation

- **Context Menu Translation** — Right-click → Apps → Babel Guild or Babel Pocket
- **Babel Lens** — OCR a Discord image with Cloud Vision, translate the detected text, and return a captioned image
- **`/translate` Command** — Guild-only slash command with public webhook-based output
- **Ephemeral Messages** — Context menu translations are private, only visible to you
- **Multi-language Support** — Auto-detects your Discord locale, or use `/setlang` to choose
- **Custom Prompt** — Fully customizable translation system prompt from the dashboard
- **Server Glossary** — Guild-only term mappings injected into translation prompts, with cache invalidation when terms change

### Performance & Reliability

- **LRU Cache** — Same message translated by 50 users = 1 API call, with versioned cache keys (content hash × language × model × prompt × output tokens)
- **Auto-Retry** — Exponential backoff for transient API errors (429, 5xx)
- **Runtime Translation Queue** — Bounded concurrency/queue limiter with per-user, per-guild, and global backpressure
- **Webhook Auto-Recovery** — Automatically re-creates webhooks if deleted externally

### Security

- **scrypt Password Hashing** — Dashboard password verified with asynchronous `crypto.scrypt` + random salt (timing-safe comparison)
- **CSRF Protection** — All dashboard mutation endpoints require a CSRF token
- **Login Rate Limiting** — Brute-force protection (5 attempts / 15 min per IP)
- **Error Sanitization** — API keys and URLs stripped from user-facing error messages
- **Global Error Handlers** — `unhandledRejection` and `uncaughtException` are caught, logged, and handled

### Observability

- **Structured Logging** — JSON logs with request-scoped `requestId`, command context, guild/user IDs, retry classification, and automatic secret redaction
- **Application Metrics** — In-memory counters for translations, API calls, cache hits, failures, provider fallback, budget blocks, and webhook re-creates via `/api/stats` and Prometheus `/metrics`
- **Health Model** — Kubernetes-style `/livez`, `/readyz`, and `/healthz` endpoints separate liveness from readiness
- **Translation & Error Logs** — In-memory audit ring buffer with O(1) error counter

### Dashboard

- **Web Dashboard** — Login-protected admin panel with setup wizard
- **Modular Auth** — Session, cookie, password, and CSRF handling in dedicated auth modules
- **Session Management** — View active dashboard sessions and revoke stale admin logins
- **Config Runtime Effects** — Config changes apply immediate runtime updates and cache invalidation
- **API Health Check** — Real-time health status for each configured provider
- **Translation Test** — Test translations directly from the dashboard
- **User Preferences** — View and manage per-user language settings
- **Cost Tracking** — Real-time token usage with global, per-server, and per-user budget controls

### Infrastructure

- **Portable Persistence** — SQLite stores config, usage, preferences, budgets, and sessions in one file that can be backed up or moved between hosts
- **Governed Message Catalogs** — Discord and dashboard error messages centralized into separate message catalogs
- **Graceful Shutdown** — Clean `SIGTERM`/`SIGINT` handling with ordered teardown for Docker & PM2

---

## Quick Start

**Prerequisites:** Node.js `22.13+`, npm, a Discord bot token, and either a Vertex AI project or credentials for an OpenAI-compatible endpoint. Babel Lens additionally requires a Google API key with the Cloud Vision API enabled.

```bash
git clone https://github.com/0xH4KU/babel-discord-translator.git
cd babel-discord-translator
npm install
cp .env.example .env
```

Edit `.env` with your Discord bot token and app profile:

```env
DISCORD_TOKEN=your_bot_token_here
BABEL_APP=guild
DASHBOARD_PORT=3000
DASHBOARD_PASSWORD=your_strong_password
```

> [!IMPORTANT]
> Use a strong, randomly generated password for `DASHBOARD_PASSWORD`. Babel logs a warning when local development falls back to `admin`, and refuses to start in production if the dashboard password is still `admin`.

Run in development:

```bash
npm run dev
```

Or choose a specific product profile:

```bash
npm run dev:guild
npm run dev:pocket
```

### Supported Translation Providers

Babel ships two provider adapters. Either can run alone, or both can be configured in primary/fallback order from the dashboard.

| Provider              | Required Settings                                  | Transport                                      |
| --------------------- | -------------------------------------------------- | ---------------------------------------------- |
| Vertex AI Gemini      | API key, GCP project, location, and Gemini model    | Native Vertex AI `generateContent` API         |
| OpenAI-compatible API | API key, base URL, and model                        | `${baseUrl}/v1/chat/completions`                |

The OpenAI-compatible adapter covers OpenAI, OpenRouter, and other services that expose the same chat-completions path and bearer-token authentication. A dedicated adapter is only needed when a provider uses a different request or authentication contract.

Babel Lens uses one Cloud Vision `TEXT_DETECTION` feature per image and has a dedicated API key in Settings. Its shared dashboard limit defaults to 900 images per UTC month and is enforced atomically in SQLite; set any non-negative integer, or `0` to disable Lens globally. Babel Guild also requires Lens to be enabled per server in Access; enabling Lens automatically enables Translation, and new servers default to off. Supported Discord attachments are PNG, JPEG, and WebP up to 7 MB and 16 megapixels. Image bytes are sent to Google Cloud Vision for OCR and are not persisted by Babel.

For production:

```bash
npm run build
npm start
```

Or run with Docker Compose:

```bash
docker compose up -d --build
```

Open `http://localhost:3000` → Login → Complete the setup wizard.
On first boot, Babel creates `data/babel.sqlite` and auto-imports `data/config.json` if a legacy JSON store exists.

For Railway, Docker, VPS, PM2, and static dashboard demo notes, see the [deployment guide](docs/operations/deployment.md). The [Railway guide](docs/operations/railway.md) and [Docker operations guide](docs/operations/docker.md) cover hosted and self-managed Node/SQLite deployments.

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

By default, `npm run register` follows `BABEL_APP` and falls back to Babel Guild. Babel Guild registers **Babel**, **Babel Lens**, **/translate**, **/setlang**, **/mylang**, and **/help**.

Choose a specific app:

```bash
DISCORD_APP_ID=your_app_id DISCORD_BOT_TOKEN=your_token npm run register:guild
DISCORD_APP_ID=your_app_id DISCORD_BOT_TOKEN=your_token npm run register:pocket
```

Babel Pocket registers **Babel Pocket**, **Babel Lens**, **/setlang**, **/mylang**, and **/help** for User Install contexts.

### 3. Invite the Bot

Replace `YOUR_APP_ID` with your application ID:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands
```

### 4. Configure via Dashboard

After starting the bot, open `http://localhost:3000`:

| Tab          | Settings                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| **Setup**    | Provider mode, Vertex AI and/or OpenAI-compatible credentials and models    |
| **Config**   | Cooldown, cache size, max input length, max output tokens, custom prompt    |
| **Settings** | Translation providers, dedicated Vision key and monthly image limit         |
| **Access**   | Translation/Lens server access, user allowlist, and budget overrides         |
| **Glossary** | Babel Guild source → target term mappings                                   |
| **Users**    | View and manage per-user language preferences                               |
| **Monitor**  | API health, cache hit rate, failure rate, API call volume, translation test |

For the exact Guild and Pocket budget semantics, see [Budget model](docs/operations/budget-model.md).

---

## Multi-language Support

Babel automatically translates to the language that makes sense for you:

| Scenario                        | Behavior                                         |
| ------------------------------- | ------------------------------------------------ |
| Your Discord is set to Japanese | English messages → 日本語                        |
| Your Discord is set to Korean   | English messages → 한국어                        |
| Chinese/English Discord users   | Auto Chinese ↔ English (default behavior)        |
| Used `/setlang ja`              | Always translates to 日本語 regardless of locale |
| Used `/setlang auto`            | Clears preference, reverts to locale detection   |

**Priority:** `/setlang` preference > Discord locale > Auto-detect

---

## Configuration

All configuration is managed through the web dashboard. The `.env` file only needs:

| Variable              | Description                                                                             | Default                                           |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `DISCORD_TOKEN`       | Discord bot token                                                                       | _required_                                        |
| `PORT`                | Platform-provided dashboard web server port; takes precedence over `DASHBOARD_PORT`     | unset                                             |
| `DASHBOARD_PORT`      | Dashboard web server port                                                               | `3000`                                            |
| `DASHBOARD_HOST`      | Dashboard bind host                                                                     | `0.0.0.0`                                         |
| `DASHBOARD_PASSWORD`  | Dashboard login password                                                                | `admin` (development only; refused in production) |
| `BABEL_METRICS_TOKEN` | Bearer/header token for `GET /metrics`; required by default for production public binds | unset                                             |
| `BABEL_DB_PATH`       | SQLite database path                                                                    | `data/babel.sqlite`                               |
| `BABEL_APP`           | Root app selector: `guild` for Babel Guild, `pocket` for Babel Pocket                   | `guild`                                           |

If `DASHBOARD_PASSWORD` is omitted, Babel warns in local development and test environments, but exits during startup when `NODE_ENV=production`.

Set `BABEL_APP=combined` to run both Babel Guild and Babel Pocket in one process. In combined mode, the combined dashboard root `/` shows a product chooser; `/guild` opens the Babel Guild dashboard; `/pocket` opens the Babel Pocket dashboard.

### Migration & Legacy Export

Babel auto-imports `data/config.json` into SQLite on first startup. Manual scripts:

```bash
# Import legacy JSON → SQLite
npm run db:migrate

# Export the legacy-compatible JSON subset for inspection
npm run db:export:json
```

Use `npm run db:migrate -- --force` to overwrite an existing SQLite file.

The JSON export is not a complete backup and excludes SQLite-only data. Use SQLite's `.backup` command for rollback and disaster recovery; see [SQLite backup and restore](docs/operations/sqlite-backup-restore.md).

Babel stores runtime data through native `node:sqlite`. Before upgrading Node on a self-hosted install, back up `data/babel.sqlite`, run `npm run build`, and run `npm run smoke:dashboard` after upgrading Node.

---

## Runtime Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Node.js Process                         │
│                                                             │
│  BABEL_APP=guild                 BABEL_APP=pocket           │
│  ┌──────────────┐                ┌────────────────┐         │
│  │ Babel Guild  │                │ Babel Pocket   │         │
│  └──────┬───────┘                └────────┬───────┘         │
│         └────────────────┬────────────────┘                 │
│                          │                                  │
│  ┌──────────────┐    ┌────────────────────────────────────┐ │
│  │  Discord.js   │    │         Express Dashboard          │ │
│  │  Gateway       │    │  /livez  /readyz  /healthz        │ │
│  │               │    │  /api/config  /api/stats  ...      │ │
│  └───────┬───────┘    └──────────────┬─────────────────────┘ │
│          │                           │                       │
│  ┌───────▼───────────────────────────▼─────────────────────┐ │
│  │              Shared Application Layer                    │ │
│  │ TranslationService → Cache → RuntimeLimiter → Providers│ │
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

| Layer           | Path                       | Responsibility                                                                    |
| --------------- | -------------------------- | --------------------------------------------------------------------------------- |
| **Profiles**    | `src/apps/`                | Guild/Pocket profiles, bootstrap, and command definitions                         |
| **Entry**       | `src/index.ts`             | Node entrypoint selected by `BABEL_APP` or a CLI profile argument                 |
| **Commands**    | `src/commands/`            | Discord interaction handlers (`babel`, `translate`, `setlang`, `mylang`, `help`)  |
| **Translation** | `src/modules/translation/` | Cache, cooldowns, runtime limiter, language detection, webhook delivery           |
| **Config**      | `src/modules/config/`      | Environment validation, runtime config access, config change effects              |
| **Usage**       | `src/modules/usage/`       | Token accounting, global/guild/user budgets, usage history                        |
| **Dashboard**   | `src/modules/dashboard/`   | Express app, auth/session flow, capability-gated admin API surface                |
| **Shared**      | `src/shared/`              | Structured logger, health model, graceful shutdown, app metrics, message catalogs |
| **Infra**       | `src/infra/`               | Translation provider transports, retry, timeout, and health probes                |
| **Persistence** | `src/persistence/`         | SQLite store, migrations, normalization, and legacy JSON import/export            |

### Persistence Model

| State                                                    | Storage   | Survives Restart? |
| -------------------------------------------------------- | --------- | ----------------- |
| Config, usage, preferences, guild/user budgets, sessions | SQLite    | yes               |
| Server glossaries and pending Pocket owners              | SQLite    | yes               |
| Translation cache, cooldowns, runtime limiter queues     | In-memory | no                |
| Audit logs, metrics snapshots, webhook channel cache     | In-memory | no                |

---

## Development

```bash
npm run dev             # Run root app in watch mode, selected by BABEL_APP
npm run dev:guild       # Run Babel Guild in watch mode
npm run dev:pocket      # Run Babel Pocket in watch mode
npm run typecheck       # Type check (no emit)
npm test                # Run tests
npm run test:coverage   # Run tests with v8 coverage
npm run test:watch      # Run tests in watch mode
npm run lint            # Run ESLint
npm run format          # Format with Prettier
npm run build           # Build the Node runtime for production
npm run build:guild     # Build Babel Guild
npm run build:pocket    # Build Babel Pocket
npm run register:guild  # Register Babel Guild commands
npm run register:pocket # Register Babel Pocket commands
npm run demo:build      # Build Guild and Pocket dashboard demos into docs/demo for GitHub Pages
npm start               # Run production root app, selected by BABEL_APP
npm run start:guild     # Run Babel Guild production artifact
npm run start:pocket    # Run Babel Pocket production artifact
npm run db:migrate      # Import legacy JSON → SQLite
npm run db:export:json  # Export the legacy-compatible JSON subset
```

### Test Coverage

The test suite exercises the Node/SQLite runtime. Run `npm test` for the executable suite and `npm run test:coverage` for coverage.

---

## Production Deployment

### Railway

Babel is Railway-ready for a one-click self-host template: `railway.json` configures the `/livez` healthcheck, Railway's `PORT` is respected automatically, and `/app/data` can be mounted as a volume for SQLite. One Railway template can deploy either Babel Guild or Babel Pocket by exposing `BABEL_APP` as a service variable; keep `guild` as the default for existing users and set `pocket` for user-install deployments. Set `BABEL_APP=combined` to run both products in one service; the combined dashboard root `/` shows a product chooser, `/guild` opens the Babel Guild dashboard, and `/pocket` opens the Babel Pocket dashboard.

Run one replica per Discord application. Babel's Discord event handling, runtime limits, queues, caches, and metrics are process-local, so horizontal scaling is not currently supported even when replicas share SQLite storage.

Use these template variables:

| Variable             | Value                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| `DISCORD_TOKEN`      | Your Discord bot token                                                     |
| `BABEL_APP`          | `guild` for Babel Guild, `pocket` for Babel Pocket, or `combined` for both |
| `DASHBOARD_PASSWORD` | A strong random password                                                   |
| `BABEL_DB_PATH`      | `/app/data/babel.sqlite`                                                   |
| `NODE_ENV`           | `production`                                                               |

Mount a Railway volume at `/app/data`, generate a public domain, then log in and finish provider setup from the dashboard. See [Railway deployment](docs/operations/railway.md) for the template publishing checklist and transparent kickback disclosure wording.

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

| Endpoint       | Purpose                                                                                        | Use As                       |
| -------------- | ---------------------------------------------------------------------------------------------- | ---------------------------- |
| `GET /livez`   | Runtime liveness                                                                               | Platform **liveness** probe  |
| `GET /readyz`  | Local database/config, Discord connection, and provider configuration readiness                | Platform **readiness** probe |
| `GET /healthz` | Combined readiness status                                                                      | Operator **monitoring**      |
| `GET /metrics` | Prometheus text metrics with version, translation, provider, queue, cache, and budget counters | Alerting and dashboards      |

Set `BABEL_METRICS_TOKEN` before exposing `/metrics` outside a private network. When `NODE_ENV=production` and `DASHBOARD_HOST` is a public bind such as `0.0.0.0`, Babel requires a metrics token by default. Scrapers can pass it with `Authorization: Bearer <token>` or `x-metrics-token: <token>`.

### Operations Guides

- [Deployment guide](docs/operations/deployment.md)
- [Alerts runbook](docs/operations/alerts-runbook.md)
- [SQLite backup and restore](docs/operations/sqlite-backup-restore.md)

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
┌─ Provider Call ───┐  ← Retry/backoff runs inside acquired permit
│  (with retry)     │    (prevents retry storms)
└───────────────────┘
```

- Dashboard login uses a separate `express-rate-limit` policy — admin traffic never steals translation permits
- Runtime pressure is exposed in `/api/stats` as `running`, `queued`, and `shed` counts

---

## Security Model

| Layer                   | Mechanism                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Password Storage**    | Async `crypto.scrypt` verification with random 16-byte salt and a 64-byte key                      |
| **Password Comparison** | Timing-safe via `crypto.timingSafeEqual`                                                          |
| **Session Tokens**      | `crypto.randomBytes(32)`, HttpOnly + SameSite=Strict cookies                                      |
| **CSRF**                | Per-session CSRF token required on all mutation endpoints                                         |
| **Login Throttle**      | `express-rate-limit` — 5 attempts / 15 min per IP                                                 |
| **Security Headers**    | Dashboard responses include CSP, `X-Frame-Options`, `X-Content-Type-Options`, and Referrer Policy |
| **Error Sanitization**  | API keys, tokens, and URLs redacted from user-facing errors                                       |
| **Log Redaction**       | Automatic redaction of secrets matching known patterns                                            |
| **Process Safety**      | Global `unhandledRejection` / `uncaughtException` handlers                                        |
| **SQL Safety**          | Table name whitelist in dynamic queries; parameterized queries throughout                         |
| **Docker**              | Non-root user, prod-only dependencies, no devDeps in image                                        |

---

## Tech Stack

| Technology                                                                     | Version | Role                                        |
| ------------------------------------------------------------------------------ | ------- | ------------------------------------------- |
| [TypeScript](https://www.typescriptlang.org)                                   | 6.0     | Strict mode with `noUncheckedIndexedAccess` |
| [Node.js](https://nodejs.org)                                                  | 22.13+  | Runtime with native `node:sqlite`           |
| [discord.js](https://discord.js.org)                                           | v14     | Discord gateway client                      |
| [Express](https://expressjs.com)                                               | v5      | Dashboard & API server                      |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | v8      | Login throttling                            |
| [Vertex AI Gemini](https://cloud.google.com/vertex-ai)                         | —       | Native translation provider                 |
| OpenAI-compatible Chat Completions                                             | —       | Configurable translation provider           |
| [Vitest](https://vitest.dev)                                                   | v4      | Test runner with v8 coverage                |
| [ESLint](https://eslint.org) + [Prettier](https://prettier.io)                 | v9 / v3 | Code quality                                |

---

## License

This project is licensed under [GPL-3.0-only](LICENSE).
