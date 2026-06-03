# Babel Monorepo Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Merge Babel Pocket into `babel-discord-translator` as a two-app monorepo with shared translation, provider, persistence, logging, metrics, and dashboard foundations.

**Architecture:** Implement a capability-driven shared core first, then expose two product apps: Babel Guild for guild/server install and Babel Pocket for user install. Keep behavior protected by tests while progressively moving code toward `apps/*` and `packages/*`; compatibility exports may remain during the migration so existing imports and tests continue to work.

**Tech Stack:** Node.js 22.12+, TypeScript 5.9, npm workspaces, discord.js 14, Express 4, SQLite via `node:sqlite`, Vitest, ESLint 9.

---

## Scope Note

The design includes multiple subsystems. This plan implements the main merge slice end-to-end: product naming, Pocket domain merge, shared access/usage scope, app-specific command surfaces, workspace scaffolding, and first large-file splits for translation and usage. A separate follow-up plan should handle deeper dashboard frontend restructuring after both apps run from one repo.

## Target File Structure

- Modify `package.json`: root workspace scripts, repository metadata, root build/test orchestration.
- Modify `package-lock.json`: npm workspace lockfile changes after `npm install`.
- Create `tsconfig.base.json`: shared compiler options.
- Modify `tsconfig.json`: root compatibility build config extending base.
- Create `apps/babel-guild/package.json`: app metadata and scripts for Babel Guild.
- Create `apps/babel-guild/tsconfig.json`: app build config.
- Create `apps/babel-guild/src/index.ts`: Guild app entrypoint wrapper.
- Create `apps/babel-guild/scripts/register.ts`: Guild command registration wrapper.
- Create `apps/babel-pocket/package.json`: app metadata and scripts for Babel Pocket.
- Create `apps/babel-pocket/tsconfig.json`: app build config.
- Create `apps/babel-pocket/src/index.ts`: Pocket app entrypoint wrapper.
- Create `apps/babel-pocket/scripts/register.ts`: Pocket command registration wrapper.
- Create `src/apps/app-profile.ts`: product profile types and definitions.
- Create `src/apps/bootstrap.ts`: shared Discord client/dashboard/bootstrap composition.
- Modify `src/index.ts`: delegate to Babel Guild bootstrap for backward compatibility.
- Modify `scripts/register.ts`: delegate to Babel Guild registration for backward compatibility.
- Create `src/apps/commands.ts`: Guild and Pocket command definitions.
- Modify `tests/register.test.ts`: assert app-specific command surfaces.
- Modify `src/types.ts`: add user budget, allowed users, user usage, pending owner types, and translation scope.
- Modify `src/persistence/store-defaults.ts`: add user-install defaults.
- Modify `src/persistence/sqlite-database.ts`: add user usage and pending owner migrations.
- Modify `src/store.ts`: move user budget/usage persistence into focused helpers.
- Create `src/modules/usage/user-budget-repository.ts`: user budget repository.
- Create `src/modules/dashboard/pending-user-install-owner-repository.ts`: pending owner repository.
- Modify `src/modules/config/config-repository.ts`: include user-install runtime config keys.
- Create `src/modules/usage/usage-scope.ts`: normalize guild/user billing scope.
- Create `src/modules/usage/usage-cost.ts`: cost and stats helpers extracted from `usage.ts`.
- Create `src/modules/usage/budget-scope.ts`: budget selection logic.
- Modify `src/modules/usage/usage-repository.ts`: user usage reads/writes.
- Modify `src/modules/usage/usage.ts`: use extracted usage helpers and user scope.
- Modify `tests/usage.test.ts`: cover global, guild, and user usage.
- Create `src/modules/translation/access-policy.ts`: guild/user-install access decisions.
- Create `src/modules/translation/target-language.ts`: target language decision helper.
- Create `src/modules/translation/translation-scope.ts`: translation request scope helpers.
- Modify `src/modules/translation/translation-service.ts`: use access policy, normalized scope, and user-install pending owner repository.
- Modify `tests/translation-service.test.ts`: cover Guild and Pocket authorization paths.
- Modify `src/commands/babel.ts`: support product profile command labels and billing owner resolution.
- Modify `src/commands/help.ts`: use app profile for help copy where needed.
- Modify `src/shared/messages/discord-messages.ts`: add unauthorized user message.
- Modify `src/modules/dashboard/dashboard.ts`: accept app profile/capabilities and hide irrelevant access routes.
- Modify `tests/dashboard.test.ts`: assert Guild/Pocket dashboard capability behavior.
- Modify `README.md`: explain repo name, Babel Guild, Babel Pocket, and app selection.
- Modify `docs/operations/deployment.md`, `docs/operations/docker.md`, `docs/operations/railway.md`: document per-app deployment commands.

---

### Task 1: Add App Profiles And Command Definitions

**Files:**
- Create: `src/apps/app-profile.ts`
- Create: `src/apps/commands.ts`
- Modify: `tests/register.test.ts`
- Modify: `scripts/register.ts`

- [x] **Step 1: Write failing command surface tests**

Create `tests/register.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCommandsForProfile } from '../src/apps/commands.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';

describe('Discord command registration profiles', () => {
    it('registers Babel Guild server-install commands', () => {
        const commands = getCommandsForProfile(BABEL_GUILD_PROFILE);
        const names = commands.map((command) => command.name);

        expect(names).toEqual(['Babel', 'setlang', 'translate', 'help', 'mylang']);
        expect(commands.find((command) => command.name === 'translate')).toMatchObject({
            type: 1,
            description: 'Translate text',
        });
        expect(commands.every((command) => command.integration_types === undefined)).toBe(true);
        expect(commands.every((command) => command.contexts === undefined)).toBe(true);
    });

    it('registers Babel Pocket user-install commands without public translate', () => {
        const commands = getCommandsForProfile(BABEL_POCKET_PROFILE);
        const names = commands.map((command) => command.name);

        expect(names).toEqual(['Babel Pocket', 'setlang', 'help', 'mylang']);
        expect(names).not.toContain('translate');
        expect(commands.every((command) => command.integration_types?.includes(1))).toBe(true);
        expect(commands.every((command) => command.contexts)).toEqual(true);
        expect(commands.find((command) => command.name === 'Babel Pocket')).toMatchObject({
            type: 3,
            integration_types: [1],
            contexts: [0, 1, 2],
        });
    });
});
```

- [x] **Step 2: Run the new test and verify red**

Run: `npm test -- tests/register.test.ts`

Expected: FAIL because `src/apps/commands.ts` and `src/apps/app-profile.ts` do not exist.

- [x] **Step 3: Implement app profiles**

Create `src/apps/app-profile.ts`:

```ts
export type AccessMode = 'guild' | 'user-install';

export interface AppProfile {
    id: 'babel-guild' | 'babel-pocket';
    productName: 'Babel Guild' | 'Babel Pocket';
    commandName: 'Babel' | 'Babel Pocket';
    accessMode: AccessMode;
    enableTranslateCommand: boolean;
    enableWebhookOutput: boolean;
    enableGuildAccess: boolean;
    enableUserAccess: boolean;
    enableGuildGlossary: boolean;
}

export const BABEL_GUILD_PROFILE: AppProfile = {
    id: 'babel-guild',
    productName: 'Babel Guild',
    commandName: 'Babel',
    accessMode: 'guild',
    enableTranslateCommand: true,
    enableWebhookOutput: true,
    enableGuildAccess: true,
    enableUserAccess: false,
    enableGuildGlossary: true,
};

export const BABEL_POCKET_PROFILE: AppProfile = {
    id: 'babel-pocket',
    productName: 'Babel Pocket',
    commandName: 'Babel Pocket',
    accessMode: 'user-install',
    enableTranslateCommand: false,
    enableWebhookOutput: false,
    enableGuildAccess: false,
    enableUserAccess: true,
    enableGuildGlossary: false,
};

export function resolveAppProfile(value = process.env.BABEL_APP): AppProfile {
    return value === 'pocket' || value === 'babel-pocket'
        ? BABEL_POCKET_PROFILE
        : BABEL_GUILD_PROFILE;
}
```

Create `src/apps/commands.ts` by moving the existing command definitions out of `scripts/register.ts` and making `/translate` conditional:

```ts
import type { AppProfile } from './app-profile.js';

interface DiscordCommandChoice {
    name: string;
    value: string;
}

interface DiscordCommandOption {
    name: string;
    description: string;
    type: number;
    required?: boolean;
    choices?: DiscordCommandChoice[];
}

export interface DiscordCommand {
    name: string;
    type: number;
    description?: string;
    integration_types?: number[];
    contexts?: number[];
    options?: DiscordCommandOption[];
}

const INTEGRATION_USER_INSTALL = 1;
const CONTEXT_GUILD = 0;
const CONTEXT_BOT_DM = 1;
const CONTEXT_PRIVATE_CHANNEL = 2;

const USER_INSTALL_COMMAND_CONTEXT = {
    integration_types: [INTEGRATION_USER_INSTALL],
    contexts: [CONTEXT_GUILD, CONTEXT_BOT_DM, CONTEXT_PRIVATE_CHANNEL],
};

const LANGUAGE_CHOICES = [
    { name: 'Auto', value: 'auto' },
    { name: '繁體中文', value: 'zh-TW' },
    { name: '简体中文', value: 'zh-CN' },
    { name: 'English', value: 'en' },
    { name: '日本語', value: 'ja' },
    { name: '한국어', value: 'ko' },
    { name: 'Español', value: 'es' },
    { name: 'Français', value: 'fr' },
    { name: 'Deutsch', value: 'de' },
    { name: 'Português', value: 'pt' },
    { name: 'Русский', value: 'ru' },
    { name: 'Italiano', value: 'it' },
    { name: 'Tiếng Việt', value: 'vi' },
    { name: 'ไทย', value: 'th' },
    { name: 'العربية', value: 'ar' },
    { name: 'Bahasa Indonesia', value: 'id' },
];

function withInstallContext(profile: AppProfile): Partial<DiscordCommand> {
    return profile.accessMode === 'user-install' ? USER_INSTALL_COMMAND_CONTEXT : {};
}

export function getCommandsForProfile(profile: AppProfile): DiscordCommand[] {
    const context = withInstallContext(profile);
    const commands: DiscordCommand[] = [
        {
            name: profile.commandName,
            type: 3,
            ...context,
        },
        {
            name: 'setlang',
            type: 1,
            description: 'Set your preferred translation language',
            ...context,
            options: [
                {
                    name: 'language',
                    description: 'Target language',
                    type: 3,
                    required: true,
                    choices: LANGUAGE_CHOICES,
                },
            ],
        },
    ];

    if (profile.enableTranslateCommand) {
        commands.push({
            name: 'translate',
            type: 1,
            description: 'Translate text',
            options: [
                {
                    name: 'text',
                    description: 'Text to translate',
                    type: 3,
                    required: true,
                },
                {
                    name: 'to',
                    description: 'Target language',
                    type: 3,
                    required: false,
                    choices: LANGUAGE_CHOICES,
                },
                {
                    name: 'visibility',
                    description: 'Where to send the translation',
                    type: 3,
                    required: false,
                    choices: [
                        { name: 'Public channel message', value: 'public' },
                        { name: 'Private ephemeral reply', value: 'private' },
                    ],
                },
            ],
        });
    }

    commands.push(
        {
            name: 'help',
            type: 1,
            description: `Show how to use ${profile.productName}`,
            ...context,
        },
        {
            name: 'mylang',
            type: 1,
            description: 'Check your current translation language',
            ...context,
        },
    );

    return commands;
}
```

- [x] **Step 4: Update register script**

Modify `scripts/register.ts` to export `registerCommands` and use the profile command list:

```ts
#!/usr/bin/env node

import { getCommandsForProfile } from '../src/apps/commands.js';
import { resolveAppProfile } from '../src/apps/app-profile.js';

export async function registerCommands(): Promise<void> {
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const profile = resolveAppProfile();

    if (!appId || !botToken) {
        console.error(
            '❌ Missing env vars. Usage:\n' +
                '   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=xxx npm run register',
        );
        process.exit(1);
    }

    const commands = getCommandsForProfile(profile);
    const url = `https://discord.com/api/v10/applications/${appId}/commands`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify(commands),
    });

    if (response.ok) {
        const data = (await response.json()) as Array<{ name: string; id: string }>;
        console.log(`✅ Registered ${data.length} ${profile.productName} commands:`);
        data.forEach((cmd) => console.log(`   - "${cmd.name}" (ID: ${cmd.id})`));
        return;
    }

    const error = await response.text();
    console.error(`❌ Failed: ${response.status}`, error);
    process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await registerCommands();
}
```

- [x] **Step 5: Verify green**

Run: `npm test -- tests/register.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

Run:

```bash
git add src/apps/app-profile.ts src/apps/commands.ts scripts/register.ts tests/register.test.ts
git commit -m "feat: add babel app command profiles"
```

---

### Task 2: Merge Pocket Persistence Types And Defaults

**Files:**
- Modify: `src/types.ts`
- Modify: `src/persistence/store-defaults.ts`
- Modify: `src/repositories/store-data-normalizer.ts`
- Modify: `src/modules/config/config-repository.ts`
- Modify: `tests/config-repository.test.ts`
- Modify: `tests/store.test.ts`

- [x] **Step 1: Write failing config/default tests**

Update the test fixtures in `tests/config-repository.test.ts` and `tests/store.test.ts` so every `StoreData` factory includes:

```ts
allowedUserIds: [],
defaultUserDailyBudgetUsd: 0,
userBudgets: {},
userTokenUsage: {},
userUsageHistory: {},
```

Add this assertion to the config repository test:

```ts
it('includes user-install config keys in runtime config', () => {
    const config = configRepository.getRuntimeConfig();

    expect(config.allowedUserIds).toEqual([]);
    expect(config.defaultUserDailyBudgetUsd).toBe(0);
});
```

Add this assertion to the store test:

```ts
it('includes empty user-install collections in snapshots', () => {
    const snapshot = store.getAll();

    expect(snapshot.userBudgets).toEqual({});
    expect(snapshot.userTokenUsage).toEqual({});
    expect(snapshot.userUsageHistory).toEqual({});
});
```

- [x] **Step 2: Run tests and verify red**

Run: `npm test -- tests/config-repository.test.ts tests/store.test.ts`

Expected: FAIL because `StoreData` and defaults do not include user-install fields.

- [x] **Step 3: Add shared types**

Modify `src/types.ts`:

```ts
export interface UserBudgetConfig {
    dailyBudgetUsd: number;
}

export interface TranslationScope {
    guildId?: string | null;
    actorUserId: string;
    billingUserId?: string | null;
}
```

Add these fields to `StoreData`:

```ts
allowedUserIds: string[];
defaultUserDailyBudgetUsd: number;
userBudgets: Record<string, UserBudgetConfig>;
userTokenUsage: Record<string, TokenUsage>;
userUsageHistory: Record<string, UsageHistoryEntry[]>;
```

- [x] **Step 4: Add defaults and normalization**

Modify `src/persistence/store-defaults.ts` so `DEFAULT_STORE_DATA` includes:

```ts
allowedUserIds: [],
defaultUserDailyBudgetUsd: 0,
userBudgets: {},
userTokenUsage: {},
userUsageHistory: {},
```

Modify `src/repositories/store-data-normalizer.ts` so normalized data preserves user-install fields:

```ts
allowedUserIds: Array.isArray(data.allowedUserIds) ? [...data.allowedUserIds] : [],
defaultUserDailyBudgetUsd:
    typeof data.defaultUserDailyBudgetUsd === 'number' ? data.defaultUserDailyBudgetUsd : 0,
userBudgets: cloneUserBudgets(data.userBudgets ?? {}),
userTokenUsage: cloneUsageRecord(data.userTokenUsage ?? {}),
userUsageHistory: cloneUsageHistoryRecord(data.userUsageHistory ?? {}),
```

If helper names differ in the current file, add focused helpers with these signatures:

```ts
export function cloneUserBudgets(
    budgets: Record<string, UserBudgetConfig>,
): Record<string, UserBudgetConfig> {
    return Object.fromEntries(
        Object.entries(budgets).map(([userId, budget]) => [userId, { ...budget }]),
    );
}
```

- [x] **Step 5: Include user-install config keys**

Modify `src/modules/config/config-repository.ts`:

```ts
type RuntimeConfigKey =
    | 'translationProvider'
    | 'openaiApiKey'
    | 'openaiBaseUrl'
    | 'openaiModel'
    | 'vertexApiKey'
    | 'gcpProjectId'
    | 'gcpLocation'
    | 'geminiModel'
    | 'allowedGuildIds'
    | 'allowedUserIds'
    | 'cooldownSeconds'
    | 'cacheMaxSize'
    | 'setupComplete'
    | 'inputPricePerMillion'
    | 'outputPricePerMillion'
    | 'dailyBudgetUsd'
    | 'defaultUserDailyBudgetUsd'
    | 'translationPrompt'
    | 'maxInputLength'
    | 'maxOutputTokens'
    | 'runtimeMaxConcurrentTranslations'
    | 'runtimeMaxQueueSize'
    | 'runtimePerUserConcurrency'
    | 'runtimePerGuildConcurrency';
```

Ensure `RUNTIME_CONFIG_KEYS` includes `allowedUserIds` and `defaultUserDailyBudgetUsd`.

- [x] **Step 6: Verify green**

Run: `npm test -- tests/config-repository.test.ts tests/store.test.ts`

Expected: PASS.

- [x] **Step 7: Commit**

Run:

```bash
git add src/types.ts src/persistence/store-defaults.ts src/repositories/store-data-normalizer.ts src/modules/config/config-repository.ts tests/config-repository.test.ts tests/store.test.ts
git commit -m "feat: add user-install store fields"
```

---

### Task 3: Add User Budget And Pending Owner Storage

**Files:**
- Modify: `src/persistence/sqlite-database.ts`
- Modify: `src/store.ts`
- Modify: `src/modules/usage/usage-repository.ts`
- Create: `src/modules/usage/user-budget-repository.ts`
- Create: `src/modules/dashboard/pending-user-install-owner-repository.ts`
- Modify: `tests/sqlite-database.test.ts`
- Create: `tests/pending-user-install-owner-repository.test.ts`

- [x] **Step 1: Write failing SQLite migration test**

Add to `tests/sqlite-database.test.ts`:

```ts
it('creates user-install usage and pending owner tables', () => {
    const db = createTestDatabase();
    runSqliteMigrations(db);

    const tables = db
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?)",
        )
        .all('user_budgets', 'user_daily_usage', 'user_usage_history', 'pending_user_install_owners')
        .map((row) => (row as { name: string }).name)
        .sort();

    expect(tables).toEqual([
        'pending_user_install_owners',
        'user_budgets',
        'user_daily_usage',
        'user_usage_history',
    ]);
});
```

- [x] **Step 2: Write failing pending owner repository test**

Create `tests/pending-user-install-owner-repository.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { closeSqliteDatabase } from '../src/persistence/sqlite-database.js';
import { PendingUserInstallOwnerRepository } from '../src/modules/dashboard/pending-user-install-owner-repository.js';

describe('PendingUserInstallOwnerRepository', () => {
    afterEach(() => {
        closeSqliteDatabase();
    });

    it('records first and last seen timestamps for unauthorized user-install owners', () => {
        const repository = new PendingUserInstallOwnerRepository();

        repository.recordSeen('user-1');
        repository.recordSeen('user-1');

        const owners = repository.list();
        expect(owners).toHaveLength(1);
        expect(owners[0]).toMatchObject({
            userId: 'user-1',
            source: 'user-install',
        });
        expect(Date.parse(owners[0]?.firstSeenAt ?? '')).not.toBeNaN();
        expect(Date.parse(owners[0]?.lastSeenAt ?? '')).not.toBeNaN();
    });
});
```

- [x] **Step 3: Run tests and verify red**

Run: `npm test -- tests/sqlite-database.test.ts tests/pending-user-install-owner-repository.test.ts`

Expected: FAIL because tables and repository do not exist.

- [x] **Step 4: Add SQLite migrations**

Modify `src/persistence/sqlite-database.ts` by adding migrations after existing guild usage/glossary migrations:

```ts
{
    id: 5,
    name: 'user_budgets_and_usage',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_budgets (
                user_id TEXT PRIMARY KEY,
                daily_budget_usd REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_daily_usage (
                user_id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                requests INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_usage_history (
                user_id TEXT NOT NULL,
                date TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                requests INTEGER NOT NULL,
                PRIMARY KEY (user_id, date)
            );

            CREATE INDEX IF NOT EXISTS idx_user_usage_history_lookup
                ON user_usage_history (user_id, date);
        `);
    },
},
{
    id: 6,
    name: 'pending_user_install_owners',
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS pending_user_install_owners (
                user_id TEXT PRIMARY KEY,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                source TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pending_user_install_owners_last_seen
                ON pending_user_install_owners (last_seen_at);
        `);
    },
},
```

Add these names to the table allowlist used by `isSqliteStoreEmpty`:

```ts
'user_budgets',
'user_daily_usage',
'user_usage_history',
'pending_user_install_owners',
```

- [x] **Step 5: Add user budget repository**

Create `src/modules/usage/user-budget-repository.ts`:

```ts
import { store } from '../../store.js';
import type { UserBudgetConfig } from '../../types.js';
import { cloneUserBudgets } from '../../repositories/store-data-normalizer.js';

export class UserBudgetRepository {
    getBudget(userId: string): UserBudgetConfig | null {
        return store.getUserBudget(userId);
    }

    setBudget(userId: string, dailyBudgetUsd: number): void {
        store.setUserBudget(userId, dailyBudgetUsd);
    }

    clearBudget(userId: string): boolean {
        return store.clearUserBudget(userId);
    }

    getAll(): Record<string, UserBudgetConfig> {
        return cloneUserBudgets(store.get('userBudgets'));
    }
}

export const userBudgetRepository = new UserBudgetRepository();
```

- [x] **Step 6: Add pending owner repository**

Create `src/modules/dashboard/pending-user-install-owner-repository.ts`:

```ts
import { getSqliteDatabase } from '../../persistence/sqlite-database.js';

export interface PendingUserInstallOwner {
    userId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    source: 'user-install';
}

export class PendingUserInstallOwnerRepository {
    recordSeen(userId: string): void {
        const now = new Date().toISOString();
        getSqliteDatabase()
            .prepare(
                `
                INSERT INTO pending_user_install_owners (
                    user_id,
                    first_seen_at,
                    last_seen_at,
                    source
                )
                VALUES (?, ?, ?, 'user-install')
                ON CONFLICT(user_id) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at
            `,
            )
            .run(userId, now, now);
    }

    list(): PendingUserInstallOwner[] {
        const rows = getSqliteDatabase()
            .prepare(
                `
                SELECT
                    user_id AS userId,
                    first_seen_at AS firstSeenAt,
                    last_seen_at AS lastSeenAt,
                    source
                FROM pending_user_install_owners
                ORDER BY last_seen_at DESC
            `,
            )
            .all() as unknown as PendingUserInstallOwner[];

        return rows.map((row) => ({ ...row, source: 'user-install' }));
    }

    clear(userId: string): boolean {
        const result = getSqliteDatabase()
            .prepare('DELETE FROM pending_user_install_owners WHERE user_id = ?')
            .run(userId);

        return result.changes > 0;
    }
}
```

- [x] **Step 7: Add store methods and usage repository user methods**

Modify `src/store.ts` with methods equivalent to the existing guild budget and guild usage methods:

```ts
getUserBudget(userId: string): UserBudgetConfig | null;
setUserBudget(userId: string, dailyBudgetUsd: number): void;
clearUserBudget(userId: string): boolean;
getUserDailyUsage(userId: string): TokenUsage | null;
saveUserDailyUsage(userId: string, usage: TokenUsage): void;
getUserUsageHistory(userId: string): UsageHistoryEntry[];
saveUserUsageHistory(userId: string, history: UsageHistoryEntry[]): void;
```

Modify `src/modules/usage/usage-repository.ts` so it exposes:

```ts
getUserDailyUsage(userId: string): TokenUsage | null;
saveUserDailyUsage(userId: string, usage: TokenUsage): void;
getAllUserDailyUsage(): Record<string, TokenUsage>;
getUserUsageHistory(userId: string): UsageHistoryEntry[];
saveUserUsageHistory(userId: string, history: UsageHistoryEntry[]): void;
```

- [x] **Step 8: Verify green**

Run: `npm test -- tests/sqlite-database.test.ts tests/pending-user-install-owner-repository.test.ts tests/store.test.ts`

Expected: PASS.

- [x] **Step 9: Commit**

Run:

```bash
git add src/persistence/sqlite-database.ts src/store.ts src/modules/usage/usage-repository.ts src/modules/usage/user-budget-repository.ts src/modules/dashboard/pending-user-install-owner-repository.ts tests/sqlite-database.test.ts tests/pending-user-install-owner-repository.test.ts tests/store.test.ts
git commit -m "feat: add user-install persistence"
```

---

### Task 4: Add Shared Usage Scope And Budget Enforcement

**Files:**
- Create: `src/modules/usage/usage-scope.ts`
- Create: `src/modules/usage/usage-cost.ts`
- Create: `src/modules/usage/budget-scope.ts`
- Modify: `src/modules/usage/usage.ts`
- Modify: `tests/usage.test.ts`

- [x] **Step 1: Write failing usage scope tests**

Add to `tests/usage.test.ts`:

```ts
it('records usage for global and user scopes', () => {
    usage.record(100, 50, { userId: 'user-1' });

    expect(usage.getStats().requests).toBe(1);
    expect(usage.getUserStats('user-1').requests).toBe(1);
});

it('uses user budget before default user budget', () => {
    configRepository.update({ defaultUserDailyBudgetUsd: 10 });
    userBudgetRepository.setBudget('user-1', 0.000001);

    usage.record(1000, 1000, { userId: 'user-1' });

    expect(usage.isBudgetExceeded({ userId: 'user-1' })).toBe(true);
});

it('keeps legacy guild string scope working', () => {
    usage.record(100, 50, 'guild-1');

    expect(usage.getGuildStats('guild-1').requests).toBe(1);
});
```

- [x] **Step 2: Run tests and verify red**

Run: `npm test -- tests/usage.test.ts`

Expected: FAIL because usage scope does not support user ids.

- [x] **Step 3: Add scope helper**

Create `src/modules/usage/usage-scope.ts`:

```ts
export interface UsageScope {
    guildId?: string | null;
    userId?: string | null;
}

export type LegacyUsageScope = UsageScope | string | null | undefined;

export function normalizeUsageScope(scope: LegacyUsageScope): UsageScope {
    if (typeof scope === 'string') {
        return { guildId: scope };
    }

    if (!scope) {
        return {};
    }

    return {
        guildId: scope.guildId ?? null,
        userId: scope.userId ?? null,
    };
}
```

- [x] **Step 4: Extract cost helpers**

Create `src/modules/usage/usage-cost.ts` with the existing cost formulas from `usage.ts`:

```ts
import type { RuntimeConfig } from '../config/config-repository.js';
import type { TokenUsage, UsageCost, UsageHistoryDay, UsageStats } from '../../types.js';

export function calculateCost(usage: TokenUsage, runtimeConfig: RuntimeConfig): UsageCost {
    const inputCost = (usage.inputTokens / 1_000_000) * (runtimeConfig.inputPricePerMillion || 0);
    const outputCost =
        (usage.outputTokens / 1_000_000) * (runtimeConfig.outputPricePerMillion || 0);

    return {
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
    };
}

export function withCost(
    usage: TokenUsage,
    inputPricePerMillion: number,
    outputPricePerMillion: number,
): UsageCost {
    const inputCost = (usage.inputTokens / 1_000_000) * inputPricePerMillion;
    const outputCost = (usage.outputTokens / 1_000_000) * outputPricePerMillion;

    return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

export function toUsageStats(cost: UsageCost, usage: TokenUsage, budget: number): UsageStats {
    return {
        ...usage,
        ...cost,
        totalTokens: usage.inputTokens + usage.outputTokens,
        budget,
        budgetExceeded: budget > 0 && cost.totalCost >= budget,
    };
}

export function toUsageHistoryDay(
    day: TokenUsage,
    runtimeConfig: RuntimeConfig,
): UsageHistoryDay {
    return {
        ...day,
        totalTokens: day.inputTokens + day.outputTokens,
        cost: calculateCost(day, runtimeConfig),
    };
}
```

If the current `UsageStats` shape differs, keep the existing field names and move the existing formulas exactly.

- [x] **Step 5: Add budget selection helper**

Create `src/modules/usage/budget-scope.ts`:

```ts
import type { RuntimeConfig } from '../config/config-repository.js';
import { guildBudgetRepository } from './guild-budget-repository.js';
import { userBudgetRepository } from './user-budget-repository.js';
import type { UsageScope } from './usage-scope.js';

export type BudgetScopeKind = 'global' | 'guild' | 'user';

export interface BudgetScopeDecision {
    kind: BudgetScopeKind;
    budget: number;
    guildId?: string;
    userId?: string;
}

export function resolveBudgetScope(
    scope: UsageScope,
    runtimeConfig: RuntimeConfig,
): BudgetScopeDecision {
    if (scope.userId) {
        const userBudget = userBudgetRepository.getBudget(scope.userId);

        return {
            kind: 'user',
            userId: scope.userId,
            budget: userBudget?.dailyBudgetUsd ?? runtimeConfig.defaultUserDailyBudgetUsd ?? 0,
        };
    }

    if (scope.guildId) {
        const guildBudget = guildBudgetRepository.getBudget(scope.guildId);
        if (guildBudget) {
            return {
                kind: 'guild',
                guildId: scope.guildId,
                budget: guildBudget.dailyBudgetUsd,
            };
        }
    }

    return {
        kind: 'global',
        budget: runtimeConfig.dailyBudgetUsd || 0,
    };
}
```

- [x] **Step 6: Update usage tracker**

Modify `src/modules/usage/usage.ts`:

- `record(inputTokens, outputTokens, scopeInput?: LegacyUsageScope)` records global usage plus guild and/or user usage.
- `isBudgetExceeded(scopeInput?: LegacyUsageScope)` uses `resolveBudgetScope`.
- `wouldExceedBudget({ estimatedInputTokens, estimatedOutputTokens, guildId, userId })` uses `resolveBudgetScope`.
- Add `getUserCost(userId)` and `getUserStats(userId)`.
- Add `getUserHistory(userId)`.
- `ensureToday()` rolls over user daily usage into user history.

Use this signature:

```ts
record(inputTokens: number, outputTokens: number, scopeInput?: LegacyUsageScope): void
```

Keep legacy guild string support through `normalizeUsageScope`.

- [x] **Step 7: Verify green**

Run: `npm test -- tests/usage.test.ts`

Expected: PASS.

- [x] **Step 8: Commit**

Run:

```bash
git add src/modules/usage/usage-scope.ts src/modules/usage/usage-cost.ts src/modules/usage/budget-scope.ts src/modules/usage/usage.ts tests/usage.test.ts
git commit -m "feat: support user usage budgets"
```

---

### Task 5: Add Translation Access Policy And Pocket Authorization

**Files:**
- Create: `src/modules/translation/access-policy.ts`
- Create: `src/modules/translation/translation-scope.ts`
- Create: `src/modules/translation/target-language.ts`
- Modify: `src/modules/translation/translation-service.ts`
- Modify: `src/shared/messages/discord-messages.ts`
- Modify: `tests/translation-service.test.ts`

- [x] **Step 1: Write failing translation service tests**

Add Pocket tests from the Pocket repository into `tests/translation-service.test.ts`:

```ts
it('allows whitelisted user-install owners without a guild id', async () => {
    const { service, usageTracker } = createService({
        storeOverrides: {
            allowedGuildIds: [],
            allowedUserIds: ['user-owner'],
            userLanguagePrefs: { 'user-owner': 'ja' },
        },
        accessMode: 'user-install',
    });

    const result = await service.process({
        command: 'babel',
        commandLabel: 'Babel Pocket (context menu)',
        guildId: null,
        userId: 'user-owner',
        billingUserId: 'user-owner',
        userTag: 'owner#0001',
        locale: 'en-US',
        text: 'Hello',
    });

    expect(result.status).toBe('success');
    expect(usageTracker.record).toHaveBeenCalledWith(12, 6, {
        guildId: null,
        userId: 'user-owner',
    });
});

it('records unauthorized user-install owners as pending access users', async () => {
    const pendingUserInstallOwnerRepository = {
        recordSeen: vi.fn(),
    };
    const { service } = createService({
        storeOverrides: {
            allowedGuildIds: [],
            allowedUserIds: ['user-allowed'],
        },
        accessMode: 'user-install',
        pendingUserInstallOwnerRepository,
    });

    const result = await service.process({
        command: 'babel',
        commandLabel: 'Babel Pocket (context menu)',
        guildId: null,
        userId: 'interaction-user',
        billingUserId: 'install-owner',
        userTag: 'actor#0001',
        locale: 'en-US',
        text: 'Hello',
    });

    expect(result).toEqual({
        status: 'blocked',
        message: 'This user is not authorized.',
    });
    expect(pendingUserInstallOwnerRepository.recordSeen).toHaveBeenCalledWith('install-owner');
});
```

Update `createService` test helper to accept:

```ts
accessMode?: AccessMode;
pendingUserInstallOwnerRepository?: { recordSeen: ReturnType<typeof vi.fn> };
```

- [x] **Step 2: Run tests and verify red**

Run: `npm test -- tests/translation-service.test.ts`

Expected: FAIL because translation service has no user-install access mode.

- [x] **Step 3: Add unauthorized user message**

Modify `src/shared/messages/discord-messages.ts`:

```ts
unauthorizedUser: () => 'This user is not authorized.',
```

- [x] **Step 4: Add translation scope helper**

Create `src/modules/translation/translation-scope.ts`:

```ts
import type { TranslationScope } from '../../types.js';

export function createTranslationScope(input: {
    guildId?: string | null;
    userId: string;
    billingUserId?: string | null;
}): TranslationScope {
    return {
        guildId: input.guildId ?? null,
        actorUserId: input.userId,
        billingUserId: input.billingUserId ?? null,
    };
}

export function getBillingUsageUserId(scope: TranslationScope): string | null {
    return scope.billingUserId ?? null;
}

export function getRuntimeLimiterUserId(scope: TranslationScope): string {
    return scope.billingUserId ?? scope.actorUserId;
}
```

- [x] **Step 5: Add access policy**

Create `src/modules/translation/access-policy.ts`:

```ts
import type { AccessMode } from '../../apps/app-profile.js';
import type { RuntimeConfig } from '../config/config-repository.js';
import type { TranslationScope } from '../../types.js';

export interface AccessDecision {
    authorized: boolean;
    blockReason?: 'guild_not_allowed' | 'user_not_allowed';
    pendingUserId?: string;
}

export function decideTranslationAccess(
    accessMode: AccessMode,
    runtimeConfig: RuntimeConfig,
    scope: TranslationScope,
): AccessDecision {
    if (accessMode === 'user-install') {
        const billingUserId = scope.billingUserId ?? scope.actorUserId;
        const authorized = runtimeConfig.allowedUserIds.includes(billingUserId);

        return authorized
            ? { authorized: true }
            : {
                  authorized: false,
                  blockReason: 'user_not_allowed',
                  pendingUserId: billingUserId,
              };
    }

    const guildId = scope.guildId;
    const authorized = !!guildId && runtimeConfig.allowedGuildIds.includes(guildId);

    return authorized
        ? { authorized: true }
        : {
              authorized: false,
              blockReason: 'guild_not_allowed',
          };
}
```

- [x] **Step 6: Extract target language helper**

Create `src/modules/translation/target-language.ts` by moving the existing target-language decision from `translation-service.ts` without changing behavior. The public function should be:

```ts
export interface TargetLanguageDecision {
    targetLang: string;
    targetSource: 'option' | 'setlang' | 'locale' | 'auto';
}

export function decideTargetLanguage(input: {
    requestedTargetLang?: string;
    userPreference?: string | null;
    locale?: string;
}): TargetLanguageDecision;
```

Use the same priority as the current service: command option, stored `/setlang`, locale, then auto.

- [x] **Step 7: Update translation service dependencies**

Modify `TranslationServiceDeps` in `src/modules/translation/translation-service.ts`:

```ts
accessMode?: AccessMode;
pendingUserInstallOwnerRepository?: { recordSeen(userId: string): void };
```

Default `accessMode` to `'guild'`. Use `decideTranslationAccess` after runtime config load. On user block, call `pendingUserInstallOwnerRepository.recordSeen(decision.pendingUserId)` and return `discordMessages.unauthorizedUser()`.

Pass usage scope to budget checks and recording:

```ts
const usageScope = {
    guildId: request.guildId ?? null,
    userId: request.billingUserId ?? null,
};
```

Use `getRuntimeLimiterUserId(scope)` for runtime limiter and provider logging user id.

- [x] **Step 8: Verify green**

Run: `npm test -- tests/translation-service.test.ts`

Expected: PASS.

- [x] **Step 9: Commit**

Run:

```bash
git add src/modules/translation/access-policy.ts src/modules/translation/translation-scope.ts src/modules/translation/target-language.ts src/modules/translation/translation-service.ts src/shared/messages/discord-messages.ts tests/translation-service.test.ts
git commit -m "feat: add user-install translation access"
```

---

### Task 6: Add Profile-Aware Command Handling And App Bootstrap

**Files:**
- Create: `src/apps/bootstrap.ts`
- Modify: `src/index.ts`
- Modify: `src/commands/babel.ts`
- Modify: `src/commands/help.ts`
- Modify: `tests/babel-command.test.ts`

- [x] **Step 1: Write failing Babel command test**

Add to `tests/babel-command.test.ts`:

```ts
it('passes user-install billing owner for Babel Pocket interactions', async () => {
    const translationService = {
        process: vi.fn(async () => ({
            status: 'success',
            message: 'translated',
        })),
    };
    const interaction = createMessageContextMenuInteraction({
        commandName: 'Babel Pocket',
        authorizingIntegrationOwners: { '1': 'install-owner' },
    });

    await handleBabel(interaction, {
        translationService,
        profile: BABEL_POCKET_PROFILE,
    });

    expect(translationService.process).toHaveBeenCalledWith(
        expect.objectContaining({
            commandLabel: 'Babel Pocket (context menu)',
            billingUserId: 'install-owner',
        }),
    );
});
```

Import `BABEL_POCKET_PROFILE` from `src/apps/app-profile.ts`. Extend the test interaction factory to include `authorizingIntegrationOwners`.

- [x] **Step 2: Run test and verify red**

Run: `npm test -- tests/babel-command.test.ts`

Expected: FAIL because `handleBabel` does not accept profiles or billing owner.

- [x] **Step 3: Update Babel command handler**

Modify `src/commands/babel.ts`:

```ts
import { BABEL_GUILD_PROFILE, type AppProfile } from '../apps/app-profile.js';

function getUserInstallOwnerId(interaction: MessageContextMenuCommandInteraction): string | null {
    return interaction.authorizingIntegrationOwners?.['1'] ?? null;
}
```

Extend deps:

```ts
interface BabelCommandDeps extends CommandDeps {
    profile?: AppProfile;
}
```

Use:

```ts
const profile = deps.profile ?? BABEL_GUILD_PROFILE;
const billingUserId =
    profile.accessMode === 'user-install'
        ? getUserInstallOwnerId(interaction) ?? interaction.user.id
        : null;
```

Pass `commandLabel: `${profile.commandName} (context menu)``, `billingUserId`, and existing fields to `translationService.process`.

- [x] **Step 4: Add shared bootstrap**

Create `src/apps/bootstrap.ts` by moving the body of `src/index.ts` into:

```ts
import type { AppProfile } from './app-profile.js';

export async function startBabelApp(profile: AppProfile): Promise<void> {
    // Move current src/index.ts startup code here.
    // Pass profile.accessMode into createTranslationService.
    // Construct webhookService only when profile.enableWebhookOutput is true.
    // Match message context menu command by profile.commandName.
    // Register /translate handler only when profile.enableTranslateCommand is true.
}
```

The moved code must preserve existing startup logging, health/dashboard startup, graceful shutdown, and Discord interaction handling.

- [x] **Step 5: Keep root index backward compatible**

Modify `src/index.ts`:

```ts
import { BABEL_GUILD_PROFILE } from './apps/app-profile.js';
import { startBabelApp } from './apps/bootstrap.js';

await startBabelApp(BABEL_GUILD_PROFILE);
```

- [x] **Step 6: Verify green**

Run:

```bash
npm test -- tests/babel-command.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 7: Commit**

Run:

```bash
git add src/apps/bootstrap.ts src/index.ts src/commands/babel.ts src/commands/help.ts tests/babel-command.test.ts
git commit -m "feat: add profile-aware app bootstrap"
```

---

### Task 7: Add Workspace Apps

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tsconfig.base.json`
- Modify: `tsconfig.json`
- Create: `apps/babel-guild/package.json`
- Create: `apps/babel-guild/tsconfig.json`
- Create: `apps/babel-guild/src/index.ts`
- Create: `apps/babel-guild/scripts/register.ts`
- Create: `apps/babel-pocket/package.json`
- Create: `apps/babel-pocket/tsconfig.json`
- Create: `apps/babel-pocket/src/index.ts`
- Create: `apps/babel-pocket/scripts/register.ts`

- [x] **Step 1: Update root workspace metadata**

Modify root `package.json`:

```json
{
  "name": "babel-discord-translator",
  "private": true,
  "workspaces": [
    "apps/*"
  ],
  "scripts": {
    "start": "npm run start -w @babel-discord-translator/guild",
    "dev": "npm run dev -w @babel-discord-translator/guild",
    "dev:guild": "npm run dev -w @babel-discord-translator/guild",
    "dev:pocket": "npm run dev -w @babel-discord-translator/pocket",
    "build": "npm run build:guild && npm run build:pocket",
    "build:guild": "npm run build -w @babel-discord-translator/guild",
    "build:pocket": "npm run build -w @babel-discord-translator/pocket",
    "typecheck": "tsc --noEmit",
    "register": "npm run register -w @babel-discord-translator/guild",
    "register:guild": "npm run register -w @babel-discord-translator/guild",
    "register:pocket": "npm run register -w @babel-discord-translator/pocket",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/ apps/ tests/",
    "format": "prettier --write .",
    "prepare": "node scripts/prepare-husky.js"
  }
}
```

Preserve existing dependencies, devDependencies, keywords, license, repository, engines, and lint-staged.

- [x] **Step 2: Add shared tsconfig**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

Modify root `tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "apps/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [x] **Step 3: Add Babel Guild app package**

Create `apps/babel-guild/package.json`:

```json
{
  "name": "@babel-discord-translator/guild",
  "version": "0.1.3",
  "description": "Babel Guild server-install Discord translator",
  "type": "module",
  "main": "../../dist/apps/babel-guild/src/index.js",
  "scripts": {
    "start": "node ../../dist/apps/babel-guild/src/index.js",
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json && rm -rf ../../dist/apps/babel-guild/src/locales ../../dist/apps/babel-guild/src/public && cp -r ../../src/locales ../../dist/apps/babel-guild/src/locales && cp -r ../../src/public ../../dist/apps/babel-guild/src/public",
    "register": "tsx scripts/register.ts"
  }
}
```

Create `apps/babel-guild/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../dist",
    "rootDir": "../.."
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "../../src/**/*.ts"],
  "exclude": ["../../node_modules", "../../dist"]
}
```

Create `apps/babel-guild/src/index.ts`:

```ts
import { BABEL_GUILD_PROFILE } from '../../../src/apps/app-profile.js';
import { startBabelApp } from '../../../src/apps/bootstrap.js';

await startBabelApp(BABEL_GUILD_PROFILE);
```

Create `apps/babel-guild/scripts/register.ts`:

```ts
import { registerCommandsForProfile } from '../../../src/apps/register.js';
import { BABEL_GUILD_PROFILE } from '../../../src/apps/app-profile.js';

await registerCommandsForProfile(BABEL_GUILD_PROFILE);
```

- [x] **Step 4: Add Babel Pocket app package**

Create `apps/babel-pocket/package.json`:

```json
{
  "name": "@babel-discord-translator/pocket",
  "version": "0.1.3",
  "description": "Babel Pocket user-install Discord translator",
  "type": "module",
  "main": "../../dist/apps/babel-pocket/src/index.js",
  "scripts": {
    "start": "node ../../dist/apps/babel-pocket/src/index.js",
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json && rm -rf ../../dist/apps/babel-pocket/src/locales ../../dist/apps/babel-pocket/src/public && cp -r ../../src/locales ../../dist/apps/babel-pocket/src/locales && cp -r ../../src/public ../../dist/apps/babel-pocket/src/public",
    "register": "tsx scripts/register.ts"
  }
}
```

Create `apps/babel-pocket/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../dist",
    "rootDir": "../.."
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "../../src/**/*.ts"],
  "exclude": ["../../node_modules", "../../dist"]
}
```

Create `apps/babel-pocket/src/index.ts`:

```ts
import { BABEL_POCKET_PROFILE } from '../../../src/apps/app-profile.js';
import { startBabelApp } from '../../../src/apps/bootstrap.js';

await startBabelApp(BABEL_POCKET_PROFILE);
```

Create `apps/babel-pocket/scripts/register.ts`:

```ts
import { registerCommandsForProfile } from '../../../src/apps/register.js';
import { BABEL_POCKET_PROFILE } from '../../../src/apps/app-profile.js';

await registerCommandsForProfile(BABEL_POCKET_PROFILE);
```

- [x] **Step 5: Extract register helper**

Create `src/apps/register.ts` from the logic in `scripts/register.ts`:

```ts
import type { AppProfile } from './app-profile.js';
import { getCommandsForProfile } from './commands.js';

export async function registerCommandsForProfile(profile: AppProfile): Promise<void> {
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;

    if (!appId || !botToken) {
        console.error(
            '❌ Missing env vars. Usage:\n' +
                '   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=xxx npm run register',
        );
        process.exit(1);
    }

    const response = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify(getCommandsForProfile(profile)),
    });

    if (response.ok) {
        const data = (await response.json()) as Array<{ name: string; id: string }>;
        console.log(`✅ Registered ${data.length} ${profile.productName} commands:`);
        data.forEach((cmd) => console.log(`   - "${cmd.name}" (ID: ${cmd.id})`));
        return;
    }

    const error = await response.text();
    console.error(`❌ Failed: ${response.status}`, error);
    process.exitCode = 1;
}
```

Modify root `scripts/register.ts` to call `registerCommandsForProfile(resolveAppProfile())`.

- [x] **Step 6: Install workspace lockfile updates**

Run: `npm install`

Expected: command exits 0 and updates `package-lock.json` with workspaces.

- [x] **Step 7: Verify workspace builds**

Run:

```bash
npm run typecheck
npm run build:guild
npm run build:pocket
```

Expected: all commands exit 0.

- [x] **Step 8: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json apps src/apps/register.ts scripts/register.ts
git commit -m "feat: add guild and pocket workspace apps"
```

---

### Task 8: Add Dashboard Capability Gate

**Files:**
- Create: `src/modules/dashboard/capabilities.ts`
- Modify: `src/modules/dashboard/dashboard.ts`
- Modify: `tests/dashboard.test.ts`

- [x] **Step 1: Write failing dashboard capability tests**

Add tests:

```ts
it('does not expose guild glossary routes for Babel Pocket', async () => {
    const app = createDashboardApp({
        ...createDashboardDeps(),
        profile: BABEL_POCKET_PROFILE,
    });

    const response = await request(app).get('/api/guilds/guild-1/glossary');

    expect(response.status).toBe(404);
});

it('does not expose pending user-install owners for Babel Guild', async () => {
    const app = createDashboardApp({
        ...createDashboardDeps(),
        profile: BABEL_GUILD_PROFILE,
    });

    const response = await request(app).get('/api/access/pending-users');

    expect(response.status).toBe(404);
});
```

- [x] **Step 2: Run tests and verify red**

Run: `npm test -- tests/dashboard.test.ts`

Expected: FAIL because dashboard does not accept app profile capability gates.

- [x] **Step 3: Add dashboard capabilities helper**

Create `src/modules/dashboard/capabilities.ts`:

```ts
import type { AppProfile } from '../../apps/app-profile.js';

export interface DashboardCapabilities {
    guildAccess: boolean;
    userAccess: boolean;
    guildGlossary: boolean;
    pendingUserInstallOwners: boolean;
}

export function getDashboardCapabilities(profile: AppProfile): DashboardCapabilities {
    return {
        guildAccess: profile.enableGuildAccess,
        userAccess: profile.enableUserAccess,
        guildGlossary: profile.enableGuildGlossary,
        pendingUserInstallOwners: profile.enableUserAccess,
    };
}
```

- [x] **Step 4: Gate dashboard routes**

Modify `createDashboardApp` deps to accept `profile?: AppProfile`, defaulting to `BABEL_GUILD_PROFILE`.

Wrap Guild-only routes:

```ts
if (capabilities.guildGlossary) {
    app.get('/api/guilds/:guildId/glossary', requireAuth, csrfProtection, handler);
    app.post('/api/guilds/:guildId/glossary', requireAuth, csrfProtection, handler);
    app.delete('/api/guilds/:guildId/glossary/:termId', requireAuth, csrfProtection, handler);
}
```

Wrap Pocket-only route group:

```ts
if (capabilities.pendingUserInstallOwners) {
    app.get('/api/access/pending-users', requireAuth, csrfProtection, handler);
    app.delete('/api/access/pending-users/:userId', requireAuth, csrfProtection, handler);
}
```

Keep shared routes unchanged.

- [x] **Step 5: Verify green**

Run: `npm test -- tests/dashboard.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

Run:

```bash
git add src/modules/dashboard/capabilities.ts src/modules/dashboard/dashboard.ts tests/dashboard.test.ts
git commit -m "feat: gate dashboard routes by app profile"
```

---

### Task 9: Documentation And Product Naming

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/docker.md`
- Modify: `docs/operations/railway.md`
- Modify: `.env.example`

- [x] **Step 1: Update README product framing**

Add this framing near the top of `README.md`:

```md
# babel-discord-translator

This repository contains two self-hosted Discord translation apps:

| App | Install Model | Best For | Command Surface |
|---|---|---|---|
| Babel Guild | Server/Guild Install | Communities and servers | `Babel`, `/translate`, `/setlang`, `/mylang`, `/help` |
| Babel Pocket | User Install | Individuals and trusted friends | `Babel Pocket`, `/setlang`, `/mylang`, `/help` |
```

Document commands:

```bash
npm run dev:guild
npm run dev:pocket
npm run register:guild
npm run register:pocket
```

- [x] **Step 2: Update environment example**

Add to `.env.example`:

```env
# Selects the default root app when using npm run dev/register.
# Use "guild" for Babel Guild or "pocket" for Babel Pocket.
BABEL_APP=guild
```

- [x] **Step 3: Update operations docs**

In deployment docs, add:

````md
## Choosing An App

Use Babel Guild for server/guild install deployments. Use Babel Pocket for User Install deployments.

For Guild:

```bash
npm run build:guild
npm run register:guild
npm run start -w @babel-discord-translator/guild
```

For Pocket:

```bash
npm run build:pocket
npm run register:pocket
npm run start -w @babel-discord-translator/pocket
```
````

- [x] **Step 4: Verify docs formatting**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both commands exit 0.

- [x] **Step 5: Commit**

Run:

```bash
git add README.md CHANGELOG.md docs/operations/deployment.md docs/operations/docker.md docs/operations/railway.md .env.example
git commit -m "docs: document babel guild and pocket apps"
```

---

### Task 10: Full Verification

**Files:**
- No planned edits.

- [x] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [x] **Step 4: Run both builds**

Run:

```bash
npm run build:guild
npm run build:pocket
```

Expected: both commands exit 0 and create `dist/apps/babel-guild` and `dist/apps/babel-pocket`.

- [x] **Step 5: Inspect final git status**

Run: `git status -sb`

Expected: clean working tree.

---

## Self-Review

### Spec Coverage

- Product names are covered by Tasks 1, 6, 7, and 9.
- Babel Guild command and runtime behavior are covered by Tasks 1, 6, 7, and 10.
- Babel Pocket user-install command registration is covered by Tasks 1 and 7.
- User allowlist, budgets, pending owners, and user usage are covered by Tasks 2 through 5.
- Shared scope/access/budget model is covered by Tasks 4 and 5.
- First large-file splits are covered by Tasks 4, 5, 6, and 8.
- Workspace app layout is covered by Task 7.
- Documentation is covered by Task 9.
- Full verification is covered by Task 10.

### Specificity Scan

This plan avoids vague implementation markers. Where existing code must be moved, the destination function signatures and required behavior are specified.

### Type Consistency

- App profile uses `AccessMode = 'guild' | 'user-install'`.
- Translation service receives `accessMode?: AccessMode`.
- Usage uses `UsageScope` with `{ guildId?: string | null; userId?: string | null }`.
- Translation request keeps existing `userId` and adds `billingUserId?: string | null`.
- Dashboard accepts `profile?: AppProfile` and derives capabilities through `getDashboardCapabilities`.
