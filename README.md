<div align="center">

# Babel

**Discord translation bot with one-click context menu, powered by Vertex AI Gemini.**

Right-click any message → *Translate / 翻譯* → Get an ephemeral translation only you can see.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)

</div>

## Features

- 🔄 **Context Menu Translation** — Right-click → Apps → Translate / 翻譯
- 👁 **Ephemeral Messages** — Translations are private, only visible to you
- ⚡ **LRU Cache** — Same message translated by 50 users = 1 API call
- 🕐 **Per-User Cooldown** — Configurable rate limiting
- 🔒 **Server Whitelist** — Control which servers can use the bot
- 💰 **Cost Tracking** — Real-time token usage monitoring with daily budget
- 🖥 **Web Dashboard** — Login-protected admin panel with setup wizard

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

### 2. Register the Context Menu Command

```bash
DISCORD_APP_ID=your_app_id DISCORD_BOT_TOKEN=your_token npm run register
```

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
- **Whitelist** — Toggle servers on/off

## Configuration

All configuration is managed through the web dashboard. The `.env` file only needs three values:

| Variable | Description | Default |
|---|---|---|
| `DISCORD_TOKEN` | Discord bot token | *required* |
| `DASHBOARD_PORT` | Dashboard web server port | `3000` |
| `DASHBOARD_PASSWORD` | Dashboard login password | `admin` |

## Production Deployment

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Tech Stack

- [discord.js](https://discord.js.org) v14 — Discord gateway client
- [Express](https://expressjs.com) — Dashboard web server
- [Vertex AI Gemini](https://cloud.google.com/vertex-ai) — Translation engine

## License

[MIT](LICENSE)
