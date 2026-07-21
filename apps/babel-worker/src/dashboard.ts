import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../../../src/apps/app-profile.js';
import { getCommandsForProfile } from '../../../src/apps/commands.js';
import { buildDashboardCapabilitiesResponse } from '../../../src/modules/dashboard/capabilities.js';
import { validateConfigUpdate } from '../../../src/modules/dashboard/config-validation.js';
import {
    parseGlossaryImport,
    sanitizeGlossaryImportRequest,
    sanitizeGlossaryInput,
} from '../../../src/modules/dashboard/glossary-input.js';
import { normalizeStoreData } from '../../../src/persistence/store-data-normalizer.js';
import { DEFAULT_STORE_DATA } from '../../../src/persistence/store-defaults.js';
import { getVersionMetadata } from '../../../src/shared/version.js';
import type { AppProfile } from '../../../src/apps/app-profile.js';
import type { StoreData } from '../../../src/shared/types.js';
import type { D1PreparedStatement, WorkerEnv } from './index.js';

interface ConfigRow {
    key: string;
    value: string;
}

interface SessionRow {
    token: string;
    expiry: number;
    csrf: string;
}

interface UsageRow {
    date: string;
    input_tokens: number;
    output_tokens: number;
    requests: number;
}

interface GuildRow {
    id: string;
    name: string;
    icon?: string | null;
    approximate_member_count?: number;
}

interface DiscordMe {
    id: string;
    username: string;
    global_name?: string | null;
    discriminator?: string;
    avatar?: string | null;
}

interface DashboardOptions {
    translate(
        text: string,
        targetLanguage: string,
        env: WorkerEnv,
    ): Promise<{
        text: string;
        inputTokens: number;
        outputTokens: number;
        provider: string;
        cached?: boolean;
        fallback?: boolean;
    }>;
    resetProviderState(): void;
    providerHealth(
        env: WorkerEnv,
    ): Promise<
        Record<
            'vertexAi' | 'openAi',
            { status: 'pass' | 'fail' | 'skip'; latencyMs?: number; error?: string }
        >
    >;
}

interface RuntimeMetricRow {
    translations_total: number;
    api_calls_total: number;
    cache_hits_total: number;
    cache_misses_total: number;
    failures_total: number;
    budget_exceeded_total: number;
    rejected_total: number;
    provider_fallback_total: number;
    vertex_success_total: number;
    vertex_failure_total: number;
    vertex_fallback_from_total: number;
    vertex_fallback_to_total: number;
    openai_success_total: number;
    openai_failure_total: number;
    openai_fallback_from_total: number;
    openai_fallback_to_total: number;
}

const SESSION_TTL_MS = 86_400_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_ATTEMPT_LIMIT = 5;
const DISCORD_API = 'https://discord.com/api/v10';
const RUNTIME_CONFIG_CACHE_MS = 5_000;
const REQUIRED_D1_TABLES = [
    'user_language_preferences',
    'guild_budgets',
    'user_budgets',
    'daily_usage',
    'guild_daily_usage',
    'user_daily_usage',
    'guild_glossary',
    'usage_history',
    'guild_usage_history',
    'user_usage_history',
    'app_config',
    'sessions',
    'dashboard_login_attempts',
    'worker_logs',
    'translation_cache',
    'cooldowns',
    'pending_user_install_owners',
    'runtime_metrics',
    'runtime_leases',
    'budget_reservations',
] as const;
const discordCache = new Map<
    string,
    { expires: number; me: DiscordMe | null; guilds: GuildRow[] }
>();
const discordUserCache = new Map<string, { expires: number; user: DiscordMe }>();
// ponytail: isolate-local cache; use versioned KV invalidation only if 5s cross-isolate staleness matters.
const runtimeConfigCache = new WeakMap<
    WorkerEnv['DB'],
    Map<string, { expires: number; config: StoreData }>
>();

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
    return Response.json(data, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Security-Policy':
                "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self'; script-src 'self'; connect-src 'self'",
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            ...extraHeaders,
        },
    });
}

function splitIds(value: string | undefined): string[] {
    return [
        ...new Set(
            (value ?? '')
                .split(',')
                .map((id) => id.trim())
                .filter(Boolean),
        ),
    ];
}

export async function databaseReady(env: WorkerEnv): Promise<boolean> {
    try {
        const placeholders = REQUIRED_D1_TABLES.map(() => '?').join(', ');
        const row = await env.DB.prepare(
            `SELECT COUNT(*) AS table_count FROM sqlite_master
             WHERE type = 'table' AND name IN (${placeholders})`,
        )
            .bind(...REQUIRED_D1_TABLES)
            .first<{ table_count: number }>();
        return row?.table_count === REQUIRED_D1_TABLES.length;
    } catch {
        return false;
    }
}

async function storedConfig(env: WorkerEnv): Promise<Partial<StoreData>> {
    try {
        const { results } = await env.DB.prepare(
            'SELECT key, value FROM app_config',
        ).all<ConfigRow>();
        return Object.fromEntries(
            results.flatMap((row) => {
                try {
                    return [[row.key, JSON.parse(row.value)]];
                } catch {
                    return [];
                }
            }),
        ) as Partial<StoreData>;
    } catch {
        return {};
    }
}

export async function getRuntimeConfig(env: WorkerEnv): Promise<StoreData> {
    const cacheKey = env.BABEL_APP ?? 'guild';
    const cached = runtimeConfigCache.get(env.DB)?.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.config;
    const profile =
        env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
            ? BABEL_POCKET_PROFILE
            : BABEL_GUILD_PROFILE;
    const providerReady = (env.TRANSLATION_PROVIDER ?? 'vertex')
        .split('+')
        .some((provider) =>
            provider === 'openai'
                ? !!(env.OPENAI_API_KEY && env.OPENAI_BASE_URL && env.OPENAI_MODEL)
                : !!(env.VERTEX_AI_API_KEY && env.GCP_PROJECT),
        );
    const accessReady =
        profile.accessMode === 'user-install'
            ? splitIds(env.ALLOWED_USER_IDS).length > 0
            : splitIds(env.ALLOWED_GUILD_IDS).length > 0;
    const defaults: Partial<StoreData> = {
        ...DEFAULT_STORE_DATA,
        vertexAiApiKey: env.VERTEX_AI_API_KEY ?? '',
        gcpProject: env.GCP_PROJECT ?? '',
        gcpLocation: env.GCP_LOCATION ?? DEFAULT_STORE_DATA.gcpLocation,
        geminiModel: env.GEMINI_MODEL ?? DEFAULT_STORE_DATA.geminiModel,
        openaiApiKey: env.OPENAI_API_KEY ?? '',
        openaiBaseUrl: env.OPENAI_BASE_URL ?? '',
        openaiModel: env.OPENAI_MODEL ?? '',
        translationProvider: env.TRANSLATION_PROVIDER ?? DEFAULT_STORE_DATA.translationProvider,
        translationPrompt: env.TRANSLATION_PROMPT ?? '',
        maxInputLength: positiveInteger(env.MAX_INPUT_LENGTH, DEFAULT_STORE_DATA.maxInputLength),
        maxOutputTokens: positiveInteger(env.MAX_OUTPUT_TOKENS, DEFAULT_STORE_DATA.maxOutputTokens),
        cooldownSeconds: positiveInteger(env.COOLDOWN_SECONDS, DEFAULT_STORE_DATA.cooldownSeconds),
        cacheMaxSize: positiveInteger(env.CACHE_MAX_SIZE, DEFAULT_STORE_DATA.cacheMaxSize),
        translationMaxConcurrent: positiveInteger(
            env.TRANSLATION_MAX_CONCURRENT,
            DEFAULT_STORE_DATA.translationMaxConcurrent,
        ),
        translationMaxGlobalQueue: positiveInteger(
            env.TRANSLATION_MAX_GLOBAL_QUEUE,
            DEFAULT_STORE_DATA.translationMaxGlobalQueue,
        ),
        translationMaxGuildQueue: positiveInteger(
            env.TRANSLATION_MAX_GUILD_QUEUE,
            DEFAULT_STORE_DATA.translationMaxGuildQueue,
        ),
        translationMaxUserOutstanding: positiveInteger(
            env.TRANSLATION_MAX_USER_OUTSTANDING,
            DEFAULT_STORE_DATA.translationMaxUserOutstanding,
        ),
        translationMaxQueueWaitMs: positiveInteger(
            env.TRANSLATION_MAX_QUEUE_WAIT_MS,
            DEFAULT_STORE_DATA.translationMaxQueueWaitMs,
        ),
        allowedGuildIds: splitIds(env.ALLOWED_GUILD_IDS),
        allowedUserIds: splitIds(env.ALLOWED_USER_IDS),
        inputPricePerMillion: nonNegative(env.INPUT_PRICE_PER_MILLION),
        outputPricePerMillion: nonNegative(env.OUTPUT_PRICE_PER_MILLION),
        dailyBudgetUsd: nonNegative(env.DAILY_BUDGET_USD),
        defaultUserDailyBudgetUsd: nonNegative(env.DEFAULT_USER_DAILY_BUDGET_USD),
        setupComplete: providerReady && accessReady,
    };
    const config = normalizeStoreData({ ...defaults, ...(await storedConfig(env)) });
    let cache = runtimeConfigCache.get(env.DB);
    if (!cache) {
        cache = new Map();
        runtimeConfigCache.set(env.DB, cache);
    }
    cache.set(cacheKey, { expires: Date.now() + RUNTIME_CONFIG_CACHE_MS, config });
    return config;
}

export async function configuredEnv(env: WorkerEnv): Promise<WorkerEnv> {
    const config = await getRuntimeConfig(env);
    return {
        ...env,
        VERTEX_AI_API_KEY: config.vertexAiApiKey,
        GCP_PROJECT: config.gcpProject,
        GCP_LOCATION: config.gcpLocation,
        GEMINI_MODEL: config.geminiModel,
        OPENAI_API_KEY: config.openaiApiKey,
        OPENAI_BASE_URL: config.openaiBaseUrl,
        OPENAI_MODEL: config.openaiModel,
        TRANSLATION_PROVIDER: config.translationProvider,
        TRANSLATION_PROMPT: config.translationPrompt,
        MAX_INPUT_LENGTH: String(config.maxInputLength),
        MAX_OUTPUT_TOKENS: String(config.maxOutputTokens),
        COOLDOWN_SECONDS: String(config.cooldownSeconds),
        CACHE_MAX_SIZE: String(config.cacheMaxSize),
        SETUP_COMPLETE: String(config.setupComplete),
        TRANSLATION_MAX_CONCURRENT: String(config.translationMaxConcurrent),
        TRANSLATION_MAX_GLOBAL_QUEUE: String(config.translationMaxGlobalQueue),
        TRANSLATION_MAX_GUILD_QUEUE: String(config.translationMaxGuildQueue),
        TRANSLATION_MAX_USER_OUTSTANDING: String(config.translationMaxUserOutstanding),
        TRANSLATION_MAX_QUEUE_WAIT_MS: String(config.translationMaxQueueWaitMs),
        ALLOWED_GUILD_IDS: config.allowedGuildIds.join(','),
        ALLOWED_USER_IDS: config.allowedUserIds.join(','),
        INPUT_PRICE_PER_MILLION: String(config.inputPricePerMillion),
        OUTPUT_PRICE_PER_MILLION: String(config.outputPricePerMillion),
        DAILY_BUDGET_USD: String(config.dailyBudgetUsd),
        DEFAULT_USER_DAILY_BUDGET_USD: String(config.defaultUserDailyBudgetUsd),
    };
}

function positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegative(value: string | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function profileEnv(env: WorkerEnv, profile: AppProfile): WorkerEnv {
    return { ...env, BABEL_APP: profile.id === 'babel-pocket' ? 'pocket' : 'guild' };
}

function dashboardRoute(
    pathname: string,
    env: WorkerEnv,
): {
    path: string;
    env: WorkerEnv;
    profile: AppProfile;
    profiles: AppProfile[];
} | null {
    const combined = env.BABEL_APP === 'combined' || env.BABEL_APP === 'both';
    const scoped = pathname.match(/^\/(guild|pocket)\/api(\/.*)?$/);
    if (scoped) {
        const profile = scoped[1] === 'pocket' ? BABEL_POCKET_PROFILE : BABEL_GUILD_PROFILE;
        return {
            path: scoped[2] || '/',
            env: profileEnv(env, profile),
            profile,
            profiles: [profile],
        };
    }
    if (!pathname.startsWith('/api/')) return null;
    const profile =
        env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
            ? BABEL_POCKET_PROFILE
            : BABEL_GUILD_PROFILE;
    return {
        path: pathname.slice(4) || '/',
        env,
        profile,
        profiles: combined ? [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE] : [profile],
    };
}

function cookieToken(request: Request): string | null {
    return request.headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1] ?? null;
}

function randomHex(bytes = 32): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
        value.toString(16).padStart(2, '0'),
    ).join('');
}

function sessionCookie(request: Request, token: string, maxAge: number): string {
    return [
        `session=${token}`,
        'HttpOnly',
        'Path=/',
        'SameSite=Strict',
        `Max-Age=${maxAge}`,
        ...(new URL(request.url).protocol === 'https:' ? ['Secure'] : []),
    ].join('; ');
}

async function session(request: Request, env: WorkerEnv): Promise<SessionRow | null> {
    const token = cookieToken(request);
    if (!token) return null;
    const row = await env.DB.prepare('SELECT token, expiry, csrf FROM sessions WHERE token = ?')
        .bind(token)
        .first<SessionRow>();
    if (!row || row.expiry <= Date.now()) {
        if (row) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        return null;
    }
    return row;
}

async function publicSessionId(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}

function safeEqual(left: string, right: string): boolean {
    const a = new TextEncoder().encode(left);
    const b = new TextEncoder().encode(right);
    let difference = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
        difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
    }
    return difference === 0;
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const value = (await request.json()) as unknown;
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

async function loginAllowed(request: Request, env: WorkerEnv): Promise<boolean> {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const now = Date.now();
    const row = await env.DB.prepare(
        `INSERT INTO dashboard_login_attempts (ip, window_start, attempts)
         VALUES (?, ?, 1)
         ON CONFLICT (ip) DO UPDATE SET
             window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END,
             attempts = CASE WHEN ? - window_start >= ? THEN 1 ELSE attempts + 1 END
         RETURNING attempts`,
    )
        .bind(ip, now, now, LOGIN_WINDOW_MS, now, now, LOGIN_WINDOW_MS)
        .first<{ attempts: number }>();
    return (row?.attempts ?? 1) <= LOGIN_ATTEMPT_LIMIT;
}

async function saveConfig(env: WorkerEnv, updates: Partial<StoreData>): Promise<void> {
    const now = new Date().toISOString();
    const statements = Object.entries(updates).map(([key, value]) =>
        env.DB.prepare(
            `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(key, JSON.stringify(value), now),
    );
    if (statements.length > 0) await env.DB.batch(statements);
    runtimeConfigCache.delete(env.DB);
}

function discordToken(env: WorkerEnv): string | undefined {
    return env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
        ? (env.BABEL_POCKET_DISCORD_TOKEN ?? env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN)
        : (env.BABEL_GUILD_DISCORD_TOKEN ?? env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN);
}

function discordAppId(env: WorkerEnv): string | undefined {
    return env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
        ? (env.BABEL_POCKET_DISCORD_APP_ID ?? env.DISCORD_APP_ID)
        : (env.BABEL_GUILD_DISCORD_APP_ID ?? env.DISCORD_APP_ID);
}

async function discordData(env: WorkerEnv): Promise<{ me: DiscordMe | null; guilds: GuildRow[] }> {
    const token = discordToken(env);
    if (!token) return { me: null, guilds: [] };
    const cached = discordCache.get(token);
    if (cached && cached.expires > Date.now()) return cached;
    const headers = { Authorization: `Bot ${token}` };
    try {
        const [meResponse, guildResponse] = await Promise.all([
            fetch(`${DISCORD_API}/users/@me`, {
                headers,
                signal: AbortSignal.timeout(5000),
            }),
            fetch(`${DISCORD_API}/users/@me/guilds`, {
                headers,
                signal: AbortSignal.timeout(5000),
            }),
        ]);
        const result = {
            me: meResponse.ok ? ((await meResponse.json()) as DiscordMe) : null,
            guilds: guildResponse.ok ? ((await guildResponse.json()) as GuildRow[]) : [],
        };
        discordCache.set(token, { ...result, expires: Date.now() + 60_000 });
        return result;
    } catch {
        return { me: null, guilds: [] };
    }
}

async function discordUserProfiles(
    env: WorkerEnv,
    userIds: string[],
): Promise<Record<string, { username: string; displayName: string; avatarUrl: string }>> {
    const token = discordToken(env);
    if (!token || userIds.length === 0) return {};
    const entries = await Promise.all(
        userIds.map(async (userId) => {
            const key = `${token}:${userId}`;
            const cached = discordUserCache.get(key);
            if (cached && cached.expires > Date.now()) return [userId, cached.user] as const;
            try {
                const response = await fetch(`${DISCORD_API}/users/${encodeURIComponent(userId)}`, {
                    headers: { Authorization: `Bot ${token}` },
                    signal: AbortSignal.timeout(5000),
                });
                if (!response.ok) return null;
                const user = (await response.json()) as DiscordMe;
                discordUserCache.set(key, { user, expires: Date.now() + 60 * 60_000 });
                return [userId, user] as const;
            } catch {
                return null;
            }
        }),
    );
    return Object.fromEntries(
        entries.flatMap((entry) => {
            if (!entry) return [];
            const [userId, user] = entry;
            return [
                [
                    userId,
                    {
                        username: user.username,
                        displayName: user.global_name || user.username,
                        avatarUrl: userAvatar(user),
                    },
                ],
            ];
        }),
    );
}

function guildIcon(guild: GuildRow): string {
    return guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
        : '';
}

function userAvatar(user: DiscordMe | null): string {
    return user?.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : '';
}

function usageCost(
    row: Pick<UsageRow, 'input_tokens' | 'output_tokens'> | null,
    config: StoreData,
) {
    if (!row) return 0;
    return (
        (row.input_tokens / 1_000_000) * config.inputPricePerMillion +
        (row.output_tokens / 1_000_000) * config.outputPricePerMillion
    );
}

function usageJson(row: UsageRow | null, config: StoreData) {
    return {
        date: row?.date ?? new Date().toISOString().slice(0, 10),
        inputTokens: row?.input_tokens ?? 0,
        outputTokens: row?.output_tokens ?? 0,
        requests: row?.requests ?? 0,
        totalCost: usageCost(row, config),
        dailyBudget: config.dailyBudgetUsd,
        budgetExceeded:
            config.dailyBudgetUsd > 0 && usageCost(row, config) >= config.dailyBudgetUsd,
    };
}

async function todayUsage(env: WorkerEnv, profile: AppProfile): Promise<UsageRow | null> {
    const table = profile.accessMode === 'user-install' ? 'user_daily_usage' : 'guild_daily_usage';
    return env.DB.prepare(
        `SELECT date, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(requests) AS requests
         FROM ${table} WHERE date = ? GROUP BY date`,
    )
        .bind(new Date().toISOString().slice(0, 10))
        .first<UsageRow>();
}

async function history(env: WorkerEnv, profile: AppProfile): Promise<UsageRow[]> {
    const table =
        profile.accessMode === 'user-install' ? 'user_usage_history' : 'guild_usage_history';
    const current =
        profile.accessMode === 'user-install' ? 'user_daily_usage' : 'guild_daily_usage';
    const { results } = await env.DB.prepare(
        `SELECT * FROM (
             SELECT date, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                    SUM(requests) AS requests
             FROM (
                 SELECT date, input_tokens, output_tokens, requests FROM ${table}
                 UNION ALL
                 SELECT date, input_tokens, output_tokens, requests FROM ${current}
             )
             GROUP BY date ORDER BY date DESC LIMIT 30
         ) ORDER BY date ASC`,
    ).all<UsageRow>();
    return results;
}

async function budgetLists(env: WorkerEnv, profile: AppProfile, config: StoreData) {
    const date = new Date().toISOString().slice(0, 10);
    if (profile.accessMode === 'guild') {
        const [{ guilds }, budgetRows, usageRows] = await Promise.all([
            discordData(env),
            env.DB.prepare('SELECT guild_id, daily_budget_usd FROM guild_budgets').all<{
                guild_id: string;
                daily_budget_usd: number;
            }>(),
            env.DB.prepare(
                'SELECT guild_id, input_tokens, output_tokens, requests FROM guild_daily_usage WHERE date = ?',
            )
                .bind(date)
                .all<{
                    guild_id: string;
                    input_tokens: number;
                    output_tokens: number;
                    requests: number;
                }>(),
        ]);
        const budgets = new Map(
            budgetRows.results.map((row) => [row.guild_id, row.daily_budget_usd]),
        );
        const usage = new Map(usageRows.results.map((row) => [row.guild_id, row]));
        return {
            guildBudgets: guilds.map((guild) => {
                const row = usage.get(guild.id) ?? null;
                const budget = budgets.get(guild.id) ?? config.dailyBudgetUsd;
                const totalCost = usageCost(row, config);
                return {
                    id: guild.id,
                    name: guild.name,
                    budget,
                    isCustom: budgets.has(guild.id),
                    totalCost,
                    requests: row?.requests ?? 0,
                    exceeded: budget > 0 && totalCost >= budget,
                };
            }),
            userBudgets: [],
        };
    }

    const [budgetRows, usageRows, pendingRows] = await Promise.all([
        env.DB.prepare('SELECT user_id, daily_budget_usd FROM user_budgets').all<{
            user_id: string;
            daily_budget_usd: number;
        }>(),
        env.DB.prepare(
            'SELECT user_id, input_tokens, output_tokens, requests FROM user_daily_usage WHERE date = ?',
        )
            .bind(date)
            .all<{
                user_id: string;
                input_tokens: number;
                output_tokens: number;
                requests: number;
            }>(),
        env.DB.prepare('SELECT user_id FROM pending_user_install_owners').all<{
            user_id: string;
        }>(),
    ]);
    const budgets = new Map(budgetRows.results.map((row) => [row.user_id, row.daily_budget_usd]));
    const usage = new Map(usageRows.results.map((row) => [row.user_id, row]));
    const pending = new Set(pendingRows.results.map((row) => row.user_id));
    const ids = [
        ...new Set([...config.allowedUserIds, ...budgets.keys(), ...usage.keys(), ...pending]),
    ];
    const profiles = await discordUserProfiles(env, ids);
    return {
        guildBudgets: [],
        userBudgets: ids.map((id) => {
            const row = usage.get(id) ?? null;
            const budget = budgets.get(id) ?? config.defaultUserDailyBudgetUsd;
            const totalCost = usageCost(row, config);
            return {
                id,
                name: profiles[id]?.displayName ?? id,
                username: profiles[id]?.username ?? id,
                avatar: profiles[id]?.avatarUrl ?? '',
                budget,
                isCustom: budgets.has(id),
                allowed: config.allowedUserIds.includes(id),
                pending: pending.has(id) && !config.allowedUserIds.includes(id),
                totalCost,
                requests: row?.requests ?? 0,
                exceeded: budget > 0 && totalCost >= budget,
            };
        }),
    };
}

function providerSummary(
    enabled: boolean,
    configured: boolean,
    metrics: RuntimeMetricRow | null,
    provider: 'vertex' | 'openai',
) {
    return {
        enabled,
        configured,
        successTotal: metrics?.[`${provider}_success_total`] ?? 0,
        failureTotal: metrics?.[`${provider}_failure_total`] ?? 0,
        fallbackFromTotal: metrics?.[`${provider}_fallback_from_total`] ?? 0,
        fallbackToTotal: metrics?.[`${provider}_fallback_to_total`] ?? 0,
    };
}

async function stats(env: WorkerEnv, profile: AppProfile, config: StoreData): Promise<Response> {
    const [{ me, guilds }, usage, budgets, metrics, cache, runtime] = await Promise.all([
        discordData(env),
        todayUsage(env, profile),
        budgetLists(env, profile, config),
        env.DB.prepare('SELECT * FROM runtime_metrics WHERE app_profile_id = ?')
            .bind(profile.id)
            .first<RuntimeMetricRow>(),
        env.DB.prepare('SELECT COUNT(*) AS size FROM translation_cache WHERE app_profile_id = ?')
            .bind(profile.id)
            .first<{ size: number }>(),
        env.DB.prepare(
            `SELECT
                 COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS inflight,
                 COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued
             FROM runtime_leases WHERE app_profile_id = ? AND expires_at > ?`,
        )
            .bind(profile.id, Date.now())
            .first<{ inflight: number; queued: number }>(),
    ]);
    const providerMode = config.translationProvider;
    const vertexEnabled = providerMode.split('+').includes('vertex');
    const openaiEnabled = providerMode.split('+').includes('openai');
    const usageData = usageJson(usage, config);
    const budgetRows = profile.accessMode === 'guild' ? budgets.guildBudgets : budgets.userBudgets;
    const warningCount = budgetRows.filter(
        (item) => item.budget > 0 && item.totalCost / item.budget >= 0.8 && !item.exceeded,
    ).length;
    const exceededCount = budgetRows.filter((item) => item.exceeded).length;
    const cacheRequests = (metrics?.cache_hits_total ?? 0) + (metrics?.cache_misses_total ?? 0);
    return json({
        bot: {
            name: me
                ? `${me.username}${me.discriminator && me.discriminator !== '0' ? `#${me.discriminator}` : ''}`
                : profile.productName,
            avatar: userAvatar(me),
            uptime: 0,
            memoryMB: 'N/A',
            memory: { rssMB: 'N/A', heapUsedMB: 'N/A', externalMB: 'N/A' },
            guilds: profile.accessMode === 'guild' ? guilds.length : 0,
        },
        translations: {
            total: metrics?.translations_total ?? 0,
            apiCalls: metrics?.api_calls_total ?? 0,
            saved: metrics?.cache_hits_total ?? 0,
            failures: metrics?.failures_total ?? 0,
            failureRate:
                (metrics?.translations_total ?? 0) > 0
                    ? (metrics?.failures_total ?? 0) / (metrics?.translations_total ?? 1)
                    : 0,
            cacheHits: metrics?.cache_hits_total ?? 0,
            cacheHitRate: cacheRequests > 0 ? (metrics?.cache_hits_total ?? 0) / cacheRequests : 0,
            budgetExceeded: metrics?.budget_exceeded_total ?? 0,
            webhookRecreated: 0,
        },
        cache: {
            size: cache?.size ?? 0,
            maxSize: config.cacheMaxSize,
            hits: metrics?.cache_hits_total ?? 0,
            misses: metrics?.cache_misses_total ?? 0,
        },
        usage: usageData,
        guildBudgets: budgets.guildBudgets,
        userBudgets: budgets.userBudgets,
        errors: metrics?.failures_total ?? 0,
        operations: {
            providerMode,
            providers: {
                vertex: providerSummary(
                    vertexEnabled,
                    !!(config.vertexAiApiKey && config.gcpProject),
                    metrics,
                    'vertex',
                ),
                openai: providerSummary(
                    openaiEnabled,
                    !!(config.openaiApiKey && config.openaiBaseUrl && config.openaiModel),
                    metrics,
                    'openai',
                ),
            },
            fallbackTotal: metrics?.provider_fallback_total ?? 0,
            lastFallback: null,
            runtimePressure: {
                inflight: runtime?.inflight ?? 0,
                queued: runtime?.queued ?? 0,
                rejectedTotal: metrics?.rejected_total ?? 0,
                rejectionCounts: {},
                limits: {
                    maxConcurrent: config.translationMaxConcurrent,
                    maxGlobalQueue: config.translationMaxGlobalQueue,
                    maxGuildQueue: config.translationMaxGuildQueue,
                    maxUserOutstanding: config.translationMaxUserOutstanding,
                    maxQueueWaitMs: Math.min(config.translationMaxQueueWaitMs, 5000),
                },
            },
            budgetRisk: { warningCount, exceededCount },
            guidance: [],
        },
    });
}

async function guildList(env: WorkerEnv): Promise<Response> {
    const { guilds } = await discordData(env);
    return json(
        guilds.map((guild) => ({
            id: guild.id,
            name: guild.name,
            icon: guildIcon(guild),
            memberCount: guild.approximate_member_count ?? null,
        })),
    );
}

async function glossaryList(env: WorkerEnv, guildId: string): Promise<Response> {
    const { results } = await env.DB.prepare(
        `SELECT id, guild_id, source_text, target_language, target_text, notes, created_at, updated_at
         FROM guild_glossary WHERE guild_id = ? ORDER BY id`,
    )
        .bind(guildId)
        .all<{
            id: number;
            guild_id: string;
            source_text: string;
            target_language: string;
            target_text: string;
            notes: string;
            created_at: string;
            updated_at: string;
        }>();
    const entries = results.map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        sourceText: row.source_text,
        targetLanguage: row.target_language,
        targetText: row.target_text,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
    return json({ entries, count: entries.length });
}

async function glossarySave(request: Request, env: WorkerEnv, guildId: string): Promise<Response> {
    const body = await jsonBody(request);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    const input = sanitizeGlossaryInput(body);
    if (!input.ok) return json({ error: input.error }, 400);
    const now = new Date().toISOString();
    if (input.value.id) {
        await env.DB.prepare(
            `UPDATE guild_glossary SET source_text = ?, target_language = ?, target_text = ?,
                    notes = ?, updated_at = ? WHERE guild_id = ? AND id = ?`,
        )
            .bind(
                input.value.sourceText,
                input.value.targetLanguage,
                input.value.targetText,
                input.value.notes,
                now,
                guildId,
                input.value.id,
            )
            .run();
    } else {
        await env.DB.prepare(
            `INSERT INTO guild_glossary
                (guild_id, source_text, target_language, target_text, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                guildId,
                input.value.sourceText,
                input.value.targetLanguage,
                input.value.targetText,
                input.value.notes,
                now,
                now,
            )
            .run();
    }
    const entry = await env.DB.prepare(
        `SELECT id, guild_id AS guildId, source_text AS sourceText,
                target_language AS targetLanguage, target_text AS targetText, notes,
                created_at AS createdAt, updated_at AS updatedAt
         FROM guild_glossary WHERE guild_id = ?
         ${input.value.id ? 'AND id = ?' : 'ORDER BY id DESC LIMIT 1'}`,
    )
        .bind(guildId, ...(input.value.id ? [input.value.id] : []))
        .first<Record<string, string | number>>();
    if (!entry) return json({ error: 'Glossary entry not found' }, 404);
    return json({ ok: true, entry, cacheCleared: true });
}

function glossaryKey(sourceText: string, targetLanguage: string): string {
    return `${sourceText.trim().toLowerCase()}\u0000${targetLanguage.trim().toLowerCase()}`;
}

async function glossaryImport(
    request: Request,
    env: WorkerEnv,
    guildId: string,
): Promise<Response> {
    const body = await jsonBody(request);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    const sanitized = sanitizeGlossaryImportRequest(body);
    if (!sanitized.ok) return json({ error: sanitized.error }, 400);
    const parsed = parseGlossaryImport(sanitized.value.text);
    const existingResponse = await glossaryList(env, guildId);
    const existingPayload = (await existingResponse.json()) as {
        entries: Array<{
            id: number;
            sourceText: string;
            targetLanguage: string;
        }>;
    };
    const existing = new Map(
        existingPayload.entries.map((entry) => [
            glossaryKey(entry.sourceText, entry.targetLanguage),
            entry.id,
        ]),
    );
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const row of parsed.rows) {
        const key = glossaryKey(row.input.sourceText, row.input.targetLanguage);
        const id = existing.get(key);
        if (id && sanitized.value.duplicateMode === 'skip') {
            skipped++;
            continue;
        }
        if (id) {
            statements.push(
                env.DB.prepare(
                    `UPDATE guild_glossary SET source_text = ?, target_language = ?, target_text = ?,
                            notes = ?, updated_at = ? WHERE guild_id = ? AND id = ?`,
                ).bind(
                    row.input.sourceText,
                    row.input.targetLanguage,
                    row.input.targetText,
                    row.input.notes,
                    now,
                    guildId,
                    id,
                ),
            );
            updated++;
        } else {
            statements.push(
                env.DB.prepare(
                    `INSERT INTO guild_glossary
                        (guild_id, source_text, target_language, target_text, notes, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ).bind(
                    guildId,
                    row.input.sourceText,
                    row.input.targetLanguage,
                    row.input.targetText,
                    row.input.notes,
                    now,
                    now,
                ),
            );
            created++;
        }
    }
    if (statements.length > 0) await env.DB.batch(statements);
    return json({
        ok: true,
        created,
        updated,
        skipped,
        failed: parsed.errors?.length ?? 0,
        errors: parsed.errors ?? [],
        cacheCleared: statements.length > 0,
    });
}

async function budgetResponse(env: WorkerEnv, profile: AppProfile, config: StoreData) {
    const lists = await budgetLists(env, profile, config);
    if (profile.accessMode === 'user-install') {
        return json({
            budgets: Object.fromEntries(
                lists.userBudgets.map((item) => [
                    item.id,
                    {
                        budget: item.budget,
                        isCustom: item.isCustom,
                        allowed: item.allowed,
                        pending: item.pending,
                    },
                ]),
            ),
            profiles: Object.fromEntries(
                lists.userBudgets.map((item) => [
                    item.id,
                    {
                        username: item.username,
                        displayName: item.name,
                        avatarUrl: item.avatar,
                    },
                ]),
            ),
        });
    }
    const { guilds } = await discordData(env);
    const byId = new Map(lists.guildBudgets.map((item) => [item.id, item]));
    return json(
        Object.fromEntries(
            guilds.map((guild) => {
                const item = byId.get(guild.id);
                return [
                    guild.id,
                    {
                        name: guild.name,
                        budget: item?.isCustom ? item.budget : -1,
                        usage: {
                            inputTokens: 0,
                            outputTokens: 0,
                            requests: item?.requests ?? 0,
                            totalCost: item?.totalCost ?? 0,
                        },
                    },
                ];
            }),
        ),
    );
}

async function setBudget(
    request: Request,
    env: WorkerEnv,
    kind: 'guild' | 'user',
    id: string,
): Promise<Response> {
    const body = await jsonBody(request);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    const value = body.dailyBudgetUsd;
    const table = kind === 'guild' ? 'guild_budgets' : 'user_budgets';
    const column = kind === 'guild' ? 'guild_id' : 'user_id';
    if (value === null || value === undefined) {
        await env.DB.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(id).run();
        return json({ ok: true, mode: kind === 'guild' ? 'global' : 'default' });
    }
    const budget = Number(value);
    if (!Number.isFinite(budget) || budget < 0) {
        return json({ error: 'dailyBudgetUsd must be >= 0' }, 400);
    }
    await env.DB.prepare(
        `INSERT INTO ${table} (${column}, daily_budget_usd) VALUES (?, ?)
         ON CONFLICT (${column}) DO UPDATE SET daily_budget_usd = excluded.daily_budget_usd`,
    )
        .bind(id, budget)
        .run();
    return json({ ok: true, budget });
}

async function preferences(env: WorkerEnv, profile: AppProfile): Promise<Response> {
    const { results } = await env.DB.prepare(
        `SELECT guild_id, user_id, language FROM user_language_preferences
         ${profile.accessMode === 'user-install' ? "WHERE guild_id = ''" : "WHERE guild_id <> ''"}
         ORDER BY guild_id, user_id`,
    ).all<{ guild_id: string; user_id: string; language: string }>();
    const guilds = profile.accessMode === 'guild' ? (await discordData(env)).guilds : [];
    const guildById = new Map(guilds.map((guild) => [guild.id, guild]));
    const entries = results.map((row) => {
        const guild = guildById.get(row.guild_id);
        return {
            guildId: row.guild_id,
            userId: row.user_id,
            language: row.language,
            guildName: guild?.name ?? row.guild_id,
            guildIcon: guild ? guildIcon(guild) : '',
            guildMemberCount: guild?.approximate_member_count ?? null,
        };
    });
    const profiles = await discordUserProfiles(env, [
        ...new Set(entries.map((entry) => entry.userId)),
    ]);
    return json({ entries, count: entries.length, profiles });
}

async function recordLog(
    env: WorkerEnv,
    type: 'translation' | 'error',
    data: Record<string, unknown>,
): Promise<void> {
    const profileId =
        env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
            ? BABEL_POCKET_PROFILE.id
            : BABEL_GUILD_PROFILE.id;
    await env.DB.batch([
        env.DB.prepare(
            'INSERT INTO worker_logs (app_profile_id, type, timestamp, data) VALUES (?, ?, ?, ?)',
        ).bind(profileId, type, Date.now(), JSON.stringify(data)),
        env.DB.prepare(
            `DELETE FROM worker_logs WHERE app_profile_id = ? AND id NOT IN (
                 SELECT id FROM worker_logs WHERE app_profile_id = ?
                 ORDER BY timestamp DESC, id DESC LIMIT 200
             )`,
        ).bind(profileId, profileId),
    ]);
}

export { recordLog as recordWorkerLog };

async function logs(url: URL, env: WorkerEnv): Promise<Response> {
    const count = Math.min(
        Math.max(Number.parseInt(url.searchParams.get('count') ?? '50', 10), 1),
        200,
    );
    const filter = url.searchParams.get('filter');
    const errorType = url.searchParams.get('errorType');
    const profileId =
        env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
            ? BABEL_POCKET_PROFILE.id
            : BABEL_GUILD_PROFILE.id;
    const clauses = ['app_profile_id = ?'];
    const values: Array<string | number> = [profileId];
    if (filter === 'translation' || filter === 'error') {
        clauses.push('type = ?');
        values.push(filter);
    }
    const { results } = await env.DB.prepare(
        `SELECT type, timestamp, data FROM worker_logs
         WHERE ${clauses.join(' AND ')} ORDER BY timestamp DESC LIMIT ?`,
    )
        .bind(...values, count)
        .all<{ type: string; timestamp: number; data: string }>();
    return json(
        results
            .flatMap((row) => {
                try {
                    return [{ type: row.type, timestamp: row.timestamp, ...JSON.parse(row.data) }];
                } catch {
                    return [];
                }
            })
            .filter((entry) => !errorType || entry.errorType === errorType),
    );
}

function csvCell(value: unknown): string {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function usageHistoryResponse(env: WorkerEnv, profile: AppProfile, csv = false) {
    const config = await getRuntimeConfig(env);
    const rows = (await history(env, profile)).map((row) => ({
        date: row.date,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        requests: row.requests,
        cost: usageCost(row, config),
    }));
    if (!csv) return json(rows);
    const body = [
        'date,inputTokens,outputTokens,requests,cost',
        ...rows.map((row) =>
            [row.date, row.inputTokens, row.outputTokens, row.requests, row.cost]
                .map(csvCell)
                .join(','),
        ),
    ].join('\n');
    return new Response(body, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="babel-usage-export.csv"',
            'Cache-Control': 'no-store',
        },
    });
}

async function health(
    env: WorkerEnv,
    config: StoreData,
    options: DashboardOptions,
): Promise<Response> {
    const database = await databaseReady(env);
    const providerChecks = await options.providerHealth(env);
    const providerReady = Object.values(providerChecks).some((check) => check.status === 'pass');
    const checks = {
        database: { status: database ? 'pass' : 'fail' },
        configuration: {
            status: providerReady ? 'pass' : 'fail',
            detail: providerReady
                ? 'Provider configuration is complete'
                : 'Provider setup is incomplete',
        },
        vertexAi: providerChecks.vertexAi,
        openAi: providerChecks.openAi,
    };
    return json(
        {
            healthy: database && providerReady,
            readiness: database && providerReady ? 'ready' : 'not_ready',
            vertexAi: checks.vertexAi,
            checks,
        },
        database && providerReady ? 200 : 503,
    );
}

async function setupDoctor(env: WorkerEnv, profile: AppProfile, config: StoreData) {
    const database = await databaseReady(env);
    const provider = config.translationProvider
        .split('+')
        .some((name) =>
            name === 'vertex'
                ? !!(config.vertexAiApiKey && config.gcpProject)
                : !!(config.openaiApiKey && config.openaiBaseUrl && config.openaiModel),
        );
    const access =
        profile.accessMode === 'guild'
            ? config.allowedGuildIds.length > 0
            : config.allowedUserIds.length > 0;
    const checks = [
        {
            id: 'database',
            status: database ? 'pass' : 'fail',
            title: 'D1 database',
            detail: database ? 'D1 is available' : 'D1 query failed',
        },
        {
            id: 'provider',
            status: provider ? 'pass' : 'fail',
            title: 'Translation provider',
            detail: provider
                ? 'Provider configuration is complete'
                : 'Provider credentials are incomplete',
        },
        {
            id: 'access',
            status: access ? 'pass' : 'warn',
            title: 'Access allowlist',
            detail: access ? 'At least one id is allowed' : 'The allowlist is empty',
        },
        {
            id: 'discord',
            status: discordToken(env) ? 'pass' : profile.enableWebhookOutput ? 'fail' : 'warn',
            title: 'Discord bot token',
            detail: discordToken(env)
                ? 'Discord token is configured'
                : 'Discord token is not configured',
        },
    ];
    const appId = discordAppId(env);
    const token = discordToken(env);
    if (!appId || !token) {
        checks.push({
            id: 'commands',
            status: 'warn',
            title: 'Discord commands',
            detail: 'Discord registration credentials are missing',
        });
    } else {
        try {
            const response = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
                headers: { Authorization: `Bot ${token}` },
                signal: AbortSignal.timeout(5000),
            });
            const registered = response.ok
                ? new Set(
                      ((await response.json()) as Array<{ name?: string }>).flatMap((command) =>
                          command.name ? [command.name] : [],
                      ),
                  )
                : new Set<string>();
            const missing = getCommandsForProfile(profile)
                .map((command) => command.name)
                .filter((name) => !registered.has(name));
            checks.push({
                id: 'commands',
                status: response.ok && missing.length === 0 ? 'pass' : 'fail',
                title: 'Discord commands',
                detail:
                    response.ok && missing.length === 0
                        ? 'Discord commands are registered'
                        : missing.length > 0
                          ? `Missing registered Discord commands: ${missing.join(', ')}`
                          : `Discord command lookup failed with HTTP ${response.status}`,
            });
        } catch (error) {
            checks.push({
                id: 'commands',
                status: 'fail',
                title: 'Discord commands',
                detail: error instanceof Error ? error.message : 'Discord command check failed',
            });
        }
    }
    return json({ ok: checks.every((item) => item.status !== 'fail'), checks });
}

export async function handleDashboardRequest(
    request: Request,
    env: WorkerEnv,
    options: DashboardOptions,
): Promise<Response | null> {
    const url = new URL(request.url);
    const route = dashboardRoute(url.pathname, env);
    if (!route) return null;
    const method = request.method;

    if (route.path === '/login' && method === 'POST') {
        if (!(await loginAllowed(request, route.env))) {
            return json({ error: 'Too many login attempts, please try again later' }, 429);
        }
        const body = await jsonBody(request);
        const password = typeof body?.password === 'string' ? body.password : '';
        if (!route.env.DASHBOARD_PASSWORD || !safeEqual(password, route.env.DASHBOARD_PASSWORD)) {
            return json({ error: 'Wrong password' }, 401);
        }
        const token = randomHex();
        const csrf = randomHex();
        await route.env.DB.batch([
            route.env.DB.prepare('DELETE FROM dashboard_login_attempts WHERE ip = ?').bind(
                request.headers.get('cf-connecting-ip') ?? 'unknown',
            ),
            route.env.DB.prepare(
                'INSERT INTO sessions (token, expiry, csrf) VALUES (?, ?, ?)',
            ).bind(token, Date.now() + SESSION_TTL_MS, csrf),
        ]);
        return json({ ok: true, csrfToken: csrf }, 200, {
            'Set-Cookie': sessionCookie(request, token, SESSION_TTL_MS / 1000),
        });
    }

    const activeSession = await session(request, route.env);
    if (route.path === '/auth/check' && method === 'GET') {
        return json({
            authenticated: !!activeSession,
            ...(activeSession ? { csrfToken: activeSession.csrf } : {}),
        });
    }
    if (route.path === '/logout' && method === 'POST') {
        if (activeSession) {
            await route.env.DB.prepare('DELETE FROM sessions WHERE token = ?')
                .bind(activeSession.token)
                .run();
        }
        return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }
    if (!activeSession) return json({ error: 'Unauthorized' }, 401);
    if (!['GET', 'HEAD'].includes(method)) {
        const csrf = request.headers.get('x-csrf-token') ?? '';
        if (!safeEqual(csrf, activeSession.csrf)) {
            return json({ error: 'Invalid CSRF token' }, 403);
        }
    }

    const runtimeEnv = await configuredEnv(route.env);
    const config = await getRuntimeConfig(route.env);

    if (route.path === '/capabilities' && method === 'GET') {
        return json(buildDashboardCapabilitiesResponse(route.profile, route.profiles));
    }
    if (route.path === '/setup-status' && method === 'GET') {
        return json({ complete: config.setupComplete });
    }
    if (route.path === '/setup-doctor/run' && method === 'POST') {
        return setupDoctor(runtimeEnv, route.profile, config);
    }
    if (route.path === '/version' && method === 'GET') {
        return json(getVersionMetadata());
    }
    if (route.path === '/sessions' && method === 'GET') {
        const { results } = await route.env.DB.prepare(
            'SELECT token, expiry, csrf FROM sessions WHERE expiry > ? ORDER BY expiry',
        )
            .bind(Date.now())
            .all<SessionRow>();
        return json({
            sessions: await Promise.all(
                results.map(async (row) => ({
                    id: await publicSessionId(row.token),
                    current: safeEqual(row.token, activeSession.token),
                    expiresAt: new Date(row.expiry).toISOString(),
                    expiresInMs: Math.max(row.expiry - Date.now(), 0),
                })),
            ),
        });
    }
    if (route.path === '/sessions/revoke' && method === 'POST') {
        const body = await jsonBody(request);
        const id = typeof body?.id === 'string' ? body.id : '';
        const { results } = await route.env.DB.prepare(
            'SELECT token, expiry, csrf FROM sessions WHERE expiry > ?',
        )
            .bind(Date.now())
            .all<SessionRow>();
        const target = (
            await Promise.all(
                results.map(async (row) => ({ row, id: await publicSessionId(row.token) })),
            )
        ).find((item) => item.id === id)?.row;
        if (!target) return json({ error: 'Session not found' }, 404);
        await route.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(target.token).run();
        const current = safeEqual(target.token, activeSession.token);
        return json(
            { ok: true, revoked: true, current },
            200,
            current ? { 'Set-Cookie': sessionCookie(request, '', 0) } : {},
        );
    }
    if (route.path === '/stats' && method === 'GET') {
        return stats(runtimeEnv, route.profile, config);
    }
    if (route.path === '/config' && method === 'GET') {
        return json({
            ...config,
            vertexAiApiKey: config.vertexAiApiKey ? `••••${config.vertexAiApiKey.slice(-6)}` : '',
            hasApiKey: !!config.vertexAiApiKey,
            openaiApiKey: config.openaiApiKey ? `••••${config.openaiApiKey.slice(-6)}` : '',
            hasOpenaiApiKey: !!config.openaiApiKey,
        });
    }
    if (route.path === '/config' && method === 'POST') {
        const body = await jsonBody(request);
        if (!body) return json({ error: 'Invalid JSON body' }, 400);
        const validation = validateConfigUpdate(body);
        if (!validation.valid) return json({ error: validation.error }, 400);
        await saveConfig(route.env, validation.sanitized);
        options.resetProviderState();
        return json({
            ok: true,
            cacheCleared: false,
            changedKeys: Object.keys(validation.sanitized),
            immediateEffects: Object.keys(validation.sanitized),
        });
    }
    if (route.path === '/guilds' && method === 'GET') return guildList(runtimeEnv);
    if (route.path === '/usage/history' && method === 'GET') {
        return usageHistoryResponse(runtimeEnv, route.profile);
    }
    if (route.path === '/usage/export.csv' && method === 'GET') {
        return usageHistoryResponse(runtimeEnv, route.profile, true);
    }
    if (route.path === '/guild-budgets' && method === 'GET') {
        return budgetResponse(runtimeEnv, BABEL_GUILD_PROFILE, config);
    }
    if (route.path === '/user-budgets' && method === 'GET') {
        return budgetResponse(runtimeEnv, BABEL_POCKET_PROFILE, config);
    }
    const guildBudget = route.path.match(/^\/guild-budgets\/([^/]+)$/);
    if (guildBudget && method === 'POST') {
        return setBudget(request, runtimeEnv, 'guild', decodeURIComponent(guildBudget[1]!));
    }
    const userBudget = route.path.match(/^\/user-budgets\/([^/]+)$/);
    if (userBudget && method === 'POST') {
        return setBudget(request, runtimeEnv, 'user', decodeURIComponent(userBudget[1]!));
    }
    const glossary = route.path.match(/^\/guild-glossary\/([^/]+)(?:\/([^/]+))?$/);
    if (glossary) {
        const guildId = decodeURIComponent(glossary[1]!);
        if (!glossary[2] && method === 'GET') return glossaryList(runtimeEnv, guildId);
        if (!glossary[2] && method === 'POST') return glossarySave(request, runtimeEnv, guildId);
        if (glossary[2] === 'import' && method === 'POST') {
            return glossaryImport(request, runtimeEnv, guildId);
        }
        if (method === 'DELETE') {
            const entryId = Number.parseInt(glossary[2]!, 10);
            if (!Number.isInteger(entryId) || entryId < 1) {
                return json({ error: 'Valid glossary entry id is required' }, 400);
            }
            const found = await runtimeEnv.DB.prepare(
                'SELECT id FROM guild_glossary WHERE guild_id = ? AND id = ?',
            )
                .bind(guildId, entryId)
                .first<{ id: number }>();
            if (!found) return json({ error: 'Glossary entry not found' }, 404);
            await runtimeEnv.DB.prepare('DELETE FROM guild_glossary WHERE guild_id = ? AND id = ?')
                .bind(guildId, entryId)
                .run();
            return json({ ok: true, deleted: entryId });
        }
    }
    if (route.path === '/logs' && method === 'GET') return logs(url, runtimeEnv);
    if (route.path === '/user-prefs' && method === 'GET') {
        return preferences(runtimeEnv, route.profile);
    }
    if (route.path === '/user-prefs/batch-delete' && method === 'POST') {
        const body = await jsonBody(request);
        const entries = Array.isArray(body?.entries) ? body.entries : [];
        const deleted: Array<{ guildId: string; userId: string }> = [];
        for (const value of entries) {
            if (!value || typeof value !== 'object') continue;
            const row = value as Record<string, unknown>;
            const guildId = String(row.guildId ?? '');
            const userId = String(row.userId ?? '');
            if (!userId) continue;
            await runtimeEnv.DB.prepare(
                'DELETE FROM user_language_preferences WHERE guild_id = ? AND user_id = ?',
            )
                .bind(guildId, userId)
                .run();
            deleted.push({ guildId, userId });
        }
        if (deleted.length === 0) return json({ error: 'entries must be a non-empty array' }, 400);
        return json({ ok: true, deleted, notFound: [] });
    }
    const userPreference = route.path.match(/^\/user-prefs\/([^/]+)$/);
    if (userPreference && method === 'DELETE') {
        const userId = decodeURIComponent(userPreference[1]!);
        const guildId =
            route.profile.accessMode === 'guild' ? (url.searchParams.get('guildId') ?? '') : '';
        if (route.profile.accessMode === 'guild' && !guildId) {
            return json({ error: 'guildId is required' }, 400);
        }
        const found = await runtimeEnv.DB.prepare(
            'SELECT user_id FROM user_language_preferences WHERE guild_id = ? AND user_id = ?',
        )
            .bind(guildId, userId)
            .first<{ user_id: string }>();
        if (!found) return json({ error: 'User not found' }, 404);
        await runtimeEnv.DB.prepare(
            'DELETE FROM user_language_preferences WHERE guild_id = ? AND user_id = ?',
        )
            .bind(guildId, userId)
            .run();
        return json({ ok: true, deleted: { guildId, userId } });
    }
    if (route.path === '/cache/clear' && method === 'POST') {
        const count = await runtimeEnv.DB.prepare(
            'SELECT COUNT(*) AS size FROM translation_cache WHERE app_profile_id = ?',
        )
            .bind(route.profile.id)
            .first<{ size: number }>();
        await runtimeEnv.DB.batch([
            runtimeEnv.DB.prepare('DELETE FROM translation_cache WHERE app_profile_id = ?').bind(
                route.profile.id,
            ),
            runtimeEnv.DB.prepare(
                `UPDATE runtime_metrics SET cache_hits_total = 0, cache_misses_total = 0
                 WHERE app_profile_id = ?`,
            ).bind(route.profile.id),
        ]);
        return json({ ok: true, cleared: count?.size ?? 0 });
    }
    if (route.path === '/translate/test' && method === 'POST') {
        const body = await jsonBody(request);
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        const targetLanguage =
            typeof body?.targetLanguage === 'string' ? body.targetLanguage : 'auto';
        if (!text) return json({ error: 'Text is required' }, 400);
        try {
            const start = Date.now();
            const result = await options.translate(text, targetLanguage, runtimeEnv);
            return json({
                ok: true,
                translation: result.text,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                latencyMs: Date.now() - start,
                cached: result.cached ?? false,
                provider: result.provider,
                fallback: result.fallback ?? false,
            });
        } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
    }
    if (route.path === '/health' && method === 'GET') {
        return health(runtimeEnv, config, options);
    }

    return json({ error: 'Not Found' }, 404);
}
