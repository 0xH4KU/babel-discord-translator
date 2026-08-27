import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
});
