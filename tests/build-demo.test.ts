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

    it('should mirror public dashboard assets and inject demo mode scripts for both apps', () => {
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

        const landingHtml = readFileSync(join(demoDir, 'index.html'), 'utf-8');
        expect(landingHtml).toContain('Babel Guild demo');
        expect(landingHtml).toContain('guild/index.html');
        expect(landingHtml).toContain('Babel Pocket demo');
        expect(landingHtml).toContain('pocket/index.html');

        const guildHtml = readFileSync(join(demoDir, 'guild', 'index.html'), 'utf-8');
        expect(guildHtml).toContain('<title>Babel Guild — Dashboard Demo</title>');
        expect(guildHtml).toContain('<script src="demo/demo-api.js"></script>');
        expect(guildHtml).toContain('<script src="demo/demo-readonly.js"></script>');
        expect(guildHtml).toContain('<link rel="stylesheet" href="demo/demo.css" />');

        const pocketHtml = readFileSync(join(demoDir, 'pocket', 'index.html'), 'utf-8');
        expect(pocketHtml).toContain('<title>Babel Pocket — Dashboard Demo</title>');
        expect(pocketHtml).toContain('<script src="demo/demo-api.js"></script>');

        expect(readFileSync(join(demoDir, 'guild', 'js', 'utils.js'), 'utf-8')).toContain(
            'window.originalUtils',
        );
        expect(readFileSync(join(demoDir, 'pocket', 'js', 'utils.js'), 'utf-8')).toContain(
            'window.originalUtils',
        );
        expect(readFileSync(join(demoDir, 'guild', 'demo', 'demo-api.js'), 'utf-8')).toContain(
            'window.BABEL_DEMO',
        );
        const guildStats = JSON.parse(
            readFileSync(join(demoDir, 'guild', 'demo', 'fixtures', 'stats.json'), 'utf-8'),
        ) as { bot: { name: string }; guildBudgets: unknown[] };
        expect(guildStats.bot.name).toBe('Babel Guild Demo#0110');
        expect(guildStats.guildBudgets.length).toBeGreaterThan(0);

        const pocketStats = JSON.parse(
            readFileSync(join(demoDir, 'pocket', 'demo', 'fixtures', 'stats.json'), 'utf-8'),
        ) as { bot: { name: string }; guildBudgets: unknown[] };
        expect(pocketStats.bot.name).toBe('Babel Pocket Demo#0110');
        expect(pocketStats.guildBudgets).toEqual([]);

        const guildCapabilities = JSON.parse(
            readFileSync(join(demoDir, 'guild', 'demo', 'fixtures', 'capabilities.json'), 'utf-8'),
        ) as { profile: { id: string }; capabilities: Record<string, boolean> };
        expect(guildCapabilities.profile.id).toBe('babel-guild');
        expect(guildCapabilities.capabilities).toMatchObject({
            guildAccess: true,
            userAccess: false,
            guildGlossary: true,
            pendingUserInstallOwners: false,
        });

        const pocketCapabilities = JSON.parse(
            readFileSync(join(demoDir, 'pocket', 'demo', 'fixtures', 'capabilities.json'), 'utf-8'),
        ) as { profile: { id: string }; capabilities: Record<string, boolean> };
        expect(pocketCapabilities.profile.id).toBe('babel-pocket');
        expect(pocketCapabilities.capabilities).toMatchObject({
            guildAccess: false,
            userAccess: true,
            guildGlossary: false,
            pendingUserInstallOwners: true,
        });

        const pocketConfig = JSON.parse(
            readFileSync(join(demoDir, 'pocket', 'demo', 'fixtures', 'config.json'), 'utf-8'),
        ) as { allowedGuildIds?: string[]; allowedUserIds?: string[] };
        expect(pocketConfig.allowedGuildIds).toEqual([]);
        expect(pocketConfig.allowedUserIds).toEqual(['200000000000000001', '200000000000000002']);

        expect(
            readFileSync(join(demoDir, 'guild', 'demo', 'fixtures', 'user-prefs.json'), 'utf-8'),
        ).toContain('Alex Chen');
        const pocketUserBudgets = JSON.parse(
            readFileSync(join(demoDir, 'pocket', 'demo', 'fixtures', 'user-budgets.json'), 'utf-8'),
        ) as {
            budgets: Record<string, { allowed: boolean; pending: boolean }>;
            profiles: Record<string, { displayName?: string }>;
        };
        expect(pocketUserBudgets.budgets['200000000000000006']).toMatchObject({
            allowed: false,
            pending: true,
        });
        expect(pocketUserBudgets.profiles['200000000000000006'].displayName).toBe(
            'Waiting Operator',
        );
    });
});
