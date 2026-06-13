# Docker Deployment and Operations

This guide is for operators who want to run Babel Guild or Babel Pocket as a self-hosted Discord translation app. You provide the Discord bot token, dashboard password, hosting, and AI provider key. Babel does not require a hosted bot subscription.

## Choose The Product Profile

Select the app profile before you build the image or register Discord commands.

| Product      | Install Model        | Docker Environment    | Command Registration      |
| ------------ | -------------------- | --------------------- | ------------------------- |
| Babel Guild  | Server/Guild Install | `BABEL_APP=guild`     | `npm run register:guild`  |
| Babel Pocket | User Install         | `BABEL_APP=pocket`    | `npm run register:pocket` |
| Both         | Both                 | `BABEL_APP=combined`  | Run both explicit commands |

The same Docker image can run either product, or both products in one process. Compose defaults to Babel Guild for backward compatibility.

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

Set `BABEL_APP=pocket` in `.env` or Compose to run Babel Pocket from the same image. Set `BABEL_APP=combined` when you want one container with both Discord clients, one dashboard, and one SQLite database.

## Quick VPS Deploy

Use this path when you have a fresh Ubuntu VPS and want the shortest Docker Compose setup.

```bash
git clone https://github.com/0xH4KU/babel-discord-translator.git
cd babel-discord-translator
bash scripts/vps-install.sh
```

The installer checks Docker and Docker Compose, creates `.env` from `.env.example` when needed, starts the Compose service, and checks `http://localhost:3000/livez`.

Before exposing the dashboard publicly, edit `.env` and set at least:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
BABEL_APP=guild
# For BABEL_APP=combined, set both profile-specific tokens:
# BABEL_GUILD_DISCORD_TOKEN=your_guild_bot_token_here
# BABEL_GUILD_DISCORD_APP_ID=your_guild_app_id_here
# BABEL_POCKET_DISCORD_TOKEN=your_pocket_bot_token_here
# BABEL_POCKET_DISCORD_APP_ID=your_pocket_app_id_here
DASHBOARD_PASSWORD=replace_with_a_strong_password
DASHBOARD_PORT=3000
DASHBOARD_HOST=0.0.0.0
BABEL_DB_PATH=/app/data/babel.sqlite
NODE_ENV=production
BABEL_NODE_MAX_OLD_SPACE_MB=64
BABEL_NODE_MAX_SEMI_SPACE_MB=4
```

Use `BABEL_APP=guild` for Babel Guild, `BABEL_APP=pocket` for Babel Pocket, or `BABEL_APP=combined` for both.
The `BABEL_NODE_MAX_*` values control the Node.js V8 heap caps inside Docker; keep the defaults for small servers, or raise them if the dashboard or bot needs more memory.

After the container is healthy, register the matching Discord commands. The script does not register Discord commands for you because Guild and Pocket expose different command surfaces.

`DISCORD_APP_ID` must be set in `.env`. Command registration can reuse the same `DISCORD_TOKEN` used by the running bot.

For Babel Guild:

```bash
docker compose exec babel npm run register:guild
```

For Babel Pocket:

```bash
docker compose exec babel npm run register:pocket
```

Check the deployment:

```bash
docker compose ps
docker compose logs -f babel
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
```

Open `http://YOUR_SERVER_IP:3000`, log in with `DASHBOARD_PASSWORD`, and complete the setup wizard.

## Install Docker on Ubuntu 24.04 ARM

Update the host and install curl:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install curl -y
```

Install Docker:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

Allow your user to run Docker without sudo:

```bash
sudo usermod -aG docker $USER
```

Log out and back in so the group change takes effect.

## First Deployment

Prepare the environment file:

```bash
cp .env.example .env
nano .env
```

Set at least:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_app_id_here
BABEL_APP=guild
# For BABEL_APP=combined, set BABEL_GUILD_DISCORD_TOKEN and BABEL_POCKET_DISCORD_TOKEN.
DASHBOARD_PASSWORD=replace_with_a_strong_password
DASHBOARD_PORT=3000
DASHBOARD_HOST=0.0.0.0
BABEL_DB_PATH=/app/data/babel.sqlite
NODE_ENV=production
BABEL_NODE_MAX_OLD_SPACE_MB=64
BABEL_NODE_MAX_SEMI_SPACE_MB=4
```

Start with Docker Compose:

```bash
docker compose up -d --build
```

Or build and run manually:

```bash
docker build -t babel-bot .
docker run -d \
  --name babel-translator \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v babel_data:/app/data \
  babel-bot
```

Verify the container:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
```

Open `http://localhost:3000`, log in with `DASHBOARD_PASSWORD`, and complete the setup wizard.

## Updating Babel

Back up the SQLite database first:

```bash
mkdir -p backups
docker exec babel-translator sh -lc "sqlite3 /app/data/babel.sqlite \".backup '/app/data/babel-backup.sqlite'\"" || true
docker cp babel-translator:/app/data/babel-backup.sqlite ./backups/babel-$(date +%Y%m%d-%H%M%S).sqlite || true
```

Then update:

```bash
git pull
docker compose up -d --build
docker image prune -f
```

For manual Docker runs:

```bash
git pull
docker build -t babel-bot .
docker stop babel-translator
docker rm babel-translator
docker run -d \
  --name babel-translator \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v babel_data:/app/data \
  babel-bot
docker image prune -f
```

Verify after updating:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
docker logs --tail 100 babel-translator
```

## Common Operations

View logs:

```bash
docker logs -f babel-translator
```

Restart:

```bash
docker restart babel-translator
```

Open a shell:

```bash
docker exec -it babel-translator sh
```

Stop and remove the container:

```bash
docker stop babel-translator
docker rm babel-translator
```

Remove the image:

```bash
docker rmi babel-bot
```

Remove the data volume only when you intentionally want to delete all persisted config and usage data:

```bash
docker volume rm babel_data
```

## Migrating Servers

Back up `.env` securely. It contains your Discord token and dashboard settings.

Create a SQLite backup from the old host:

```bash
mkdir -p backups
docker exec babel-translator sh -lc "sqlite3 /app/data/babel.sqlite \".backup '/app/data/babel-backup.sqlite'\""
docker cp babel-translator:/app/data/babel-backup.sqlite ./backups/babel.sqlite
```

Copy these files to the new host:

- `.env`
- `backups/babel.sqlite`

On the new host, restore into a bind mount:

```bash
mkdir -p babel_data_backup
cp backups/babel.sqlite babel_data_backup/babel.sqlite
docker build -t babel-bot .
docker run -d \
  --name babel-translator \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/babel_data_backup:/app/data \
  babel-bot
```

Then verify:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/readyz
```
