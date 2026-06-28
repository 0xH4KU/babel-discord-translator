import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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

    it('filters user language preferences by selected guild', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const nodes = {
            'prefs-count': { textContent: '' },
            'prefs-guild-filter': { disabled: false, innerHTML: '', value: '' },
            'prefs-pagination': { innerHTML: '' },
            'prefs-batch-delete': { disabled: false, textContent: '' },
            'user-prefs-container': { innerHTML: '' },
        };
        const context = {
            document: {
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
            },
            hasDashboardCapability(name: string) {
                return name === 'guildAccess';
            },
            genAvatar(value: string) {
                return `avatar:${value}`;
            },
            renderPagination() {},
        };

        expect(html).toContain('id="prefs-guild-filter"');

        expect(accessJs).toContain('entry.guildId');
        expect(accessJs).toContain('entry.userId');
        expect(accessJs).toContain('setPrefsGuildFilter');
        expect(accessJs).toContain('renderPrefsGuildFilter');
        expect(accessJs).toContain('body: JSON.stringify({ entries })');
        expect(accessJs).toContain('const query = userPrefsUseGuildFilter()');
        expect(accessJs).toContain("'?guildId=' + encodeURIComponent(guildId)");
        expect(accessJs).toContain("api('/user-prefs/' + encodeURIComponent(userId) + query");

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                accessJs,
                `allPrefsData = [
                    {
                        guildId: 'guild-1',
                        guildName: 'Server 1',
                        guildIcon: '',
                        userId: 'user-1',
                        language: 'zh-TW'
                    },
                    {
                        guildId: 'guild-2',
                        guildName: 'Server 2',
                        guildIcon: '',
                        userId: 'user-2',
                        language: 'ja'
                    }
                ];`,
                'renderUserPrefs();',
                "setPrefsGuildFilter('guild-2');",
            ].join('\n'),
            context,
        );

        expect(nodes['prefs-guild-filter'].innerHTML).toContain('Server 1');
        expect(nodes['prefs-guild-filter'].innerHTML).toContain('Server 2');
        expect(nodes['user-prefs-container'].innerHTML).toContain('user-2');
        expect(nodes['user-prefs-container'].innerHTML).not.toContain('user-1');
        expect(nodes['prefs-count'].textContent).toBe('1 shown in Server 2 / 2 total');
    });

    it('renders Pocket user preferences without server filtering controls', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const nodes = {
            'prefs-count': { textContent: '' },
            'prefs-guild-filter': { disabled: false, hidden: false, innerHTML: '', value: '' },
            'prefs-pagination': { innerHTML: '' },
            'prefs-batch-delete': { disabled: false, textContent: '' },
            'user-prefs-container': { innerHTML: '' },
        };
        const context = {
            document: {
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
            },
            hasDashboardCapability() {
                return false;
            },
            genAvatar(value: string) {
                return `avatar:${value}`;
            },
            renderPagination() {},
        };

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                accessJs,
                `allPrefsData = [{
                    guildId: '',
                    userId: 'user-pocket',
                    language: 'ko'
                }];`,
                'renderUserPrefs();',
            ].join('\n'),
            context,
        );

        expect(nodes['prefs-guild-filter'].hidden).toBe(true);
        expect(nodes['user-prefs-container'].innerHTML).toContain('user-pocket');
        expect(nodes['user-prefs-container'].innerHTML).not.toContain('user-prefs-guild-id');
        expect(nodes['prefs-count'].textContent).toBe('1 shown / 1 total');
    });

    it('keeps user preference controls usable on narrow mobile screens', () => {
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const responsiveCss = readFileSync('src/public/css/responsive.css', 'utf-8');

        expect(accessJs).toContain('data-label="User"');
        expect(accessJs).toContain('data-label="Language"');
        expect(accessJs).toContain('data-label="Action"');
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*\.prefs-tools\s*{[\s\S]*flex-direction:\s*column/s,
        );
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*#prefs-guild-filter\s*{[\s\S]*flex:\s*0\s+0\s+auto/s,
        );
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*#prefs-guild-filter\s*{[\s\S]*width:\s*100%/s,
        );
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*\.user-prefs-table\s+thead\s*{[\s\S]*display:\s*none/s,
        );
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*\.user-prefs-table\s+td\[data-label\]::before\s*{[\s\S]*content:\s*attr\(data-label\)/s,
        );
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*\.user-prefs-table\s+td\[data-label="Action"\]\s+\.btn-danger\s*{[\s\S]*width:\s*100%/s,
        );
        expect(responsiveCss).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*\.user-prefs-table\s+td:last-child\s*{[\s\S]*width:\s*100%[\s\S]*white-space:\s*normal/s,
        );
    });

    it('exposes Server Glossary import controls and client import flow', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const settingsCss = readFileSync('src/public/css/settings.css', 'utf-8');

        expect(html).toContain('id="glossary-import-file"');
        expect(html).toContain('id="glossary-target-language"');
        expect(html).toContain('Language');
        expect(html).toContain('class="glossary-file-input"');
        expect(html).toContain('class="glossary-file-button"');
        expect(html).toContain('id="glossary-import-file-name"');
        expect(html).toContain('id="glossary-import-text"');
        expect(html).toContain('class="glossary-import-textarea"');
        expect(html).toContain('name="glossary-import-mode"');
        expect(html).toContain('class="glossary-import-option"');
        expect(html).toContain('data-action="importGlossaryEntries"');
        expect(accessJs).toContain('function readGlossaryImportFile');
        expect(accessJs).toContain('glossary-target-language');
        expect(accessJs).toContain('entry.targetLanguage');
        expect(accessJs).toContain('targetLanguage');
        expect(accessJs).toContain('glossary-import-file-name');
        expect(accessJs).toContain('function importGlossaryEntries');
        expect(accessJs).toContain("api('/guild-glossary/' + glossaryGuildId + '/import'");
        expect(accessJs).toContain('renderGlossaryImportResult');
        expect(accessJs).toContain('escapeHtml(error.error)');
        expect(settingsCss).toContain('.glossary-import');
        expect(settingsCss).toContain('.glossary-import-grid');
        expect(settingsCss).toContain('.glossary-file-picker .glossary-file-input');
        expect(settingsCss).toContain('clip-path: inset(50%)');
        expect(settingsCss).toContain('.glossary-file-button');
        expect(settingsCss).toContain('.glossary-file-picker .glossary-file-button');
        expect(settingsCss).toContain('.glossary-import-options .glossary-import-option');
        expect(settingsCss).toContain(
            ".glossary-import-options .glossary-import-option input[type='radio']",
        );
        expect(settingsCss).toContain(
            '.glossary-import-options .glossary-import-option:focus-within',
        );
        expect(settingsCss).toContain('.glossary-import-textarea');
        expect(settingsCss).toContain('.glossary-import-result');
    });

    it('uses the original Babel Pocket user whitelist controls', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const settingsCss = readFileSync('src/public/css/settings.css', 'utf-8');

        expect(html).toContain('User Whitelist');
        expect(html).toContain('id="user-access-list"');
        expect(html).toContain('id="user-access-pagination"');
        expect(html).toContain('id="add-user-input"');
        expect(html).toContain('data-action="saveUserWhitelist"');
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

    it('renders the overview budget card for Babel Pocket daily budget usage', async () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const appJs = readFileSync('src/public/js/app.js', 'utf-8');
        const dashboardJs = readFileSync('src/public/js/dashboard.js', 'utf-8');
        const nodes = {
            'budget-card': {
                hidden: false,
                style: { display: '' },
                setAttribute() {},
            },
            'budget-card-label': { textContent: '' },
            'budget-amount': { textContent: '' },
            'guild-budget-overview': {
                children: [] as unknown[],
                replaceChildren(...children: unknown[]) {
                    this.children = children;
                },
                append(...children: unknown[]) {
                    this.children.push(...children);
                },
            },
            'bot-name': { textContent: '' },
            'bot-tag': { textContent: '' },
            'bot-avatar': { src: '' },
            'stat-cost': { textContent: '' },
            'stat-cost-breakdown': { textContent: '' },
            'stat-total': { textContent: '' },
            'stat-total-detail': { textContent: '' },
            'stat-hitrate': { textContent: '' },
            'stat-saved': { textContent: '' },
            'stat-uptime': { textContent: '' },
            'stat-memory': { textContent: '' },
            'ops-provider-mode': { textContent: '' },
            'ops-provider-vertex': null,
            'ops-provider-openai': null,
            'ops-runtime': null,
            'ops-budget-risk': null,
            'ops-guidance': null,
        };
        const createdElements: Array<{
            className: string;
            textContent: string;
            children: unknown[];
        }> = [];
        const context = {
            document: {
                body: { dataset: {} },
                title: '',
                addEventListener() {},
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
                querySelectorAll(selector: string) {
                    if (selector === '[data-capability]') return [];
                    return [];
                },
                createElement() {
                    const element = {
                        className: '',
                        textContent: '',
                        style: {},
                        classList: { add() {}, remove() {} },
                        children: [] as unknown[],
                        append(...children: unknown[]) {
                            this.children.push(...children);
                        },
                    };
                    createdElements.push(element);
                    return element;
                },
            },
            window: {
                location: { pathname: '/pocket' },
            },
            setInterval() {},
            fetch: async () => ({
                ok: true,
                json: async () => ({
                    bot: {
                        name: 'Babel Pocket#0001',
                        avatar: '',
                        uptime: 60,
                        memory: { rssMB: '42.0' },
                    },
                    operations: {},
                    usage: {
                        totalCost: 0.21,
                        dailyBudget: 1.25,
                        inputTokens: 1000,
                        outputTokens: 2000,
                        requests: 89,
                    },
                    guildBudgets: [],
                    translations: {
                        total: 3,
                        apiCalls: 2,
                        cacheHitRate: 0,
                    },
                    cache: { size: 0, maxSize: 2000 },
                }),
            }),
        };

        expect(html).toContain('id="budget-card"');
        expect(html).not.toContain('id="budget-card" data-capability="guildAccess"');

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                appJs.replace(/init\(\);\s*$/, ''),
                dashboardJs,
                `applyDashboardCapabilities({
                    profile: { id: 'babel-pocket', productName: 'Babel Pocket' },
                    profiles: [{ id: 'babel-pocket', productName: 'Babel Pocket' }],
                    capabilities: {
                        guildAccess: false,
                        userAccess: true,
                        guildGlossary: false,
                        pendingUserInstallOwners: true
                    }
                });`,
                'loadStats();',
            ].join('\n'),
            context,
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(nodes['budget-card'].hidden).toBe(false);
        expect(nodes['budget-card'].style.display).toBe('');
        expect(nodes['budget-card-label'].textContent).toBe('Daily Budget');
        expect(nodes['budget-amount'].textContent).toBe('Total: $0.21');
        expect(nodes['guild-budget-overview'].children).toHaveLength(1);
        expect(createdElements.some((element) => element.textContent === '$0.21 / $1.25')).toBe(
            true,
        );
    });

    it('escapes glossary table fields rendered from stored import data', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const glossaryContainer = { innerHTML: '' };
        const context = {
            document: {
                getElementById(id: string) {
                    return id === 'glossary-container' ? glossaryContainer : null;
                },
            },
            hasDashboardCapability(name: string) {
                return name === 'guildGlossary';
            },
        };

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                accessJs,
                "glossaryGuildId = 'guild-1';",
                `glossaryEntries = [{
                    id: 1,
                    sourceText: '<img src=x onerror=alert(1)>',
                    targetLanguage: 'ja<script>alert(1)</script>',
                    targetText: '<b>owned</b>',
                    notes: '<svg onload=alert(1)>'
                }];`,
                'renderGlossaryEntries();',
            ].join('\n'),
            context,
        );

        expect(glossaryContainer.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(glossaryContainer.innerHTML).toContain('ja&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(glossaryContainer.innerHTML).toContain('&lt;b&gt;owned&lt;/b&gt;');
        expect(glossaryContainer.innerHTML).toContain('&lt;svg onload=alert(1)&gt;');
        expect(glossaryContainer.innerHTML).not.toContain('<img src=x');
        expect(glossaryContainer.innerHTML).not.toContain('<b>owned</b>');
        expect(glossaryContainer.innerHTML).not.toContain('<svg onload');
    });

    it('escapes guild access rows rendered from Discord data', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const nodes = {
            'guild-list': { innerHTML: '' },
            'guild-pagination': { innerHTML: '' },
        };
        const context = {
            document: {
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
                querySelectorAll() {
                    return [];
                },
            },
            hasDashboardCapability(name: string) {
                return name === 'guildAccess';
            },
            renderPagination() {},
            formatUsd(value: number) {
                return `$${value}`;
            },
            window: {
                location: { pathname: '/' },
            },
        };

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                accessJs,
                `currentConfig = {
                    allowedGuildIds: ["guild');alert(1)//"],
                    dailyBudgetUsd: 0
                };`,
                `accessAllowedGuildIdsDraft = ["guild');alert(1)//"];`,
                `allGuilds = [{
                    id: "guild');alert(1)//",
                    name: '<img src=x onerror=alert(1)>',
                    icon: 'https://cdn.example/avatar.png" onerror="alert(2)',
                    memberCount: 12
                }];`,
                'guildBudgetData = {};',
                'renderGuilds();',
            ].join('\n'),
            context,
        );

        expect(nodes['guild-list'].innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(nodes['guild-list'].innerHTML).not.toContain('<img src=x');
        expect(nodes['guild-list'].innerHTML).not.toContain('onerror="alert(2)');
        expect(nodes['guild-list'].innerHTML).not.toContain("toggleGuildAllowed('guild');alert");
    });

    it('escapes session rows before rendering dashboard session metadata', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const settingsJs = readFileSync('src/public/js/settings.js', 'utf-8');
        const nodes = {
            'session-list': { innerHTML: '' },
        };
        const context = {
            document: {
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
                querySelectorAll() {
                    return [];
                },
            },
            window: {
                location: { pathname: '/' },
            },
        };

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                settingsJs,
                `renderSessions([{
                    id: "abc');alert(1)//<img src=x onerror=alert(2)>",
                    current: false,
                    expiresAt: '2026-06-23T00:00:00.000Z'
                }]);`,
            ].join('\n'),
            context,
        );

        expect(nodes['session-list'].innerHTML).toContain('&lt;img src=x onerror=alert(2)&gt;');
        expect(nodes['session-list'].innerHTML).not.toContain('<img src=x');
        expect(nodes['session-list'].innerHTML).not.toContain("revokeSession('abc');alert");
    });

    it('escapes usage history rows and chart tooltips before rendering', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const historyJs = readFileSync('src/public/js/history.js', 'utf-8');
        const nodes = {
            'history-table-container': { innerHTML: '' },
            'history-chart': { innerHTML: '' },
            'history-summary': { textContent: '' },
            'history-pagination': { innerHTML: '' },
        };
        const context = {
            document: {
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
                querySelectorAll() {
                    return [];
                },
            },
            window: {
                location: { pathname: '/' },
            },
        };

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                historyJs,
                `allHistoryData = [{
                    date: '2026-06-23" onmouseover="alert(1)<script>alert(2)</script>',
                    requests: 3,
                    inputTokens: 12,
                    outputTokens: 5,
                    cost: 0.01
                }];`,
                'renderHistory();',
            ].join('\n'),
            context,
        );

        expect(nodes['history-table-container'].innerHTML).toContain(
            '&lt;script&gt;alert(2)&lt;/script&gt;',
        );
        expect(nodes['history-chart'].innerHTML).not.toContain('onmouseover="alert(1)');
        expect(nodes['history-table-container'].innerHTML).not.toContain('<script>');
    });
});
