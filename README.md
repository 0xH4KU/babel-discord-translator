<div align="center">

<img src="assets/babel-logo-transparent.png" alt="Babel" width="120">

# Babel

**Discord translation bot with one-click context menu, powered by Vertex AI Gemini.**

Right-click any message → *Babel* → Get an ephemeral translation only you can see.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
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
- **Web Dashboard** — Login-protected admin panel with setup wizard
- **API Health Check** — Dashboard shows API connectivity status
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
- **Docker Health Check** — Built-in `/healthz` endpoint for container orchestration
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

All configuration is managed through the web dashboard. The `.env` file only needs three values:

| Variable | Description | Default |
|---|---|---|
| `DISCORD_TOKEN` | Discord bot token | *required* |
| `DASHBOARD_PORT` | Dashboard web server port | `3000` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `admin` |

## Project Structure

```
src/
├── index.ts          # Entry point, client setup, graceful shutdown
├── config.ts         # Environment validation (fail-fast)
├── types.ts          # Shared TypeScript type definitions
├── lang.ts           # Language detection & locale mapping
├── translate.ts      # Vertex AI Gemini API client with retry
├── cache.ts          # LRU translation cache
├── cooldown.ts       # Per-user rate limiter
├── log.ts            # In-memory ring buffer audit log
├── store.ts          # File-based config persistence
├── usage.ts          # Token usage tracking & per-server budget enforcement
├── dashboard.ts      # Dashboard app factory + HTTP server bootstrap
├── shutdown.ts       # Graceful shutdown orchestration for Discord + HTTP
├── services/
│   └── translation-service.ts  # Shared translation application workflow
├── commands/         # Discord command handlers
│   ├── babel.ts      #   Context menu translation
│   ├── translate.ts  #   /translate (public via webhook)
│   ├── setlang.ts    #   /setlang & /mylang
│   ├── help.ts       #   /help (loads locales from JSON)
│   └── shared.ts     #   Error sanitization utilities
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

132 tests across 10 suites covering all modules:

| Suite | Tests | Covers |
|---|---|---|
| `cache.test.ts` | 9 | LRU eviction, hit/miss stats, versioned cache keys |
| `cooldown.test.ts` | 6 | Rate limiting, cleanup, per-user isolation |
| `log.test.ts` | 14 | Ring buffer, addError, type filtering, defaults |
| `lang.test.ts` | 29 | Script detection (CJK/Cyrillic/Arabic/Thai/Hindi), locale mapping, same-language check |
| `translation-service.test.ts` | 7 | Shared workflow, cache hits, budget/error handling, language decisions |
| `translate.test.ts` | 20 | Retry logic, prompt building, API errors, URL routing |
| `usage.test.ts` | 23 | Cost calculation, per-server budget enforcement, global fallback, day rollover, guild history |
| `store.test.ts` | 7 | File persistence, defaults merging, corrupt JSON resilience |
| `dashboard.test.ts` | 14 | Auth flow, API key masking, config protection, runtime cache invalidation |
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

The Docker image includes a built-in `HEALTHCHECK` that pings `/healthz` every 30 seconds.
Both PM2 and Docker run the same built artifact as `npm start`: `dist/src/index.js`.

## Tech Stack

- [TypeScript](https://www.typescriptlang.org) 5.9 — Strict mode with `noUncheckedIndexedAccess`
- [discord.js](https://discord.js.org) v14 — Discord gateway client
- [Express](https://expressjs.com) + [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) — Dashboard & API security
- [Vertex AI Gemini](https://cloud.google.com/vertex-ai) — Translation engine
- [tsx](https://tsx.is) — TypeScript execution for development
- [Vitest](https://vitest.dev) — Testing (132 tests, 10 suites, v8 coverage)
- [ESLint](https://eslint.org) + [Prettier](https://prettier.io) — Code quality

## License

[GPL-3.0](LICENSE)
