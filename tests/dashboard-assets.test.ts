import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('dashboard static assets', () => {
    it('filters user language preferences by selected guild', () => {
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

    it('renders the overview budget card for Babel Pocket daily budget usage', async () => {
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
                    userBudgets: [
                        {
                            id: 'user-custom',
                            displayName: 'Custom User',
                            budget: 0.2,
                            isCustom: true,
                            allowed: true,
                            pending: false,
                            totalCost: 0.1,
                            requests: 12,
                            exceeded: false,
                        },
                        {
                            id: 'user-default',
                            displayName: 'Default User',
                            budget: 0.5,
                            isCustom: false,
                            allowed: true,
                            pending: false,
                            totalCost: 0,
                            requests: 0,
                            exceeded: false,
                        },
                    ],
                    translations: {
                        total: 3,
                        apiCalls: 2,
                        cacheHitRate: 0,
                    },
                    cache: { size: 0, maxSize: 2000 },
                    ocrCache: { size: 3, maxSize: 250, hitRate: '60.0%' },
                }),
            }),
        };

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
        expect(nodes['stat-saved'].textContent).toBe('0 / 2000 translations · 3 / 250 OCR (60.0%)');
        expect(nodes['guild-budget-overview'].children).toHaveLength(3);
        expect(
            createdElements.some((element) => element.textContent === 'Global Safety Budget'),
        ).toBe(true);
        expect(createdElements.some((element) => element.textContent === 'Custom User')).toBe(true);
        expect(createdElements.some((element) => element.textContent === 'Default User')).toBe(
            true,
        );
        expect(createdElements.some((element) => element.textContent === '$0.21 / $1.25')).toBe(
            true,
        );
        expect(createdElements.some((element) => element.textContent === '$0.10 / $0.20')).toBe(
            true,
        );
        expect(createdElements.some((element) => element.textContent === '$0 / $0.50')).toBe(true);
    });

    it('refreshes stats every 15 seconds only while the dashboard is visible', () => {
        const dashboardJs = readFileSync('src/public/js/dashboard.js', 'utf-8');
        let scheduled = () => undefined;
        let refreshMs = 0;
        const context = {
            document: { hidden: true },
            statsCalls: 0,
            healthCalls: 0,
            setInterval(callback: () => void, delay: number) {
                scheduled = callback;
                refreshMs = delay;
                return 1;
            },
            clearInterval() {},
        };

        vm.createContext(context);
        vm.runInContext(dashboardJs, context);
        vm.runInContext(
            `loadStats = async () => { statsCalls += 1; };
             checkApiHealth = async () => { healthCalls += 1; };
             loadDashboard();`,
            context,
        );

        expect(context.statsCalls).toBe(1);
        expect(context.healthCalls).toBe(1);
        expect(refreshMs).toBe(15000);
        scheduled();
        expect(context.statsCalls).toBe(1);
        context.document.hidden = false;
        scheduled();
        expect(context.statsCalls).toBe(2);
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
        const visionLimitsJs = readFileSync('src/public/js/vision-limits.js', 'utf-8');
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
                visionLimitsJs,
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

    it('keeps Lens access scoped to translation-enabled guilds', () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const visionLimitsJs = readFileSync('src/public/js/vision-limits.js', 'utf-8');
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
            showToast() {},
            window: { location: { pathname: '/' } },
        };

        vm.createContext(context);
        vm.runInContext(
            [
                utilsJs,
                accessJs,
                visionLimitsJs,
                `currentConfig = {
                    allowedGuildIds: ['guild-1'],
                    lensEnabledGuildIds: ['guild-1'],
                    dailyBudgetUsd: 0
                };`,
                `accessAllowedGuildIdsDraft = ['guild-1'];`,
                `accessLensEnabledGuildIdsDraft = ['guild-1'];`,
                `allGuilds = [
                    { id: 'guild-1', name: 'Server 1', icon: 'one.png', memberCount: 10 },
                    { id: 'guild-2', name: 'Server 2', icon: 'two.png', memberCount: 20 }
                ];`,
                'guildBudgetData = {};',
                "toggleGuildAllowed('guild-1', false);",
                "toggleGuildLens('guild-2', true);",
            ].join('\n'),
            context,
        );

        const state = JSON.parse(
            vm.runInContext(
                'JSON.stringify({ allowed: accessAllowedGuildIdsDraft, lens: accessLensEnabledGuildIdsDraft })',
                context,
            ),
        );
        expect(state).toEqual({ allowed: ['guild-2'], lens: ['guild-2'] });
        expect(nodes['guild-list'].innerHTML).toContain('Translation');
        expect(nodes['guild-list'].innerHTML).toContain('Babel Lens');
        expect(nodes['guild-list'].innerHTML).toContain('Translation + Lens');
        expect(nodes['guild-list'].innerHTML).toContain('access-master-item');
        expect(nodes['guild-list'].innerHTML).toContain('access-selected-detail');
        expect(nodes['guild-list'].innerHTML).not.toMatch(
            /data-lens-guild-id="guild-1"[^>]*disabled/,
        );
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
        expect(nodes['history-table-container'].innerHTML).toContain(
            '<details class="mobile-activity-row">',
        );
    });

    it('submits all runtime settings with numeric values', async () => {
        const settingsJs = readFileSync('src/public/js/settings.js', 'utf-8');
        const fields: Record<string, { value: string; checked?: boolean }> = {
            'cfg-apikey': { value: '' },
            'cfg-vision-apikey': { value: 'vision-key' },
            'cfg-project': { value: 'project-1' },
            'cfg-location': { value: 'global' },
            'cfg-model': { value: 'gemini-model' },
            'cfg-vertex-images': { value: '', checked: true },
            'cfg-media-resolution': { value: 'high' },
            'cfg-cooldown': { value: '7' },
            'cfg-cache': { value: '3000' },
            'cfg-max-input': { value: '4096' },
            'cfg-max-output': { value: '2048' },
            'cfg-max-concurrent': { value: '6' },
            'cfg-max-global-queue': { value: '40' },
            'cfg-max-guild-queue': { value: '8' },
            'cfg-max-user-outstanding': { value: '2' },
            'cfg-max-queue-wait': { value: '45000' },
            'cfg-input-price': { value: '0.25' },
            'cfg-output-price': { value: '1.5' },
            'cfg-budget': { value: '3.75' },
            'cfg-vision-limit': { value: '950' },
            'cfg-prompt': { value: 'Translate precisely.' },
            'cfg-provider': { value: 'openai' },
            'cfg-openai-apikey': { value: '' },
            'cfg-openai-baseurl': { value: 'https://api.example.test/v1' },
            'cfg-openai-model': { value: 'model-1' },
            'cfg-openai-images': { value: '', checked: false },
        };
        const requests: Array<{ path: string; options: { method?: string; body?: string } }> = [];
        const context = {
            document: {
                getElementById(id: string) {
                    return fields[id];
                },
            },
            async api(path: string, options: { method?: string; body?: string } = {}) {
                requests.push({ path, options });
                return { ok: true };
            },
            showToast() {},
            hasDashboardCapability() {
                return false;
            },
        };

        vm.createContext(context);
        vm.runInContext(settingsJs, context);
        vm.runInContext('loadSettings = () => {};', context);
        await vm.runInContext('saveSettings();', context);

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ path: '/config', options: { method: 'POST' } });
        const payload = JSON.parse(requests[0].options.body!);
        expect(payload).toMatchObject({
            translationMaxConcurrent: 6,
            translationMaxGlobalQueue: 40,
            translationMaxGuildQueue: 8,
            translationMaxUserOutstanding: 2,
            translationMaxQueueWaitMs: 45000,
            maxInputLength: 4096,
            maxOutputTokens: 2048,
            visionMonthlyImageLimit: 950,
            visionApiKey: 'vision-key',
            vertexAiSupportsImages: true,
            openaiSupportsImages: false,
            geminiMediaResolution: 'high',
        });
        expect(
            Object.values(payload)
                .filter((value) => typeof value === 'number')
                .every((value) => Number.isFinite(value)),
        ).toBe(true);
    });

    it('previews a custom Vision limit while editing', () => {
        const settingsJs = readFileSync('src/public/js/settings.js', 'utf-8');
        const usage = { textContent: '' };
        const context = {
            document: {
                getElementById(id: string) {
                    return id === 'cfg-vision-usage' ? usage : null;
                },
            },
        };

        vm.createContext(context);
        vm.runInContext(settingsJs, context);
        vm.runInContext(
            `currentConfig = { visionMonthlyImageLimit: 900, visionUsage: { images: 0, limit: 900, month: '2026-08' } }; previewVisionLimit('950');`,
            context,
        );

        expect(usage.textContent).toBe('0 / 950 images used · 2026-08');
    });

    it('shows Vision settings only for enabled text-only providers and tracks drafts', () => {
        const settingsJs = readFileSync('src/public/js/settings.js', 'utf-8');
        const fallback = { hidden: true };
        const status = {
            textContent: '',
            classList: { toggle() {} },
        };
        const button = { disabled: true };
        const fields = {
            'cfg-provider': { value: 'vertex' },
            'cfg-vertex-images': { checked: false },
            'cfg-openai-images': { checked: false },
            'cfg-model': { value: 'gemini-new' },
            'lens-route-vertex': { textContent: '', className: '' },
            'lens-route-openai': { textContent: '', className: '' },
            'settings-save-status': status,
            'settings-save-button': button,
        };
        const context = {
            document: {
                getElementById(id: string) {
                    return fields[id as keyof typeof fields] || null;
                },
                querySelectorAll(selector: string) {
                    return selector === '.vision-fallback-only' ? [fallback] : [];
                },
            },
        };

        vm.createContext(context);
        vm.runInContext(settingsJs, context);
        vm.runInContext(
            `currentConfig = { translationProvider: 'vertex', geminiModel: 'gemini-old' };
             settingsLoaded = true;
             refreshLensRoutes();`,
            context,
        );
        expect(fallback.hidden).toBe(false);
        expect(fields['lens-route-vertex'].textContent).toBe('Vision fallback');

        fields['cfg-vertex-images'].checked = true;
        vm.runInContext('onProviderCapabilityChange();', context);
        expect(fallback.hidden).toBe(true);
        expect(fields['lens-route-vertex'].textContent).toBe('Direct multimodal');
        expect(button.disabled).toBe(false);
        expect(status.textContent).toBe('Unsaved changes');

        vm.runInContext('onVertexIdentityChanged();', context);
        expect(fields['cfg-vertex-images'].checked).toBe(false);
    });

    it('partitions Access and Settings into profile-aware compact views', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const logsJs = readFileSync('src/public/js/logs.js', 'utf-8');

        expect(html).toContain('id="tab-activity"');
        expect(html).toMatch(/id="access-servers"\s+data-capability="guildAccess"/);
        expect(html).toMatch(/id="access-users"\s+data-capability="pendingUserInstallOwners"/);
        expect(html).toMatch(/id="access-glossary"\s+data-capability="guildGlossary"/);
        expect(html).toContain('id="glossary-editor-dialog"');
        expect(html).toContain('id="settings-category-select"');
        expect(logsJs).toContain("details.className = 'mobile-activity-row'");
    });

    it('returns to login when an authenticated API request expires', async () => {
        const utilsJs = readFileSync('src/public/js/utils.js', 'utf-8');
        const activeViews = new Set<string>(['dashboard-view']);
        const views = ['login-view', 'dashboard-view'].map((id) => ({
            id,
            classList: {
                add(name: string) {
                    if (name === 'active') activeViews.add(id);
                },
                remove(name: string) {
                    if (name === 'active') activeViews.delete(id);
                },
            },
        }));
        const requests: Array<{ url: string; options: { headers: Record<string, string> } }> = [];
        const context = {
            document: {
                addEventListener() {},
                querySelectorAll() {
                    return views;
                },
                getElementById(id: string) {
                    return views.find((view) => view.id === id);
                },
            },
            window: { location: { pathname: '/pocket' } },
            async fetch(url: string, options: { headers: Record<string, string> }) {
                requests.push({ url, options });
                return { status: 401 };
            },
            setTimeout() {},
        };

        vm.createContext(context);
        vm.runInContext(utilsJs, context);
        vm.runInContext("setCsrfToken('csrf-1');", context);

        await expect(vm.runInContext("api('/config');", context)).rejects.toThrow(
            'Session expired',
        );
        expect(activeViews).toEqual(new Set(['login-view']));
        expect(requests[0].url).toBe('/pocket/api/config');
        expect(requests[0].options.headers['x-csrf-token']).toBe('csrf-1');
    });

    it('submits glossary imports and renders the server result', async () => {
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const nodes = {
            'glossary-import-text': { value: '  source,target\nraid,團本  ' },
            'glossary-import-result': { hidden: true, innerHTML: '' },
        };
        const requests: Array<{ path: string; options: { method?: string; body?: string } }> = [];
        const toasts: string[] = [];
        const context = {
            reloadCount: 0,
            document: {
                getElementById(id: string) {
                    return nodes[id as keyof typeof nodes] || null;
                },
                querySelector(selector: string) {
                    return selector === 'input[name="glossary-import-mode"]:checked'
                        ? { value: 'overwrite' }
                        : null;
                },
                querySelectorAll() {
                    return [];
                },
            },
            hasDashboardCapability(name: string) {
                return name === 'guildGlossary';
            },
            async api(path: string, options: { method?: string; body?: string } = {}) {
                requests.push({ path, options });
                return {
                    ok: true,
                    json: async () => ({
                        created: 2,
                        updated: 0,
                        skipped: 0,
                        failed: 1,
                        errors: [{ line: 3, error: 'Invalid row' }],
                    }),
                };
            },
            showToast(message: string) {
                toasts.push(message);
            },
            escapeHtml(value: unknown) {
                return String(value);
            },
        };

        vm.createContext(context);
        vm.runInContext(accessJs, context);
        vm.runInContext(
            "glossaryGuildId = 'guild-1'; loadGlossaryEntries = async () => { reloadCount += 1; };",
            context,
        );
        await vm.runInContext('importGlossaryEntries();', context);

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            path: '/guild-glossary/guild-1/import',
            options: { method: 'POST' },
        });
        expect(JSON.parse(requests[0].options.body!)).toEqual({
            text: 'source,target\nraid,團本',
            duplicateMode: 'overwrite',
        });
        expect(context.reloadCount).toBe(1);
        expect(nodes['glossary-import-result'].hidden).toBe(false);
        expect(nodes['glossary-import-result'].innerHTML).toContain('Created 2');
        expect(nodes['glossary-import-result'].innerHTML).toContain('Failed 1');
        expect(toasts).toEqual(['Glossary import complete with errors']);
    });
});
