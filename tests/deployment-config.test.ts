import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('deployment configuration', () => {
    it('copies shared runtime assets into the root dist path used after build', () => {
        const rootPackageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            scripts: Record<string, string>;
        };
        const guildPackageJson = JSON.parse(
            readFileSync('apps/babel-guild/package.json', 'utf8'),
        ) as {
            scripts: Record<string, string>;
        };
        const pocketPackageJson = JSON.parse(
            readFileSync('apps/babel-pocket/package.json', 'utf8'),
        ) as {
            scripts: Record<string, string>;
        };

        expect(rootPackageJson.scripts['build:assets']).toBe('node scripts/copy-assets.js');
        expect(rootPackageJson.scripts.build).toBe('tsc -p tsconfig.json && npm run build:assets');
        expect(guildPackageJson.scripts.build).toContain('node ../../scripts/copy-assets.js');
        expect(pocketPackageJson.scripts.build).toContain('node ../../scripts/copy-assets.js');
        expect(guildPackageJson.scripts.build).not.toContain('apps/babel-guild');
        expect(pocketPackageJson.scripts.build).not.toContain('apps/babel-pocket');
    });

    it('allows the asset copy helper to run on a clean dist directory', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'babel-assets-'));

        try {
            cpSync('scripts/copy-assets.js', join(tempRoot, 'scripts/copy-assets.js'));
            cpSync('src/locales', join(tempRoot, 'src/locales'), { recursive: true });
            cpSync('src/public', join(tempRoot, 'src/public'), { recursive: true });

            execFileSync(process.execPath, [join(tempRoot, 'scripts/copy-assets.js')]);

            expect(existsSync(join(tempRoot, 'dist/src/locales/help.json'))).toBe(true);
            expect(existsSync(join(tempRoot, 'dist/src/public/index.html'))).toBe(true);
        } finally {
            rmSync(tempRoot, { force: true, recursive: true });
        }
    });

    it('keeps root scripts profile-selectable while explicit app scripts stay available', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            scripts: Record<string, string>;
        };

        expect(packageJson.scripts.start).toBe('node dist/src/index.js');
        expect(packageJson.scripts.dev).toBe('tsx watch src/index.ts');
        expect(packageJson.scripts.register).toBe('tsx scripts/register.ts');
        expect(readFileSync('scripts/register.ts', 'utf8')).toContain('resolveAppProfiles');
        expect(readFileSync('scripts/register.ts', 'utf8')).toContain(
            'registerCommandsForProfiles',
        );
        expect(packageJson.scripts['start:guild']).toBe(
            'npm run start -w @babel-discord-translator/guild',
        );
        expect(packageJson.scripts['start:pocket']).toBe(
            'npm run start -w @babel-discord-translator/pocket',
        );
    });

    it('runs a built dashboard smoke check in package scripts and CI', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            scripts: Record<string, string>;
        };
        const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

        expect(packageJson.scripts['smoke:dashboard']).toBe(
            'node scripts/smoke-dashboard-build.js',
        );
        expect(ci).toContain('npm run smoke:dashboard');
    });

    it('keeps the README TypeScript badge aligned with package.json', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            devDependencies: Record<string, string>;
        };
        const readme = readFileSync('README.md', 'utf8');
        const typescriptVersion = packageJson.devDependencies.typescript.replace(/^[^\d]*/, '');
        const majorMinor = typescriptVersion.split('.').slice(0, 2).join('.');

        expect(readme).toContain(
            `[![TypeScript](https://img.shields.io/badge/TypeScript-${majorMinor}-blue.svg)]`,
        );
    });

    it('documents and tests the supported Node runtime range for native SQLite', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            engines: Record<string, string>;
        };
        const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
            packages: Record<string, { engines?: Record<string, string> }>;
        };
        const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
        const readme = readFileSync('README.md', 'utf8');
        const deploymentDocs = readFileSync('docs/operations/deployment.md', 'utf8');
        const dockerDocs = readFileSync('docs/operations/docker.md', 'utf8');

        expect(packageJson.engines.node).toBe('>=22.13.0');
        expect(packageLock.packages[''].engines?.node).toBe('>=22.13.0');
        expect(ci).toContain('node-version: [22, 24]');
        for (const doc of [readme, deploymentDocs, dockerDocs]) {
            expect(doc).toContain('Node.js `22.13+`');
            expect(doc).toContain('native `node:sqlite`');
            expect(doc).toContain('run `npm run smoke:dashboard` after upgrading Node');
        }
    });

    it('builds the Docker image with workspace app manifests and sources', () => {
        const dockerfile = readFileSync('Dockerfile', 'utf8');

        expect(dockerfile).toContain(
            'COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./',
        );
        expect(dockerfile).toContain(
            'COPY apps/babel-guild/package.json ./apps/babel-guild/package.json',
        );
        expect(dockerfile).toContain(
            'COPY apps/babel-pocket/package.json ./apps/babel-pocket/package.json',
        );
        expect(dockerfile).toContain('COPY apps/ ./apps/');
        expect(dockerfile).toContain(
            'CMD ["sh", "-c", "node --max-old-space-size=${BABEL_NODE_MAX_OLD_SPACE_MB:-64} --max-semi-space-size=${BABEL_NODE_MAX_SEMI_SPACE_MB:-4} dist/src/index.js"]',
        );
    });

    it('defaults Docker Compose deployments to Babel Guild', () => {
        const compose = readFileSync('docker-compose.yml', 'utf8');

        expect(compose).toContain('BABEL_APP: ${BABEL_APP:-guild}');
    });

    it('lets Docker Compose deployment settings be controlled from the environment file', () => {
        const compose = readFileSync('docker-compose.yml', 'utf8');

        expect(compose).toContain('DASHBOARD_PORT: ${DASHBOARD_PORT:-3000}');
        expect(compose).toContain('DASHBOARD_HOST: ${DASHBOARD_HOST:-0.0.0.0}');
        expect(compose).toContain('BABEL_DB_PATH: ${BABEL_DB_PATH:-/app/data/babel.sqlite}');
        expect(compose).toContain(
            'BABEL_NODE_MAX_OLD_SPACE_MB: ${BABEL_NODE_MAX_OLD_SPACE_MB:-64}',
        );
        expect(compose).toContain(
            'BABEL_NODE_MAX_SEMI_SPACE_MB: ${BABEL_NODE_MAX_SEMI_SPACE_MB:-4}',
        );
        expect(compose).toContain('"${DASHBOARD_PORT:-3000}:${DASHBOARD_PORT:-3000}"');
        expect(compose).toContain('http://localhost:$${DASHBOARD_PORT:-3000}/livez');
    });

    it('provides a conservative VPS installer for Docker Compose deployments', () => {
        const scriptPath = 'scripts/vps-install.sh';
        const script = readFileSync(scriptPath, 'utf8');
        const mode = statSync(scriptPath).mode;

        expect(mode & 0o111).not.toBe(0);
        expect(script).toContain('set -euo pipefail');
        expect(script).toContain('docker compose up -d --build');
        expect(script).toContain('cp .env.example .env');
        expect(script).toContain('Refusing to overwrite existing .env');
        expect(script).toContain('/livez');
        expect(script).toContain('npm run register:guild');
        expect(script).toContain('npm run register:pocket');
        expect(script).toContain('DASHBOARD_PASSWORD is still the example value');
        expect(script).toContain('Open .env in your editor, then rerun this script');
        expect(script).toContain('exit 1');
        expect(script).not.toContain('npm run register:guild\n');
    });

    it('leads the Docker operations guide with a quick VPS deploy path', () => {
        const dockerGuide = readFileSync('docs/operations/docker.md', 'utf8');
        const quickDeployIndex = dockerGuide.indexOf('## Quick VPS Deploy');
        const installDockerIndex = dockerGuide.indexOf('## Install Docker');

        expect(quickDeployIndex).toBeGreaterThan(0);
        expect(installDockerIndex).toBeGreaterThan(quickDeployIndex);
        expect(dockerGuide).toContain('bash scripts/vps-install.sh');
        expect(dockerGuide).toContain('docker compose exec babel npm run register:guild');
        expect(dockerGuide).toContain('docker compose exec babel npm run register:pocket');
        expect(dockerGuide).toContain('DISCORD_APP_ID');
        expect(dockerGuide).toContain('DISCORD_TOKEN');
        expect(dockerGuide).toContain('BABEL_APP=combined');
        expect(dockerGuide).toContain('BABEL_GUILD_DISCORD_TOKEN');
        expect(dockerGuide).toContain('BABEL_POCKET_DISCORD_TOKEN');
        expect(dockerGuide).toContain('The script does not register Discord commands for you');
    });

    it('documents Docker and VPS defaults in the example environment file', () => {
        const envExample = readFileSync('.env.example', 'utf8');

        expect(envExample).toContain('BABEL_APP=guild');
        expect(envExample).toContain('DISCORD_APP_ID=your_app_id_here');
        expect(envExample).toContain('Set BABEL_APP=pocket for User Install workflows');
        expect(envExample).toContain('BABEL_GUILD_DISCORD_TOKEN=');
        expect(envExample).toContain('BABEL_POCKET_DISCORD_TOKEN=');
        expect(envExample).toContain('"combined" to run both');
        expect(envExample).toContain('BABEL_DB_PATH=/app/data/babel.sqlite');
        expect(envExample).toContain('NODE_ENV=production');
        expect(envExample).toContain('BABEL_NODE_MAX_OLD_SPACE_MB=64');
        expect(envExample).toContain('BABEL_NODE_MAX_SEMI_SPACE_MB=4');
        expect(envExample).toContain('Required for VPS/Docker deployments');
    });

    it('documents dashboard runtime mode for constrained deployments', () => {
        const envExample = readFileSync('.env.example', 'utf8');
        const dockerDocs = readFileSync('docs/operations/docker.md', 'utf8');
        const deploymentDocs = readFileSync('docs/operations/deployment.md', 'utf8');

        expect(envExample).toContain('BABEL_DASHBOARD_MODE=full');
        expect(dockerDocs).toContain('BABEL_DASHBOARD_MODE=health-only');
        expect(dockerDocs).toContain(
            'Do not use `off` unless you also replace the Docker or host healthcheck',
        );
        expect(deploymentDocs).toContain('BABEL_DASHBOARD_MODE');
    });

    it('documents optional metrics token protection for public deployments', () => {
        const envExample = readFileSync('.env.example', 'utf8');
        const readme = readFileSync('README.md', 'utf8');
        const dockerDocs = readFileSync('docs/operations/docker.md', 'utf8');
        const deploymentDocs = readFileSync('docs/operations/deployment.md', 'utf8');
        const alertsRunbook = readFileSync('docs/operations/alerts-runbook.md', 'utf8');

        expect(envExample).toContain('BABEL_METRICS_TOKEN=');
        expect(readme).toContain('BABEL_METRICS_TOKEN');
        expect(readme).toContain('requires a metrics token by default');
        expect(dockerDocs).toContain('BABEL_METRICS_TOKEN');
        expect(dockerDocs).toContain('requires a metrics token by default');
        expect(deploymentDocs).toContain('BABEL_METRICS_TOKEN');
        expect(deploymentDocs).toContain('requires a metrics token by default');
        expect(alertsRunbook).toContain('Authorization: Bearer $BABEL_METRICS_TOKEN');
    });

    it('documents combined dashboard chooser routing consistently', () => {
        const readme = readFileSync('README.md', 'utf8');
        const deploymentDocs = readFileSync('docs/operations/deployment.md', 'utf8');
        const railwayDocs = readFileSync('docs/operations/railway.md', 'utf8');
        const dockerDocs = readFileSync('docs/operations/docker.md', 'utf8');

        for (const doc of [readme, deploymentDocs, railwayDocs, dockerDocs]) {
            expect(doc).toContain('BABEL_APP=combined');
            expect(doc).toContain('combined dashboard root `/` shows a product chooser');
            expect(doc).toContain('`/guild` opens the Babel Guild dashboard');
            expect(doc).toContain('`/pocket` opens the Babel Pocket dashboard');
        }
    });
});
