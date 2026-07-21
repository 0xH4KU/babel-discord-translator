# Babel Deployment Guide

This guide covers common ways to run Babel Guild and Babel Pocket from the `babel-discord-translator` monorepo. Babel does not proxy your traffic through a shared hosted bot: you provide the Discord application, dashboard password, hosting, and AI provider credentials.

> Railway links may be affiliate or template links when provided. They help support Babel maintenance at no extra cost to you.

## Before You Deploy

You need:

- A Discord application with a bot token
- Node.js `22.13+` for local/VPS installs and deployment tooling, or Docker for container installs
- A dashboard password that is not `admin`
- At least one configured translation provider in the dashboard after startup

Babel does not require privileged Discord intents.

Node/Docker/Railway deployments store runtime data with native `node:sqlite`. Before upgrading Node.js on those installs, back up `data/babel.sqlite`, rebuild, and run `npm run smoke:dashboard` after upgrading Node. The Cloudflare runtime uses D1 instead.

## Choose The Product Profile

Select the app profile before you register Discord commands or start the process.

| Product      | Install Model        | Runtime Selector     | Command Registration       |
| ------------ | -------------------- | -------------------- | -------------------------- |
| Babel Guild  | Server/Guild Install | `BABEL_APP=guild`    | `npm run register:guild`   |
| Babel Pocket | User Install         | `BABEL_APP=pocket`   | `npm run register:pocket`  |
| Both         | Both                 | `BABEL_APP=combined` | Run both explicit commands |

Babel Guild is the default root profile for backward compatibility. Use Babel Pocket when the Discord application is configured for User Install and you want user-scoped access and budgets.

For Guild:

```bash
npm run build:guild
npm run register:guild
npm run start:guild
```

For Pocket:

```bash
npm run build:pocket
npm run register:pocket
npm run start:pocket
```

Root commands also support `BABEL_APP=guild`, `BABEL_APP=pocket`, or `BABEL_APP=combined` for Docker, PM2, Railway, and simple VPS deployments. Combined mode starts one Node.js process, two Discord clients, one dashboard, and one SQLite database. In combined mode, the combined dashboard root `/` shows a product chooser; `/guild` opens the Babel Guild dashboard; `/pocket` opens the Babel Pocket dashboard. The profile-specific scripts are aliases over the same root build and entrypoint.

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

This registers the default Babel Guild command set unless `BABEL_APP=pocket` is set. Use `npm run register:guild` or `npm run register:pocket` when you want the command surface to be explicit.

## Cloudflare Workers

The Worker workspace replaces the long-running Discord Gateway clients with signed HTTP interactions. It serves the same dashboard assets and persists configuration, sessions, usage, cache, cooldowns, logs, and runtime controls in D1.

Create the D1 database once, add its generated ID to `apps/babel-worker/wrangler.jsonc`, then migrate and deploy:

```bash
npx wrangler d1 create babel-worker --config apps/babel-worker/wrangler.jsonc
npm run db:migrate:remote -w @babel-discord-translator/worker
npm run deploy:worker
```

Keep Cloudflare bindings small:

- Variable: `BABEL_APP=combined`
- Secrets: `DASHBOARD_PASSWORD` plus each profile's Discord token, public key, and application ID
- Dashboard/D1: provider credentials, models, allowlists, prompts, runtime limits, prices, and budgets

The checked-in deployment uses Worker `babel-discord-translator` and custom domain `babel.lum.bio`. Forks must replace the Worker name, D1 database ID, and route. Configure the Discord applications with separate endpoints:

```text
https://babel.lum.bio/guild/interactions
https://babel.lum.bio/pocket/interactions
```

Discord validates each URL with a signed PING when it is saved. Do not retire the previous runtime until `/readyz` returns `200` and both endpoint updates succeed. See the [Worker guide](../../apps/babel-worker/README.md) for required secret names, local development, D1 import, and validation details.

## Railway

Railway is a good fit for small communities that want a hosted self-deploy without managing a VPS. Babel supports Railway's `PORT` variable, binds the dashboard on `0.0.0.0` by default, and includes `railway.json` for the `/livez` healthcheck. A single Railway template can serve either product, or both products together, by exposing `BABEL_APP` as a service variable.

Recommended environment variables:

| Variable             | Value                                                 |
| -------------------- | ----------------------------------------------------- |
| `DISCORD_TOKEN`      | Your Discord bot token for single-profile deployments |
| `BABEL_APP`          | `guild`, `pocket`, or `combined`                      |
| `DASHBOARD_PASSWORD` | A strong random password                              |
| `BABEL_DB_PATH`      | `/app/data/babel.sqlite`                              |
| `NODE_ENV`           | `production`                                          |

Use `BABEL_APP=guild` for Babel Guild, `BABEL_APP=pocket` for Babel Pocket, or `BABEL_APP=combined` to run both in one Railway service. Keep the template default at `guild` so existing template users stay on the server-install product unless they intentionally choose Pocket or combined mode.

For combined mode, set `BABEL_GUILD_DISCORD_TOKEN` and `BABEL_POCKET_DISCORD_TOKEN`. If Guild and Pocket are separate Discord applications, set `BABEL_GUILD_DISCORD_APP_ID` and `BABEL_POCKET_DISCORD_APP_ID` before running `npm run register:guild` and `npm run register:pocket`.

In combined mode, the combined dashboard root `/` shows a product chooser. `/guild` opens the Babel Guild dashboard, and `/pocket` opens the Babel Pocket dashboard.

Use a persistent volume mounted at `/app/data` so SQLite survives restarts and redeploys. If the Railway volume is not writable by the Docker image's non-root user, set `RAILWAY_RUN_UID=0` on the service.

After deployment:

1. Generate a Railway public domain.
2. Open the Railway public URL.
3. Log in with `DASHBOARD_PASSWORD`.
4. Complete the setup wizard and configure the provider.
5. Register Discord commands from a local checkout or Railway shell with the matching `npm run register:guild` or `npm run register:pocket` command.
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
# For BABEL_APP=combined:
# BABEL_GUILD_DISCORD_TOKEN=your_guild_bot_token_here
# BABEL_POCKET_DISCORD_TOKEN=your_pocket_bot_token_here
DASHBOARD_PORT=3000
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PASSWORD=replace_with_a_strong_password
BABEL_DASHBOARD_MODE=full
BABEL_METRICS_TOKEN=
BABEL_DB_PATH=/app/data/babel.sqlite
NODE_ENV=production
```

`BABEL_DASHBOARD_MODE` defaults to `full`. Set it to `health-only` on constrained hosts when you only need `/livez`, `/readyz`, `/healthz`, and `/metrics`. Set it to `off` only if your platform healthcheck no longer depends on Babel's HTTP endpoints.

Set `BABEL_METRICS_TOKEN` when `/metrics` is reachable from outside a private network. In `NODE_ENV=production` with a public bind such as `DASHBOARD_HOST=0.0.0.0`, Babel requires a metrics token by default. Prometheus or curl can pass it as `Authorization: Bearer <token>` or `x-metrics-token: <token>`.

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
Because Babel uses native `node:sqlite`, run `npm run smoke:dashboard` after upgrading Node and before putting the dashboard back behind public traffic.

## Static Dashboard Demo

The public dashboard demo is generated from the real dashboard assets with mock data:

```bash
npm run demo:build
```

The generated site lives in `docs/demo/`, so GitHub Pages can publish it from the `docs` folder. The landing page links to separate read-only Guild and Pocket dashboard demos, both using fixture JSON without connecting to Discord or any AI provider.

When the dashboard UI changes, run `npm run demo:build` before committing to refresh the mirrored demo.

## Operations Checks

After any deploy:

```bash
BABEL_BASE_URL=${BABEL_BASE_URL:-http://localhost:3000}
curl -fsS "$BABEL_BASE_URL/livez"
curl -fsS "$BABEL_BASE_URL/readyz"
curl -fsS -H "Authorization: Bearer $BABEL_METRICS_TOKEN" "$BABEL_BASE_URL/metrics" | head
```

In the dashboard, check:

- Operations provider cards
- Runtime queue pressure
- Budget risk
- Translation test
- Guild access controls for Babel Guild, or user allowlist/pending owners for Babel Pocket

## Support

Babel is free and self-hosted. If it saves setup time or helps your community or private install avoid a hosted bot subscription, you can support upstream maintenance on Ko-fi:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/0xh4ku)
