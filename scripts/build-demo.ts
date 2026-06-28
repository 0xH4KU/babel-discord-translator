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
    gcpProject: string;
    gcpLocation: string;
    geminiModel: string;
    allowedGuildIds: string[];
    allowedUserIds: string[];
    cooldownSeconds: number;
    cacheMaxSize: number;
    setupComplete: boolean;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    dailyBudgetUsd: number;
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
    gcpProject: 'babel-demo-project',
    gcpLocation: 'global',
    geminiModel: 'gemini-2.5-flash-lite',
    allowedGuildIds: ['100000000000000001', '100000000000000002'],
    allowedUserIds: [],
    cooldownSeconds: 5,
    cacheMaxSize: 2000,
    setupComplete: true,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    dailyBudgetUsd: 0.75,
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

const DEMO_HISTORY = [
    { date: '2026-05-03', inputTokens: 220_100, outputTokens: 73_200, requests: 184, cost: 0.058 },
    { date: '2026-05-04', inputTokens: 261_900, outputTokens: 91_400, requests: 205, cost: 0.073 },
    { date: '2026-05-05', inputTokens: 198_000, outputTokens: 64_100, requests: 163, cost: 0.052 },
    { date: '2026-05-06', inputTokens: 344_400, outputTokens: 121_000, requests: 279, cost: 0.097 },
    { date: '2026-05-07', inputTokens: 410_200, outputTokens: 139_600, requests: 331, cost: 0.117 },
    { date: '2026-05-08', inputTokens: 292_500, outputTokens: 103_300, requests: 248, cost: 0.083 },
    { date: '2026-05-09', inputTokens: 331_700, outputTokens: 112_900, requests: 267, cost: 0.091 },
    { date: '2026-05-10', inputTokens: 456_100, outputTokens: 151_200, requests: 356, cost: 0.129 },
    { date: '2026-05-11', inputTokens: 498_000, outputTokens: 172_500, requests: 389, cost: 0.149 },
    { date: '2026-05-12', inputTokens: 377_300, outputTokens: 119_000, requests: 298, cost: 0.101 },
    { date: '2026-05-13', inputTokens: 529_900, outputTokens: 188_700, requests: 421, cost: 0.159 },
    { date: '2026-05-14', inputTokens: 582_400, outputTokens: 201_100, requests: 462, cost: 0.174 },
    { date: '2026-05-15', inputTokens: 468_300, outputTokens: 160_400, requests: 374, cost: 0.141 },
    { date: '2026-05-16', inputTokens: 612_800, outputTokens: 209_300, requests: 489, cost: 0.186 },
    { date: '2026-05-17', inputTokens: 690_100, outputTokens: 244_200, requests: 538, cost: 0.217 },
    { date: '2026-05-18', inputTokens: 532_000, outputTokens: 188_000, requests: 416, cost: 0.159 },
    { date: '2026-05-19', inputTokens: 744_300, outputTokens: 260_000, requests: 587, cost: 0.231 },
    { date: '2026-05-20', inputTokens: 601_500, outputTokens: 214_400, requests: 469, cost: 0.196 },
    { date: '2026-05-21', inputTokens: 788_800, outputTokens: 284_100, requests: 622, cost: 0.263 },
    { date: '2026-05-22', inputTokens: 700_300, outputTokens: 240_900, requests: 551, cost: 0.226 },
    { date: '2026-05-23', inputTokens: 819_900, outputTokens: 303_300, requests: 648, cost: 0.303 },
    { date: '2026-05-24', inputTokens: 884_400, outputTokens: 328_700, requests: 695, cost: 0.329 },
    { date: '2026-05-25', inputTokens: 772_100, outputTokens: 279_400, requests: 612, cost: 0.289 },
    { date: '2026-05-26', inputTokens: 905_000, outputTokens: 338_000, requests: 721, cost: 0.341 },
    { date: '2026-05-27', inputTokens: 811_400, outputTokens: 292_500, requests: 643, cost: 0.315 },
    { date: '2026-05-28', inputTokens: 951_300, outputTokens: 360_900, requests: 759, cost: 0.371 },
    {
        date: '2026-05-29',
        inputTokens: 1_022_100,
        outputTokens: 392_700,
        requests: 814,
        cost: 0.399,
    },
    { date: '2026-05-30', inputTokens: 873_400, outputTokens: 318_200, requests: 693, cost: 0.346 },
    {
        date: '2026-05-31',
        inputTokens: 1_114_600,
        outputTokens: 430_800,
        requests: 884,
        cost: 0.442,
    },
    { date: '2026-06-01', inputTokens: 918_420, outputTokens: 304_880, requests: 713, cost: 0.214 },
];

const DEMO_LOGS: DemoLogFixture = [
    {
        type: 'translation',
        guildId: '100000000000000001',
        guildName: 'Builder Lounge',
        userId: '200000000000000001',
        userTag: 'alice#1024',
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

const DEMO_USER_PREFS = [
    {
        guildId: '100000000000000001',
        guildName: 'Builder Lounge',
        guildIcon: '',
        guildMemberCount: 1842,
        userId: '200000000000000001',
        language: 'zh-TW',
    },
    {
        guildId: '100000000000000001',
        guildName: 'Builder Lounge',
        guildIcon: '',
        guildMemberCount: 1842,
        userId: '200000000000000002',
        language: 'ja',
    },
    {
        guildId: '100000000000000002',
        guildName: 'Indie Game Dev',
        guildIcon: '',
        guildMemberCount: 637,
        userId: '200000000000000001',
        language: 'ko',
    },
    {
        guildId: '100000000000000003',
        guildName: 'Open Source Asia',
        guildIcon: '',
        guildMemberCount: 1294,
        userId: '200000000000000004',
        language: 'en',
    },
    {
        guildId: '100000000000000004',
        guildName: 'Polyglot Study',
        guildIcon: '',
        guildMemberCount: 483,
        userId: '200000000000000005',
        language: 'es',
    },
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

const DEMO_USER_PROFILES = {
    '200000000000000001': {
        userId: '200000000000000001',
        username: 'alex',
        globalName: 'Alex Chen',
        displayName: 'Alex Chen',
        avatarUrl:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%235865f2%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3EA%3C/text%3E%3C/svg%3E',
        fetchedAt: '2026-06-01T12:00:00.000Z',
        lastSeenAt: '2026-06-01T12:00:00.000Z',
    },
    '200000000000000002': {
        userId: '200000000000000002',
        username: 'mei',
        globalName: 'Mei Lin',
        displayName: 'Mei Lin',
        avatarUrl:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%2322c55e%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3EM%3C/text%3E%3C/svg%3E',
        fetchedAt: '2026-06-01T12:00:00.000Z',
        lastSeenAt: '2026-06-01T12:00:00.000Z',
    },
    '200000000000000003': {
        userId: '200000000000000003',
        username: 'sora',
        globalName: 'Sora',
        displayName: 'Sora',
        avatarUrl:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%23f59e0b%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3ES%3C/text%3E%3C/svg%3E',
        fetchedAt: '2026-06-01T12:00:00.000Z',
        lastSeenAt: '2026-06-01T12:00:00.000Z',
    },
    '200000000000000004': {
        userId: '200000000000000004',
        username: 'riley',
        globalName: null,
        displayName: 'riley',
        avatarUrl:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%23ef4444%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3ER%3C/text%3E%3C/svg%3E',
        fetchedAt: '2026-06-01T12:00:00.000Z',
        lastSeenAt: '2026-06-01T12:00:00.000Z',
    },
    '200000000000000005': {
        userId: '200000000000000005',
        username: 'dani',
        globalName: 'Dani',
        displayName: 'Dani',
        avatarUrl:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%238b5cf6%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3ED%3C/text%3E%3C/svg%3E',
        fetchedAt: '2026-06-01T12:00:00.000Z',
        lastSeenAt: '2026-06-01T12:00:00.000Z',
    },
};

const DEMO_PENDING_USER = {
    userId: '200000000000000006',
    firstSeenAt: '2026-06-01T09:20:00.000Z',
    lastSeenAt: '2026-06-01T11:45:00.000Z',
    source: 'user-install',
    profile: {
        userId: '200000000000000006',
        username: 'waiting-operator',
        globalName: 'Waiting Operator',
        displayName: 'Waiting Operator',
        avatarUrl:
            'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22%3E%3Crect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%230ea5e9%22/%3E%3Ctext x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22%3EW%3C/text%3E%3C/svg%3E',
    },
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
    version: '0.2.1',
    repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
    update: {
        status: 'current',
        latestVersion: '0.2.1',
        latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.2.1',
    },
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
        allowedUserIds: ['200000000000000001', '200000000000000002'],
        dailyBudgetUsd: 0.25,
        defaultUserDailyBudgetUsd: 0.5,
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
    '/version/refresh': 'version.json',
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
    if (method !== 'GET' && route !== '/version/refresh') {
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

.demo-only-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.45);
  padding: 1rem;
  margin-bottom: 1rem;
}

.demo-only-section h3 {
  margin-top: 0;
}

.demo-only-section ul {
  margin: 0.75rem 0 0;
  padding-left: 1.25rem;
  color: var(--text-dim);
}
`;

function createDemoReadonlyJs(variant: DemoVariant): string {
    const pocketSummary =
        variant.kind === 'pocket'
            ? `
  async function installPocketDemoSections() {
    const accessTab = document.getElementById('tab-access');
    if (!accessTab || accessTab.querySelector('[data-pocket-demo-summary]')) return;

    accessTab.querySelectorAll('.settings-section').forEach((section) => {
      const heading = section.querySelector('h3')?.textContent || '';
      if (heading.includes('Server Whitelist') || heading.includes('Server Glossary')) {
        section.style.display = 'none';
      }
    });
    accessTab.querySelectorAll('.save-bar[data-capability="guildAccess"]').forEach((saveBar) => {
      saveBar.style.display = 'none';
    });

    const summary = document.createElement('div');
    summary.className = 'demo-only-section';
    summary.dataset.pocketDemoSummary = 'true';
    summary.innerHTML =
      '<h3>User Install Access</h3>' +
      '<div class="desc-text">Babel Pocket uses user allowlists and per-user budgets. The demo fixtures include approved installing users and one pending owner request.</div>' +
      '<ul><li>Approved users: Alex Chen, Mei Lin</li><li>Pending user-install owner: Waiting Operator</li><li>Default user budget: $0.50/day</li></ul>';
    accessTab.prepend(summary);
  }`
            : `
  async function installPocketDemoSections() {}`;

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
${pocketSummary}

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
    installPocketDemoSections();
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
