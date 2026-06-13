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

    it('offers a combined-mode product chooser with separate management paths', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const appJs = readFileSync('src/public/js/app.js', 'utf-8');

        expect(html).toContain('id="profile-select-view"');
        expect(html).toContain('href="/guild"');
        expect(html).toContain('href="/pocket"');
        expect(appJs).toContain('shouldShowProfileSelect');
        expect(appJs).toContain("show('profile-select-view')");
    });

    it('routes dashboard API calls through the active product path', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');

        expect(utilsJs).toContain('getDashboardApiBase');
        expect(utilsJs).toContain("startsWith('/guild')");
        expect(utilsJs).toContain("startsWith('/pocket')");
        expect(utilsJs).toContain("return '/guild/api'");
        expect(utilsJs).toContain("return '/pocket/api'");
        expect(utilsJs).toContain('getDashboardApiBase() + path');
    });

    it('marks Guild-only and Pocket-only dashboard sections with capability gates', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const variablesCss = readFileSync('src/public/css/variables.css', 'utf-8');

        expect(html).toContain('data-capability="guildAccess"');
        expect(html).toContain('data-capability="guildGlossary"');
        expect(html).toContain('data-capability="pendingUserInstallOwners"');
        expect(html).toContain('id="user-access-list"');
        expect(variablesCss).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
    });

    it('keeps Access tab network calls aligned with the current app capabilities', () => {
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');

        expect(accessJs).toContain('hasDashboardCapability');
        expect(accessJs).toContain("hasDashboardCapability('guildAccess')");
        expect(accessJs).toContain("hasDashboardCapability('guildGlossary')");
        expect(accessJs).toContain("hasDashboardCapability('pendingUserInstallOwners')");
        expect(accessJs).toContain("api('/user-budgets')");
    });

    it('uses the original Babel Pocket user whitelist controls', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const settingsCss = readFileSync('src/public/css/settings.css', 'utf-8');

        expect(html).toContain('User Whitelist');
        expect(html).toContain('id="user-access-list"');
        expect(html).toContain('id="user-access-pagination"');
        expect(html).toContain('id="add-user-input"');
        expect(html).toContain('onclick="saveUserWhitelist()"');
        expect(accessJs).toContain('accessAllowedUserIdsDraft');
        expect(accessJs).toContain("api('/user-budgets')");
        expect(accessJs).toContain('setAllowedUserEnabled');
        expect(accessJs).toContain('saveUserBudget');
        expect(accessJs).toContain('badge-yellow');
        expect(settingsCss).toContain('.guild-item .user-access-state');
        expect(settingsCss).toContain('.user-access-toggle');
        expect(accessJs).toContain('body: JSON.stringify({ allowedUserIds })');
    });

    it('labels overview usage scope from the active app profile instead of hard-coded servers', () => {
        const dashboardJs = readFileSync('src/public/js/dashboard.js', 'utf-8');

        expect(dashboardJs).toContain('getDashboardUsageScopeLabel');
        expect(dashboardJs).toContain('getDashboardUsageScopeLabel(d)');
    });
});
