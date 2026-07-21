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

    it('builds content-hashed Worker dashboard assets', () => {
        const tempRoot = mkdtempSync(join(tmpdir(), 'babel-worker-assets-'));

        try {
            cpSync(
                'scripts/build-worker-assets.js',
                join(tempRoot, 'scripts/build-worker-assets.js'),
            );
            cpSync('src/public', join(tempRoot, 'src/public'), { recursive: true });

            execFileSync(process.execPath, [join(tempRoot, 'scripts/build-worker-assets.js')]);

            const outputDir = join(tempRoot, 'dist/worker-public');
            const html = readFileSync(join(outputDir, 'index.html'), 'utf8');
            const headers = readFileSync(join(outputDir, '_headers'), 'utf8');
            const refs = [...html.matchAll(/(?:src|href)="(\/(?:css|js)\/[^"?]+)"/g)].map(
                (match) => match[1],
            );

            expect(refs).not.toHaveLength(0);
            expect(refs.every((ref) => /\.[a-f0-9]{12}\.(?:css|js)$/.test(ref))).toBe(true);
            expect(refs.every((ref) => existsSync(join(outputDir, ref.slice(1))))).toBe(true);
            expect(headers).toContain("Content-Security-Policy: default-src 'self'");
            expect(headers).toContain('X-Frame-Options: DENY');
            expect(headers).toContain('Cache-Control: public, max-age=31536000, immutable');
        } finally {
            rmSync(tempRoot, { force: true, recursive: true });
        }
    });
});
