#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DEFAULT_PUBLIC_DIR = join(ROOT_DIR, 'src', 'public');
const DEFAULT_DEMO_DIR = join(ROOT_DIR, 'docs', 'demo');
const DEMO_NOW = Date.parse('2026-06-01T12:00:00.000Z');

interface BuildDashboardDemoOptions {
    publicDir?: string;
    demoDir?: string;
}

type DemoAppKind = 'guild' | 'pocket';

interface DemoVariant {
    kind: DemoAppKind;
    pathSegment: string;
    title: string;
    productName: string;
    commandName: string;
    accessMode: 'guild' | 'user-install';
    botName: string;
}

interface DemoConfigFixture {
    vertexAiApiKey: string;
    hasApiKey: boolean;
    visionApiKey: string;
    hasVisionApiKey: boolean;
    gcpProject: string;
    gcpLocation: string;
    geminiModel: string;
    vertexAiSupportsImages: boolean;
    geminiMediaResolution: 'default' | 'low' | 'medium' | 'high';
    allowedGuildIds: string[];
    lensEnabledGuildIds: string[];
    allowedUserIds: string[];
    cooldownSeconds: number;
    cacheMaxSize: number;
    setupComplete: boolean;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    dailyBudgetUsd: number;
    visionMonthlyImageLimit: number;
    visionUsage: {
        month: string;
        images: number;
        limit: number;
        remaining: number;
    };
    defaultUserDailyBudgetUsd: number;
    translationPrompt: string;
    maxInputLength: number;
    maxOutputTokens: number;
    translationMaxConcurrent: number;
    translationMaxGlobalQueue: number;
    translationMaxGuildQueue: number;
    translationMaxUserOutstanding: number;
    translationMaxQueueWaitMs: number;
    openaiApiKey: string;
    hasOpenaiApiKey: boolean;
    openaiBaseUrl: string;
    openaiModel: string;
    openaiSupportsImages: boolean;
    translationProvider: string;
}

type DemoLogFixture = Array<{
    type: string;
    guildId: string | null;
    guildName: string | null;
    userId: string;
    userTag: string;
    contentPreview?: string;
    cached?: boolean;
    targetLanguage?: string;
    langSource?: string;
    error?: string;
    command?: string;
    requestId?: string;
    provider?: string;
    errorType?: string;
    suggestedAction?: string;
    timestamp: number;
}>;

interface DemoUserBudgetOverviewFixture {
    id: string;
    name: string;
    username: string;
    avatar: string;
    budget: number;
    isCustom: boolean;
    allowed: boolean;
    pending: boolean;
    totalCost: number;
    requests: number;
    exceeded: boolean;
}

const DEMO_VARIANTS: DemoVariant[] = [
    {
        kind: 'guild',
        pathSegment: 'guild',
        title: 'Babel Guild — Dashboard Demo',
        productName: 'Babel Guild',
        commandName: 'Babel',
        accessMode: 'guild',
        botName: 'Babel Guild Demo#0110',
    },
    {
        kind: 'pocket',
        pathSegment: 'pocket',
        title: 'Babel Pocket — Dashboard Demo',
        productName: 'Babel Pocket',
        commandName: 'Babel Pocket',
        accessMode: 'user-install',
        botName: 'Babel Pocket Demo#0110',
    },
];

const DEMO_STATS = {
    bot: {
        name: 'Babel Guild Demo#0110',
        avatar: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2218%22 fill=%22%235865f2%22/%3E%3Ctext x=%2232%22 y=%2240%22 text-anchor=%22middle%22 font-family=%22Arial%22 font-size=%2228%22 font-weight=%22700%22 fill=%22white%22%3EB%3C/text%3E%3C/svg%3E',
        uptime: 342_720,
        memoryMB: '86.3',
        memory: {
            rssMB: '86.3',
            heapUsedMB: '33.1',
            externalMB: '4.6',
        },
        guilds: 4,
    },
    translations: {
        total: 1284,
        apiCalls: 713,
        saved: 571,
        failures: 9,
        failureRate: 0.0069,
        cacheHits: 571,
        cacheHitRate: 0.445,
        budgetExceeded: 3,
        webhookRecreated: 1,
    },
    metrics: {
        translationsTotal: 1284,
        translationApiCallsTotal: 713,
        translationCacheHitsTotal: 571,
        translationFailuresTotal: 9,
        budgetExceededTotal: 3,
        webhookRecreateTotal: 1,
        translationSuccessRate: 0.993,
        translationFailureRate: 0.0069,
        translationCacheHitRate: 0.445,
        translationApiCallRate: 0.555,
        providers: {},
        providerFallbackTotal: 4,
        lastProviderFallback: {
            from: 'vertex',
            to: 'openai',
            errorType: 'timeout',
            error: 'Provider request timed out',
            timestamp: DEMO_NOW - 1000 * 60 * 26,
        },
    },
    runtime: {
        inflight: 1,
        queued: 0,
        rejectedTotal: 2,
        rejectionCounts: {
            user_queue_full: 1,
            guild_queue_full: 0,
            global_queue_full: 1,
            queue_wait_timeout: 0,
        },
        limits: {
            maxConcurrent: 4,
            maxGlobalQueue: 25,
            maxGuildQueue: 5,
            maxUserOutstanding: 1,
            maxQueueWaitMs: 30000,
        },
    },
    operations: {
        providerMode: 'vertex+openai',
        providers: {
            vertex: {
                enabled: true,
                configured: true,
                successTotal: 704,
                failureTotal: 5,
                fallbackFromTotal: 4,
                fallbackToTotal: 0,
                lastLatencyMs: 582,
                lastErrorType: 'timeout',
                lastError: 'Provider request timed out',
            },
            openai: {
                enabled: true,
                configured: true,
                successTotal: 9,
                failureTotal: 1,
                fallbackFromTotal: 0,
                fallbackToTotal: 4,
                lastLatencyMs: 771,
                lastErrorType: 'rate_limit',
                lastError: 'OpenAI-compatible provider returned 429',
            },
        },
        fallbackTotal: 4,
        lastFallback: {
            from: 'vertex',
            to: 'openai',
            errorType: 'timeout',
            error: 'Provider request timed out',
            timestamp: DEMO_NOW - 1000 * 60 * 26,
        },
        runtimePressure: {
            inflight: 1,
            queued: 0,
            rejectedTotal: 2,
        },
        budgetRisk: {
            warningCount: 1,
            exceededCount: 0,
            warnings: [
                {
                    id: '100000000000000001',
                    name: 'Builder Lounge',
                    budget: 1.25,
                    totalCost: 1.07,
                    usedPercent: 0.856,
                },
            ],
            exceeded: [],
        },
        guidance: [
            {
                area: 'budget',
                severity: 'warning',
                title: 'Server budget nearing limit',
                action: 'Review per-server usage and adjust budgets before translations are blocked.',
            },
            {
                area: 'provider',
                severity: 'info',
                title: 'Fallback is working',
                action: 'The backup provider handled recent primary provider failures.',
            },
        ],
    },
    cache: {
        size: 571,
        maxSize: 2000,
        hits: 571,
        misses: 713,
    },
    usage: {
        date: '2026-06-01',
        inputTokens: 918_420,
        outputTokens: 304_880,
        requests: 713,
        inputCost: 0.0918,
        outputCost: 0.122,
        totalCost: 0.2138,
        dailyBudget: 2,
        budgetUsedPercent: 10.69,
        budgetExceeded: false,
    },
    guildBudgets: [
        {
            id: '100000000000000001',
            name: 'Builder Lounge',
            budget: 1.25,
            isCustom: true,
            totalCost: 1.07,
            requests: 421,
            exceeded: false,
        },
        {
            id: '100000000000000002',
            name: 'Indie Game Dev',
            budget: 0.75,
            isCustom: false,
            totalCost: 0.28,
            requests: 168,
            exceeded: false,
        },
        {
            id: '100000000000000003',
            name: 'Open Source Asia',
            budget: 0,
            isCustom: true,
            totalCost: 0.15,
            requests: 89,
            exceeded: false,
        },
    ],
    userBudgets: [] as DemoUserBudgetOverviewFixture[],
    errors: 9,
};

const DEMO_CONFIG: DemoConfigFixture = {
    vertexAiApiKey: '••••demo12',
    hasApiKey: true,
    visionApiKey: '••••vision',
    hasVisionApiKey: true,
    gcpProject: 'babel-demo-project',
    gcpLocation: 'global',
    geminiModel: 'gemini-2.5-flash-lite',
    vertexAiSupportsImages: true,
    geminiMediaResolution: 'default',
    allowedGuildIds: ['100000000000000001', '100000000000000002'],
    lensEnabledGuildIds: ['100000000000000001'],
    allowedUserIds: [],
    cooldownSeconds: 5,
    cacheMaxSize: 2000,
    setupComplete: true,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    dailyBudgetUsd: 0.75,
    visionMonthlyImageLimit: 900,
    visionUsage: {
        month: '2026-06',
        images: 184,
        limit: 900,
        remaining: 716,
    },
    defaultUserDailyBudgetUsd: 0,
    translationPrompt: '',
    maxInputLength: 2000,
    maxOutputTokens: 1000,
    translationMaxConcurrent: 4,
    translationMaxGlobalQueue: 25,
    translationMaxGuildQueue: 5,
    translationMaxUserOutstanding: 1,
    translationMaxQueueWaitMs: 30000,
    openaiApiKey: '••••demoai',
    hasOpenaiApiKey: true,
    openaiBaseUrl: 'https://api.openai.com',
    openaiModel: 'gpt-4o-mini',
    openaiSupportsImages: false,
    translationProvider: 'vertex+openai',
};

const DEMO_GUILDS = [
    {
        id: '100000000000000001',
        name: 'Builder Lounge',
        icon: '',
        memberCount: 1842,
    },
    {
        id: '100000000000000002',
        name: 'Indie Game Dev',
        icon: '',
        memberCount: 637,
    },
    {
        id: '100000000000000003',
        name: 'Open Source Asia',
        icon: '',
        memberCount: 1294,
    },
    {
        id: '100000000000000004',
        name: 'Polyglot Study',
        icon: '',
        memberCount: 483,
    },
];

const DEMO_GUILD_BUDGETS = {
    '100000000000000001': {
        name: 'Builder Lounge',
        budget: 1.25,
        usage: {
            date: '2026-06-01',
            inputTokens: 501_200,
            outputTokens: 151_000,
            requests: 421,
            inputCost: 0.0501,
            outputCost: 0.0604,
            totalCost: 1.07,
            dailyBudget: 1.25,
            budgetUsedPercent: 85.6,
            budgetExceeded: false,
        },
    },
    '100000000000000002': {
        name: 'Indie Game Dev',
        budget: -1,
        usage: {
            date: '2026-06-01',
            inputTokens: 222_300,
            outputTokens: 86_400,
            requests: 168,
            inputCost: 0.0222,
            outputCost: 0.0346,
            totalCost: 0.28,
            dailyBudget: 0.75,
            budgetUsedPercent: 37.3,
            budgetExceeded: false,
        },
    },
    '100000000000000003': {
        name: 'Open Source Asia',
        budget: 0,
        usage: {
            date: '2026-06-01',
            inputTokens: 113_000,
            outputTokens: 48_200,
            requests: 89,
            inputCost: 0.0113,
            outputCost: 0.0193,
            totalCost: 0.15,
            dailyBudget: 0,
            budgetUsedPercent: 0,
            budgetExceeded: false,
        },
    },
    '100000000000000004': {
        name: 'Polyglot Study',
        budget: -1,
        usage: {
            date: '2026-06-01',
            inputTokens: 81_920,
            outputTokens: 19_280,
            requests: 35,
            inputCost: 0.0082,
            outputCost: 0.0077,
            totalCost: 0.05,
            dailyBudget: 0.75,
            budgetUsedPercent: 6.6,
            budgetExceeded: false,
        },
    },
};

const HISTORY_ACTIVITY = [0.72, 0.86, 0.68, 1.05, 1.18, 0.91, 1] as const;
const DEMO_HISTORY = Array.from({ length: 30 }, (_, index) => {
    if (index === 29) {
        const { date, inputTokens, outputTokens, requests, totalCost: cost } = DEMO_STATS.usage;
        return { date, inputTokens, outputTokens, requests, cost: Number(cost.toFixed(3)) };
    }

    const activity = HISTORY_ACTIVITY[index % HISTORY_ACTIVITY.length] ?? 1;
    const inputTokens = Math.round((300_000 + index * 26_000) * activity);
    const outputTokens = Math.round(inputTokens * (0.29 + (index % 3) * 0.02));
    return {
        date: new Date(DEMO_NOW - (29 - index) * 86_400_000).toISOString().slice(0, 10),
        inputTokens,
        outputTokens,
        requests: Math.round(inputTokens / 1_300),
        cost: Number(((inputTokens * 0.1 + outputTokens * 0.4) / 1_000_000).toFixed(3)),
    };
});

const DEMO_LOGS: DemoLogFixture = [
    {
        type: 'translation',
        guildId: '100000000000000001',
        guildName: 'Builder Lounge',
        userId: '200000000000000001',
        userTag: 'alice#1024',
        command: 'Babel Lens',
        contentPreview: 'Can someone translate the release notes?',
        cached: false,
        targetLanguage: 'zh-TW',
        langSource: 'discord-locale',
        timestamp: DEMO_NOW - 1000 * 45,
    },
    {
        type: 'translation',
        guildId: '100000000000000002',
        guildName: 'Indie Game Dev',
        userId: '200000000000000002',
        userTag: 'kenji#2048',
        command: 'Babel',
        contentPreview: 'The prototype build is ready for testing.',
        cached: true,
        targetLanguage: 'ja',
        langSource: 'user-preference',
        timestamp: DEMO_NOW - 1000 * 180,
    },
    {
        type: 'error',
        guildId: '100000000000000001',
        guildName: 'Builder Lounge',
        userId: '200000000000000003',
        userTag: 'mira#3001',
        error: 'Provider request timed out after 15000ms',
        command: 'Babel',
        requestId: 'demo-req-7f1a',
        provider: 'vertex',
        errorType: 'timeout',
        suggestedAction: 'The backup provider handled this request. Monitor provider latency.',
        timestamp: DEMO_NOW - 1000 * 60 * 8,
    },
    {
        type: 'translation',
        guildId: '100000000000000003',
        guildName: 'Open Source Asia',
        userId: '200000000000000004',
        userTag: 'sofia#7788',
        command: 'Babel',
        contentPreview: 'Please keep the code comments in English.',
        cached: false,
        targetLanguage: 'ko',
        langSource: 'discord-locale',
        timestamp: DEMO_NOW - 1000 * 60 * 17,
    },
    {
        type: 'error',
        guildId: '100000000000000002',
        guildName: 'Indie Game Dev',
        userId: '200000000000000005',
        userTag: 'dani#4421',
        error: 'OpenAI-compatible provider returned 429',
        command: 'translate',
        requestId: 'demo-req-9c42',
        provider: 'openai',
        errorType: 'rate_limit',
        suggestedAction: 'Lower concurrency or check provider rate limits.',
        timestamp: DEMO_NOW - 1000 * 60 * 29,
    },
];

function demoUserPreference(guildIndex: number, userId: string, language: string) {
    const guild = DEMO_GUILDS[guildIndex];
    if (!guild) throw new Error(`Missing demo guild at index ${guildIndex}`);

    return {
        guildId: guild.id,
        guildName: guild.name,
        guildIcon: guild.icon,
        guildMemberCount: guild.memberCount,
        userId,
        language,
    };
}

const DEMO_USER_PREFS = [
    demoUserPreference(0, '200000000000000001', 'zh-TW'),
    demoUserPreference(0, '200000000000000002', 'ja'),
    demoUserPreference(1, '200000000000000001', 'ko'),
    demoUserPreference(2, '200000000000000004', 'en'),
    demoUserPreference(3, '200000000000000005', 'es'),
];

const DEMO_POCKET_USER_PREFS = [
    {
        guildId: '',
        userId: '200000000000000001',
        language: 'zh-TW',
    },
    {
        guildId: '',
        userId: '200000000000000002',
        language: 'ja',
    },
];

function demoUserProfile(
    userId: string,
    username: string,
    displayName: string,
    color: string,
    globalName: string | null = displayName,
) {
    const initial = displayName.charAt(0).toUpperCase();
    const timestamp = new Date(DEMO_NOW).toISOString();
    return {
        userId,
        username,
        globalName,
        displayName,
        avatarUrl: `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%23${color}%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3E${initial}%3C/text%3E%3C/svg%3E`,
        fetchedAt: timestamp,
        lastSeenAt: timestamp,
    };
}

const DEMO_USER_PROFILES = {
    '200000000000000001': demoUserProfile('200000000000000001', 'alex', 'Alex Chen', '5865f2'),
    '200000000000000002': demoUserProfile('200000000000000002', 'mei', 'Mei Lin', '22c55e'),
    '200000000000000003': demoUserProfile('200000000000000003', 'sora', 'Sora', 'f59e0b'),
    '200000000000000004': demoUserProfile('200000000000000004', 'riley', 'riley', 'ef4444', null),
    '200000000000000005': demoUserProfile('200000000000000005', 'dani', 'Dani', '8b5cf6'),
};

const DEMO_PENDING_USER = {
    userId: '200000000000000006',
    firstSeenAt: '2026-06-01T09:20:00.000Z',
    lastSeenAt: '2026-06-01T11:45:00.000Z',
    source: 'user-install',
    profile: demoUserProfile(
        '200000000000000006',
        'waiting-operator',
        'Waiting Operator',
        '0ea5e9',
    ),
};

const DEMO_USER_BUDGETS = {
    budgets: {
        '200000000000000001': {
            budget: 1.25,
            isCustom: true,
            allowed: true,
            pending: false,
        },
        '200000000000000002': {
            budget: 0.5,
            isCustom: false,
            allowed: true,
            pending: false,
        },
        '200000000000000006': {
            budget: 0.5,
            isCustom: false,
            allowed: false,
            pending: true,
        },
    },
    profiles: {
        ...DEMO_USER_PROFILES,
        '200000000000000006': DEMO_PENDING_USER.profile,
    },
};

const DEMO_GLOSSARY = {
    entries: [
        {
            id: 1,
            guildId: '100000000000000001',
            sourceText: 'Babel',
            targetLanguage: 'auto',
            targetText: 'Babel',
            notes: 'Preserve project name',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
            id: 2,
            guildId: '100000000000000001',
            sourceText: 'release notes',
            targetLanguage: 'zh-TW',
            targetText: '版本公告',
            notes: 'Community wording',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
            id: 3,
            guildId: '100000000000000001',
            sourceText: 'raid',
            targetLanguage: 'zh-TW',
            targetText: '團本',
            notes: 'Game term',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
            id: 4,
            guildId: '100000000000000001',
            sourceText: 'raid',
            targetLanguage: 'ja',
            targetText: 'レイド',
            notes: 'Game term',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
    ],
    count: 4,
};

const DEMO_VERSION = {
    version: '0.3.0',
    repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases',
};

const DEMO_HEALTH = {
    healthy: true,
    readiness: 'ready',
    vertexAi: {
        status: 'pass',
        latencyMs: 582,
    },
    checks: {
        configuration: {
            status: 'pass',
            detail: 'Demo configuration complete',
        },
        vertexAi: {
            status: 'pass',
            latencyMs: 582,
        },
        openAi: {
            status: 'pass',
            latencyMs: 771,
        },
    },
};

function writeJson(path: string, data: unknown): void {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function createCapabilitiesFixture(variant: DemoVariant): unknown {
    const isPocket = variant.kind === 'pocket';

    return {
        profile: {
            id: isPocket ? 'babel-pocket' : 'babel-guild',
            productName: variant.productName,
            commandName: variant.commandName,
            accessMode: variant.accessMode,
        },
        capabilities: {
            guildAccess: !isPocket,
            userAccess: isPocket,
            guildGlossary: !isPocket,
            pendingUserInstallOwners: isPocket,
        },
    };
}

function createStatsFixture(variant: DemoVariant): typeof DEMO_STATS {
    if (variant.kind === 'guild') {
        return {
            ...DEMO_STATS,
            bot: {
                ...DEMO_STATS.bot,
                name: variant.botName,
            },
            userBudgets: [],
        };
    }

    return {
        ...DEMO_STATS,
        bot: {
            ...DEMO_STATS.bot,
            name: variant.botName,
            guilds: 0,
        },
        usage: {
            ...DEMO_STATS.usage,
            inputTokens: 318_420,
            outputTokens: 104_880,
            requests: 241,
            inputCost: 0.0318,
            outputCost: 0.042,
            totalCost: 0.0738,
            dailyBudget: 0.5,
            budgetUsedPercent: 14.76,
        },
        guildBudgets: [],
        userBudgets: [
            {
                id: '200000000000000001',
                name: 'Alex Chen',
                username: 'alexchen',
                avatar: '',
                budget: 1.25,
                isCustom: true,
                allowed: true,
                pending: false,
                totalCost: 0.052,
                requests: 129,
                exceeded: false,
            },
            {
                id: '200000000000000002',
                name: 'Mei Lin',
                username: 'meilin',
                avatar: '',
                budget: 0.5,
                isCustom: false,
                allowed: true,
                pending: false,
                totalCost: 0.0218,
                requests: 112,
                exceeded: false,
            },
            {
                id: '200000000000000003',
                name: 'Waiting Operator',
                username: 'waiting',
                avatar: '',
                budget: 0.5,
                isCustom: false,
                allowed: false,
                pending: true,
                totalCost: 0,
                requests: 0,
                exceeded: false,
            },
        ],
        operations: {
            ...DEMO_STATS.operations,
            budgetRisk: {
                warningCount: 0,
                exceededCount: 0,
                warnings: [],
                exceeded: [],
            },
            guidance: [
                {
                    area: 'budget',
                    severity: 'info',
                    title: 'User budget is healthy',
                    action: 'Babel Pocket is tracking usage against the installing user.',
                },
                ...DEMO_STATS.operations.guidance.filter((item) => item.area !== 'budget'),
            ],
        },
    };
}

function createConfigFixture(variant: DemoVariant): typeof DEMO_CONFIG {
    if (variant.kind === 'guild') {
        return { ...DEMO_CONFIG };
    }

    return {
        ...DEMO_CONFIG,
        allowedGuildIds: [],
        lensEnabledGuildIds: [],
        allowedUserIds: ['200000000000000001', '200000000000000002'],
        dailyBudgetUsd: 0.25,
        defaultUserDailyBudgetUsd: 0.5,
        openaiSupportsImages: true,
    };
}

function createLogsFixture(variant: DemoVariant): DemoLogFixture {
    if (variant.kind === 'guild') {
        return DEMO_LOGS;
    }

    return DEMO_LOGS.map((entry) => ({
        ...entry,
        guildId: null,
        guildName: null,
        command: entry.command === 'Babel' ? 'Babel Pocket' : entry.command,
    }));
}

function createDemoApiJs(variant: DemoVariant): string {
    const userOnlyRoutes =
        variant.kind === 'pocket'
            ? `
    '/user-budgets': 'user-budgets.json',
    '/guild-glossary/100000000000000001': { error: 'No demo fixture for /guild-glossary/100000000000000001', status: 404 },`
            : `
    '/guild-glossary/100000000000000001': 'guild-glossary.json',
    '/guild-glossary/100000000000000001/import': { ok: true, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], cacheCleared: false },
    '/guild-glossary/100000000000000002': { entries: [], count: 0 },
    '/guild-glossary/100000000000000003': { entries: [], count: 0 },
    '/guild-glossary/100000000000000004': { entries: [], count: 0 },`;

    return `
(function () {
  const fixtureMap = {
    '/auth/check': { authenticated: true, csrfToken: 'demo-csrf-token' },
    '/setup-status': { complete: true },
    '/capabilities': 'capabilities.json',
    '/stats': 'stats.json',
    '/health': 'health.json',
    '/version': 'version.json',
    '/config': 'config.json',
    '/guilds': 'guilds.json',
    '/guild-budgets': 'guild-budgets.json',
    '/usage/history': 'history.json',
    '/logs': 'logs.json',
    '/user-prefs': 'user-prefs.json',${userOnlyRoutes}
    '/sessions': 'sessions.json'
  };

  function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || data.status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function normalizePath(path) {
    return String(path).split('?')[0];
  }

  async function loadFixture(name) {
    const response = await fetch('demo/fixtures/' + name);
    return response.json();
  }

  window.BABEL_DEMO = true;
  window.BABEL_DEMO_APP = ${JSON.stringify(variant.kind)};
  window.api = async function demoApi(path, opts) {
    const method = (opts && opts.method ? opts.method : 'GET').toUpperCase();
    const route = normalizePath(path);
    if (method !== 'GET') {
      return jsonResponse({ ok: true, demo: true, message: 'Demo mode: changes are disabled.' });
    }

    const fixture = fixtureMap[route];
    if (!fixture) {
      return jsonResponse({ error: 'No demo fixture for ' + route }, 404);
    }

    if (typeof fixture === 'string') {
      return jsonResponse(await loadFixture(fixture));
    }

    return jsonResponse(fixture);
  };
})();
`;
}

function injectDemoAssets(html: string, variant: DemoVariant): string {
    const relativeHtml = html
        .replaceAll('href="/css/', 'href="css/')
        .replaceAll('src="/js/', 'src="js/');
    const withTitle = relativeHtml
        .replace('<title>Babel — Dashboard</title>', `<title>${variant.title}</title>`)
        .replace(
            '<script src="js/utils.js"></script>',
            '<script src="js/utils.js"></script>\n        <script src="demo/demo-api.js"></script>',
        )
        .replace(
            '<script src="js/app.js"></script>',
            '<script src="demo/demo-readonly.js"></script>\n        <script src="js/app.js"></script>',
        );

    if (withTitle.includes('<link rel="stylesheet" href="css/responsive.css" />')) {
        return withTitle.replace(
            '<link rel="stylesheet" href="css/responsive.css" />',
            '<link rel="stylesheet" href="css/responsive.css" />\n        <link rel="stylesheet" href="demo/demo.css" />',
        );
    }

    return withTitle.replace(
        '</head>',
        '        <link rel="stylesheet" href="demo/demo.css" />\n</head>',
    );
}

export function buildDashboardDemo({
    publicDir = DEFAULT_PUBLIC_DIR,
    demoDir = DEFAULT_DEMO_DIR,
}: BuildDashboardDemoOptions = {}): void {
    rmSync(demoDir, { recursive: true, force: true });
    mkdirSync(demoDir, { recursive: true });

    writeFileSync(join(demoDir, 'index.html'), createDemoLandingPage());

    for (const variant of DEMO_VARIANTS) {
        buildDemoVariant(publicDir, demoDir, variant);
    }
}

function buildDemoVariant(publicDir: string, demoDir: string, variant: DemoVariant): void {
    const variantDir = join(demoDir, variant.pathSegment);
    cpSync(publicDir, variantDir, { recursive: true });

    const demoAssetsDir = join(variantDir, 'demo');
    const fixtureDir = join(demoAssetsDir, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });

    const htmlPath = join(variantDir, 'index.html');
    writeFileSync(htmlPath, injectDemoAssets(readFileSync(htmlPath, 'utf-8'), variant));

    writeFileSync(join(demoAssetsDir, 'demo.css'), DEMO_CSS);
    writeFileSync(join(demoAssetsDir, 'demo-api.js'), createDemoApiJs(variant));
    writeFileSync(join(demoAssetsDir, 'demo-readonly.js'), createDemoReadonlyJs(variant));

    writeJson(join(fixtureDir, 'capabilities.json'), createCapabilitiesFixture(variant));
    writeJson(join(fixtureDir, 'stats.json'), createStatsFixture(variant));
    writeJson(join(fixtureDir, 'config.json'), createConfigFixture(variant));
    writeJson(join(fixtureDir, 'guilds.json'), variant.kind === 'guild' ? DEMO_GUILDS : []);
    writeJson(
        join(fixtureDir, 'guild-budgets.json'),
        variant.kind === 'guild' ? DEMO_GUILD_BUDGETS : {},
    );
    writeJson(join(fixtureDir, 'history.json'), DEMO_HISTORY);
    writeJson(join(fixtureDir, 'logs.json'), createLogsFixture(variant));
    const userPrefEntries = variant.kind === 'guild' ? DEMO_USER_PREFS : DEMO_POCKET_USER_PREFS;
    writeJson(join(fixtureDir, 'user-prefs.json'), {
        entries: userPrefEntries,
        count: userPrefEntries.length,
        profiles: DEMO_USER_PROFILES,
    });
    if (variant.kind === 'guild') {
        writeJson(join(fixtureDir, 'guild-glossary.json'), DEMO_GLOSSARY);
    } else {
        writeJson(join(fixtureDir, 'user-budgets.json'), DEMO_USER_BUDGETS);
    }
    writeJson(join(fixtureDir, 'sessions.json'), {
        sessions: [
            {
                id: `${variant.kind}-demo-current-session`,
                current: true,
                expiresAt: '2026-06-02T00:00:00.000Z',
                expiresInMs: 86_400_000,
            },
        ],
    });
    writeJson(join(fixtureDir, 'version.json'), DEMO_VERSION);
    writeJson(join(fixtureDir, 'health.json'), DEMO_HEALTH);
}

function createDemoLandingPage(): string {
    return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Babel Dashboard Demos</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e5e7eb;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 2rem;
      }
      main {
        width: min(880px, 100%);
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 2rem;
      }
      p {
        margin: 0 0 1.5rem;
        color: #94a3b8;
      }
      .demo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 1rem;
      }
      a {
        display: block;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 1.25rem;
        background: #111827;
        color: inherit;
        text-decoration: none;
      }
      a:hover {
        border-color: #60a5fa;
      }
      strong {
        display: block;
        margin-bottom: 0.5rem;
        font-size: 1.15rem;
      }
      span {
        color: #94a3b8;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Babel dashboard demos</h1>
      <p>Choose the product surface you want to preview. Both demos are read-only and use fixture data.</p>
      <div class="demo-grid">
        <a href="guild/index.html">
          <strong>Babel Guild demo</strong>
          <span>Server-install dashboard with guild access, per-server budgets, and glossary fixtures.</span>
        </a>
        <a href="pocket/index.html">
          <strong>Babel Pocket demo</strong>
          <span>User-install dashboard with user allowlist and pending owner fixtures.</span>
        </a>
      </div>
    </main>
  </body>
</html>
`;
}

const DEMO_CSS = `
.demo-banner {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: rgba(15, 23, 42, 0.96);
  color: var(--text);
  box-shadow: var(--shadow-sm);
  width: calc(100% - 248px);
  margin-left: 248px;
}

.demo-banner strong {
  display: inline-block;
  margin-right: 0.45rem;
  font-size: 0.9rem;
}

.demo-banner span {
  color: var(--text-dim);
  font-size: 0.82rem;
}

.demo-badge {
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-radius: 999px;
  color: var(--yellow);
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}

.demo-disabled {
  cursor: not-allowed !important;
}

@media (max-width: 768px) {
  .demo-banner {
    width: 100%;
    margin-left: 0;
  }
}
`;

function createDemoReadonlyJs(variant: DemoVariant): string {
    return `
(function () {
  const appName = ${JSON.stringify(variant.productName)};

  function installDemoBanner() {
    if (document.querySelector('.demo-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML =
      '<div><strong>' + appName + ' dashboard demo</strong><span>Mock data only. No Discord or AI provider is connected.</span></div>' +
      '<div class="demo-badge">Read-only demo</div>';
    document.body.prepend(banner);
  }
  function disableMutations() {
    const selectors = [
      '#login-view',
      '#wizard-view',
      '#cfg-apikey',
      '#cfg-openai-apikey',
      '#add-guild-input',
      '#prefs-batch-delete',
      '[data-action^="save"]',
      '[data-action^="delete"]',
      '[data-action="clearCache"]',
      '[data-action="testTranslate"]',
      '[data-action="revokeSession"]',
      '[data-action="wizFinish"]',
      '[data-action="doLogout"]'
    ];

    document.querySelectorAll(selectors.join(',')).forEach((element) => {
      if (element.id === 'login-view' || element.id === 'wizard-view') return;
      element.classList.add('demo-disabled');
      if ('disabled' in element) element.disabled = true;
      element.title = 'Demo mode: changes are disabled.';
    });
  }

  function wrapToast() {
    const originalToast = window.showToast;
    window.showToast = function demoToast(message, isError) {
      originalToast(message || 'Demo mode: changes are disabled.', isError);
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    installDemoBanner();
    wrapToast();
    setTimeout(disableMutations, 100);
    setInterval(disableMutations, 1000);
  });
})();
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildDashboardDemo();
}
