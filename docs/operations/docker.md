# Docker Deployment and Operations

This guide is for server owners who want to run Babel as their own self-hosted Discord translation bot. You provide the Discord bot token, dashboard password, hosting, and AI provider key. Babel does not require a hosted bot subscription.

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

Docker defaults to Babel Guild with `BABEL_APP=guild`. Set `BABEL_APP=pocket` in `.env` or Compose to run Babel Pocket from the same image.

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
BABEL_APP=guild
DASHBOARD_PASSWORD=replace_with_a_strong_password
DASHBOARD_PORT=3000
DASHBOARD_HOST=0.0.0.0
BABEL_DB_PATH=/app/data/babel.sqlite
NODE_ENV=production
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
