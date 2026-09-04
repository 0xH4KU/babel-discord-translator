import { PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import type { AppProfile } from '../../apps/app-profile.js';
import { getCommandsForProfile } from '../../apps/commands.js';
import { DISCORD_API_TIMEOUT_MS, resolveRegistrationEnv } from '../../apps/register.js';
import { checkOpenAiHealth, type OpenAiHealthStatus } from '../../infra/openai-client.js';
import { checkVertexAiHealth, type VertexAiHealthStatus } from '../../infra/vertex-ai-client.js';
import { getSqliteDatabase, inTransaction } from '../../persistence/sqlite-database.js';
import { store, type ConfigStore } from '../../persistence/store.js';
import { configRepository, type ConfigRepository } from '../config/config-repository.js';
import { getReadinessStatus } from '../../shared/health.js';
import type { StoreData } from '../../shared/types.js';
import { providerModeIncludes } from './operations-summary.js';

export type SetupDoctorStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface SetupDoctorCheck {
    id: string;
    title: string;
    status: SetupDoctorStatus;
    detail: string;
    action?: string;
    error?: string;
    latencyMs?: number;
}

export interface SetupDoctorReport {
    ok: boolean;
    timestamp: string;
    checks: SetupDoctorCheck[];
}

type SetupDoctorConfigStore = Pick<
    ConfigRepository,
    'getDashboardConfig' | 'getRuntimeConfig' | 'isSetupComplete'
> &
    Partial<SetupDoctorBudgetStore>;

type SetupDoctorBudgetStore = Pick<ConfigStore, 'listGuildBudgets' | 'listUserBudgets'>;

export interface SetupDoctorDeps {
    profile: AppProfile;
    profiles?: AppProfile[];
    client: Client;
    configStore?: SetupDoctorConfigStore;
    budgetStore?: SetupDoctorBudgetStore;
    healthCheck?: () => Promise<VertexAiHealthStatus>;
    openAiHealthCheck?: () => Promise<OpenAiHealthStatus>;
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    sqliteProbe?: () => void | Promise<void>;
    requireProfileSpecificRegistrationEnv?: boolean;
}

const SQLITE_PROBE_KEY = '__setup_doctor_probe__';
const CHECK_TITLES: Record<string, string> = {
    discord: 'Discord',
    commands: 'Discord commands',
    'provider-vertex': 'Vertex AI provider',
    'provider-openai': 'OpenAI provider',
    'lens-fallback': 'Babel Lens fallback',
    sqlite: 'SQLite',
    budget: 'Budget',
    webhook: 'Webhook',
};

function lensFallbackCheck(configStore: SetupDoctorConfigStore): SetupDoctorCheckDraft {
    try {
        const config = configStore.getDashboardConfig();
        const needsVision =
            (providerModeIncludes(config.translationProvider, 'vertex') &&
                !config.vertexAiSupportsImages) ||
            (providerModeIncludes(config.translationProvider, 'openai') &&
                !config.openaiSupportsImages);

        if (!needsVision) {
            return {
                id: 'lens-fallback',
                status: 'skipped',
                detail: 'All enabled providers use direct image translation',
            };
        }

        if (!config.visionApiKey.trim() || config.visionMonthlyImageLimit <= 0) {
            return {
                id: 'lens-fallback',
                status: 'warn',
                detail: 'A text-only provider needs Cloud Vision, but fallback is not configured',
                action: 'Configure a Vision key and limit, or confirm image support in Settings.',
            };
        }

        return {
            id: 'lens-fallback',
            status: 'pass',
            detail: 'Cloud Vision fallback is configured for text-only providers',
        };
    } catch (error) {
        return {
            id: 'lens-fallback',
            status: 'warn',
            detail: 'Babel Lens fallback configuration could not be checked',
            error: errorMessage(error),
        };
    }
}

type SetupDoctorCheckDraft = Omit<SetupDoctorCheck, 'title'> & { title?: string };

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function withTitle(check: SetupDoctorCheckDraft): SetupDoctorCheck {
    return { title: CHECK_TITLES[check.id] ?? check.id, ...check };
}

function hasSameNumbers(actual: unknown, expected?: number[]): boolean {
    return (
        expected === undefined ||
        (Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every((value) => actual.includes(value)))
    );
}

export function runSqliteWriteProbe(): void {
    const db = getSqliteDatabase();
    inTransaction(db, () => {
        db.prepare(
            `
            INSERT OR REPLACE INTO app_config (key, value_json)
            VALUES (?, ?)
        `,
        ).run(SQLITE_PROBE_KEY, 'true');
        db.prepare('DELETE FROM app_config WHERE key = ?').run(SQLITE_PROBE_KEY);
    });
}

function discordCheck(client: Client): SetupDoctorCheckDraft {
    try {
        if (!client.user) {
            return {
                id: 'discord',
                status: 'fail',
                detail: 'Discord client is not logged in',
                action: 'Start the bot with a valid Discord token.',
            };
        }

        return {
            id: 'discord',
            status: 'pass',
            detail: `Logged in as ${client.user.tag ?? client.user.id}`,
        };
    } catch (error) {
        return {
            id: 'discord',
            status: 'fail',
            detail: 'Discord client check failed',
            error: errorMessage(error),
        };
    }
}

async function commandsCheck({
    profile,
    profiles,
    env,
    fetchFn,
    requireProfileSpecificRegistrationEnv,
}: Pick<
    SetupDoctorDeps,
    'profile' | 'profiles' | 'env' | 'fetchFn' | 'requireProfileSpecificRegistrationEnv'
>): Promise<SetupDoctorCheckDraft> {
    const registerCommand =
        profile.id === 'babel-pocket' ? 'npm run register:pocket' : 'npm run register:guild';
    try {
        const { appId, botToken } = resolveRegistrationEnv(profile, env, {
            requireProfileSpecificEnv:
                requireProfileSpecificRegistrationEnv ?? (profiles ?? [profile]).length > 1,
        });

        if (!appId || !botToken) {
            return {
                id: 'commands',
                status: 'skipped',
                detail: 'Discord registration credentials are missing',
                action: `Set Discord registration env vars, then run ${registerCommand}.`,
            };
        }

        const response = await (fetchFn ?? fetch)(
            `https://discord.com/api/v10/applications/${appId}/commands`,
            {
                headers: { Authorization: `Bot ${botToken}` },
                signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS),
            },
        );

        if (!response.ok) {
            return {
                id: 'commands',
                status: 'fail',
                detail: `Discord command lookup failed with HTTP ${response.status}`,
                error: await response.text(),
                action: `Run ${registerCommand} after fixing Discord API access.`,
            };
        }

        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) {
            return {
                id: 'commands',
                status: 'fail',
                detail: 'Discord command lookup returned an unexpected response',
                action: `Run ${registerCommand} to refresh Discord commands.`,
            };
        }

        const registeredCommands = new Map(
            body
                .filter(
                    (command): command is Record<string, unknown> =>
                        typeof command === 'object' &&
                        command !== null &&
                        'name' in command &&
                        typeof command.name === 'string',
                )
                .map((command) => [command.name as string, command]),
        );
        const expectedCommands = getCommandsForProfile(profile);
        const missingNames = expectedCommands
            .map(({ name }) => name)
            .filter((name) => !registeredCommands.has(name));

        if (missingNames.length > 0) {
            return {
                id: 'commands',
                status: 'fail',
                detail: `Missing registered Discord commands: ${missingNames.join(', ')}`,
                action: `Run ${registerCommand} to refresh Discord commands.`,
            };
        }

        const mismatchedNames = expectedCommands
            .filter((expected) => {
                const actual = registeredCommands.get(expected.name)!;
                return (
                    actual.type !== expected.type ||
                    !hasSameNumbers(actual.integration_types, expected.integration_types) ||
                    !hasSameNumbers(actual.contexts, expected.contexts)
                );
            })
            .map(({ name }) => name);

        if (mismatchedNames.length > 0) {
            return {
                id: 'commands',
                status: 'fail',
                detail: `Outdated registered Discord commands: ${mismatchedNames.join(', ')}`,
                action: `Run ${registerCommand} to refresh Discord commands.`,
            };
        }

        return {
            id: 'commands',
            status: 'pass',
            detail: 'Discord commands are registered',
        };
    } catch (error) {
        return {
            id: 'commands',
            status: 'fail',
            detail: 'Discord command check failed',
            error: errorMessage(error),
            action: `Run ${registerCommand} after fixing the command check error.`,
        };
    }
}

function providerCheck(
    id: string,
    providerName: string,
    check: { status: 'pass' | 'fail' | 'skip'; detail: string; error?: string; latencyMs?: number },
): SetupDoctorCheckDraft {
    return {
        id,
        status: check.status === 'skip' ? 'skipped' : check.status,
        detail: check.detail || `${providerName} provider check completed`,
        error: check.error,
        latencyMs: check.latencyMs,
    };
}

async function providerChecks(
    configStore: SetupDoctorConfigStore,
    healthCheck: () => Promise<VertexAiHealthStatus>,
    openAiHealthCheck: () => Promise<OpenAiHealthStatus>,
): Promise<SetupDoctorCheckDraft[]> {
    try {
        const readiness = await getReadinessStatus({
            configStore,
            healthCheck,
            openAiHealthCheck,
            probeProviders: true,
        });
        if (readiness.checks.configuration.status === 'fail') {
            const { detail, error } = readiness.checks.configuration;
            return [
                {
                    id: 'provider-vertex',
                    status: 'fail',
                    detail,
                    error,
                },
                {
                    id: 'provider-openai',
                    status: 'fail',
                    detail,
                    error,
                },
            ];
        }

        return [
            providerCheck('provider-vertex', 'Vertex AI', readiness.checks.vertexAi),
            providerCheck('provider-openai', 'OpenAI', readiness.checks.openAi),
        ];
    } catch (error) {
        return [
            {
                id: 'provider-vertex',
                status: 'fail',
                detail: 'Provider readiness check failed',
                error: errorMessage(error),
            },
            {
                id: 'provider-openai',
                status: 'fail',
                detail: 'Provider readiness check failed',
                error: errorMessage(error),
            },
        ];
    }
}

async function sqliteCheck(
    sqliteProbe: () => void | Promise<void>,
): Promise<SetupDoctorCheckDraft> {
    try {
        await sqliteProbe();
        return {
            id: 'sqlite',
            status: 'pass',
            detail: 'SQLite write probe succeeded',
        };
    } catch (error) {
        return {
            id: 'sqlite',
            status: 'fail',
            detail: 'SQLite write probe failed',
            error: errorMessage(error),
            action: 'Check database path and filesystem write permissions.',
        };
    }
}

function budgetCheck(
    configStore: SetupDoctorConfigStore,
    budgetStore: SetupDoctorBudgetStore,
): SetupDoctorCheckDraft {
    try {
        const config = configStore.getDashboardConfig();
        const values = [
            ['input price', config.inputPricePerMillion],
            ['output price', config.outputPricePerMillion],
            ['monthly budget', config.monthlyBudgetUsd],
            ['default user monthly budget', config.defaultUserMonthlyBudgetUsd],
            ...budgetEntries('guild', budgetStore.listGuildBudgets()),
            ...budgetEntries('user', budgetStore.listUserBudgets()),
        ] as const;
        const invalid = values.filter(([, value]) => !Number.isFinite(value) || value < 0);

        if (invalid.length > 0) {
            return {
                id: 'budget',
                status: 'fail',
                detail: `Negative or invalid price/budget values: ${invalid.map(([name]) => name).join(', ')}`,
                action: 'Set price and budget values to 0 or higher.',
            };
        }

        const zeroBudgets = values.filter(
            ([name, value]) => name.includes('budget') && value === 0,
        );
        if (zeroBudgets.length > 0) {
            return {
                id: 'budget',
                status: 'warn',
                detail: `Unlimited budget values: ${zeroBudgets.map(([name]) => name).join(', ')}`,
            };
        }

        return {
            id: 'budget',
            status: 'pass',
            detail: 'Price and budget values are valid',
        };
    } catch (error) {
        return {
            id: 'budget',
            status: 'fail',
            detail: 'Budget configuration check failed',
            error: errorMessage(error),
        };
    }
}

function budgetEntries(
    scope: 'guild' | 'user',
    budgets: StoreData['guildBudgets'] | StoreData['userBudgets'],
): Array<[string, number]> {
    return Object.entries(budgets).map(([id, budget]) => [
        `${scope} ${id} monthly budget`,
        budget.monthlyBudgetUsd,
    ]);
}

function webhookCheck(profile: AppProfile, client: Client): SetupDoctorCheckDraft {
    if (profile.id !== 'babel-guild') {
        return {
            id: 'webhook',
            status: 'skipped',
            detail: 'Webhook permission check is only needed for Babel Guild',
        };
    }

    try {
        const guilds = Array.from(client.guilds.cache.values());
        if (guilds.length === 0) {
            return {
                id: 'webhook',
                status: 'skipped',
                detail: 'No guilds are cached for webhook permission inspection',
            };
        }

        if (!client.user) {
            return {
                id: 'webhook',
                status: 'skipped',
                detail: 'Discord client user is unavailable for webhook permission inspection',
            };
        }

        const result = inspectWebhookChannelPermissions(guilds, client.user.id);
        if (!result) {
            return {
                id: 'webhook',
                status: 'skipped',
                detail: 'No cached guild channel permissions are available for webhook inspection',
            };
        }

        if (result.denied.length > 0) {
            const examples = result.denied.slice(0, 5).join(', ');
            return {
                id: 'webhook',
                status: 'fail',
                detail: `Missing Manage Webhooks permission in ${result.denied.length} of ${result.checked} inspected channels: ${examples}${result.denied.length > 5 ? ', ...' : ''}`,
                action: 'Grant the bot Manage Webhooks permission in every translated channel.',
            };
        }

        return {
            id: 'webhook',
            status: 'pass',
            detail: `Manage Webhooks permission is available in all ${result.checked} inspected channels`,
        };
    } catch (error) {
        return {
            id: 'webhook',
            status: 'fail',
            detail: 'Webhook permission check failed',
            error: errorMessage(error),
        };
    }
}

function inspectWebhookChannelPermissions(
    guilds: Guild[],
    userId: string,
): { checked: number; denied: string[] } | null {
    let checked = 0;
    const denied: string[] = [];

    for (const guild of guilds) {
        for (const channel of guild.channels.cache.values()) {
            const permissions = channel.permissionsFor(userId);
            if (!permissions) {
                continue;
            }

            checked++;
            if (!permissions.has(PermissionFlagsBits.ManageWebhooks)) {
                denied.push(`${guild.name} / ${channel.name}`);
            }
        }
    }

    return checked > 0 ? { checked, denied } : null;
}

export async function runSetupDoctor({
    profile,
    profiles = [profile],
    client,
    configStore = configRepository,
    budgetStore,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    env = process.env,
    fetchFn = fetch,
    sqliteProbe = runSqliteWriteProbe,
    requireProfileSpecificRegistrationEnv,
}: SetupDoctorDeps): Promise<SetupDoctorReport> {
    const resolvedBudgetStore = budgetStore ?? {
        listGuildBudgets: () => configStore.listGuildBudgets?.() ?? store.listGuildBudgets(),
        listUserBudgets: () => configStore.listUserBudgets?.() ?? store.listUserBudgets(),
    };
    const checks: SetupDoctorCheckDraft[] = [
        discordCheck(client),
        await commandsCheck({
            profile,
            profiles,
            env,
            fetchFn,
            requireProfileSpecificRegistrationEnv,
        }),
        ...(await providerChecks(configStore, healthCheck, openAiHealthCheck)),
        lensFallbackCheck(configStore),
        await sqliteCheck(sqliteProbe),
        budgetCheck(configStore, resolvedBudgetStore),
        webhookCheck(profile, client),
    ];

    return {
        ok: checks.every((check) => check.status !== 'fail'),
        timestamp: new Date().toISOString(),
        checks: checks.map(withTitle),
    };
}
