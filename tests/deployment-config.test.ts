import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
        expect(rootPackageJson.scripts.build).toContain('npm run build:assets');
        expect(guildPackageJson.scripts.build).toContain(
            'node ../../scripts/copy-assets.js apps/babel-guild',
        );
        expect(pocketPackageJson.scripts.build).toContain(
            'node ../../scripts/copy-assets.js apps/babel-pocket',
        );
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
        expect(packageJson.scripts['start:guild']).toBe(
            'npm run start -w @babel-discord-translator/guild',
        );
        expect(packageJson.scripts['start:pocket']).toBe(
            'npm run start -w @babel-discord-translator/pocket',
        );
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
        expect(dockerfile).toContain('CMD ["npm", "start"]');
    });

    it('defaults Docker Compose deployments to Babel Guild', () => {
        const compose = readFileSync('docker-compose.yml', 'utf8');

        expect(compose).toContain('BABEL_APP: guild');
    });
});
