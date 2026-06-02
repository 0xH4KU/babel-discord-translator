import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDashboardDemo } from '../scripts/build-demo.js';

describe('build-dashboard-demo', () => {
    let tempDir = '';

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
            tempDir = '';
        }
    });

    it('should mirror public dashboard assets and inject demo mode scripts', () => {
        tempDir = mkdtempSync(join(tmpdir(), 'babel-demo-'));
        const publicDir = join(tempDir, 'src-public');
        const demoDir = join(tempDir, 'docs-demo');

        mkdirSync(join(publicDir, 'js'), { recursive: true });
        mkdirSync(join(publicDir, 'css'), { recursive: true });
        writeFileSync(
            join(publicDir, 'index.html'),
            [
                '<!doctype html>',
                '<html><head><title>Babel — Dashboard</title></head>',
                '<body>',
                '<div id="dashboard-view"></div>',
                '<script src="js/utils.js"></script>',
                '<script src="js/app.js"></script>',
                '</body></html>',
            ].join('\n'),
        );
        writeFileSync(join(publicDir, 'js', 'utils.js'), 'window.originalUtils = true;');
        writeFileSync(join(publicDir, 'js', 'app.js'), 'window.originalApp = true;');
        writeFileSync(join(publicDir, 'css', 'dashboard.css'), 'body { color: black; }');

        buildDashboardDemo({ publicDir, demoDir });

        const html = readFileSync(join(demoDir, 'index.html'), 'utf-8');
        expect(html).toContain('<title>Babel — Dashboard Demo</title>');
        expect(html).toContain('<script src="demo/demo-api.js"></script>');
        expect(html).toContain('<script src="demo/demo-readonly.js"></script>');
        expect(html).toContain('<link rel="stylesheet" href="demo/demo.css" />');

        expect(readFileSync(join(demoDir, 'js', 'utils.js'), 'utf-8')).toContain(
            'window.originalUtils',
        );
        expect(readFileSync(join(demoDir, 'demo', 'demo-api.js'), 'utf-8')).toContain(
            'window.BABEL_DEMO',
        );
        expect(readFileSync(join(demoDir, 'demo', 'fixtures', 'stats.json'), 'utf-8')).toContain(
            'Babel Demo#0110',
        );
        expect(
            readFileSync(join(demoDir, 'demo', 'fixtures', 'user-prefs.json'), 'utf-8'),
        ).toContain('Alex Chen');
    });
});
