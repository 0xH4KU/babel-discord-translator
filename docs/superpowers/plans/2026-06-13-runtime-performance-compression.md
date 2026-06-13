# Runtime Performance Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in lower-memory dashboard modes, in-flight translation deduplication, reduced translation hot-path config reads, and a burst-friendlier runtime limiter queue.

**Architecture:** Keep current defaults unchanged. Add small runtime composition helpers around dashboard startup, keep translation dedupe inside `createTranslationService()` so it shares existing cache keys, pass the already loaded runtime config into `translate()`, and change only the limiter's internal queue representation while preserving its public API.

**Tech Stack:** TypeScript, Node.js 22, discord.js, Express 4, Vitest, SQLite via `node:sqlite`.

---

## File Structure

- Modify `src/apps/bootstrap.ts`: resolve `BABEL_DASHBOARD_MODE`, start full dashboard, health-only server, or no HTTP server after Discord clients are ready.
- Create `src/modules/dashboard/dashboard-mode.ts`: parse dashboard mode environment values with a safe default.
- Create `src/modules/dashboard/health-dashboard.ts`: build the minimal health/metrics Express app used by `health-only`.
- Modify `src/modules/translation/translation-service-helpers.ts`: include runtime config in translator options.
- Modify `src/modules/translation/translation-service.ts`: add per-service in-flight dedupe keyed by existing cache key and pass runtime config through translator options.
- Modify `src/modules/translation/translate.ts`: use runtime config from translator options when present, otherwise keep current direct config read behavior.
- Modify `src/modules/translation/translation-runtime-limiter.ts`: replace array queue internals with ordered map/head cleanup while preserving current external API.
- Modify `.env.example`, `docs/operations/docker.md`, and `docs/operations/deployment.md`: document the dashboard mode and memory-oriented settings.
- Modify tests in `tests/bootstrap.test.ts`, `tests/dashboard.test.ts`, `tests/translation-service.test.ts`, `tests/translate.test.ts`, and `tests/translation-runtime-limiter.test.ts`.

## Task 1: Dashboard Mode Parsing

**Files:**
- Create: `src/modules/dashboard/dashboard-mode.ts`
- Test: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add these imports near the dashboard imports in `tests/dashboard.test.ts`:

```ts
import { resolveDashboardMode } from '../src/modules/dashboard/dashboard-mode.js';
```

Add this describe block before `describe('Dashboard API', () => {`:

```ts
describe('dashboard mode parsing', () => {
    it('defaults to full dashboard mode', () => {
        expect(resolveDashboardMode(undefined)).toBe('full');
        expect(resolveDashboardMode('')).toBe('full');
    });

    it('accepts full, health-only, and off modes', () => {
        expect(resolveDashboardMode('full')).toBe('full');
        expect(resolveDashboardMode('health-only')).toBe('health-only');
        expect(resolveDashboardMode('off')).toBe('off');
    });

    it('trims and lowercases dashboard mode values', () => {
        expect(resolveDashboardMode(' HEALTH-ONLY ')).toBe('health-only');
    });

    it('falls back to full for unknown dashboard mode values', () => {
        expect(resolveDashboardMode('minimal')).toBe('full');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/dashboard.test.ts -t "dashboard mode parsing"
```

Expected: FAIL because `src/modules/dashboard/dashboard-mode.ts` does not exist.

- [ ] **Step 3: Implement dashboard mode parser**

Create `src/modules/dashboard/dashboard-mode.ts`:

```ts
export type DashboardMode = 'full' | 'health-only' | 'off';

export function resolveDashboardMode(value = process.env.BABEL_DASHBOARD_MODE): DashboardMode {
    const normalized = value?.trim().toLowerCase();

    if (normalized === 'health-only' || normalized === 'off' || normalized === 'full') {
        return normalized;
    }

    return 'full';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/dashboard.test.ts -t "dashboard mode parsing"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/modules/dashboard/dashboard-mode.ts tests/dashboard.test.ts
git commit -m "feat(dashboard): parse runtime dashboard mode"
```

Expected: commit created.

## Task 2: Health-Only Dashboard App

**Files:**
- Create: `src/modules/dashboard/health-dashboard.ts`
- Test: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing health-only route test**

Update the dashboard import in `tests/dashboard.test.ts`:

```ts
import {
    createDashboardApp,
    startDashboardServer,
    stopDashboardApp,
} from '../src/modules/dashboard/dashboard.js';
import { createHealthDashboardApp } from '../src/modules/dashboard/health-dashboard.js';
```

Add this test inside `describe('Dashboard API', () => {` after the existing health endpoint test:

```ts
it('should expose health-only dashboard endpoints without full dashboard API routes', async () => {
    const healthOnlyApp = createHealthDashboardApp({
        cache,
        metrics,
        runtimeLimiter,
        healthCheck,
        healthProbeCacheTtlMs: 0,
    });
    const healthOnlyServer = startDashboardServer(healthOnlyApp, 0);

    try {
        const live = await request(healthOnlyServer, 'GET', '/livez');
        expect(live.status).toBe(200);
        expect(live.body!.live).toBe(true);

        const ready = await request(healthOnlyServer, 'GET', '/readyz');
        expect(ready.status).toBe(200);
        expect(ready.body!.ready).toBe(true);

        const metricsResponse = await requestText(healthOnlyServer, 'GET', '/metrics');
        expect(metricsResponse.status).toBe(200);
        expect(metricsResponse.text).toContain('babel_translation_success_total');

        const stats = await request(healthOnlyServer, 'GET', '/api/stats');
        expect(stats.status).toBe(404);
    } finally {
        healthOnlyServer.close();
        stopDashboardApp(healthOnlyApp);
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/dashboard.test.ts -t "health-only dashboard"
```

Expected: FAIL because `createHealthDashboardApp` does not exist.

- [ ] **Step 3: Implement health-only app**

Create `src/modules/dashboard/health-dashboard.ts`:

```ts
import express, { type NextFunction, type Request, type Response } from 'express';
import { createEmptyAppMetricsSnapshot } from '../../shared/app-metrics.js';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../shared/health.js';
import { checkOpenAiHealth } from '../../infra/openai-client.js';
import { checkVertexAiHealth } from '../../infra/vertex-ai-client.js';
import { createEmptyRuntimeSnapshot, renderPrometheusMetrics } from './prometheus-metrics.js';
import type { DashboardDeps } from '../../shared/types.js';

type HealthDashboardDeps = Pick<
    DashboardDeps,
    | 'cache'
    | 'metrics'
    | 'runtimeLimiter'
    | 'healthCheck'
    | 'openAiHealthCheck'
    | 'healthProbeCacheTtlMs'
>;

function asyncHandler(
    fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
        fn(req, res).catch(next);
    };
}

export function createHealthDashboardApp({
    cache,
    metrics,
    runtimeLimiter,
    healthCheck = checkVertexAiHealth,
    openAiHealthCheck = checkOpenAiHealth,
    healthProbeCacheTtlMs = 5_000,
}: HealthDashboardDeps): express.Express {
    const app = express();
    app.set('trust proxy', 1);

    app.get('/livez', (_req: Request, res: Response) => {
        const health = getLivenessStatus();
        res.status(health.live ? 200 : 503).json(health);
    });

    app.get(
        '/readyz',
        asyncHandler(async (_req: Request, res: Response) => {
            const health = await getReadinessStatus({
                healthCheck,
                openAiHealthCheck,
                cacheTtlMs: healthProbeCacheTtlMs,
            });
            res.status(health.ready ? 200 : 503).json(health);
        }),
    );

    app.get(
        '/healthz',
        asyncHandler(async (_req: Request, res: Response) => {
            const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
            const health = await getHealthStatus(
                { healthCheck, openAiHealthCheck, cacheTtlMs: healthProbeCacheTtlMs },
                metricsSnapshot,
            );
            res.status(health.live ? 200 : 503).json(health);
        }),
    );

    app.get('/metrics', (_req: Request, res: Response) => {
        const metricsSnapshot = metrics?.snapshot() ?? createEmptyAppMetricsSnapshot();
        const runtimeSnapshot = runtimeLimiter?.snapshot() ?? createEmptyRuntimeSnapshot();

        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(
            renderPrometheusMetrics({
                metricsSnapshot,
                cacheStats: cache.stats(),
                runtimeSnapshot,
            }),
        );
    });

    return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/dashboard.test.ts -t "health-only dashboard"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/modules/dashboard/health-dashboard.ts tests/dashboard.test.ts
git commit -m "feat(dashboard): add health-only dashboard app"
```

Expected: commit created.

## Task 3: Bootstrap Dashboard Modes

**Files:**
- Modify: `src/apps/bootstrap.ts`
- Test: `tests/bootstrap.test.ts`

- [ ] **Step 1: Write failing bootstrap tests**

In `tests/bootstrap.test.ts`, add these mocks to the hoisted object:

```ts
createHealthDashboardApp: vi.fn(),
resolveDashboardMode: vi.fn(() => 'full' as const),
```

Add these mocks after the existing dashboard mock:

```ts
vi.mock('../src/modules/dashboard/health-dashboard.js', () => ({
    createHealthDashboardApp: mocks.createHealthDashboardApp,
}));

vi.mock('../src/modules/dashboard/dashboard-mode.js', () => ({
    resolveDashboardMode: mocks.resolveDashboardMode,
}));
```

Add these tests inside `describe('startBabelApp', () => {` after the combined dashboard test:

```ts
it('starts a health-only dashboard when dashboard mode is health-only', async () => {
    mocks.resolveDashboardMode.mockReturnValue('health-only');
    const { startBabelApp } = await import('../src/apps/bootstrap.js');

    await startBabelApp(BABEL_GUILD_PROFILE);
    const readyCallback = mocks.clients[0]!.once.mock.calls[0]![1];
    readyCallback({
        user: { id: 'guild-bot', tag: 'Guild#0001' },
    });

    expect(mocks.createDashboardApp).not.toHaveBeenCalled();
    expect(mocks.createHealthDashboardApp).toHaveBeenCalledTimes(1);
    expect(mocks.startDashboardServer).toHaveBeenCalledTimes(1);
});

it('does not start a dashboard server when dashboard mode is off', async () => {
    mocks.resolveDashboardMode.mockReturnValue('off');
    const { startBabelApp } = await import('../src/apps/bootstrap.js');

    await startBabelApp(BABEL_GUILD_PROFILE);
    const readyCallback = mocks.clients[0]!.once.mock.calls[0]![1];
    readyCallback({
        user: { id: 'guild-bot', tag: 'Guild#0001' },
    });

    expect(mocks.createDashboardApp).not.toHaveBeenCalled();
    expect(mocks.createHealthDashboardApp).not.toHaveBeenCalled();
    expect(mocks.startDashboardServer).not.toHaveBeenCalled();
    expect(mocks.createGracefulShutdownHandler).toHaveBeenCalledWith(
        expect.objectContaining({
            getDashboardApp: expect.any(Function),
            getDashboardServer: expect.any(Function),
        }),
    );
});
```

Update `beforeEach()` to reset the mode:

```ts
mocks.resolveDashboardMode.mockReturnValue('full');
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/bootstrap.test.ts -t "dashboard mode"
```

Expected: FAIL because bootstrap does not use dashboard mode or health-only app yet.

- [ ] **Step 3: Implement dashboard mode branching**

In `src/apps/bootstrap.ts`, add imports:

```ts
import { createHealthDashboardApp } from '../modules/dashboard/health-dashboard.js';
import { resolveDashboardMode } from '../modules/dashboard/dashboard-mode.js';
```

In `startBabelApps()`, after `const shared = createSharedRuntime();`, add:

```ts
const dashboardMode = resolveDashboardMode();
```

Replace `startDashboardIfReady` with this structure:

```ts
const startDashboardIfReady = () => {
    if (dashboardApp || dashboardServer || readyProfileIds.size !== runtimes.length) {
        return;
    }

    if (dashboardMode === 'off') {
        startupLogger.info('dashboard.server.skipped', { mode: dashboardMode });
        return;
    }

    if (dashboardMode === 'health-only') {
        dashboardApp = createHealthDashboardApp({
            cache: shared.cache,
            metrics: shared.metrics,
            runtimeLimiter: shared.runtimeLimiter,
        });
        dashboardServer = startDashboardServer(
            dashboardApp,
            shared.config.dashboardPort,
            shared.config.dashboardHost,
        );
        return;
    }

    dashboardApp = createDashboardApp({
        cache: shared.cache,
        cooldown: primaryRuntime.cooldown,
        cooldowns: cooldownsByProfile,
        log: shared.log,
        client: primaryRuntime.client,
        clients: clientsByProfile,
        getStats: () => shared.stats,
        metrics: shared.metrics,
        runtimeLimiter: shared.runtimeLimiter,
        profile: primaryRuntime.profile,
        profiles,
    });
    dashboardServer = startDashboardServer(
        dashboardApp,
        shared.config.dashboardPort,
        shared.config.dashboardHost,
    );
};
```

- [ ] **Step 4: Run bootstrap tests**

Run:

```bash
npm test -- tests/bootstrap.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/apps/bootstrap.ts tests/bootstrap.test.ts
git commit -m "feat(app): support dashboard runtime modes"
```

Expected: commit created.

## Task 4: Translation In-Flight Deduplication

**Files:**
- Modify: `src/modules/translation/translation-service.ts`
- Test: `tests/translation-service.test.ts`

- [ ] **Step 1: Add failing concurrent dedupe tests**

Add this helper near the existing `createStructuredLoggerMock()` helper in `tests/translation-service.test.ts`:

```ts
function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
```

Add these tests after `should reuse the same cached translation for identical requests`:

```ts
it('should join an in-flight translation for identical concurrent requests', async () => {
    const gate = deferred<TranslationResult>();
    const translator = vi.fn(() => gate.promise);
    const { service, usageTracker, metrics } = createService({ translator });

    const first = service.process({
        command: 'translate',
        commandLabel: '/translate',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        userId: 'user1',
        userTag: 'user#0001',
        locale: 'ko',
        text: 'Hello world',
        targetLanguageOption: 'ko',
    });
    const second = service.process({
        command: 'translate',
        commandLabel: '/translate',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        userId: 'user2',
        userTag: 'user#0002',
        locale: 'ko',
        text: 'Hello world',
        targetLanguageOption: 'ko',
    });

    await Promise.resolve();
    expect(translator).toHaveBeenCalledTimes(1);

    gate.resolve({
        text: '안녕하세요',
        inputTokens: 20,
        outputTokens: 10,
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe('success');
    expect(secondResult.status).toBe('success');
    expect(secondResult.status === 'success' ? secondResult.cached : false).toBe(true);
    expect(usageTracker.record).toHaveBeenCalledTimes(1);
    expect(metrics.snapshot()).toMatchObject({
        translationsTotal: 2,
        translationApiCallsTotal: 1,
    });
});

it('should clear failed in-flight translations so a later retry can call the provider', async () => {
    const translator = vi
        .fn()
        .mockRejectedValueOnce(new Error('provider timeout'))
        .mockResolvedValueOnce({
            text: '再試行成功',
            inputTokens: 18,
            outputTokens: 9,
        });
    const { service } = createService({ translator });
    const request = {
        command: 'translate' as const,
        commandLabel: '/translate',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        userId: 'user1',
        userTag: 'user#0001',
        locale: 'ja',
        text: 'Hello retry',
        targetLanguageOption: 'ja',
    };

    const failed = await service.process(request);
    const retried = await service.process({ ...request, userId: 'user2', userTag: 'user#0002' });

    expect(failed.status).toBe('error');
    expect(retried.status).toBe('success');
    expect(translator).toHaveBeenCalledTimes(2);
});

it('should not join in-flight translations for different cache keys', async () => {
    const gate = deferred<TranslationResult>();
    const translator = vi
        .fn()
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValueOnce({
            text: '違う翻訳',
            inputTokens: 22,
            outputTokens: 11,
        });
    const { service } = createService({ translator });

    const first = service.process({
        command: 'translate',
        commandLabel: '/translate',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        userId: 'user1',
        userTag: 'user#0001',
        locale: 'ja',
        text: 'Hello world',
        targetLanguageOption: 'ja',
    });
    const second = service.process({
        command: 'translate',
        commandLabel: '/translate',
        guildId: 'guild-1',
        guildName: 'Test Guild',
        userId: 'user2',
        userTag: 'user#0002',
        locale: 'zh-TW',
        text: 'Hello world',
        targetLanguageOption: 'zh-TW',
    });

    await Promise.resolve();
    expect(translator).toHaveBeenCalledTimes(2);

    gate.resolve({
        text: 'こんにちは',
        inputTokens: 20,
        outputTokens: 10,
    });

    await expect(first).resolves.toMatchObject({ status: 'success' });
    await expect(second).resolves.toMatchObject({ status: 'success' });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/translation-service.test.ts -t "in-flight|failed in-flight|different cache keys"
```

Expected: FAIL because concurrent identical requests call the translator twice.

- [ ] **Step 3: Implement in-flight dedupe**

In `src/modules/translation/translation-service.ts`, add near helper interfaces:

```ts
interface InFlightTranslation {
    promise: Promise<TranslationResult>;
}
```

Inside `createTranslationService(...)`, before `return {`, add:

```ts
const inFlightTranslations = new Map<string, InFlightTranslation>();
```

Inside `process()`, after cache lookup and before limiter acquire, insert:

```ts
const inFlight = !cached ? inFlightTranslations.get(cacheKey) : undefined;
if (inFlight) {
    requestLogger.info('translation.inflight.joined', {
        targetLanguage,
        langSource,
    });

    if (request.beforeTranslate) {
        await request.beforeTranslate();
        deferred = true;
        requestLogger.info('translation.request.deferred');
    }

    cooldown.set(request.userId);
    stats.totalTranslations++;

    const result = await inFlight.promise;
    translated = result.text;
    cached = true;
    inputTokens = 0;
    outputTokens = 0;
    provider = result.provider;
    fallback = result.fallback;
}
```

Then wrap the leader provider call where `const result = await translator(...)` currently happens:

```ts
const providerPromise = translator(
    originalText,
    targetLanguage,
    createTranslatorOptions(
        {
            requestId,
            guildId: request.guildId ?? null,
            userId: getRuntimeLimiterUserId(scope),
            command: request.command,
        },
        metrics,
        glossaryEntries,
    ),
);
inFlightTranslations.set(cacheKey, { promise: providerPromise });
try {
    const result = await providerPromise;
    cache.set(cacheKey, result.text);
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    provider = result.provider;
    fallback = result.fallback;
    usageTracker.record(result.inputTokens, result.outputTokens, usageScope);
    return result.text;
} finally {
    inFlightTranslations.delete(cacheKey);
}
```

Apply the same pattern in the no-limiter branch. Keep one provider call responsible for `stats.apiCalls++`, `metrics?.recordTranslationApiCall()`, cache write, and usage record.

Do not set in-flight entries for cached requests.

- [ ] **Step 4: Run translation service tests**

Run:

```bash
npm test -- tests/translation-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/modules/translation/translation-service.ts tests/translation-service.test.ts
git commit -m "feat(translation): dedupe in-flight provider calls"
```

Expected: commit created.

## Task 5: Pass Runtime Config Through Translator Options

**Files:**
- Modify: `src/modules/translation/translation-service-helpers.ts`
- Modify: `src/modules/translation/translation-service.ts`
- Modify: `src/modules/translation/translate.ts`
- Test: `tests/translation-service.test.ts`
- Test: `tests/translate.test.ts`

- [ ] **Step 1: Write failing option assertion**

In `tests/translation-service.test.ts`, update `should translate successfully and record usage through the shared service` by adding this assertion after `expect(translatorOptions?.metrics).toBe(metrics);`:

```ts
expect(translatorOptions?.runtimeConfig).toMatchObject({
    geminiModel: 'gemini-2.5-flash-lite',
    maxOutputTokens: 1000,
});
```

In `tests/translate.test.ts`, extend the `mockStore` type in the `describe('translate', () => {` block:

```ts
const mockStore = store as unknown as {
    _setMock: (key: string, val: unknown) => void;
    get: ReturnType<typeof vi.fn>;
    getConfigValues: ReturnType<typeof vi.fn>;
};
```

Then add this test inside `describe('translate', () => {`:

```ts
it('uses runtime config from options without reading the repository again', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(geminiResponse('こんにちは', 12, 6));
    mockStore.getConfigValues.mockClear();

    const result = await translate('Hello', 'ja', {
        runtimeConfig: {
            vertexAiApiKey: 'test-key',
            gcpProject: 'test-project',
            gcpLocation: 'global',
            geminiModel: 'gemini-2.5-flash-lite',
            allowedGuildIds: [],
            allowedUserIds: [],
            cooldownSeconds: 0,
            cacheMaxSize: 2000,
            setupComplete: true,
            inputPricePerMillion: 0,
            outputPricePerMillion: 0,
            dailyBudgetUsd: 0,
            defaultUserDailyBudgetUsd: 0,
            translationPrompt: '',
            maxInputLength: 2000,
            maxOutputTokens: 321,
            translationMaxConcurrent: 4,
            translationMaxGlobalQueue: 25,
            translationMaxGuildQueue: 5,
            translationMaxUserOutstanding: 1,
            translationMaxQueueWaitMs: 30000,
            openaiApiKey: '',
            openaiBaseUrl: '',
            openaiModel: '',
            translationProvider: 'vertex',
        },
    });

    expect(result.text).toBe('こんにちは');
    expect(mockStore.getConfigValues).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/translation-service.test.ts -t "translate successfully"
npm test -- tests/translate.test.ts -t "runtime config from options"
```

Expected: FAIL because translator options do not include runtime config and `translate()` does not accept it.

- [ ] **Step 3: Extend translator options**

In `src/modules/translation/translation-service-helpers.ts`, import `RuntimeConfig`:

```ts
import type { RuntimeConfig } from '../config/config-repository.js';
```

Add to `TranslatorOptions`:

```ts
runtimeConfig?: RuntimeConfig;
```

Change `createTranslatorOptions()` signature:

```ts
export function createTranslatorOptions(
    logContext: TranslatorOptions['logContext'],
    metrics?: AppMetricsCollector,
    glossaryEntries: TranslatorOptions['glossaryEntries'] = [],
    runtimeConfig?: RuntimeConfig,
): TranslatorOptions {
    return {
        logContext,
        ...(metrics ? { metrics } : {}),
        ...(glossaryEntries.length > 0 ? { glossaryEntries } : {}),
        ...(runtimeConfig ? { runtimeConfig } : {}),
    };
}
```

In `src/modules/translation/translation-service.ts`, pass `runtimeConfig` to every `createTranslatorOptions(...)` call.

- [ ] **Step 4: Update translate()**

In `src/modules/translation/translate.ts`, import `RuntimeConfig`:

```ts
import { configRepository, type RuntimeConfig } from '../config/config-repository.js';
```

Update the options type:

```ts
options?: {
    logContext?: Pick<StructuredLogFields, 'requestId' | 'guildId' | 'userId' | 'command'>;
    metrics?: AppMetricsCollector;
    glossaryEntries?: TranslationGlossaryPromptEntry[];
    runtimeConfig?: RuntimeConfig;
},
```

Change:

```ts
const config = configRepository.getRuntimeConfig();
```

to:

```ts
const config = options?.runtimeConfig ?? configRepository.getRuntimeConfig();
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/translation-service.test.ts -t "translate successfully|runtime config once"
npm test -- tests/translate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/modules/translation/translation-service-helpers.ts src/modules/translation/translation-service.ts src/modules/translation/translate.ts tests/translation-service.test.ts tests/translate.test.ts
git commit -m "perf(translation): reuse runtime config snapshot"
```

Expected: commit created.

## Task 6: Runtime Limiter Queue Internals

**Files:**
- Modify: `src/modules/translation/translation-runtime-limiter.ts`
- Test: `tests/translation-runtime-limiter.test.ts`

- [ ] **Step 1: Add accounting regression tests**

Add these tests to `tests/translation-runtime-limiter.test.ts` after the existing timeout test:

```ts
it('should release user and guild counters when queued reservations are cancelled', () => {
    const limiter = new TranslationRuntimeLimiter({
        maxConcurrent: 1,
        maxGlobalQueue: 2,
        maxGuildQueue: 1,
        maxUserOutstanding: 1,
    });
    const firstAdmission = limiter.acquire({ userId: 'user-1', guildId: 'guild-1' });
    const secondAdmission = limiter.acquire({ userId: 'user-2', guildId: 'guild-1' });

    expect(firstAdmission.accepted).toBe(true);
    expect(secondAdmission.accepted).toBe(true);
    if (!firstAdmission.accepted || !secondAdmission.accepted) {
        throw new Error('Expected reservations to be accepted');
    }

    secondAdmission.reservation.cancel();

    const replacement = limiter.acquire({ userId: 'user-2', guildId: 'guild-1' });
    expect(replacement.accepted).toBe(true);
    expect(limiter.snapshot().queued).toBe(1);

    if (replacement.accepted) {
        replacement.reservation.cancel();
    }
    firstAdmission.reservation.cancel();
});

it('should skip cancelled queued entries and activate the next queued entry', async () => {
    const limiter = new TranslationRuntimeLimiter({
        maxConcurrent: 1,
        maxGlobalQueue: 3,
        maxGuildQueue: 3,
        maxUserOutstanding: 1,
    });
    const gate = deferred<void>();
    const firstAdmission = limiter.acquire({ userId: 'user-1', guildId: 'guild-1' });
    const secondAdmission = limiter.acquire({ userId: 'user-2', guildId: 'guild-1' });
    const thirdAdmission = limiter.acquire({ userId: 'user-3', guildId: 'guild-1' });
    const order: string[] = [];

    if (!firstAdmission.accepted || !secondAdmission.accepted || !thirdAdmission.accepted) {
        throw new Error('Expected reservations to be accepted');
    }

    const first = firstAdmission.reservation.run(async () => {
        await gate.promise;
    });
    secondAdmission.reservation.cancel();
    const third = thirdAdmission.reservation.run(async () => {
        order.push('third');
    });

    gate.resolve();
    await first;
    await third;

    expect(order).toEqual(['third']);
    expect(limiter.snapshot()).toMatchObject({
        inflight: 0,
        queued: 0,
    });
});
```

- [ ] **Step 2: Run tests before implementation**

Run:

```bash
npm test -- tests/translation-runtime-limiter.test.ts
```

Expected: existing code may already pass; keep these tests as regression coverage before changing internals.

- [ ] **Step 3: Replace queue internals**

In `src/modules/translation/translation-runtime-limiter.ts`, replace:

```ts
private readonly queue: QueueEntry[] = [];
```

with:

```ts
private readonly queue = new Map<number, QueueEntry>();
```

Update queue length checks to use `this.queue.size`.

When enqueueing, replace `this.queue.push(entry);` with:

```ts
this.queue.set(entry.id, entry);
```

Update `snapshot()` queued:

```ts
queued: this.queue.size,
```

Update `cancelQueuedEntry()`:

```ts
private cancelQueuedEntry(entry: QueueEntry): void {
    if (!this.queue.delete(entry.id)) {
        return;
    }

    entry.cancelled = true;
    if (entry.timeout) clearTimeout(entry.timeout);
    this.bumpMap(this.queuedByGuild, entry.guildKey, -1);
    this.bumpMap(this.outstandingByUser, entry.userId, -1);
}
```

Update `expireQueuedEntry()`:

```ts
private expireQueuedEntry(entry: QueueEntry): void {
    if (!this.queue.delete(entry.id) || entry.cancelled || entry.activeAt !== undefined) {
        return;
    }

    entry.cancelled = true;
    this.bumpMap(this.queuedByGuild, entry.guildKey, -1);
    this.bumpMap(this.outstandingByUser, entry.userId, -1);
    this.rejectedTotal += 1;
    this.rejectionCounts.queue_wait_timeout += 1;
    entry.reject(
        new RuntimeLimitError('queue_wait_timeout', 'Translation queue wait timed out'),
    );
}
```

Update `activateQueuedEntries()`:

```ts
private activateQueuedEntries(): void {
    while (this.inflight < this.limits.maxConcurrent && this.queue.size > 0) {
        const iterator = this.queue.values().next();
        const entry = iterator.value as QueueEntry | undefined;
        if (!entry) {
            return;
        }
        this.queue.delete(entry.id);

        if (entry.cancelled) {
            continue;
        }

        this.inflight += 1;
        this.bumpMap(this.queuedByGuild, entry.guildKey, -1);
        const activeAt = Date.now();
        entry.activeAt = activeAt;
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.resolve({
            queued: true,
            waitMs: Math.max(activeAt - entry.createdAt, 0),
            snapshot: this.snapshot(),
        });
    }
}
```

- [ ] **Step 4: Run limiter tests**

Run:

```bash
npm test -- tests/translation-runtime-limiter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/modules/translation/translation-runtime-limiter.ts tests/translation-runtime-limiter.test.ts
git commit -m "perf(translation): make runtime queue burst friendly"
```

Expected: commit created.

## Task 7: Configuration And Operations Docs

**Files:**
- Modify: `.env.example`
- Modify: `docs/operations/docker.md`
- Modify: `docs/operations/deployment.md`
- Test: `tests/deployment-config.test.ts`

- [ ] **Step 1: Add failing config documentation test**

Open `tests/deployment-config.test.ts` and add this test inside the existing `describe('deployment configuration', () => {` block:

```ts
it('documents dashboard runtime mode for constrained deployments', () => {
    const envExample = readFileSync('.env.example', 'utf8');
    const dockerDocs = readFileSync('docs/operations/docker.md', 'utf8');
    const deploymentDocs = readFileSync('docs/operations/deployment.md', 'utf8');

    expect(envExample).toContain('BABEL_DASHBOARD_MODE=full');
    expect(dockerDocs).toContain('BABEL_DASHBOARD_MODE=health-only');
    expect(deploymentDocs).toContain('BABEL_DASHBOARD_MODE');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/deployment-config.test.ts -t "dashboard runtime mode"
```

Expected: FAIL until docs are updated.

- [ ] **Step 3: Update `.env.example`**

Add near dashboard environment settings:

```env
# Dashboard runtime mode:
# - full: full admin dashboard, health, metrics (default)
# - health-only: health and metrics endpoints only, lower memory
# - off: no HTTP server; update host healthchecks before using
BABEL_DASHBOARD_MODE=full
```

- [ ] **Step 4: Update Docker docs**

In `docs/operations/docker.md`, add this to the example `.env` blocks:

```env
BABEL_DASHBOARD_MODE=full
```

Add this section:

````md
## Memory-Constrained Runtime

For very small instances, keep a single product profile and use the health-only dashboard:

```env
BABEL_APP=guild
BABEL_DASHBOARD_MODE=health-only
BABEL_NODE_MAX_OLD_SPACE_MB=64
BABEL_NODE_MAX_SEMI_SPACE_MB=4
```

`health-only` keeps `/livez`, `/readyz`, `/healthz`, and `/metrics`, but skips the authenticated dashboard UI and dashboard API routes. Use `full` when you need to change settings from the browser. Avoid `BABEL_APP=combined` unless you need both Guild and Pocket in one process.
````

- [ ] **Step 5: Update deployment docs**

In `docs/operations/deployment.md`, add this paragraph in Docker/Railway environment guidance:

```md
`BABEL_DASHBOARD_MODE` defaults to `full`. Set it to `health-only` on constrained hosts when you only need `/livez`, `/readyz`, `/healthz`, and `/metrics`. Set it to `off` only if your platform healthcheck no longer depends on Babel's HTTP endpoints.
```

- [ ] **Step 6: Run docs test**

Run:

```bash
npm test -- tests/deployment-config.test.ts -t "dashboard runtime mode"
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add .env.example docs/operations/docker.md docs/operations/deployment.md tests/deployment-config.test.ts
git commit -m "docs(deploy): document dashboard memory modes"
```

Expected: commit created.

## Task 8: Full Verification

**Files:**
- No code changes unless verification exposes a bug.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run runtime config benchmark**

Run:

```bash
npm run benchmark:runtime-config -- 100000
```

Expected: command completes and prints runtime config throughput and speedup versus `store.getAll()`.

- [ ] **Step 4: Optional health-only smoke test**

If local Discord credentials are not available, skip this and state that it was not run. If credentials are available, run the app with:

```bash
BABEL_DASHBOARD_MODE=health-only DASHBOARD_PORT=3000 npm start
```

Then run:

```bash
curl -fsS http://localhost:3000/livez
curl -fsS http://localhost:3000/metrics | head
```

Expected: `/livez` returns JSON with `"live":true`; `/metrics` returns Prometheus text.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes, or only intentional verification artifacts that are removed before final response.
