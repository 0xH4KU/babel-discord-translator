import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../../../src/apps/app-profile.js';
import { isSameLanguage, localeToLang } from '../../../src/modules/translation/lang.js';
import {
    buildGlossaryVersion,
    classifyTranslationError,
    selectGlossaryEntriesForTarget,
} from '../../../src/modules/translation/translation-service-helpers.js';
import { buildTranslationPrompt } from '../../../src/modules/translation/translation-prompt.js';
import { buildTranslationMessages } from '../../../src/shared/discord-message-format.js';
import { sanitizeError } from '../../../src/shared/errors.js';
import { extractTranslatableMessageText } from '../../../src/shared/message-extraction.js';
import {
    discordMessages,
    getDiscordLanguageName,
} from '../../../src/shared/messages/discord-messages.js';
import { configuredEnv, handleDashboardRequest, recordWorkerLog } from './dashboard.js';

type D1Value = string | number | null;

export interface D1PreparedStatement {
    bind(...values: D1Value[]): D1PreparedStatement;
    all<T>(): Promise<{ results: T[] }>;
    first<T>(): Promise<T | null>;
    run(): Promise<unknown>;
}

export interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface WorkerExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerEnv {
    DB: D1Database;
    ASSETS?: { fetch(request: Request): Promise<Response> };
    DASHBOARD_PASSWORD?: string;
    DISCORD_PUBLIC_KEY?: string;
    DISCORD_BOT_TOKEN?: string;
    DISCORD_TOKEN?: string;
    DISCORD_APP_ID?: string;
    BABEL_GUILD_DISCORD_PUBLIC_KEY?: string;
    BABEL_POCKET_DISCORD_PUBLIC_KEY?: string;
    BABEL_GUILD_DISCORD_TOKEN?: string;
    BABEL_POCKET_DISCORD_TOKEN?: string;
    BABEL_GUILD_DISCORD_APP_ID?: string;
    BABEL_POCKET_DISCORD_APP_ID?: string;
    BABEL_APP?: string;
    VERTEX_AI_API_KEY?: string;
    GCP_PROJECT?: string;
    GCP_LOCATION?: string;
    GEMINI_MODEL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL?: string;
    OPENAI_MODEL?: string;
    TRANSLATION_PROVIDER?: 'vertex' | 'openai' | 'vertex+openai' | 'openai+vertex';
    TRANSLATION_PROMPT?: string;
    MAX_INPUT_LENGTH?: string;
    MAX_OUTPUT_TOKENS?: string;
    COOLDOWN_SECONDS?: string;
    CACHE_MAX_SIZE?: string;
    SETUP_COMPLETE?: string;
    TRANSLATION_MAX_CONCURRENT?: string;
    TRANSLATION_MAX_GLOBAL_QUEUE?: string;
    TRANSLATION_MAX_GUILD_QUEUE?: string;
    TRANSLATION_MAX_USER_OUTSTANDING?: string;
    TRANSLATION_MAX_QUEUE_WAIT_MS?: string;
    ALLOWED_GUILD_IDS?: string;
    ALLOWED_USER_IDS?: string;
    INPUT_PRICE_PER_MILLION?: string;
    OUTPUT_PRICE_PER_MILLION?: string;
    DAILY_BUDGET_USD?: string;
    DEFAULT_USER_DAILY_BUDGET_USD?: string;
    ENABLE_GUILD_GLOSSARY?: string;
    METRICS_TOKEN?: string;
    BABEL_METRICS_TOKEN?: string;
}

interface DiscordUser {
    id: string;
    username?: string;
    global_name?: string | null;
    avatar?: string | null;
}

interface DiscordOption {
    name: string;
    value?: string;
}

interface DiscordMessage {
    content?: string;
    embeds?: Array<{
        title?: string;
        description?: string;
        fields?: Array<{ name?: string; value?: string }>;
    }>;
    attachments?: Array<{ filename?: string; description?: string }>;
    message_reference?: { message_id?: string };
}

interface DiscordInteraction {
    type: number;
    application_id: string;
    token: string;
    guild_id?: string;
    channel_id?: string;
    locale?: string;
    user?: DiscordUser;
    member?: { user?: DiscordUser; nick?: string | null };
    authorizing_integration_owners?: Record<string, string>;
    data?: {
        type?: number;
        name?: string;
        target_id?: string;
        options?: DiscordOption[];
        resolved?: { messages?: Record<string, DiscordMessage> };
    };
}

interface TranslationResult {
    text: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cached?: boolean;
    fallback?: boolean;
}

interface UsageRow {
    input_tokens: number;
    output_tokens: number;
    requests: number;
}

interface GlossaryRow {
    id: number;
    guild_id: string;
    source_text: string;
    target_language: string;
    target_text: string;
    notes: string;
    created_at: string;
    updated_at: string;
}

interface DiscordWebhookObject {
    id: string;
    name?: string | null;
    token?: string;
    user?: { id: string };
}

interface CachedTranslationRow {
    translated_text: string;
    provider: string;
}

const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const COMMAND_MESSAGE = 3;
const RESPONSE_PONG = 1;
const RESPONSE_CHANNEL_MESSAGE = 4;
const RESPONSE_DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 1 << 6;
const DISCORD_API = 'https://discord.com/api/v10';
const providerBreakers = new Map<string, { failures: number; openUntil: number }>();
interface ProviderHealthCheck {
    status: 'pass' | 'fail' | 'skip';
    latencyMs?: number;
    error?: string;
}
const providerHealthCache = new Map<
    string,
    { expires: number; checks: Record<'vertexAi' | 'openAi', ProviderHealthCheck> }
>();
const DASHBOARD_CSP = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "connect-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' https://fonts.googleapis.com",
    "script-src 'self'",
].join('; ');

function json(data: unknown, status = 200): Response {
    return Response.json(data, { status });
}

function ephemeral(content: string): Response {
    return json({ type: RESPONSE_CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });
}

async function staticAsset(request: Request, env: WorkerEnv): Promise<Response> {
    if (!env.ASSETS) return new Response('Not Found', { status: 404 });
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('Content-Security-Policy', DASHBOARD_CSP);
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    return response;
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | null {
    if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
    const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

export async function verifyDiscordRequest(
    publicKeyHex: string,
    signatureHex: string,
    timestamp: string,
    body: Uint8Array,
): Promise<boolean> {
    const publicKey = hexToBytes(publicKeyHex);
    const signature = hexToBytes(signatureHex);
    if (!publicKey || publicKey.length !== 32 || !signature || signature.length !== 64) {
        return false;
    }

    const timestampBytes = new TextEncoder().encode(timestamp);
    const message = new Uint8Array(new ArrayBuffer(timestampBytes.length + body.length));
    message.set(timestampBytes);
    message.set(body, timestampBytes.length);

    try {
        const key = await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
        return crypto.subtle.verify('Ed25519', key, signature, message);
    } catch {
        return false;
    }
}

function profileFor(env: WorkerEnv) {
    return env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket'
        ? BABEL_POCKET_PROFILE
        : BABEL_GUILD_PROFILE;
}

function interactionEndpoint(
    pathname: string,
    env: WorkerEnv,
): { publicKey: string | undefined; runtimeEnv: WorkerEnv } | null {
    if (pathname === '/guild/interactions') {
        return {
            publicKey: env.BABEL_GUILD_DISCORD_PUBLIC_KEY ?? env.DISCORD_PUBLIC_KEY,
            runtimeEnv: { ...env, BABEL_APP: 'guild' },
        };
    }
    if (pathname === '/pocket/interactions') {
        return {
            publicKey: env.BABEL_POCKET_DISCORD_PUBLIC_KEY ?? env.DISCORD_PUBLIC_KEY,
            runtimeEnv: { ...env, BABEL_APP: 'pocket' },
        };
    }
    if (pathname === '/interactions') {
        return { publicKey: env.DISCORD_PUBLIC_KEY, runtimeEnv: env };
    }
    return null;
}

async function readiness(env: WorkerEnv): Promise<Response> {
    env = await configuredEnv(env);
    const combined = env.BABEL_APP === 'combined';
    const pocketOnly = env.BABEL_APP === 'pocket' || env.BABEL_APP === 'babel-pocket';
    const providerChecks = await providerHealth(env);
    const checks = {
        database: false,
        discord: combined
            ? !!(env.BABEL_GUILD_DISCORD_PUBLIC_KEY && env.BABEL_POCKET_DISCORD_PUBLIC_KEY)
            : pocketOnly
              ? !!(env.BABEL_POCKET_DISCORD_PUBLIC_KEY ?? env.DISCORD_PUBLIC_KEY)
              : !!(env.BABEL_GUILD_DISCORD_PUBLIC_KEY ?? env.DISCORD_PUBLIC_KEY),
        provider: Object.values(providerChecks).every((check) => check.status !== 'fail'),
        access: combined
            ? commaSeparatedIds(env.ALLOWED_GUILD_IDS).size > 0 &&
              commaSeparatedIds(env.ALLOWED_USER_IDS).size > 0
            : commaSeparatedIds(pocketOnly ? env.ALLOWED_USER_IDS : env.ALLOWED_GUILD_IDS).size > 0,
        publicOutput:
            pocketOnly ||
            !!(env.BABEL_GUILD_DISCORD_TOKEN ?? env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN),
    };
    try {
        checks.database = !!(await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>())?.ok;
    } catch {
        checks.database = false;
    }
    const ready = Object.values(checks).every(Boolean);
    return json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503);
}

async function probeProvider(
    provider: 'vertex' | 'openai',
    env: WorkerEnv,
): Promise<ProviderHealthCheck> {
    if (!(env.TRANSLATION_PROVIDER ?? 'vertex').split('+').includes(provider)) {
        return { status: 'skip' };
    }
    if (!translationProviderConfigured(provider, env)) {
        return { status: 'fail', error: `${provider} is not configured` };
    }
    const start = Date.now();
    try {
        const probeEnv = { ...env, MAX_OUTPUT_TOKENS: '64' };
        if (provider === 'openai') {
            await translateWithOpenAI('Reply with OK.', probeEnv);
        } else {
            await translateWithVertex('Reply with OK.', probeEnv);
        }
        return { status: 'pass', latencyMs: Date.now() - start };
    } catch (error) {
        return {
            status: 'fail',
            error: sanitizeError(error instanceof Error ? error.message : String(error)),
        };
    }
}

async function providerHealth(
    env: WorkerEnv,
): Promise<Record<'vertexAi' | 'openAi', ProviderHealthCheck>> {
    const key = [
        appProfileId(env),
        env.TRANSLATION_PROVIDER,
        env.GCP_PROJECT,
        env.GEMINI_MODEL,
        env.OPENAI_BASE_URL,
        env.OPENAI_MODEL,
    ].join(':');
    const cached = providerHealthCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.checks;
    const [vertexAi, openAi] = await Promise.all([
        probeProvider('vertex', env),
        probeProvider('openai', env),
    ]);
    const checks = { vertexAi, openAi };
    providerHealthCache.set(key, { checks, expires: Date.now() + 5000 });
    return checks;
}

async function metrics(request: Request, env: WorkerEnv): Promise<Response> {
    const provided =
        request.headers.get('x-metrics-token') ??
        request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const metricsToken = env.BABEL_METRICS_TOKEN ?? env.METRICS_TOKEN;
    if (metricsToken && provided !== metricsToken) {
        return new Response('Unauthorized', { status: 401 });
    }
    const [usage, runtime] = await Promise.all([
        env.DB.prepare(
            'SELECT input_tokens, output_tokens, requests FROM daily_usage WHERE id = 1',
        ).first<UsageRow>(),
        env.DB.prepare(
            `SELECT translations_total, api_calls_total, cache_hits_total, failures_total,
                    rejected_total, provider_fallback_total
             FROM runtime_metrics WHERE app_profile_id = ?`,
        )
            .bind(appProfileId(env))
            .first<{
                translations_total: number;
                api_calls_total: number;
                cache_hits_total: number;
                failures_total: number;
                rejected_total: number;
                provider_fallback_total: number;
            }>(),
    ]);
    return new Response(
        [
            '# HELP babel_worker_info Cloudflare Worker runtime information.',
            '# TYPE babel_worker_info gauge',
            'babel_worker_info{runtime="cloudflare-worker"} 1',
            '# TYPE babel_translations_total counter',
            `babel_translations_total ${runtime?.translations_total ?? 0}`,
            '# TYPE babel_translation_api_calls_total counter',
            `babel_translation_api_calls_total ${runtime?.api_calls_total ?? 0}`,
            '# TYPE babel_translation_cache_hits_total counter',
            `babel_translation_cache_hits_total ${runtime?.cache_hits_total ?? 0}`,
            '# TYPE babel_translation_failures_total counter',
            `babel_translation_failures_total ${runtime?.failures_total ?? 0}`,
            '# TYPE babel_runtime_rejected_total counter',
            `babel_runtime_rejected_total ${runtime?.rejected_total ?? 0}`,
            '# TYPE babel_provider_fallback_total counter',
            `babel_provider_fallback_total ${runtime?.provider_fallback_total ?? 0}`,
            '# TYPE babel_translation_input_tokens_total counter',
            `babel_translation_input_tokens_total ${usage?.input_tokens ?? 0}`,
            '# TYPE babel_translation_output_tokens_total counter',
            `babel_translation_output_tokens_total ${usage?.output_tokens ?? 0}`,
            '',
        ].join('\n'),
        { headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' } },
    );
}

function interactionUserId(interaction: DiscordInteraction): string | null {
    return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function option(interaction: DiscordInteraction, name: string): string | null {
    const value = interaction.data?.options?.find((candidate) => candidate.name === name)?.value;
    return typeof value === 'string' ? value : null;
}

function preferenceGuildId(interaction: DiscordInteraction, env: WorkerEnv): string | null {
    return profileFor(env).accessMode === 'user-install' ? '' : (interaction.guild_id ?? null);
}

function commaSeparatedIds(value: string | undefined): Set<string> {
    return new Set(
        (value ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
    );
}

function billingUserId(interaction: DiscordInteraction): string | null {
    return interaction.authorizing_integration_owners?.['1'] ?? interactionUserId(interaction);
}

function authorized(interaction: DiscordInteraction, env: WorkerEnv): boolean {
    if (profileFor(env).accessMode === 'user-install') {
        const ownerId = billingUserId(interaction);
        return !!ownerId && commaSeparatedIds(env.ALLOWED_USER_IDS).has(ownerId);
    }
    return (
        !!interaction.guild_id && commaSeparatedIds(env.ALLOWED_GUILD_IDS).has(interaction.guild_id)
    );
}

async function getLanguagePreference(
    env: WorkerEnv,
    guildId: string,
    userId: string,
): Promise<string | null> {
    const row = await env.DB.prepare(
        'SELECT language FROM user_language_preferences WHERE guild_id = ? AND user_id = ?',
    )
        .bind(guildId, userId)
        .first<{ language: string }>();
    return row?.language ?? null;
}

async function handleSetlang(interaction: DiscordInteraction, env: WorkerEnv): Promise<Response> {
    const guildId = preferenceGuildId(interaction, env);
    const userId = interactionUserId(interaction);
    const language = option(interaction, 'language');
    if (guildId === null) {
        return ephemeral('Language preferences can only be changed inside a server.');
    }
    if (!userId || !language) return ephemeral('Invalid language preference request.');

    if (language === 'auto') {
        await env.DB.prepare(
            'DELETE FROM user_language_preferences WHERE guild_id = ? AND user_id = ?',
        )
            .bind(guildId, userId)
            .run();
        return ephemeral(discordMessages.languagePreferenceCleared());
    }

    await env.DB.prepare(
        `INSERT INTO user_language_preferences (guild_id, user_id, language)
         VALUES (?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET language = excluded.language`,
    )
        .bind(guildId, userId, language)
        .run();
    return ephemeral(discordMessages.languageTargetSet(language));
}

async function handleMylang(interaction: DiscordInteraction, env: WorkerEnv): Promise<Response> {
    const guildId = preferenceGuildId(interaction, env);
    const userId = interactionUserId(interaction);
    const locale = interaction.locale ?? 'en-US';
    const preference =
        guildId !== null && userId ? await getLanguagePreference(env, guildId, userId) : null;
    const localeLanguage = localeToLang(locale);

    if (preference) {
        return ephemeral(
            discordMessages.currentLanguageFromPreference(
                getDiscordLanguageName(preference),
                preference,
            ),
        );
    }
    if (localeLanguage) {
        return ephemeral(
            discordMessages.currentLanguageFromLocale(
                getDiscordLanguageName(localeLanguage),
                locale,
            ),
        );
    }
    return ephemeral(discordMessages.currentLanguageAuto(locale));
}

function handleHelp(interaction: DiscordInteraction, env: WorkerEnv): Response {
    const profile = profileFor(env);
    const chinese = interaction.locale?.startsWith('zh');
    const translate = profile.enableTranslateCommand
        ? chinese
            ? '\n\n**快速翻譯**\n使用 `/translate` 翻譯輸入的文字。'
            : '\n\n**Quick translation**\nUse `/translate` to translate entered text.'
        : '';
    const content = chinese
        ? `## ${profile.productName}\n\n**翻譯訊息**\n右鍵或長按訊息 → 應用程式 → **${profile.commandName}**。${translate}\n\n使用 \`/setlang\` 設定語言，\`/mylang\` 查看設定。`
        : `## ${profile.productName}\n\n**Translate a message**\nRight-click or long-press a message → Apps → **${profile.commandName}**.${translate}\n\nUse \`/setlang\` to set a language and \`/mylang\` to view it.`;
    return ephemeral(content);
}

function targetMessageText(interaction: DiscordInteraction): string {
    const targetId = interaction.data?.target_id;
    const message = targetId ? interaction.data?.resolved?.messages?.[targetId] : undefined;
    if (!message) return '';
    return extractTranslatableMessageText({
        content: message.content,
        embeds: message.embeds,
        attachments: message.attachments,
        reference: { messageId: message.message_reference?.message_id },
    });
}

async function targetLanguage(interaction: DiscordInteraction, env: WorkerEnv): Promise<string> {
    const explicit = option(interaction, 'to');
    if (explicit && explicit !== 'auto') return explicit;

    const guildId = preferenceGuildId(interaction, env);
    const userId = interactionUserId(interaction);
    if (guildId !== null && userId) {
        const preference = await getLanguagePreference(env, guildId, userId);
        if (preference) return preference;
    }
    return localeToLang(interaction.locale) ?? 'auto';
}

function boundedInteger(value: string | undefined, fallback: number, max: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function nonNegativeNumber(value: string | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

type RuntimeMetricColumn =
    | 'translations_total'
    | 'api_calls_total'
    | 'cache_hits_total'
    | 'cache_misses_total'
    | 'failures_total'
    | 'budget_exceeded_total'
    | 'rejected_total'
    | 'provider_fallback_total'
    | 'vertex_success_total'
    | 'vertex_failure_total'
    | 'vertex_fallback_from_total'
    | 'vertex_fallback_to_total'
    | 'openai_success_total'
    | 'openai_failure_total'
    | 'openai_fallback_from_total'
    | 'openai_fallback_to_total';

function appProfileId(env: WorkerEnv): string {
    return profileFor(env).id;
}

async function incrementMetrics(env: WorkerEnv, columns: RuntimeMetricColumn[]): Promise<void> {
    if (columns.length === 0) return;
    const unique = [...new Set(columns)];
    await env.DB.prepare(
        `INSERT INTO runtime_metrics (app_profile_id, ${unique.join(', ')})
         VALUES (?, ${unique.map(() => '1').join(', ')})
         ON CONFLICT (app_profile_id) DO UPDATE SET
             ${unique.map((column) => `${column} = ${column} + 1`).join(', ')}`,
    )
        .bind(appProfileId(env))
        .run();
}

async function translationCacheKey(
    text: string,
    language: string,
    prompt: string,
    glossary: Awaited<ReturnType<typeof glossaryEntries>>,
    env: WorkerEnv,
): Promise<string> {
    const fingerprint = JSON.stringify({
        text,
        language,
        prompt,
        glossary: buildGlossaryVersion(glossary),
        provider: env.TRANSLATION_PROVIDER,
        vertex: [env.GCP_PROJECT, env.GCP_LOCATION, env.GEMINI_MODEL, env.VERTEX_AI_API_KEY],
        openai: [env.OPENAI_BASE_URL, env.OPENAI_MODEL, env.OPENAI_API_KEY],
        maxOutputTokens: env.MAX_OUTPUT_TOKENS,
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
        '',
    );
}

async function cachedTranslation(
    env: WorkerEnv,
    cacheKey: string,
    recordMiss = true,
): Promise<CachedTranslationRow | null> {
    const row = await env.DB.prepare(
        `SELECT translated_text, provider FROM translation_cache
         WHERE app_profile_id = ? AND cache_key = ?`,
    )
        .bind(appProfileId(env), cacheKey)
        .first<CachedTranslationRow>();
    if (!row) {
        if (recordMiss) await incrementMetrics(env, ['cache_misses_total']);
        return null;
    }
    await env.DB.batch([
        env.DB.prepare(
            `UPDATE translation_cache SET last_accessed = ?
             WHERE app_profile_id = ? AND cache_key = ?`,
        ).bind(Date.now(), appProfileId(env), cacheKey),
        env.DB.prepare(
            `INSERT INTO runtime_metrics (app_profile_id, translations_total, cache_hits_total)
             VALUES (?, 1, 1)
             ON CONFLICT (app_profile_id) DO UPDATE SET
                 translations_total = translations_total + 1,
                 cache_hits_total = cache_hits_total + 1`,
        ).bind(appProfileId(env)),
    ]);
    return row;
}

async function cacheTranslation(
    env: WorkerEnv,
    cacheKey: string,
    result: TranslationResult,
): Promise<void> {
    const maxSize = boundedInteger(env.CACHE_MAX_SIZE, 2000, 10_000);
    await env.DB.batch([
        env.DB.prepare(
            `INSERT INTO translation_cache
                (app_profile_id, cache_key, translated_text, provider, last_accessed)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (app_profile_id, cache_key) DO UPDATE SET
                 translated_text = excluded.translated_text,
                 provider = excluded.provider,
                 last_accessed = excluded.last_accessed`,
        ).bind(appProfileId(env), cacheKey, result.text, result.provider, Date.now()),
        env.DB.prepare(
            `DELETE FROM translation_cache
             WHERE app_profile_id = ? AND cache_key NOT IN (
                 SELECT cache_key FROM translation_cache WHERE app_profile_id = ?
                 ORDER BY last_accessed DESC LIMIT ?
             )`,
        ).bind(appProfileId(env), appProfileId(env), maxSize),
    ]);
}

async function cooldown(interaction: DiscordInteraction, env: WorkerEnv) {
    const userId = interactionUserId(interaction);
    if (!userId) return { allowed: false, remaining: 1 };
    const now = Date.now();
    const expiresAt = now + boundedInteger(env.COOLDOWN_SECONDS, 5, 300) * 1000;
    const key = `${appProfileId(env)}:${userId}`;
    const accepted = await env.DB.prepare(
        `INSERT INTO cooldowns (scope_key, expires_at) VALUES (?, ?)
         ON CONFLICT (scope_key) DO UPDATE SET expires_at = excluded.expires_at
         WHERE cooldowns.expires_at <= ?
         RETURNING expires_at`,
    )
        .bind(key, expiresAt, now)
        .first<{ expires_at: number }>();
    if (accepted) return { allowed: true, remaining: 0 };
    const current = await env.DB.prepare('SELECT expires_at FROM cooldowns WHERE scope_key = ?')
        .bind(key)
        .first<{ expires_at: number }>();
    return {
        allowed: false,
        remaining: Math.max(Math.ceil(((current?.expires_at ?? expiresAt) - now) / 1000), 1),
    };
}

async function withRuntimeLease<T>(
    env: WorkerEnv,
    scope: { guildId?: string | null; userId?: string },
    task: () => Promise<T>,
): Promise<T> {
    const profileId = appProfileId(env);
    const leaseId = crypto.randomUUID();
    const userId = scope.userId ?? 'dashboard-admin';
    const guildId = scope.guildId ?? '__unknown_guild__';
    const createdAt = Date.now();
    const maxConcurrent = boundedInteger(env.TRANSLATION_MAX_CONCURRENT, 4, 100);
    const maxGlobalQueue = boundedInteger(env.TRANSLATION_MAX_GLOBAL_QUEUE, 25, 1000);
    const maxGuildQueue = boundedInteger(env.TRANSLATION_MAX_GUILD_QUEUE, 5, 100);
    const maxUserOutstanding = boundedInteger(env.TRANSLATION_MAX_USER_OUTSTANDING, 1, 20);
    // ponytail: D1 polling keeps admission global without another Cloudflare product. Move this
    // queue to a Durable Object if sustained queue traffic makes the polling writes material.
    const maxQueueWaitMs = Math.min(
        boundedInteger(env.TRANSLATION_MAX_QUEUE_WAIT_MS, 30_000, 120_000),
        5000,
    );

    await env.DB.batch([
        env.DB.prepare('DELETE FROM runtime_leases WHERE expires_at <= ?').bind(createdAt),
        env.DB.prepare(
            `INSERT INTO runtime_leases
                (lease_id, app_profile_id, user_id, guild_id, status, created_at, expires_at)
             VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
        ).bind(leaseId, profileId, userId, guildId, createdAt, createdAt + maxQueueWaitMs + 25_000),
    ]);

    const rank = await env.DB.prepare(
        `SELECT
             (SELECT COUNT(*) FROM runtime_leases
              WHERE app_profile_id = ? AND user_id = ?
                AND (created_at < ? OR (created_at = ? AND lease_id <= ?))) AS user_rank,
             (SELECT COUNT(*) FROM runtime_leases
              WHERE app_profile_id = ? AND status = 'queued'
                AND (created_at < ? OR (created_at = ? AND lease_id <= ?))) AS global_queue_rank,
             (SELECT COUNT(*) FROM runtime_leases
              WHERE app_profile_id = ? AND guild_id = ? AND status = 'queued'
                AND (created_at < ? OR (created_at = ? AND lease_id <= ?))) AS guild_queue_rank`,
    )
        .bind(
            profileId,
            userId,
            createdAt,
            createdAt,
            leaseId,
            profileId,
            createdAt,
            createdAt,
            leaseId,
            profileId,
            guildId,
            createdAt,
            createdAt,
            leaseId,
        )
        .first<{ user_rank: number; global_queue_rank: number; guild_queue_rank: number }>();

    const rejection =
        (rank?.user_rank ?? 1) > maxUserOutstanding
            ? 'user'
            : (rank?.guild_queue_rank ?? 1) > maxGuildQueue
              ? 'guild'
              : (rank?.global_queue_rank ?? 1) > maxGlobalQueue
                ? 'global'
                : null;
    if (rejection) {
        await Promise.all([
            env.DB.prepare('DELETE FROM runtime_leases WHERE lease_id = ?').bind(leaseId).run(),
            incrementMetrics(env, ['rejected_total']),
        ]);
        throw new Error(
            rejection === 'user'
                ? 'You already have a translation in progress. Please wait a moment.'
                : rejection === 'guild'
                  ? 'This server is handling too many translations right now.'
                  : 'Translation service is busy right now. Please try again in a moment.',
        );
    }

    const deadline = createdAt + maxQueueWaitMs;
    let active = false;
    while (Date.now() <= deadline) {
        const now = Date.now();
        const activated = await env.DB.prepare(
            `UPDATE runtime_leases SET status = 'active', expires_at = ?
             WHERE lease_id = ? AND status = 'queued'
               AND (SELECT COUNT(*) FROM runtime_leases
                    WHERE app_profile_id = ? AND status = 'active' AND expires_at > ?) < ?
               AND lease_id = (SELECT lease_id FROM runtime_leases
                    WHERE app_profile_id = ? AND status = 'queued' AND expires_at > ?
                    ORDER BY created_at, lease_id LIMIT 1)
             RETURNING lease_id`,
        )
            .bind(now + 25_000, leaseId, profileId, now, maxConcurrent, profileId, now)
            .first<{ lease_id: string }>();
        if (activated) {
            active = true;
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!active) {
        await Promise.all([
            env.DB.prepare('DELETE FROM runtime_leases WHERE lease_id = ?').bind(leaseId).run(),
            incrementMetrics(env, ['rejected_total']),
        ]);
        throw new Error('Translation service is busy right now. Please try again in a moment.');
    }

    try {
        return await task();
    } finally {
        await env.DB.prepare('DELETE FROM runtime_leases WHERE lease_id = ?').bind(leaseId).run();
    }
}

async function recordPendingUser(interaction: DiscordInteraction, env: WorkerEnv): Promise<void> {
    const userId = billingUserId(interaction);
    if (!userId) return;
    await env.DB.prepare(
        `INSERT INTO pending_user_install_owners (user_id, last_seen_at) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
        .bind(userId, new Date().toISOString())
        .run();
}

function usageCost(usage: UsageRow | null, env: WorkerEnv): number {
    if (!usage) return 0;
    return (
        (usage.input_tokens / 1_000_000) * nonNegativeNumber(env.INPUT_PRICE_PER_MILLION) +
        (usage.output_tokens / 1_000_000) * nonNegativeNumber(env.OUTPUT_PRICE_PER_MILLION)
    );
}

async function globalUsage(env: WorkerEnv, date: string): Promise<UsageRow | null> {
    return env.DB.prepare(
        `SELECT
            MAX(d.input_tokens - COALESCE(SUM(g.input_tokens), 0), 0) AS input_tokens,
            MAX(d.output_tokens - COALESCE(SUM(g.output_tokens), 0), 0) AS output_tokens,
            MAX(d.requests - COALESCE(SUM(g.requests), 0), 0) AS requests
         FROM daily_usage d
         LEFT JOIN guild_daily_usage g
           ON g.date = d.date
          AND g.guild_id IN (SELECT guild_id FROM guild_budgets)
         WHERE d.id = 1 AND d.date = ?
         GROUP BY d.id`,
    )
        .bind(date)
        .first<UsageRow>();
}

async function scopedUsage(
    env: WorkerEnv,
    kind: 'guild' | 'user',
    id: string,
    date: string,
): Promise<UsageRow | null> {
    const idColumn = kind === 'guild' ? 'guild_id' : 'user_id';
    return env.DB.prepare(
        `SELECT input_tokens, output_tokens, requests
         FROM ${kind}_daily_usage
         WHERE ${idColumn} = ? AND date = ?`,
    )
        .bind(id, date)
        .first<UsageRow>();
}

async function wouldExceedBudget(
    interaction: DiscordInteraction,
    text: string,
    env: WorkerEnv,
): Promise<boolean> {
    const estimatedCost =
        (Math.ceil(text.length / 4) / 1_000_000) * nonNegativeNumber(env.INPUT_PRICE_PER_MILLION) +
        (boundedInteger(env.MAX_OUTPUT_TOKENS, 1000, 8192) / 1_000_000) *
            nonNegativeNumber(env.OUTPUT_PRICE_PER_MILLION);
    if (estimatedCost === 0) return false;

    const date = new Date().toISOString().slice(0, 10);
    const globalBudget = nonNegativeNumber(env.DAILY_BUDGET_USD);

    if (profileFor(env).accessMode === 'user-install') {
        const userId = billingUserId(interaction);
        if (!userId) return true;
        const override = await env.DB.prepare(
            'SELECT daily_budget_usd FROM user_budgets WHERE user_id = ?',
        )
            .bind(userId)
            .first<{ daily_budget_usd: number }>();
        const userBudget =
            override?.daily_budget_usd ?? nonNegativeNumber(env.DEFAULT_USER_DAILY_BUDGET_USD);
        if (
            userBudget > 0 &&
            usageCost(await scopedUsage(env, 'user', userId, date), env) + estimatedCost >=
                userBudget
        ) {
            return true;
        }
        return (
            globalBudget > 0 &&
            usageCost(await globalUsage(env, date), env) + estimatedCost >= globalBudget
        );
    }

    const guildId = interaction.guild_id;
    if (!guildId) return true;
    const override = await env.DB.prepare(
        'SELECT daily_budget_usd FROM guild_budgets WHERE guild_id = ?',
    )
        .bind(guildId)
        .first<{ daily_budget_usd: number }>();
    if (override) {
        return (
            override.daily_budget_usd > 0 &&
            usageCost(await scopedUsage(env, 'guild', guildId, date), env) + estimatedCost >=
                override.daily_budget_usd
        );
    }
    return (
        globalBudget > 0 &&
        usageCost(await globalUsage(env, date), env) + estimatedCost >= globalBudget
    );
}

function usageUpsert(
    env: WorkerEnv,
    table: 'daily_usage' | 'guild_daily_usage' | 'user_daily_usage',
    idColumn: 'id' | 'guild_id' | 'user_id',
    id: number | string,
    date: string,
    inputTokens: number,
    outputTokens: number,
): D1PreparedStatement {
    return env.DB.prepare(
        `INSERT INTO ${table} (${idColumn}, date, input_tokens, output_tokens, requests)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (${idColumn}) DO UPDATE SET
             input_tokens = CASE WHEN ${table}.date = excluded.date
                 THEN ${table}.input_tokens + excluded.input_tokens ELSE excluded.input_tokens END,
             output_tokens = CASE WHEN ${table}.date = excluded.date
                 THEN ${table}.output_tokens + excluded.output_tokens ELSE excluded.output_tokens END,
             requests = CASE WHEN ${table}.date = excluded.date
                 THEN ${table}.requests + 1 ELSE 1 END,
             date = excluded.date`,
    ).bind(id, date, inputTokens, outputTokens);
}

function usageArchive(
    env: WorkerEnv,
    kind: 'global' | 'guild' | 'user',
    id: number | string,
    date: string,
): D1PreparedStatement {
    if (kind === 'global') {
        return env.DB.prepare(
            `INSERT INTO usage_history (date, input_tokens, output_tokens, requests)
             SELECT date, input_tokens, output_tokens, requests
             FROM daily_usage WHERE id = ? AND date <> ?
             ON CONFLICT (date) DO UPDATE SET
                 input_tokens = excluded.input_tokens,
                 output_tokens = excluded.output_tokens,
                 requests = excluded.requests`,
        ).bind(id, date);
    }
    const idColumn = kind === 'guild' ? 'guild_id' : 'user_id';
    return env.DB.prepare(
        `INSERT INTO ${kind}_usage_history
             (${idColumn}, date, input_tokens, output_tokens, requests)
         SELECT ${idColumn}, date, input_tokens, output_tokens, requests
         FROM ${kind}_daily_usage WHERE ${idColumn} = ? AND date <> ?
         ON CONFLICT (${idColumn}, date) DO UPDATE SET
             input_tokens = excluded.input_tokens,
             output_tokens = excluded.output_tokens,
             requests = excluded.requests`,
    ).bind(id, date);
}

async function recordUsage(
    interaction: DiscordInteraction,
    inputTokens: number,
    outputTokens: number,
    env: WorkerEnv,
): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const statements = [
        usageArchive(env, 'global', 1, date),
        usageUpsert(env, 'daily_usage', 'id', 1, date, inputTokens, outputTokens),
    ];
    if (profileFor(env).accessMode === 'user-install') {
        const userId = billingUserId(interaction);
        if (userId) {
            statements.push(
                usageArchive(env, 'user', userId, date),
                usageUpsert(
                    env,
                    'user_daily_usage',
                    'user_id',
                    userId,
                    date,
                    inputTokens,
                    outputTokens,
                ),
            );
        }
    } else if (interaction.guild_id) {
        statements.push(
            usageArchive(env, 'guild', interaction.guild_id, date),
            usageUpsert(
                env,
                'guild_daily_usage',
                'guild_id',
                interaction.guild_id,
                date,
                inputTokens,
                outputTokens,
            ),
        );
    }
    await env.DB.batch(statements);
}

async function glossaryEntries(
    interaction: DiscordInteraction,
    targetLanguage: string,
    env: WorkerEnv,
) {
    if (
        profileFor(env).accessMode !== 'guild' ||
        !interaction.guild_id ||
        env.ENABLE_GUILD_GLOSSARY === 'false'
    ) {
        return [];
    }
    const { results } = await env.DB.prepare(
        `SELECT id, guild_id, source_text, target_language, target_text, notes, created_at, updated_at
         FROM guild_glossary
         WHERE guild_id = ?
         ORDER BY id`,
    )
        .bind(interaction.guild_id)
        .all<GlossaryRow>();
    return selectGlossaryEntriesForTarget(
        results.map((row) => ({
            id: row.id,
            guildId: row.guild_id,
            sourceText: row.source_text,
            targetLanguage: row.target_language,
            targetText: row.target_text,
            notes: row.notes,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
        targetLanguage,
    );
}

async function providerFetch(url: string, init: RequestInit): Promise<Response> {
    // ponytail: one 10s attempt keeps waitUntil below 30s; move retries to a Queue if needed.
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (response.ok) return response;
    const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`Provider returned ${response.status}${detail ? `: ${detail}` : ''}`);
}

function translationProviderConfigured(provider: string, env: WorkerEnv): boolean {
    return provider === 'openai'
        ? !!(env.OPENAI_API_KEY && env.OPENAI_BASE_URL && env.OPENAI_MODEL)
        : !!(env.VERTEX_AI_API_KEY && env.GCP_PROJECT);
}

function breakerKey(provider: string, env: WorkerEnv): string {
    return `${appProfileId(env)}:${provider}`;
}

function providerAvailable(provider: string, env: WorkerEnv): boolean {
    return (providerBreakers.get(breakerKey(provider, env))?.openUntil ?? 0) <= Date.now();
}

function providerSucceeded(provider: string, env: WorkerEnv): void {
    providerBreakers.delete(breakerKey(provider, env));
}

function providerFailed(provider: string, env: WorkerEnv): void {
    const key = breakerKey(provider, env);
    const current = providerBreakers.get(key) ?? { failures: 0, openUntil: 0 };
    const failures = current.failures + 1;
    providerBreakers.set(key, {
        failures,
        openUntil: failures >= 3 ? Date.now() + 60_000 : 0,
    });
}

async function translateWithVertex(prompt: string, env: WorkerEnv): Promise<TranslationResult> {
    if (!env.VERTEX_AI_API_KEY || !env.GCP_PROJECT) throw new Error('Vertex AI is not configured.');
    const location = env.GCP_LOCATION || 'global';
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const host =
        location === 'global'
            ? 'https://aiplatform.googleapis.com'
            : `https://${location}-aiplatform.googleapis.com`;
    const response = await providerFetch(
        `${host}/v1beta1/projects/${env.GCP_PROJECT}/locations/${location}/publishers/google/models/${model}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': env.VERTEX_AI_API_KEY,
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: boundedInteger(env.MAX_OUTPUT_TOKENS, 1000, 8192),
                    temperature: 0.1,
                },
            }),
        },
    );
    const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Vertex AI returned an empty translation.');
    return {
        text,
        provider: 'vertex',
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
}

async function translateWithOpenAI(prompt: string, env: WorkerEnv): Promise<TranslationResult> {
    if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL || !env.OPENAI_MODEL) {
        throw new Error('OpenAI provider is not configured.');
    }
    const response = await providerFetch(
        `${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/v1/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: env.OPENAI_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: boundedInteger(env.MAX_OUTPUT_TOKENS, 1000, 8192),
                temperature: 0.1,
            }),
        },
    );
    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI provider returned an empty translation.');
    return {
        text,
        provider: 'openai',
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
    };
}

async function translateText(
    text: string,
    language: string,
    env: WorkerEnv,
    glossary: Awaited<ReturnType<typeof glossaryEntries>>,
    scope: { guildId?: string | null; userId?: string } = {},
): Promise<TranslationResult> {
    const prompt = buildTranslationPrompt(text, language, env.TRANSLATION_PROMPT, glossary);
    const cacheKey = await translationCacheKey(text, language, prompt, glossary, env);
    const cached = await cachedTranslation(env, cacheKey);
    if (cached) {
        return {
            text: cached.translated_text,
            provider: cached.provider,
            inputTokens: 0,
            outputTokens: 0,
            cached: true,
            fallback: false,
        };
    }

    return withRuntimeLease(env, scope, async () => {
        const queuedCached = await cachedTranslation(env, cacheKey, false);
        if (queuedCached) {
            return {
                text: queuedCached.translated_text,
                provider: queuedCached.provider,
                inputTokens: 0,
                outputTokens: 0,
                cached: true,
                fallback: false,
            };
        }

        const mode = env.TRANSLATION_PROVIDER ?? 'vertex';
        const configured = mode
            .split('+')
            .filter((provider) => translationProviderConfigured(provider, env));
        if (configured.length === 0) {
            await incrementMetrics(env, ['failures_total']);
            throw new Error(
                'No translation provider is configured. Please complete setup in the dashboard.',
            );
        }
        const providers = configured.filter((provider) => providerAvailable(provider, env));
        if (providers.length === 0) {
            await incrementMetrics(env, ['failures_total']);
            throw new Error('All configured translation providers are temporarily unavailable.');
        }
        await incrementMetrics(env, ['api_calls_total']);
        let lastError: unknown;

        for (const [index, provider] of providers.entries()) {
            let result: TranslationResult;
            try {
                result =
                    provider === 'openai'
                        ? await translateWithOpenAI(prompt, env)
                        : await translateWithVertex(prompt, env);
            } catch (error) {
                lastError = error;
                providerFailed(provider, env);
                await incrementMetrics(env, [
                    provider === 'openai' ? 'openai_failure_total' : 'vertex_failure_total',
                ]);
                continue;
            }

            providerSucceeded(provider, env);
            const metrics: RuntimeMetricColumn[] = [
                'translations_total',
                provider === 'openai' ? 'openai_success_total' : 'vertex_success_total',
            ];
            if (index > 0) {
                metrics.push(
                    'provider_fallback_total',
                    provider === 'openai' ? 'openai_fallback_to_total' : 'vertex_fallback_to_total',
                    providers[0] === 'openai'
                        ? 'openai_fallback_from_total'
                        : 'vertex_fallback_from_total',
                );
            }
            await Promise.all([
                cacheTranslation(env, cacheKey, result),
                incrementMetrics(env, metrics),
            ]);
            return { ...result, cached: false, fallback: index > 0 };
        }
        await incrementMetrics(env, ['failures_total']);
        throw lastError ?? new Error('No translation provider is configured.');
    });
}

function botToken(env: WorkerEnv): string | null {
    return profileFor(env).id === 'babel-pocket'
        ? (env.BABEL_POCKET_DISCORD_TOKEN ?? env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN ?? null)
        : (env.BABEL_GUILD_DISCORD_TOKEN ?? env.DISCORD_BOT_TOKEN ?? env.DISCORD_TOKEN ?? null);
}

async function discordBotRequest(
    path: string,
    method: 'GET' | 'POST',
    token: string,
    body?: unknown,
): Promise<Response> {
    const response = await fetch(`${DISCORD_API}${path}`, {
        method,
        headers: {
            Authorization: `Bot ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        throw new Error(`Discord API returned ${response.status}`);
    }
    return response;
}

async function getTranslationWebhook(
    interaction: DiscordInteraction,
    env: WorkerEnv,
): Promise<Required<Pick<DiscordWebhookObject, 'id' | 'token'>>> {
    if (!interaction.channel_id) throw new Error('Discord channel is unavailable.');
    const token = botToken(env);
    if (!token) throw new Error('Discord bot token is not configured.');

    const existing = (await (
        await discordBotRequest(`/channels/${interaction.channel_id}/webhooks`, 'GET', token)
    ).json()) as DiscordWebhookObject[];
    let webhook = existing.find(
        (candidate) =>
            candidate.name === 'Babel' &&
            candidate.user?.id === interaction.application_id &&
            candidate.token,
    );
    if (!webhook) {
        webhook = (await (
            await discordBotRequest(`/channels/${interaction.channel_id}/webhooks`, 'POST', token, {
                name: 'Babel',
            })
        ).json()) as DiscordWebhookObject;
    }
    if (!webhook.id || !webhook.token) throw new Error('Discord webhook token is unavailable.');
    return { id: webhook.id, token: webhook.token };
}

function interactionDisplay(interaction: DiscordInteraction): {
    username: string;
    avatarUrl?: string;
} {
    const user = interaction.member?.user ?? interaction.user;
    const username =
        interaction.member?.nick || user?.global_name || user?.username || 'Babel User';
    const avatarUrl =
        user?.id && user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : undefined;
    return { username, ...(avatarUrl ? { avatarUrl } : {}) };
}

async function sendPublicTranslations(
    interaction: DiscordInteraction,
    messages: string[],
    env: WorkerEnv,
): Promise<void> {
    const webhook = await getTranslationWebhook(interaction, env);
    const display = interactionDisplay(interaction);
    for (const content of messages) {
        const response = await fetch(
            `${DISCORD_API}/webhooks/${webhook.id}/${webhook.token}?wait=true`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    username: display.username,
                    avatar_url: display.avatarUrl,
                    allowed_mentions: { parse: [] },
                }),
            },
        );
        if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
    }
}

async function discordWebhook(
    interaction: DiscordInteraction,
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
): Promise<void> {
    const response = await fetch(
        `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}${path}`,
        {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        },
    );
    if (!response.ok) throw new Error(`Discord webhook returned ${response.status}`);
}

async function editTranslationReply(
    interaction: DiscordInteraction,
    messages: string[],
    ephemeralReply: boolean,
): Promise<void> {
    await discordWebhook(interaction, '/messages/@original', 'PATCH', {
        content: messages[0] ?? '',
    });
    for (const content of messages.slice(1)) {
        await discordWebhook(interaction, '', 'POST', {
            content,
            flags: ephemeralReply ? EPHEMERAL : undefined,
        });
    }
}

async function processTranslation(
    interaction: DiscordInteraction,
    env: WorkerEnv,
    publicOutput: boolean,
): Promise<void> {
    try {
        const contextCommand = interaction.data?.type === COMMAND_MESSAGE;
        const text = contextCommand
            ? targetMessageText(interaction)
            : (option(interaction, 'text') ?? '');
        const language = await targetLanguage(interaction, env);
        const maxInputLength = boundedInteger(env.MAX_INPUT_LENGTH, 2000, 20_000);

        if (!text.trim()) {
            await editTranslationReply(interaction, ['No text content'], true);
            return;
        }
        if (text.length > maxInputLength) {
            await editTranslationReply(
                interaction,
                [discordMessages.textTooLong(text.length, maxInputLength)],
                true,
            );
            return;
        }
        if (await wouldExceedBudget(interaction, text, env)) {
            await incrementMetrics(env, ['budget_exceeded_total']);
            await editTranslationReply(interaction, ['Daily budget exceeded'], true);
            return;
        }
        if (isSameLanguage(text, language, interaction.locale)) {
            await editTranslationReply(
                interaction,
                ['This message is already in your language!'],
                true,
            );
            return;
        }

        const glossary = await glossaryEntries(interaction, language, env);
        const result = await translateText(text, language, env, glossary, {
            guildId: interaction.guild_id ?? null,
            userId: billingUserId(interaction) ?? interactionUserId(interaction) ?? 'unknown',
        });
        if (!result.cached) {
            await recordUsage(interaction, result.inputTokens, result.outputTokens, env);
        }
        await recordWorkerLog(env, 'translation', {
            guildId: interaction.guild_id ?? null,
            guildName: interaction.guild_id ?? 'Direct Message',
            userId: interactionUserId(interaction) ?? 'unknown',
            userTag: interaction.member?.user?.username ?? interaction.user?.username ?? 'Unknown',
            contentPreview: text.slice(0, 50),
            cached: result.cached ?? false,
            targetLanguage: language,
            langSource: option(interaction, 'to') ? 'command' : 'preference',
            provider: result.provider,
        }).catch(() => undefined);
        const messages = buildTranslationMessages({
            originalText: text,
            translatedText: result.text,
            targetLanguage: language,
            cached: result.cached ?? false,
            provider: result.provider,
            includeOriginalPreview: contextCommand,
        });
        if (publicOutput) {
            await sendPublicTranslations(interaction, messages, env);
            await discordWebhook(interaction, '/messages/@original', 'DELETE');
        } else {
            await editTranslationReply(interaction, messages, true);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const diagnostic = classifyTranslationError(message);
        console.error('translation.failed', { error: message });
        await recordWorkerLog(env, 'error', {
            guildId: interaction.guild_id ?? null,
            guildName: interaction.guild_id ?? 'Direct Message',
            userId: interactionUserId(interaction) ?? 'unknown',
            userTag: interaction.member?.user?.username ?? interaction.user?.username ?? 'Unknown',
            error: sanitizeError(message),
            command: interaction.data?.name ?? 'unknown',
            errorType: diagnostic.errorType,
            suggestedAction: diagnostic.suggestedAction,
        }).catch(() => undefined);
        await editTranslationReply(
            interaction,
            [discordMessages.translationFailed(sanitizeError(message))],
            true,
        );
    }
}

export async function handleInteraction(
    interaction: DiscordInteraction,
    env: WorkerEnv,
    ctx: WorkerExecutionContext,
): Promise<Response> {
    if (interaction.type === INTERACTION_PING) return json({ type: RESPONSE_PONG });
    env = await configuredEnv(env);
    if (interaction.type !== INTERACTION_APPLICATION_COMMAND || !interaction.data?.name) {
        return ephemeral('Unsupported interaction.');
    }

    switch (interaction.data.name) {
        case 'setlang':
            return handleSetlang(interaction, env);
        case 'mylang':
            return handleMylang(interaction, env);
        case 'help':
            return handleHelp(interaction, env);
    }

    const profile = profileFor(env);
    const isContextCommand =
        interaction.data.type === COMMAND_MESSAGE && interaction.data.name === profile.commandName;
    if (interaction.data.name !== 'translate' && !isContextCommand) {
        return ephemeral('Unknown command.');
    }
    if (!authorized(interaction, env)) {
        if (profile.accessMode === 'user-install') {
            await recordPendingUser(interaction, env);
        }
        return ephemeral(
            profile.accessMode === 'user-install'
                ? discordMessages.unauthorizedUser()
                : discordMessages.unauthorizedGuild(),
        );
    }
    if (env.SETUP_COMPLETE !== 'true') {
        return ephemeral('Bot not configured yet. Please complete setup in the dashboard.');
    }

    const cooldownState = await cooldown(interaction, env);
    if (!cooldownState.allowed) {
        return ephemeral(discordMessages.cooldownRemaining(cooldownState.remaining));
    }

    const publicOutput = !isContextCommand && option(interaction, 'visibility') !== 'private';
    ctx.waitUntil(processTranslation(interaction, env, publicOutput));
    return json({
        type: RESPONSE_DEFERRED_CHANNEL_MESSAGE,
        data: { flags: EPHEMERAL },
    });
}

export default {
    async fetch(request: Request, env: WorkerEnv, ctx: WorkerExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === 'GET' && url.pathname === '/livez') {
            return json({ status: 'ok', runtime: 'cloudflare-worker' });
        }
        if (request.method === 'GET' && url.pathname === '/readyz') {
            return readiness(env);
        }
        if (request.method === 'GET' && url.pathname === '/healthz') {
            return readiness(env);
        }
        if (request.method === 'GET' && url.pathname === '/metrics') {
            return metrics(request, env);
        }
        const dashboard = await handleDashboardRequest(request, env, {
            translate: async (text, targetLanguage, runtimeEnv) =>
                translateText(text, targetLanguage, runtimeEnv, []),
            resetProviderState: () => {
                providerBreakers.clear();
                providerHealthCache.clear();
            },
            providerHealth,
        });
        if (dashboard) return dashboard;
        const endpoint = interactionEndpoint(url.pathname, env);
        if (request.method !== 'POST' || !endpoint) {
            return staticAsset(request, env);
        }

        const signature = request.headers.get('x-signature-ed25519');
        const timestamp = request.headers.get('x-signature-timestamp');
        if (!endpoint.publicKey || !signature || !timestamp) {
            return new Response('Invalid request signature', { status: 401 });
        }

        const body = new Uint8Array(await request.arrayBuffer());
        if (!(await verifyDiscordRequest(endpoint.publicKey, signature, timestamp, body))) {
            return new Response('Invalid request signature', { status: 401 });
        }

        let interaction: DiscordInteraction;
        try {
            interaction = JSON.parse(new TextDecoder().decode(body)) as DiscordInteraction;
        } catch {
            return new Response('Invalid interaction', { status: 400 });
        }

        try {
            return await handleInteraction(interaction, endpoint.runtimeEnv, ctx);
        } catch (error) {
            console.error('interaction.failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return ephemeral('Service temporarily unavailable.');
        }
    },
};
