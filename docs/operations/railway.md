# Railway Deployment

Railway is the easiest hosted self-deploy path for Babel Guild or Babel Pocket. It keeps the project aligned with the self-hosted model: every operator runs their own app instance, brings their own Discord token and AI provider credentials, and pays Railway/API usage directly instead of paying Babel for a hosted subscription.

> Railway template links may support Babel maintenance through Railway's template kickback program. Babel remains free and open source; sponsorship or affiliate attribution does not unlock private features.

## One-Click Template Status

The repository is Railway-ready:

- `railway.json` defines the `/livez` healthcheck and restart policy.
- Babel reads Railway's `PORT` before `DASHBOARD_PORT`.
- Babel binds the dashboard to `DASHBOARD_HOST`, which defaults to `0.0.0.0`.
- The Docker image stores SQLite data under `/app/data` when `BABEL_DB_PATH=/app/data/babel.sqlite`.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/babel-discord-tran-1?referralCode=euhy-o&utm_medium=integration&utm_source=template&utm_campaign=generic)

## Choose The Product Profile

Select the app profile before deploying or registering Discord commands.

| Product      | Install Model        | Railway Variable   | Command Registration      |
| ------------ | -------------------- | ------------------ | ------------------------- |
| Babel Guild  | Server/Guild Install | `BABEL_APP=guild`  | `npm run register:guild`  |
| Babel Pocket | User Install         | `BABEL_APP=pocket` | `npm run register:pocket` |

Babel Guild remains the default for existing Railway template users. Babel Pocket uses the same image and persistence layer, but expects a Discord application configured for User Install.

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

Railway Docker deployments can use the same image for either app. Set `BABEL_APP=guild` for Babel Guild or `BABEL_APP=pocket` for Babel Pocket.

## Required Variables

Set these in the Railway template or service variables:

| Variable             | Value                    |
| -------------------- | ------------------------ |
| `DISCORD_TOKEN`      | Discord bot token        |
| `BABEL_APP`          | `guild` or `pocket`      |
| `DASHBOARD_PASSWORD` | Strong random password   |
| `NODE_ENV`           | `production`             |
| `BABEL_DB_PATH`      | `/app/data/babel.sqlite` |

Optional variables:

| Variable         | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `DASHBOARD_HOST` | `0.0.0.0`                                                         |
| `DASHBOARD_PORT` | `3000` for non-Railway deploys; Railway's `PORT` takes precedence |

Do not put provider API keys in the template defaults. Configure Vertex AI or OpenAI-compatible provider settings from the dashboard after first login.

## Persistent SQLite

Create a Railway volume and mount it at:

```text
/app/data
```

Railway's build system uses `/app` as the application directory, so mounting the volume at `/app/data` persists `babel.sqlite` across restarts and redeploys.

If you use the Docker image on Railway, volumes are mounted as root. Babel's Docker image runs as the non-root `babel` user, so set this Railway variable if the volume is not writable:

```text
RAILWAY_RUN_UID=0
```

## First Boot

1. Deploy the template or connect the GitHub repo.
2. Add the required variables.
3. Attach the volume at `/app/data`.
4. Generate a Railway public domain for the service.
5. Open the public URL and log in with `DASHBOARD_PASSWORD`.
6. Complete the setup wizard and configure the translation provider.

Check the public health endpoint:

```bash
curl -fsS https://YOUR_RAILWAY_DOMAIN/livez
```

`/readyz` may return `503` until setup is complete and the configured provider passes its readiness check.

## Updates and Autodeploys

Railway has two different update paths:

- **Your own GitHub-connected service:** enable Railway GitHub autodeploys for the service source. Railway can build and deploy when the selected branch receives a new commit. If available for your project, enable the option to wait for GitHub Actions before deploying so failed CI does not roll out automatically.
- **A service created from the Babel template:** upstream template changes do not force every deployed bot to update. Railway may show that the template has updates, but the project owner should review and apply the update manually. This avoids surprising self-hosters with database, environment, or behavior changes.

Recommended template-user update flow:

1. Back up `BABEL_DB_PATH` or the Railway volume before major upgrades.
2. Review the [changelog](../../CHANGELOG.md).
3. Apply the Railway template update, or redeploy the latest source if the project was connected to your own fork.
4. Check `/livez`, `/readyz`, `/metrics`, and the dashboard after deployment.

The dashboard version badge checks the latest GitHub release periodically and caches that result for one hour. If a new release was published just after your running instance checked GitHub, the badge can stay gray until the cache refreshes. Use the refresh button beside the version badge to force a fresh check when you are preparing an update.

## Register Discord Commands

Register commands from a local checkout:

```bash
DISCORD_APP_ID=your_app_id DISCORD_BOT_TOKEN=your_token npm run register
```

Or run the same command in a Railway shell with `DISCORD_APP_ID` and `DISCORD_BOT_TOKEN` set. This registers the default Babel Guild command set unless `BABEL_APP=pocket` is set. Use `npm run register:guild` or `npm run register:pocket` when you want the command surface to be explicit.

## Template Publishing Checklist

Before publishing the marketplace template:

- Use the GitHub repository as the template source.
- Confirm Railway detects the root `Dockerfile`.
- Add required variables with clear descriptions and no secret defaults.
- Add a volume mounted at `/app/data`.
- Generate a public domain.
- Verify `/livez` returns `200`.
- Log in to the dashboard and confirm the setup wizard loads.
- Add a short disclosure that Railway may charge hosting usage and that template attribution may support upstream maintenance.

Railway's template kickback program currently requires marketplace publication. Their docs describe a 15% usage kickback for deployed public templates, with a possible support bonus bringing it to 25% when template questions are handled through the Template Queue.
