# Setup Doctor Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual `Run Doctor` button in the authenticated dashboard that checks Discord runtime state, command registration, provider readiness, SQLite writability, budget sanity, and webhook prerequisites.

**Architecture:** Put all diagnostic logic in one focused backend helper, expose it through one CSRF-protected dashboard route, then render the result in the existing Overview tab. Reuse existing profile command definitions, readiness checks, config repository, SQLite connection, dashboard API helper, and button action system.

**Tech Stack:** TypeScript, Express, discord.js, Node.js `node:sqlite`, plain dashboard JavaScript/CSS/HTML, Vitest.

---

### Task 1: Backend Setup Doctor Helper

**Files:**
- Create: `src/modules/dashboard/setup-doctor.ts`
- Create: `tests/setup-doctor.test.ts`

- [ ] **Step 1: Write failing setup-doctor tests**

Create `tests/setup-doctor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { getCommandsForProfile } from '../src/apps/commands.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import { runSetupDoctor } from '../src/modules/dashboard/setup-doctor.js';
import type { StoreData } from '../src/shared/types.js';

const baseConfig = {
    vertexAiApiKey: 'vertex-key',
    gcpProject: 'project',
    gcpLocation: 'global',
    geminiModel: 'gemini-2.5-flash-lite',
    allowedGuildIds: [],
    allowedUserIds: [],
    cooldownSeconds: 5,
    cacheMaxSize: 100,
    setupComplete: true,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.2,
    dailyBudgetUsd: 1,
    defaultUserDailyBudgetUsd: 1,
    translationPrompt: '',
    maxInputLength: 2000,
    maxOutputTokens: 1000,
    translationMaxConcurrent: 2,
    translationMaxGlobalQueue: 10,
    translationMaxGuildQueue: 5,
    translationMaxUserOutstanding: 1,
    translationMaxQueueWaitMs: 30000,
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    translationProvider: 'vertex',
    tokenUsage: null,
    usageHistory: [],
    userLanguagePrefs: {},
    userLanguagePreferenceEntries: [],
    guildBudgets: {},
    guildTokenUsage: {},
    guildUsageHistory: {},
    userBudgets: {},
    userTokenUsage: {},
    userUsageHistory: {},
} satisfies StoreData;

function configStore(overrides: Partial<StoreData> = {}) {
    const cfg = { ...baseConfig, ...overrides };
    return {
        getDashboardConfig: () => cfg,
        getRuntimeConfig: () => cfg,
        isSetupComplete: () => cfg.setupComplete,
    };
}

function client(user: unknown = { id: 'bot-1', tag: 'Babel#1234' }): Client {
    return {
        user,
        guilds: {
            cache: {
                size: 0,
                values: function* () {},
            },
        },
    } as unknown as Client;
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('runSetupDoctor', () => {
    it('returns ok with warnings when only unlimited budgets and webhook inspection are skipped', async () => {
        const expectedCommands = getCommandsForProfile(BABEL_GUILD_PROFILE);
        const fetchFn = vi.fn(async () =>
            response(expectedCommands.map((command, index) => ({ id: String(index), name: command.name }))),
        );

        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: configStore({ dailyBudgetUsd: 0 }),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn,
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(true);
        expect(report.checks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'discord', status: 'pass' }),
                expect.objectContaining({ id: 'commands', status: 'pass' }),
                expect.objectContaining({ id: 'provider-vertex', status: 'pass' }),
                expect.objectContaining({ id: 'provider-openai', status: 'skipped' }),
                expect.objectContaining({ id: 'sqlite', status: 'pass' }),
                expect.objectContaining({ id: 'budget', status: 'warn' }),
                expect.objectContaining({ id: 'webhook', status: 'skipped' }),
            ]),
        );
    });

    it('fails the report when an expected command is missing', async () => {
        const report = await runSetupDoctor({
            profile: BABEL_GUILD_PROFILE,
            profiles: [BABEL_GUILD_PROFILE],
            client: client(),
            configStore: configStore(),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: { DISCORD_APP_ID: 'app-1', DISCORD_TOKEN: 'token' },
            fetchFn: vi.fn(async () => response([{ id: '1', name: 'Babel' }])),
            sqliteProbe: vi.fn(),
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toContainEqual(
            expect.objectContaining({
                id: 'commands',
                status: 'fail',
                action: expect.stringContaining('npm run register'),
            }),
        );
    });

    it('keeps running later checks when SQLite probe fails', async () => {
        const report = await runSetupDoctor({
            profile: BABEL_POCKET_PROFILE,
            profiles: [BABEL_POCKET_PROFILE],
            client: client(),
            configStore: configStore({ translationProvider: 'openai', openaiApiKey: 'key', openaiBaseUrl: 'https://api.example.test', openaiModel: 'model' }),
            healthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 12 })),
            openAiHealthCheck: vi.fn(async () => ({ healthy: true, latencyMs: 10 })),
            env: {},
            fetchFn: vi.fn(),
            sqliteProbe: vi.fn(() => {
                throw new Error('readonly database');
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sqlite', status: 'fail' }));
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'budget', status: 'pass' }));
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'webhook', status: 'skipped' }));
    });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- tests/setup-doctor.test.ts
```

Expected: FAIL because `src/modules/dashboard/setup-doctor.ts` does not exist.

- [ ] **Step 3: Add minimal setup-doctor implementation**

Create `src/modules/dashboard/setup-doctor.ts`:

```ts
import { PermissionFlagsBits, type Client } from 'discord.js';
import { getCommandsForProfile } from '../../apps/commands.js';
import { resolveRegistrationEnv } from '../../apps/register.js';
import type { AppProfile } from '../../apps/app-profile.js';
import type { ConfigRepository } from '../config/config-repository.js';
import { configRepository } from '../config/config-repository.js';
import { getReadinessStatus } from '../../shared/health.js';
import type { OpenAiHealthStatus } from '../../infra/openai-client.js';
import { checkOpenAiHealth } from '../../infra/openai-client.js';
import type { VertexAiHealthStatus } from '../../infra/vertex-ai-client.js';
import { checkVertexAiHealth } from '../../infra/vertex-ai-client.js';
import { getSqliteDatabase, inTransaction } from '../../persistence/sqlite-database.js';

export type SetupDoctorStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface SetupDoctorCheck {
    id: string;
    status: SetupDoctorStatus;
    title: string;
    detail: string;
    action?: string;
}

export interface SetupDoctorReport {
    ok: boolean;
    timestamp: string;
    checks: SetupDoctorCheck[];
}

export interface SetupDoctorDeps {
    profile: AppProfile;
    profiles: AppProfile[];
    client: Client;
    configStore?: Pick<ConfigRepository, 'getDashboardConfig' | 'getRuntimeConfig' | 'isSetupComplete'>;
    healthCheck?: () => Promise<VertexAiHealthStatus>;
    openAiHealthCheck?: () => Promise<OpenAiHealthStatus>;
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    sqliteProbe?: () => void | Promise<void>;
    requireProfileSpecificRegistrationEnv?: boolean;
}

function check(id: string, status: SetupDoctorStatus, title: string, detail: string, action?: string): SetupDoctorCheck {
    return action ? { id, status, title, detail, action } : { id, status, title, detail };
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function safeCheck(id: string, title: string, fn: () => Promise<SetupDoctorCheck> | SetupDoctorCheck): Promise<SetupDoctorCheck> {
    try {
        return await fn();
    } catch (error) {
        return check(id, 'fail', title, `${title} check failed: ${errorText(error)}`);
    }
}

function iterableValues<T>(source: unknown): T[] {
    const values = (source as { values?: () => Iterable<T> } | null)?.values;
    if (typeof values === 'function') return [...values.call(source)];
    if (source && typeof (source as Iterable<T>)[Symbol.iterator] === 'function') {
        return [...(source as Iterable<T>)].map((item) =>
            Array.isArray(item) ? (item[1] as T) : item,
        );
    }
    return [];
}

function checkDiscordClient(client: Client): SetupDoctorCheck {
    if (!client.user) {
        return check(
            'discord',
            'fail',
            'Discord token',
            'Discord client is not logged in.',
            'Restart with a valid Discord bot token.',
        );
    }

    return check(
        'discord',
        'pass',
        'Discord token',
        `Logged in as ${client.user.tag ?? client.user.id}.`,
    );
}

async function checkCommands(deps: Required<Pick<SetupDoctorDeps, 'profile' | 'profiles' | 'env' | 'fetchFn'>> & Pick<SetupDoctorDeps, 'requireProfileSpecificRegistrationEnv'>): Promise<SetupDoctorCheck> {
    const { appId, botToken } = resolveRegistrationEnv(deps.profile, deps.env, {
        requireProfileSpecificEnv:
            deps.requireProfileSpecificRegistrationEnv ?? deps.profiles.length > 1,
    });

    if (!appId || !botToken) {
        return check(
            'commands',
            'skipped',
            'Discord commands',
            'Command registration env vars are not available to this process.',
            'Set DISCORD_APP_ID plus DISCORD_TOKEN, or profile-specific app id and token env vars.',
        );
    }

    const response = await deps.fetchFn(
        `https://discord.com/api/v10/applications/${appId}/commands`,
        { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (!response.ok) {
        return check(
            'commands',
            'fail',
            'Discord commands',
            `Discord returned ${response.status} while reading global commands.`,
            'Check the app id/token pair, then run npm run register or the profile-specific register script.',
        );
    }

    const actual = (await response.json()) as Array<{ name?: unknown }>;
    const actualNames = new Set(actual.map((command) => String(command.name ?? '')));
    const missing = getCommandsForProfile(deps.profile)
        .map((command) => command.name)
        .filter((name) => !actualNames.has(name));

    if (missing.length > 0) {
        return check(
            'commands',
            'fail',
            'Discord commands',
            `Missing commands: ${missing.join(', ')}.`,
            'Run npm run register or the profile-specific register script.',
        );
    }

    return check('commands', 'pass', 'Discord commands', 'All expected command names are registered.');
}

async function checkProviders(deps: Required<Pick<SetupDoctorDeps, 'configStore' | 'healthCheck' | 'openAiHealthCheck'>>): Promise<SetupDoctorCheck[]> {
    const readiness = await getReadinessStatus({
        configStore: deps.configStore,
        healthCheck: deps.healthCheck,
        openAiHealthCheck: deps.openAiHealthCheck,
        cacheTtlMs: 0,
    });

    return [
        providerCheck('provider-vertex', 'Vertex AI provider', readiness.checks.vertexAi),
        providerCheck('provider-openai', 'OpenAI-compatible provider', readiness.checks.openAi),
    ];
}

function providerCheck(id: string, title: string, result: { status: 'pass' | 'fail' | 'skip'; detail: string; error?: string; latencyMs?: number }): SetupDoctorCheck {
    if (result.status === 'skip') return check(id, 'skipped', title, result.detail);
    if (result.status === 'fail') return check(id, 'fail', title, result.error || result.detail);
    return check(id, 'pass', title, result.latencyMs === undefined ? result.detail : `${result.detail} (${result.latencyMs}ms).`);
}

export function runSqliteWriteProbe(): void {
    const db = getSqliteDatabase();
    const key = '__setup_doctor_probe__';
    inTransaction(db, () => {
        db.prepare(
            `
            INSERT INTO app_config (key, value_json)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
        `,
        ).run(key, JSON.stringify({ checkedAt: new Date().toISOString() }));
        db.prepare('DELETE FROM app_config WHERE key = ?').run(key);
    });
}

async function checkSqlite(sqliteProbe: () => void | Promise<void>): Promise<SetupDoctorCheck> {
    await sqliteProbe();
    return check('sqlite', 'pass', 'SQLite writable', 'Database accepted a write/delete probe.');
}

function checkBudget(configStore: NonNullable<SetupDoctorDeps['configStore']>): SetupDoctorCheck {
    const cfg = configStore.getDashboardConfig();
    const keys = [
        'inputPricePerMillion',
        'outputPricePerMillion',
        'dailyBudgetUsd',
        'defaultUserDailyBudgetUsd',
    ] as const;
    const invalid = keys.filter((key) => {
        const value = Number(cfg[key]);
        return !Number.isFinite(value) || value < 0;
    });
    if (invalid.length > 0) {
        return check(
            'budget',
            'fail',
            'Budget settings',
            `Invalid non-negative number fields: ${invalid.join(', ')}.`,
            'Open Settings and save non-negative pricing and budget values.',
        );
    }

    const unlimited = [
        cfg.dailyBudgetUsd === 0 ? 'global daily budget' : '',
        cfg.defaultUserDailyBudgetUsd === 0 ? 'default user daily budget' : '',
    ].filter(Boolean);
    if (unlimited.length > 0) {
        return check(
            'budget',
            'warn',
            'Budget settings',
            `${unlimited.join(' and ')} set to unlimited.`,
            'Set a positive budget if you want spend protection.',
        );
    }

    return check('budget', 'pass', 'Budget settings', 'Pricing and daily budgets are non-negative.');
}

function checkWebhook(profile: AppProfile, client: Client): SetupDoctorCheck {
    if (!profile.enableWebhookOutput) {
        return check('webhook', 'skipped', 'Webhook permissions', `${profile.productName} does not use webhook output.`);
    }
    if (!client.user) {
        return check('webhook', 'fail', 'Webhook permissions', 'Discord client is not logged in.');
    }

    const guilds = iterableValues<{
        name?: string;
        channels?: { cache?: unknown };
    }>(client.guilds.cache);
    if (guilds.length === 0) {
        return check(
            'webhook',
            'skipped',
            'Webhook permissions',
            'No guild cache is available for webhook permission inspection.',
            'Run this after the bot is installed in at least one server.',
        );
    }

    for (const guild of guilds) {
        const channels = iterableValues<{
            name?: string;
            permissionsFor?: (userId: string) => { has?: (flag: bigint) => boolean } | null;
        }>(guild.channels?.cache);
        const channel = channels.find((candidate) => typeof candidate.permissionsFor === 'function');
        if (!channel) continue;

        const allowed = Boolean(channel.permissionsFor?.(client.user.id)?.has?.(PermissionFlagsBits.ManageWebhooks));
        if (allowed) {
            return check(
                'webhook',
                'pass',
                'Webhook permissions',
                `Manage Webhooks is available in ${guild.name ?? 'a server'}${channel.name ? ` / ${channel.name}` : ''}.`,
            );
        }

        return check(
            'webhook',
            'fail',
            'Webhook permissions',
            `Manage Webhooks is missing in ${guild.name ?? 'a server'}${channel.name ? ` / ${channel.name}` : ''}.`,
            'Grant Manage Webhooks to the bot role in channels where public /translate output is used.',
        );
    }

    return check(
        'webhook',
        'skipped',
        'Webhook permissions',
        'No cached text channel exposed permissions for inspection.',
        'Check that the bot role has Manage Webhooks in translation channels.',
    );
}

export async function runSetupDoctor({
    profile,
    profiles,
    client,
    configStore = configRepository,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    env = process.env,
    fetchFn = fetch,
    sqliteProbe = runSqliteWriteProbe,
    requireProfileSpecificRegistrationEnv,
}: SetupDoctorDeps): Promise<SetupDoctorReport> {
    const checks: SetupDoctorCheck[] = [];

    checks.push(await safeCheck('discord', 'Discord token', () => checkDiscordClient(client)));
    checks.push(
        await safeCheck('commands', 'Discord commands', () =>
            checkCommands({
                profile,
                profiles,
                env,
                fetchFn,
                requireProfileSpecificRegistrationEnv,
            }),
        ),
    );
    try {
        checks.push(...(await checkProviders({ configStore, healthCheck, openAiHealthCheck })));
    } catch (error) {
        checks.push(check('provider-vertex', 'fail', 'Vertex AI provider', `Provider readiness failed: ${errorText(error)}`));
        checks.push(check('provider-openai', 'fail', 'OpenAI-compatible provider', `Provider readiness failed: ${errorText(error)}`));
    }
    checks.push(await safeCheck('sqlite', 'SQLite writable', () => checkSqlite(sqliteProbe)));
    checks.push(await safeCheck('budget', 'Budget settings', () => checkBudget(configStore)));
    checks.push(await safeCheck('webhook', 'Webhook permissions', () => checkWebhook(profile, client)));

    return {
        ok: checks.every((item) => item.status !== 'fail'),
        timestamp: new Date().toISOString(),
        checks,
    };
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```bash
npm test -- tests/setup-doctor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit backend helper**

Run:

```bash
git add src/modules/dashboard/setup-doctor.ts tests/setup-doctor.test.ts
git commit -m "Add setup doctor checks"
```

Expected: commit succeeds.

### Task 2: Dashboard API Route

**Files:**
- Modify: `src/modules/dashboard/dashboard.ts`
- Modify: `tests/dashboard.test.ts`

- [ ] **Step 1: Add failing dashboard API tests**

In `tests/dashboard.test.ts`, add these tests near the existing CSRF and health endpoint tests:

```ts
it('should reject setup doctor runs without CSRF token', async () => {
    const res = await request(server, 'POST', '/api/setup-doctor/run', {
        cookie: sessionCookie,
    });

    expect(res.status).toBe(403);
});

it('should run setup doctor from the authenticated dashboard', async () => {
    const originalAppId = process.env.DISCORD_APP_ID;
    const originalToken = process.env.DISCORD_TOKEN;
    delete process.env.DISCORD_APP_ID;
    delete process.env.DISCORD_TOKEN;

    try {
        const res = await request(server, 'POST', '/api/setup-doctor/run', {
            cookie: sessionCookie,
            csrf: csrfToken,
        });

        expect(res.status).toBe(200);
        expect(res.body!.timestamp).toEqual(expect.any(String));
        expect(res.body!.checks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'discord' }),
                expect.objectContaining({ id: 'commands', status: 'skipped' }),
                expect.objectContaining({ id: 'provider-vertex' }),
                expect.objectContaining({ id: 'sqlite' }),
                expect.objectContaining({ id: 'budget' }),
                expect.objectContaining({ id: 'webhook' }),
            ]),
        );
    } finally {
        if (originalAppId === undefined) {
            delete process.env.DISCORD_APP_ID;
        } else {
            process.env.DISCORD_APP_ID = originalAppId;
        }
        if (originalToken === undefined) {
            delete process.env.DISCORD_TOKEN;
        } else {
            process.env.DISCORD_TOKEN = originalToken;
        }
    }
});
```

- [ ] **Step 2: Run dashboard tests to verify RED**

Run:

```bash
npm test -- tests/dashboard.test.ts
```

Expected: FAIL because `/api/setup-doctor/run` is not registered.

- [ ] **Step 3: Register the route**

In `src/modules/dashboard/dashboard.ts`, add the import:

```ts
import { runSetupDoctor } from './setup-doctor.js';
```

After the `/api/capabilities` route, add:

```ts
    api.post(
        '/setup-doctor/run',
        auth.requireAuth,
        auth.requireCsrf,
        asyncHandler(async (_req: Request, res: Response) => {
            const scope = getScope(res);
            res.json(
                await runSetupDoctor({
                    profile: scope.profile,
                    profiles: scope.profiles,
                    client: scope.client,
                    configStore: configRepository,
                    healthCheck,
                    openAiHealthCheck,
                    requireProfileSpecificRegistrationEnv: isCombinedDashboard,
                }),
            );
        }),
    );
```

- [ ] **Step 4: Run dashboard tests to verify GREEN**

Run:

```bash
npm test -- tests/dashboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit dashboard route**

Run:

```bash
git add src/modules/dashboard/dashboard.ts tests/dashboard.test.ts
git commit -m "Expose setup doctor dashboard endpoint"
```

Expected: commit succeeds.

### Task 3: Manual Dashboard Button And Results

**Files:**
- Modify: `src/public/index.html`
- Modify: `src/public/js/dashboard.js`
- Modify: `src/public/css/dashboard.css`

- [ ] **Step 1: Add the Overview UI shell**

In `src/public/index.html`, inside `#tab-overview`, add this section after the Operations panel and before the stats grid:

```html
                <section class="setup-doctor-panel" aria-labelledby="setup-doctor-title">
                    <div class="setup-doctor-header">
                        <h2 id="setup-doctor-title">Setup Doctor</h2>
                        <button
                            class="btn btn-secondary btn-sm"
                            id="setup-doctor-run"
                            type="button"
                            data-action="runSetupDoctor"
                        >
                            Run Doctor
                        </button>
                    </div>
                    <div class="setup-doctor-results" id="setup-doctor-results"></div>
                </section>
```

- [ ] **Step 2: Add result rendering and click handler**

In `src/public/js/dashboard.js`, before `loadDashboard()`, add:

```js
function setupDoctorStatusLabel(status) {
    if (status === 'pass') return 'PASS';
    if (status === 'warn') return 'WARN';
    if (status === 'fail') return 'FAIL';
    return 'SKIP';
}

function renderSetupDoctorReport(report) {
    const container = document.getElementById('setup-doctor-results');
    if (!container) return;

    container.replaceChildren();
    (report.checks || []).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'setup-doctor-row ' + (item.status || 'skipped');

        const status = document.createElement('span');
        status.className = 'setup-doctor-status';
        status.textContent = setupDoctorStatusLabel(item.status);

        const body = document.createElement('div');
        body.className = 'setup-doctor-body';

        const title = document.createElement('strong');
        title.textContent = item.title || item.id || 'Check';

        const detail = document.createElement('span');
        detail.textContent = item.detail || '';

        body.append(title, detail);
        if (item.action) {
            const action = document.createElement('em');
            action.textContent = item.action;
            body.append(action);
        }

        row.append(status, body);
        container.append(row);
    });
}

async function runSetupDoctor() {
    const button = document.getElementById('setup-doctor-run');
    if (button) {
        button.disabled = true;
        button.textContent = 'Checking...';
    }

    try {
        const res = await api('/setup-doctor/run', { method: 'POST' });
        const report = await res.json();
        if (!res.ok) throw new Error(report.error || 'Setup Doctor failed');
        renderSetupDoctorReport(report);
        showToast(report.ok ? 'Setup Doctor passed' : 'Setup Doctor found issues', !report.ok);
    } catch (error) {
        showToast(error.message || 'Setup Doctor failed', true);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Run Doctor';
        }
    }
}
```

- [ ] **Step 3: Add compact styles**

In `src/public/css/dashboard.css`, add:

```css
.setup-doctor-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 1rem;
}

.setup-doctor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.setup-doctor-header h2 {
  font-size: 1rem;
  color: var(--text);
}

.setup-doctor-results {
  display: grid;
  gap: 0.5rem;
}

.setup-doctor-row {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.setup-doctor-status {
  align-self: start;
  border-radius: 999px;
  padding: 0.2rem 0.45rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-align: center;
}

.setup-doctor-row.pass .setup-doctor-status {
  color: var(--green);
  background: rgba(34, 197, 94, 0.12);
}

.setup-doctor-row.warn .setup-doctor-status {
  color: var(--yellow);
  background: rgba(245, 158, 11, 0.12);
}

.setup-doctor-row.fail .setup-doctor-status {
  color: var(--red);
  background: rgba(239, 68, 68, 0.12);
}

.setup-doctor-row.skipped .setup-doctor-status {
  color: var(--text-dim);
  background: rgba(148, 163, 184, 0.12);
}

.setup-doctor-body {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
}

.setup-doctor-body strong {
  color: var(--text);
  font-size: 0.9rem;
}

.setup-doctor-body span,
.setup-doctor-body em {
  color: var(--text-dim);
  font-size: 0.82rem;
  font-style: normal;
}
```

- [ ] **Step 4: Run asset smoke check**

Run:

```bash
npm run smoke:dashboard
```

Expected: PASS.

- [ ] **Step 5: Commit dashboard UI**

Run:

```bash
git add src/public/index.html src/public/js/dashboard.js src/public/css/dashboard.css
git commit -m "Add setup doctor dashboard button"
```

Expected: commit succeeds.

### Task 4: Final Verification

**Files:**
- Read: `docs/superpowers/specs/2026-07-09-setup-doctor-dashboard-design.md`
- Read: `docs/superpowers/plans/2026-07-09-setup-doctor-dashboard.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/setup-doctor.test.ts tests/dashboard.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run project checks**

Run:

```bash
npm run typecheck
npm run lint
npm run smoke:dashboard
```

Expected: all commands exit 0.

- [ ] **Step 3: Check the final diff**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: working tree is clean after the task commits; recent commits include setup doctor checks, endpoint, and button.

- [ ] **Step 4: Report skipped scope**

Report:

```text
Skipped: automatic diagnosis, command registration, webhook creation, webhook test sends, and startup-before-login token diagnosis.
Add them only when operators need one-click repair or pre-login failure diagnosis.
```
