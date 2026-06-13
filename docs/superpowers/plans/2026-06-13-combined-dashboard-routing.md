# Combined Dashboard Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add combined-mode dashboard routing with a chooser at `/` and scoped product dashboards at `/guild` and `/pocket`.

**Architecture:** Keep one Express dashboard app and one shared auth/session layer. Add a small scope resolver that mounts the same dashboard API handlers under root, `/guild/api`, and `/pocket/api` with product-specific capabilities. The frontend chooses its API base from `window.location.pathname` and shows a chooser view only at the combined root path.

**Tech Stack:** TypeScript, Express 4, static HTML/CSS/JS dashboard assets, Vitest, Node built-in HTTP test helpers.

---

### Task 1: Server Routing Tests

**Files:**
- Modify: `tests/dashboard.test.ts`
- Modify: `src/modules/dashboard/dashboard.ts`

- [x] **Step 1: Write failing tests**

Add tests near the existing combined capabilities test:

```ts
it('should expose Guild-scoped capabilities for combined /guild/api/capabilities', async () => {
    const combinedApp = createDashboardApp({
        cache,
        cooldown: new CooldownManager(5),
        log,
        client: createMinimalClient(),
        getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
        metrics,
        runtimeLimiter,
        profile: BABEL_GUILD_PROFILE,
        profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
        sessionRepository: new InMemorySessionRepository(),
        userProfileRepository,
    });
    const combinedServer = startDashboardServer(combinedApp, 0);

    try {
        const login = await request(combinedServer, 'POST', '/api/login', {
            body: { password: 'test-pass-123' },
        });
        const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
        const res = await requestText(combinedServer, 'GET', '/guild/api/capabilities', {
            cookie,
        });

        expect(res.status).toBe(200);
        expect(JSON.parse(res.text)).toMatchObject({
            profile: { id: 'babel-guild', productName: 'Babel Guild' },
            capabilities: {
                guildAccess: true,
                userAccess: false,
                guildGlossary: true,
                pendingUserInstallOwners: false,
            },
        });
    } finally {
        stopDashboardApp(combinedApp);
        combinedServer.close();
    }
});

it('should expose Pocket-scoped capabilities for combined /pocket/api/capabilities', async () => {
    const combinedApp = createDashboardApp({
        cache,
        cooldown: new CooldownManager(5),
        log,
        client: createMinimalClient(),
        getStats: () => ({ totalTranslations: 0, apiCalls: 0 }),
        metrics,
        runtimeLimiter,
        profile: BABEL_GUILD_PROFILE,
        profiles: [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
        sessionRepository: new InMemorySessionRepository(),
        userProfileRepository,
    });
    const combinedServer = startDashboardServer(combinedApp, 0);

    try {
        const login = await request(combinedServer, 'POST', '/api/login', {
            body: { password: 'test-pass-123' },
        });
        const cookie = login.rawHeaders['set-cookie']![0].split(';')[0];
        const res = await requestText(combinedServer, 'GET', '/pocket/api/capabilities', {
            cookie,
        });

        expect(res.status).toBe(200);
        expect(JSON.parse(res.text)).toMatchObject({
            profile: { id: 'babel-pocket', productName: 'Babel Pocket' },
            capabilities: {
                guildAccess: false,
                userAccess: true,
                guildGlossary: false,
                pendingUserInstallOwners: true,
            },
        });
    } finally {
        stopDashboardApp(combinedApp);
        combinedServer.close();
    }
});
```

- [x] **Step 2: Run tests to verify red**

Run: `npm test -- tests/dashboard.test.ts -t "combined /guild/api/capabilities|combined /pocket/api/capabilities"`

Expected: tests fail with 404 or the wrong capability payload.

- [x] **Step 3: Implement scoped route mounting**

In `src/modules/dashboard/dashboard.ts`, derive `isCombinedDashboard`, add scoped API routers for root, `/guild/api`, and `/pocket/api`, and have capability-gated routes use the scoped profile/capabilities.

- [x] **Step 4: Run focused tests to verify green**

Run: `npm test -- tests/dashboard.test.ts -t "capabilities"`

Expected: all capability tests pass.

### Task 2: Chooser And Frontend API Scope

**Files:**
- Modify: `src/public/index.html`
- Modify: `src/public/css/login.css`
- Modify: `src/public/js/utils.js`
- Modify: `src/public/js/app.js`
- Modify: `src/public/js/auth.js`
- Test: `tests/dashboard-assets.test.ts`

- [x] **Step 1: Write failing asset tests**

Add assertions that `src/public/index.html` contains `id="profile-select-view"`, `/guild`, and `/pocket`, and that `src/public/js/utils.js` computes a scoped API base from the pathname.

- [x] **Step 2: Run tests to verify red**

Run: `npm test -- tests/dashboard-assets.test.ts`

Expected: tests fail because the chooser and API base are not present.

- [x] **Step 3: Implement chooser view and scoped API base**

Add a `profile-select-view` modeled after `docs/demo/index.html`. Update `api()` to prefix requests with `/guild/api` or `/pocket/api` when the current path starts with `/guild` or `/pocket`. Update login flow so `/` shows the chooser after auth in combined mode, while `/guild` and `/pocket` continue into the scoped dashboard.

- [x] **Step 4: Run asset tests to verify green**

Run: `npm test -- tests/dashboard-assets.test.ts`

Expected: tests pass.

### Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/railway.md`
- Modify: `docs/operations/docker.md`
- Modify: `tests/deployment-config.test.ts`

- [x] **Step 1: Write failing docs test**

Update `tests/deployment-config.test.ts` to require docs mention `/guild`, `/pocket`, and combined chooser routing.

- [x] **Step 2: Run docs test to verify red**

Run: `npm test -- tests/deployment-config.test.ts`

Expected: test fails until docs are updated.

- [x] **Step 3: Update docs**

Update the deployment docs and README so combined mode consistently says `/` is a chooser and `/guild`/`/pocket` are the management paths.

- [x] **Step 4: Run docs test to verify green**

Run: `npm test -- tests/deployment-config.test.ts`

Expected: docs test passes.

### Task 4: Full Verification And Publish

**Files:**
- Verify all changed files.

- [x] **Step 1: Run full checks**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 2: Commit implementation**

Run:

```bash
git add .
git commit -m "feat(dashboard): route combined product dashboards"
```

- [x] **Step 3: Push main**

Run:

```bash
git push origin main
```
