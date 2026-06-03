import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('dashboard static assets', () => {
    it('loads dashboard capabilities before rendering authenticated views', () => {
        const appJs = readFileSync('src/public/js/app.js', 'utf-8');

        expect(appJs).toContain("api('/capabilities')");
        expect(appJs).toContain('applyDashboardCapabilities');
        expect(appJs).toContain('dashboardCapabilities');
        expect(appJs).toMatch(/await\s+loadDashboardCapabilities\(\)/);
    });

    it('marks Guild-only and Pocket-only dashboard sections with capability gates', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');

        expect(html).toContain('data-capability="guildAccess"');
        expect(html).toContain('data-capability="guildGlossary"');
        expect(html).toContain('data-capability="pendingUserInstallOwners"');
        expect(html).toContain('id="pending-users-container"');
    });

    it('keeps Access tab network calls aligned with the current app capabilities', () => {
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');

        expect(accessJs).toContain('hasDashboardCapability');
        expect(accessJs).toContain("hasDashboardCapability('guildAccess')");
        expect(accessJs).toContain("hasDashboardCapability('guildGlossary')");
        expect(accessJs).toContain("hasDashboardCapability('pendingUserInstallOwners')");
        expect(accessJs).toContain("api('/access/pending-users')");
    });

    it('labels overview usage scope from the active app profile instead of hard-coded servers', () => {
        const dashboardJs = readFileSync('src/public/js/dashboard.js', 'utf-8');

        expect(dashboardJs).toContain('getDashboardUsageScopeLabel');
        expect(dashboardJs).toContain('getDashboardUsageScopeLabel(d)');
    });
});
