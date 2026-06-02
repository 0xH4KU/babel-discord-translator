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

const DEMO_STATS = {
    bot: {
        name: 'Babel Demo#0110',
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
    errors: 9,
};

const DEMO_CONFIG = {
    vertexAiApiKey: '••••demo12',
    hasApiKey: true,
    gcpProject: 'babel-demo-project',
    gcpLocation: 'global',
    geminiModel: 'gemini-2.5-flash-lite',
    allowedGuildIds: ['100000000000000001', '100000000000000002'],
    cooldownSeconds: 5,
    cacheMaxSize: 2000,
    setupComplete: true,
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
    dailyBudgetUsd: 0.75,
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

const DEMO_LOGS = [
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

const DEMO_USER_PREFS = {
    '200000000000000001': 'zh-TW',
    '200000000000000002': 'ja',
    '200000000000000003': 'ko',
    '200000000000000004': 'en',
    '200000000000000005': 'es',
};

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

const DEMO_GLOSSARY = {
    entries: [
        {
            id: 1,
            guildId: '100000000000000001',
            sourceText: 'Babel',
            targetText: 'Babel',
            notes: 'Preserve project name',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
            id: 2,
            guildId: '100000000000000001',
            sourceText: 'release notes',
            targetText: '版本公告',
            notes: 'Community wording',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
        {
            id: 3,
            guildId: '100000000000000001',
            sourceText: 'raid',
            targetText: '團本',
            notes: 'Game term',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        },
    ],
    count: 3,
};

const DEMO_VERSION = {
    version: '0.1.2',
    repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
    update: {
        status: 'current',
        latestVersion: '0.1.2',
        latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.2',
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

function injectDemoAssets(html: string): string {
    const withTitle = html
        .replace('<title>Babel — Dashboard</title>', '<title>Babel — Dashboard Demo</title>')
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
    cpSync(publicDir, demoDir, { recursive: true });

    const demoAssetsDir = join(demoDir, 'demo');
    const fixtureDir = join(demoAssetsDir, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });

    const htmlPath = join(demoDir, 'index.html');
    writeFileSync(htmlPath, injectDemoAssets(readFileSync(htmlPath, 'utf-8')));

    writeFileSync(join(demoAssetsDir, 'demo.css'), DEMO_CSS);
    writeFileSync(join(demoAssetsDir, 'demo-api.js'), DEMO_API_JS);
    writeFileSync(join(demoAssetsDir, 'demo-readonly.js'), DEMO_READONLY_JS);

    writeJson(join(fixtureDir, 'stats.json'), DEMO_STATS);
    writeJson(join(fixtureDir, 'config.json'), DEMO_CONFIG);
    writeJson(join(fixtureDir, 'guilds.json'), DEMO_GUILDS);
    writeJson(join(fixtureDir, 'guild-budgets.json'), DEMO_GUILD_BUDGETS);
    writeJson(join(fixtureDir, 'history.json'), DEMO_HISTORY);
    writeJson(join(fixtureDir, 'logs.json'), DEMO_LOGS);
    writeJson(join(fixtureDir, 'user-prefs.json'), {
        prefs: DEMO_USER_PREFS,
        count: Object.keys(DEMO_USER_PREFS).length,
        profiles: DEMO_USER_PROFILES,
    });
    writeJson(join(fixtureDir, 'guild-glossary.json'), DEMO_GLOSSARY);
    writeJson(join(fixtureDir, 'sessions.json'), {
        sessions: [
            {
                id: 'demo-current-session',
                current: true,
                expiresAt: '2026-06-02T00:00:00.000Z',
                expiresInMs: 86_400_000,
            },
        ],
    });
    writeJson(join(fixtureDir, 'version.json'), DEMO_VERSION);
    writeJson(join(fixtureDir, 'health.json'), DEMO_HEALTH);
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
`;

const DEMO_API_JS = `
(function () {
  const fixtureMap = {
    '/auth/check': { authenticated: true, csrfToken: 'demo-csrf-token' },
    '/setup-status': { complete: true },
    '/stats': 'stats.json',
    '/health': 'health.json',
    '/version': 'version.json',
    '/version/refresh': 'version.json',
    '/config': 'config.json',
    '/guilds': 'guilds.json',
    '/guild-budgets': 'guild-budgets.json',
    '/usage/history': 'history.json',
    '/logs': 'logs.json',
    '/user-prefs': 'user-prefs.json',
    '/guild-glossary/100000000000000001': 'guild-glossary.json',
    '/guild-glossary/100000000000000002': { entries: [], count: 0 },
    '/guild-glossary/100000000000000003': { entries: [], count: 0 },
    '/guild-glossary/100000000000000004': { entries: [], count: 0 },
    '/sessions': 'sessions.json'
  };

  function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
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
  window.api = async function demoApi(path, opts) {
    const method = (opts && opts.method ? opts.method : 'GET').toUpperCase();
    const route = normalizePath(path);
    const fixture = fixtureMap[route];
    if (!fixture) {
      return jsonResponse({ error: 'No demo fixture for ' + route }, 404);
    }

    if (method !== 'GET' && route !== '/version/refresh') {
      return jsonResponse({ ok: true, demo: true, message: 'Demo mode: changes are disabled.' });
    }

    if (typeof fixture === 'string') {
      return jsonResponse(await loadFixture(fixture));
    }

    return jsonResponse(fixture);
  };
})();
`;

const DEMO_READONLY_JS = `
(function () {
  function installDemoBanner() {
    if (document.querySelector('.demo-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML =
      '<div><strong>Babel dashboard demo</strong><span>Mock data only. No Discord or AI provider is connected.</span></div>' +
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
      '[onclick*="save"]',
      '[onclick*="delete"]',
      '[onclick*="Delete"]',
      '[onclick*="clearCache"]',
      '[onclick*="testTranslate"]',
      '[onclick*="revokeSession"]',
      '[onclick*="wizFinish"]',
      '[onclick*="doLogout"]'
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildDashboardDemo();
}
