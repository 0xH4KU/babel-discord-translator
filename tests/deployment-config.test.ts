import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deployment configuration', () => {
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
