# Babel Cloudflare Worker

This workspace is the Cloudflare runtime. It supports Discord HTTP interactions, the existing static dashboard, D1-backed dashboard sessions/configuration, language preferences, usage history, budgets, glossary management, message-context translation, and `/translate` using Vertex AI or an OpenAI-compatible endpoint.

The checked-in production config deploys combined mode as Worker `babel-discord-translator` on [babel.lum.bio](https://babel.lum.bio). Forks must replace the Worker name, D1 database ID, and custom domain in `wrangler.jsonc`.

```bash
npm install
npm run db:migrate:local -w @babel-discord-translator/worker
npm run dev:worker
```

For combined local development, create an ignored `apps/babel-worker/.dev.vars`:

```dotenv
DASHBOARD_PASSWORD=replace_me
BABEL_GUILD_DISCORD_PUBLIC_KEY=replace_me
BABEL_POCKET_DISCORD_PUBLIC_KEY=replace_me
BABEL_GUILD_DISCORD_TOKEN=replace_me
BABEL_POCKET_DISCORD_TOKEN=replace_me
BABEL_GUILD_DISCORD_APP_ID=replace_me
BABEL_POCKET_DISCORD_APP_ID=replace_me
```

For production, set the same seven values as Worker secrets:

```bash
cd apps/babel-worker
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put BABEL_GUILD_DISCORD_PUBLIC_KEY
npx wrangler secret put BABEL_POCKET_DISCORD_PUBLIC_KEY
npx wrangler secret put BABEL_GUILD_DISCORD_TOKEN
npx wrangler secret put BABEL_POCKET_DISCORD_TOKEN
npx wrangler secret put BABEL_GUILD_DISCORD_APP_ID
npx wrangler secret put BABEL_POCKET_DISCORD_APP_ID
```

Keep only `BABEL_APP=combined` in Wrangler variables. Configure providers, allowlists, runtime limits, pricing, and budgets in the dashboard; empty allowlists deny translations until setup is complete.

The dashboard is served from `/`; combined deployments also expose profile-scoped views at `/guild` and `/pocket`. Dashboard changes are stored in D1 and override matching Wrangler defaults without requiring a Worker restart. Translation cache entries, cooldowns, usage, the 200 most recent audit events, and operational counters are also stored in D1.

`/metrics` exposes Prometheus counters. Set `BABEL_METRICS_TOKEN` as a secret to require either an `X-Metrics-Token` header or `Authorization: Bearer` token.

Configure Vertex AI and OpenAI-compatible providers in the dashboard. Provider keys and all runtime settings are stored in D1, so they do not need duplicate Worker variables or secrets.

Dashboard pricing and budget settings control D1 usage accounting and budget enforcement. Zero means unlimited. Guild/user overrides live in the `guild_budgets` and `user_budgets` D1 tables; guild glossary entries live in `guild_glossary`.

Combined deployments use separate Discord endpoints and secrets:

```text
https://babel.lum.bio/guild/interactions
https://babel.lum.bio/pocket/interactions

BABEL_GUILD_DISCORD_PUBLIC_KEY
BABEL_POCKET_DISCORD_PUBLIC_KEY
BABEL_GUILD_DISCORD_TOKEN
BABEL_POCKET_DISCORD_TOKEN
BABEL_GUILD_DISCORD_APP_ID
BABEL_POCKET_DISCORD_APP_ID
```

Set `BABEL_APP` to `combined` for that layout. Command registration remains a deliberate local/CI step using the existing `npm run register:guild` and `npm run register:pocket` scripts.

Create the production database once, copy its generated ID into `wrangler.jsonc` if Wrangler does not add it automatically, then migrate and deploy from the repository root:

```bash
npx wrangler d1 create babel-worker --config apps/babel-worker/wrangler.jsonc
npm run db:migrate:remote -w @babel-discord-translator/worker
npm run deploy:worker
```

## Railway data migration

Railway volume file access and SSH require an active deployment. SQLite uses WAL, so do not download only `babel.sqlite`. Briefly start the existing service, open an interactive Railway shell, and create a consistent backup:

```bash
railway ssh
```

Inside the Railway shell:

```bash
node --input-type=module -e 'import { DatabaseSync, backup } from "node:sqlite"; const db = new DatabaseSync(process.env.BABEL_DB_PATH || "/app/data/babel.sqlite", { readOnly: true }); await backup(db, "/app/data/babel-d1-export.sqlite"); db.close();'
exit
```

Back on the local machine:

```bash
railway volume files download /babel-d1-export.sqlite backups/railway-babel.sqlite --overwrite
```

Convert the SQLite backup to data-only SQL, apply the Worker schema, and import it into D1:

```bash
npm run db:export:d1 -- backups/railway-babel.sqlite backups/babel-d1-import.sql
npm run db:migrate:remote -w @babel-discord-translator/worker
npx wrangler d1 execute babel-worker --remote \
  --config apps/babel-worker/wrangler.jsonc \
  --file=backups/babel-d1-import.sql
```

The import preserves dashboard configuration, provider keys stored by the dashboard, language preferences, budgets, usage history, glossary entries, and pending Pocket owners. It deliberately excludes dashboard sessions and cache metadata. Transfer Railway environment secrets separately. Discord interaction public keys are the applications' verify keys from the Discord Developer Portal or current-application API. After verifying the local backup and D1 row counts, remove `/app/data/babel-d1-export.sqlite` from the Railway volume.

For a single profile, set the deployed `/interactions` URL as the Discord application's Interactions Endpoint URL. The existing Node/Gateway deployments are unchanged.

Use `/livez` for process health and `/readyz` to verify D1, Discord, provider, access, and public-output configuration before changing the Discord endpoint. Readiness and the dashboard API health badge perform a small provider probe with output capped at 64 tokens and cache the result for five seconds.
