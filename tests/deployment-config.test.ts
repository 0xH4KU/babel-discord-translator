import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('deployment builds', () => {
    it('copies shared runtime assets into a clean dist directory', () => {
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

    it('uses compiled maintenance commands and forwards container shutdown signals', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            scripts: Record<string, string>;
        };
        const dockerfile = readFileSync('Dockerfile', 'utf8');
        const installer = readFileSync('scripts/vps-install.sh', 'utf8');

        expect(packageJson.scripts['register:built']).toBe('node dist/scripts/register.js');
        expect(packageJson.scripts['db:migrate:built']).toContain('dist/scripts/');
        expect(dockerfile).toContain('"exec node --max-old-space-size=');
        expect(installer).toContain('register:built:guild');
        expect(installer).toContain('register:built:pocket');
        expect(installer).toContain('"combined"');
    });
});
