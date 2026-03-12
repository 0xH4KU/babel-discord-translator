<div align="center">

<img src="assets/babel-logo-transparent.png" alt="Babel" width="120">

# Babel

**Discord translation bot with one-click context menu, powered by Vertex AI Gemini.**

Right-click any message → *Babel* → Get an ephemeral translation only you can see.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![CI](https://github.com/0xH4KU/babel-discord-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/0xH4KU/babel-discord-translator/actions)

</div>

## Features

- **Context Menu Translation** — Right-click → Apps → Babel
- **Ephemeral Messages** — Translations are private, only visible to you
- **Multi-language Support** — Auto-detects your Discord locale, or use `/setlang` to choose
- **Check Your Language** — Use `/mylang` to see your current translation language
- **LRU Cache** — Same message translated by 50 users = 1 API call
- **Auto-Retry** — Exponential backoff for transient API errors (429, 503)
- **Per-User Cooldown** — Configurable rate limiting
- **Server Whitelist** — Control which servers can use the bot
- **Cost Tracking** — Real-time token usage with daily budget + 30-day history chart
- **Translation & Error Logs** — In-memory audit log with filter tabs
- **Custom Prompt** — Customize the translation prompt from the dashboard
- **Web Dashboard** — Login-protected admin panel with setup wizard
- **API Health Check** — Dashboard shows API connectivity status
- **Translation Test** — Test translations directly from the dashboard
- **User Preferences** — View and manage user language settings

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

Start the bot:

```bash
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
- **Budget** — Set daily USD limit (0 = unlimited)
- **Prompt** — Customize the translation system prompt
- **Whitelist** — Toggle servers on/off
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

## Development

```bash
# Run in watch mode
npm run dev

# Run tests
npm test

# Run linter
npm run lint

# Format code
npm run format
```

## Production Deployment

### PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Docker

```bash
docker build -t babel .
docker run -d --name babel --env-file .env -p 3000:3000 -v babel-data:/app/data babel
```

## Tech Stack

- [discord.js](https://discord.js.org) v14 — Discord gateway client
- [Express](https://expressjs.com) — Dashboard web server
- [Vertex AI Gemini](https://cloud.google.com/vertex-ai) — Translation engine
- [Vitest](https://vitest.dev) — Testing framework
- [ESLint](https://eslint.org) + [Prettier](https://prettier.io) — Code quality

## License

[GPL-3.0](LICENSE)
