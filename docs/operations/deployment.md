# Babel Deployment Guide

This guide covers common ways to run Babel as a self-hosted Discord translation bot. Babel does not proxy your traffic through a shared hosted bot: you provide the Discord bot token, dashboard password, hosting, and AI provider credentials.

> Railway links may be affiliate or template links when provided. They help support Babel maintenance at no extra cost to you.

## Before You Deploy

You need:

- A Discord application with a bot token
- Node.js `22.12+` for local/VPS installs, or Docker for container installs
- A dashboard password that is not `admin`
- At least one configured translation provider in the dashboard after startup

Babel does not require privileged Discord intents.

## Choosing An App

Use Babel Guild for server/guild install deployments. Use Babel Pocket for User Install deployments.

For Guild:

```bash
npm run build:guild
npm run register:guild
npm run start -w @babel-discord-translator/guild
```

For Pocket:

```bash
npm run build:pocket
npm run register:pocket
npm run start -w @babel-discord-translator/pocket
```

Root commands also support `BABEL_APP=guild` or `BABEL_APP=pocket` for Docker, PM2, and simple VPS deployments.

## Discord Setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application.
3. Open **Bot** and copy the bot token.
4. Invite the bot with:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands
```

5. Register commands:

```bash
DISCORD_APP_ID=your_app_id DISCORD_BOT_TOKEN=your_token npm run register
```

This registers the default Babel Guild command set. Use `npm run register:pocket` for Babel Pocket user-install commands.

## Railway

Railway is a good fit for small communities that want a hosted self-deploy without managing a VPS. Babel supports Railway's `PORT` variable, binds the dashboard on `0.0.0.0` by default, and includes `railway.json` for the `/livez` healthcheck.

Recommended environment variables:

| Variable             | Value                    |
| -------------------- | ------------------------ |
| `DISCORD_TOKEN`      | Your Discord bot token   |
| `BABEL_APP`          | `guild` or `pocket`      |
| `DASHBOARD_PASSWORD` | A strong random password |
| `BABEL_DB_PATH`      | `/app/data/babel.sqlite` |
| `NODE_ENV`           | `production`             |

Use a persistent volume mounted at `/app/data` so SQLite survives restarts and redeploys. If the Railway volume is not writable by the Docker image's non-root user, set `RAILWAY_RUN_UID=0` on the service.

After deployment:

1. Generate a Railway public domain.
2. Open the Railway public URL.
3. Log in with `DASHBOARD_PASSWORD`.
4. Complete the setup wizard and configure the provider.
5. Register Discord commands from a local checkout or Railway shell with `npm run register`.
6. Check `/livez`, `/readyz`, and the dashboard Operations panel.

For the one-click template checklist, persistent volume notes, and affiliate disclosure wording, see [Railway deployment](railway.md).

Railway autodeploys apply to services connected directly to a GitHub repository and branch. Services created from the Babel template should be treated as self-hosted installs: review upstream changes, back up the SQLite volume, then apply the template update or redeploy intentionally. Babel's dashboard version badge checks GitHub releases hourly; use the refresh button beside the badge for an immediate update check.

## Docker / VPS

Build and run:

```bash
docker build -t babel .
docker run -d \
  --name babel \
  --env-file .env \
  -p 3000:3000 \
  -v babel-data:/app/data \
  babel
```

Example `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
BABEL_APP=guild
DASHBOARD_PORT=3000
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PASSWORD=replace_with_a_strong_password
BABEL_DB_PATH=/app/data/babel.sqlite
NODE_ENV=production
```

Verify:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
```

For Docker Compose, update, cleanup, backup, and server migration commands, see [Docker deployment and operations](docker.md).

## PM2

For a direct Node.js install:

```bash
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Keep `data/babel.sqlite` backed up. See [SQLite backup and restore](sqlite-backup-restore.md).

## Static Dashboard Demo

The public dashboard demo is generated from the real dashboard assets with mock data:

```bash
npm run demo:build
```

The generated site lives in `docs/demo/`, so GitHub Pages can publish it from the `docs` folder. The demo is read-only, uses fixture JSON, and does not connect to Discord or any AI provider.

When the dashboard UI changes, run `npm run demo:build` before committing to refresh the mirrored demo.

## Operations Checks

After any deploy:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
curl -fsS http://localhost:3000/metrics | head
```

In the dashboard, check:

- Operations provider cards
- Runtime queue pressure
- Budget risk
- Translation test
- Server whitelist

## Support

Babel is free and self-hosted. If it saves setup time or helps your community avoid a hosted bot subscription, you can support upstream maintenance on Ko-fi:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/0xh4ku)
