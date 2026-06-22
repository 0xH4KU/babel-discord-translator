# Multilingual Guild Glossary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add target-language-aware Server Glossary entries so a guild can define different translations for the same source term across multiple target languages.

**Architecture:** Keep the existing flat glossary model and add `targetLanguage` to storage, API payloads, import rows, prompt selection, and dashboard rendering. Existing rows migrate to `auto`; exact target-language glossary entries take precedence over `auto` fallback entries during translation.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Express dashboard API, plain dashboard JavaScript/CSS/HTML, Vitest, existing demo builder.

---

### Task 1: Baseline And Failing Data-Model Tests

**Files:**
- Modify: `tests/sqlite-database.test.ts`
- Modify: `tests/store.test.ts`
- Modify: `tests/translation-service-helpers.test.ts`

- [ ] **Step 1: Run baseline verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: both commands exit 0 before feature work starts.

- [ ] **Step 2: Add failing SQLite migration test**

In `tests/sqlite-database.test.ts`, add a test under `describe('createSqliteDatabase')` that creates an in-memory DB, inspects `PRAGMA table_info(guild_glossary)`, and expects a `target_language` column with default `'auto'`. Also inspect `sqlite_master` for `idx_guild_glossary_language_lookup`.

- [ ] **Step 3: Verify RED for SQLite migration**

Run:

```bash
npm test -- tests/sqlite-database.test.ts
```

Expected: FAIL because `target_language` does not exist yet.

- [ ] **Step 4: Add failing store glossary test expectations**

In `tests/store.test.ts`, update the per-guild glossary test to expect created rows to include `targetLanguage: 'auto'`, add a `ja` entry for the same source term, and verify both rows are stored independently.

- [ ] **Step 5: Verify RED for store behavior**

Run:

```bash
npm test -- tests/store.test.ts
```

Expected: FAIL because stored glossary entries do not include `targetLanguage`.

- [ ] **Step 6: Add failing glossary-version test expectation**

In `tests/translation-service-helpers.test.ts`, update `buildGlossaryVersion` fixtures to include `targetLanguage` and expect the language value in the version fingerprint.

- [ ] **Step 7: Verify RED for helper versioning**

Run:

```bash
npm test -- tests/translation-service-helpers.test.ts
```

Expected: FAIL because glossary versioning ignores `targetLanguage`.

### Task 2: Data Model, Migration, And Store

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/persistence/sqlite-database.ts`
- Modify: `src/persistence/store.ts`
- Modify: `src/modules/translation/guild-glossary-repository.ts`
- Modify: `src/modules/translation/translation-service-helpers.ts`

- [ ] **Step 1: Extend shared glossary types**

Add `targetLanguage: string` to `GuildGlossaryEntry` and optional `targetLanguage?: string` to `GuildGlossaryInput`.

- [ ] **Step 2: Add SQLite migration**

Add migration id `6`, name `guild_glossary_target_language`, that runs:

```sql
ALTER TABLE guild_glossary
ADD COLUMN target_language TEXT NOT NULL DEFAULT 'auto';

CREATE INDEX IF NOT EXISTS idx_guild_glossary_language_lookup
ON guild_glossary (guild_id, target_language, source_text);
```

- [ ] **Step 3: Update store glossary reads and writes**

Select `target_language as targetLanguage`, trim/default input `targetLanguage` to `auto`, insert/update `target_language`, and order list results by `target_language COLLATE NOCASE`, then `source_text COLLATE NOCASE`, then `id`.

- [ ] **Step 4: Include target language in glossary version**

Update `buildGlossaryVersion` to include `entry.targetLanguage.trim()` between source and target values.

- [ ] **Step 5: Verify GREEN for data-model tests**

Run:

```bash
npm test -- tests/sqlite-database.test.ts tests/store.test.ts tests/translation-service-helpers.test.ts
```

Expected: PASS.

### Task 3: Failing Validation And Import Tests

**Files:**
- Modify: `tests/dashboard-helpers.test.ts`
- Modify: `tests/dashboard.test.ts`

- [ ] **Step 1: Add failing validation assertions**

Update dashboard helper tests to expect `sanitizeGlossaryInput` to return `targetLanguage: 'auto'` when omitted, preserve trimmed target language when provided, and reject blank or overlong target language values.

- [ ] **Step 2: Add failing import parser assertions**

Update import tests to cover four-column CSV/TSV rows with `sourceText,targetLanguage,targetText,notes` and old three-column rows defaulting to `auto`.

- [ ] **Step 3: Add failing dashboard import duplicate test**

Update `tests/dashboard.test.ts` glossary import coverage so two rows with the same source and different target languages are created independently, and overwrite only updates the matching source/language row.

- [ ] **Step 4: Verify RED for dashboard helper/API behavior**

Run:

```bash
npm test -- tests/dashboard-helpers.test.ts tests/dashboard.test.ts
```

Expected: FAIL because validation, import parsing, and duplicate matching are still source-only.

### Task 4: Validation, Import, And Dashboard API

**Files:**
- Modify: `src/modules/dashboard/glossary-input.ts`
- Modify: `src/modules/dashboard/dashboard.ts`
- Modify: `tests/dashboard.test.ts` mocked glossary store shape

- [ ] **Step 1: Add target-language validation**

In `glossary-input.ts`, add a `MAX_GLOSSARY_LANGUAGE_LENGTH` constant. `sanitizeGlossaryInput` should default missing language to `auto`, trim provided values, reject empty language, and reject values longer than the max.

- [ ] **Step 2: Parse three-column and four-column imports**

Update header detection and row mapping so `sourceText,targetLanguage,targetText,notes` maps four columns, while the old `sourceText,targetText,notes` shape maps `targetLanguage: 'auto'`.

- [ ] **Step 3: Make duplicate matching language-aware**

In the import route, replace source-only lookup keys with normalized `sourceText + targetLanguage` keys. Use the same key after overwrite when source or language casing changes.

- [ ] **Step 4: Update dashboard test mocks**

Add `targetLanguage` to dashboard test glossary fixture and mock `upsertGuildGlossaryEntry` defaulting behavior so API tests exercise the new contract.

- [ ] **Step 5: Verify GREEN for dashboard helper/API tests**

Run:

```bash
npm test -- tests/dashboard-helpers.test.ts tests/dashboard.test.ts
```

Expected: PASS.

### Task 5: Failing Translation Prompt Selection Tests

**Files:**
- Modify: `tests/translate.test.ts`
- Modify: `tests/translation-service.test.ts`
- Modify: `tests/translation-service-helpers.test.ts`

- [ ] **Step 1: Add failing prompt rendering tests**

Add tests showing non-auto target prompts render compact rules without language labels, while `auto` target prompts label language-specific rows like `[ja]`.

- [ ] **Step 2: Add failing glossary selection helper tests**

Add tests for exact language entries taking precedence over `auto`, and `auto` fallback being included when no exact entry exists.

- [ ] **Step 3: Add failing service integration assertion**

Update the translation service glossary test so repository entries include `raid` in `auto`, `zh-TW`, and `ja`, while a `ja` translation receives only the `ja` raid row plus `auto` brand rows.

- [ ] **Step 4: Verify RED for translation selection**

Run:

```bash
npm test -- tests/translate.test.ts tests/translation-service-helpers.test.ts tests/translation-service.test.ts
```

Expected: FAIL because glossary entries are passed through unfiltered and prompt rendering has no target-language labels.

### Task 6: Prompt Filtering And Translator Options

**Files:**
- Modify: `src/modules/translation/translate.ts`
- Modify: `src/modules/translation/translation-service-helpers.ts`
- Modify: `src/modules/translation/translation-service.ts`

- [ ] **Step 1: Extend prompt entry shape**

Add optional `targetLanguage?: string` to `TranslationGlossaryPromptEntry`.

- [ ] **Step 2: Add glossary selection helper**

In `translation-service-helpers.ts`, add `selectGlossaryEntriesForTarget(entries, targetLanguage)`. For non-auto target languages, return exact-language rows plus `auto` rows whose normalized source has no exact-language row. For `auto`, return all entries.

- [ ] **Step 3: Use selected entries for cache and translator options**

In `translation-service.ts`, list all guild entries, select entries for the resolved target language, build the glossary version from selected entries, and pass selected entries to the translator.

- [ ] **Step 4: Render language labels for auto target prompts**

Update `buildTranslationPrompt` and `buildGlossaryPromptSection` so prompt rendering knows the request target language. Label rules with `[targetLanguage]` only when the request target language is `auto`.

- [ ] **Step 5: Verify GREEN for translation tests**

Run:

```bash
npm test -- tests/translate.test.ts tests/translation-service-helpers.test.ts tests/translation-service.test.ts
```

Expected: PASS.

### Task 7: Failing Dashboard Asset And Demo Tests

**Files:**
- Modify: `tests/dashboard-assets.test.ts`
- Modify: `tests/build-demo.test.ts`

- [ ] **Step 1: Add failing static asset assertions**

Expect `src/public/index.html` to contain `id="glossary-target-language"`, `src/public/js/access.js` to read and render `targetLanguage`, and glossary table headers to include `Language`.

- [ ] **Step 2: Add failing demo fixture assertions**

Expect the generated guild glossary demo fixture to contain entries with `targetLanguage` values and repeated `sourceText` for different languages.

- [ ] **Step 3: Verify RED for dashboard assets/demo**

Run:

```bash
npm test -- tests/dashboard-assets.test.ts tests/build-demo.test.ts
```

Expected: FAIL because the dashboard UI and demo fixture have not been updated.

### Task 8: Dashboard UI And Demo Builder

**Files:**
- Modify: `src/public/index.html`
- Modify: `src/public/js/access.js`
- Modify: `src/public/css/settings.css`
- Modify: `scripts/build-demo.ts`
- Regenerate: `docs/demo/guild/*`
- Regenerate: `docs/demo/pocket/*`

- [ ] **Step 1: Add language control to Server Glossary form**

Add a select/input for `glossary-target-language`, defaulting to `auto`, beside Source and Target.

- [ ] **Step 2: Render and edit target language in dashboard JS**

Update `renderGlossaryEntries`, `resetGlossaryForm`, `editGlossaryEntry`, `saveGlossaryEntry`, and import placeholder text to include `targetLanguage`.

- [ ] **Step 3: Keep UI responsive**

Update glossary form/table CSS only as needed so the new field fits existing layout.

- [ ] **Step 4: Update demo glossary fixtures**

Add multilingual demo entries and `targetLanguage` fields in `scripts/build-demo.ts`.

- [ ] **Step 5: Regenerate demo assets**

Run:

```bash
npm run demo:build
```

Expected: exits 0 and refreshes `docs/demo`.

- [ ] **Step 6: Verify GREEN for dashboard assets/demo**

Run:

```bash
npm test -- tests/dashboard-assets.test.ts tests/build-demo.test.ts
```

Expected: PASS.

### Task 9: Full Verification, Live Test, And Commit

**Files:**
- All modified files from previous tasks

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run typecheck
npm test
npm run demo:build
```

Expected: all commands exit 0.

- [ ] **Step 2: Start local dashboard for live test**

Run a local dashboard/server command appropriate for this repo, using a non-conflicting port if needed.

- [ ] **Step 3: Use Playwright live test**

With the local server running, use Playwright CLI to open the dashboard, inspect the Server Glossary UI, verify the language field is present, and create or inspect language-specific glossary rows through the browser where authentication/setup allows. Capture a screenshot under `output/playwright/` if useful.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git status --short
git add <modified files>
git commit -m "feat: support multilingual guild glossary"
```

Expected: commit succeeds, then `git status --short` is clean.
