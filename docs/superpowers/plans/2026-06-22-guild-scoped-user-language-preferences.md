# Guild-Scoped User Language Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store and display Babel Guild user language preferences by Discord server.

**Architecture:** Add `guild_id` to the preference persistence contract and expose preference entries as records instead of a global user map. Commands, target resolution, dashboard APIs, and dashboard rendering all pass `guildId` explicitly.

**Tech Stack:** TypeScript, node:sqlite, Discord.js, Express, browser JavaScript, Vitest.

---

### Task 1: Persistence Contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/persistence/sqlite-database.ts`
- Modify: `src/persistence/store.ts`
- Modify: `src/persistence/store-data-normalizer.ts`
- Test: `tests/store.test.ts`
- Test: `tests/sqlite-database.test.ts`

- [ ] Write failing tests for storing the same user in two guilds and for the new `(guild_id, user_id)` schema.
- [ ] Run `npm test -- tests/store.test.ts tests/sqlite-database.test.ts` and verify the new tests fail.
- [ ] Add `UserLanguagePreferenceEntry`, migrate the SQLite table to a composite primary key, and update store methods to read/write/delete by guild id and user id.
- [ ] Run the same tests and verify they pass.

### Task 2: Runtime Lookup

**Files:**
- Modify: `src/modules/translation/user-preference-repository.ts`
- Modify: `src/modules/translation/target-language.ts`
- Modify: `src/modules/translation/translation-service.ts`
- Modify: `src/commands/setlang.ts`
- Test: `tests/store-backed-repositories.test.ts`
- Test: `tests/translation-service.test.ts`
- Test: `tests/setlang-command.test.ts`

- [ ] Write failing tests for `guildId` delegation, target language lookup, and `/setlang` storage.
- [ ] Run `npm test -- tests/store-backed-repositories.test.ts tests/translation-service.test.ts tests/setlang-command.test.ts` and verify the new tests fail.
- [ ] Pass `guildId` through repository calls and target resolution.
- [ ] Run the same tests and verify they pass.

### Task 3: Dashboard API And UI

**Files:**
- Modify: `src/modules/dashboard/dashboard.ts`
- Modify: `src/public/js/access.js`
- Modify: `src/public/index.html`
- Modify: `src/public/css/dashboard.css`
- Test: `tests/dashboard.test.ts`
- Test: `tests/dashboard-assets.test.ts`

- [ ] Write failing tests for `/api/user-prefs` entry payloads and scoped delete routes.
- [ ] Run `npm test -- tests/dashboard.test.ts tests/dashboard-assets.test.ts` and verify the new tests fail.
- [ ] Return entries with guild metadata and update the browser UI to group by server.
- [ ] Run the same tests and verify they pass.

### Task 4: Demo Assets And Full Verification

**Files:**
- Modify generated demo files under `docs/demo/guild` and `docs/demo/pocket`.
- Test: `tests/build-demo.test.ts`

- [ ] Update demo fixtures through `npm run demo:build`.
- [ ] Run `npm test -- tests/build-demo.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
