# Guild Glossary Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSV/TSV bulk import for Babel Guild Server Glossary entries with operator-selected skip or overwrite duplicate handling.

**Architecture:** Keep parsing and validation in `src/modules/dashboard/glossary-input.ts`, reusing `sanitizeGlossaryInput` for every parsed row. Add one Guild-only dashboard route beside the existing glossary routes that builds a case-insensitive in-memory lookup from current guild entries and applies `skip` or `overwrite` in file order. Extend the existing static dashboard assets with a compact import control that sends file or pasted text to the new JSON API and renders an import summary.

**Tech Stack:** TypeScript, Express 5 dashboard API, SQLite-backed glossary repository through existing store methods, static HTML/CSS/JS dashboard assets, Vitest, Node built-in HTTP test helpers.

---

### Task 1: Import Parser And Validation Helpers

**Files:**
- Modify: `tests/dashboard-helpers.test.ts`
- Modify: `src/modules/dashboard/glossary-input.ts`

- [ ] **Step 1: Write failing helper tests**

Add these imports at the top of `tests/dashboard-helpers.test.ts`:

```ts
import {
    parseGlossaryImport,
    sanitizeGlossaryInput,
    sanitizeGlossaryImportRequest,
} from '../src/modules/dashboard/glossary-input.js';
```

Replace the existing single `sanitizeGlossaryInput` import with the block above.

Add these tests inside `describe('dashboard helper modules', () => { ... })`, after the existing glossary input assertions:

```ts
    it('parses glossary CSV and TSV imports with optional headers', () => {
        expect(
            parseGlossaryImport(
                'sourceText,targetText,notes\nOpenAI,OpenAI,Preserve brand\n"raid, boss",團本,"Game, term"',
            ),
        ).toEqual({
            ok: true,
            rows: [
                {
                    line: 2,
                    input: {
                        sourceText: 'OpenAI',
                        targetText: 'OpenAI',
                        notes: 'Preserve brand',
                    },
                },
                {
                    line: 3,
                    input: {
                        sourceText: 'raid, boss',
                        targetText: '團本',
                        notes: 'Game, term',
                    },
                },
            ],
        });

        expect(parseGlossaryImport('OpenAI\tOpenAI\nraid\t團本\tGame term')).toEqual({
            ok: true,
            rows: [
                {
                    line: 1,
                    input: { sourceText: 'OpenAI', targetText: 'OpenAI', notes: '' },
                },
                {
                    line: 2,
                    input: { sourceText: 'raid', targetText: '團本', notes: 'Game term' },
                },
            ],
        });
    });

    it('returns row-level errors for invalid glossary import rows', () => {
        expect(parseGlossaryImport('source,target,notes\n,團本\nraid,,Game term')).toEqual({
            ok: true,
            rows: [],
            errors: [
                { line: 2, error: 'Glossary source and target are required' },
                { line: 3, error: 'Glossary source and target are required' },
            ],
        });
    });

    it('rejects malformed or oversized glossary import requests', () => {
        expect(
            sanitizeGlossaryImportRequest({
                text: 'source,target\nOpenAI,OpenAI',
                duplicateMode: 'skip',
            }),
        ).toEqual({
            ok: true,
            value: {
                text: 'source,target\nOpenAI,OpenAI',
                duplicateMode: 'skip',
            },
        });

        expect(
            sanitizeGlossaryImportRequest({
                text: 'source,target\nOpenAI,OpenAI',
                duplicateMode: 'replace',
            }),
        ).toEqual({ ok: false, error: 'Glossary import duplicate mode must be skip or overwrite' });

        expect(sanitizeGlossaryImportRequest({ text: '', duplicateMode: 'skip' })).toEqual({
            ok: false,
            error: 'Glossary import text is required',
        });

        expect(parseGlossaryImport('"unterminated,OpenAI')).toEqual({
            ok: true,
            rows: [],
            errors: [{ line: 1, error: 'Malformed CSV row' }],
        });
    });
```

- [ ] **Step 2: Run helper tests to verify red**

Run:

```bash
npm test -- tests/dashboard-helpers.test.ts -t "glossary"
```

Expected: FAIL because `parseGlossaryImport` and `sanitizeGlossaryImportRequest` are not exported.

- [ ] **Step 3: Implement import helper types and request validation**

In `src/modules/dashboard/glossary-input.ts`, keep the existing `sanitizeGlossaryInput` export and add these constants and types near the top:

```ts
const MAX_GLOSSARY_IMPORT_BYTES = 128 * 1024;
const MAX_GLOSSARY_IMPORT_ROWS = 500;

export type GlossaryImportDuplicateMode = 'skip' | 'overwrite';

export interface GlossaryImportRow {
    line: number;
    input: {
        sourceText: string;
        targetText: string;
        notes: string;
    };
}

export interface GlossaryImportRowError {
    line: number;
    error: string;
}
```

Add this function after `sanitizeGlossaryInput`:

```ts
export function sanitizeGlossaryImportRequest(body: Record<string, unknown>):
    | {
          ok: true;
          value: {
              text: string;
              duplicateMode: GlossaryImportDuplicateMode;
          };
      }
    | { ok: false; error: string } {
    const text = String(body.text ?? '').trim();
    const duplicateMode = String(body.duplicateMode ?? '').trim();

    if (!text) {
        return { ok: false, error: 'Glossary import text is required' };
    }

    if (Buffer.byteLength(text, 'utf8') > MAX_GLOSSARY_IMPORT_BYTES) {
        return { ok: false, error: 'Glossary import text must be 128KB or smaller' };
    }

    if (duplicateMode !== 'skip' && duplicateMode !== 'overwrite') {
        return {
            ok: false,
            error: 'Glossary import duplicate mode must be skip or overwrite',
        };
    }

    return {
        ok: true,
        value: {
            text,
            duplicateMode,
        },
    };
}
```

- [ ] **Step 4: Implement CSV/TSV parsing and row validation**

Add these helper functions to `src/modules/dashboard/glossary-input.ts` below `sanitizeGlossaryImportRequest`:

```ts
function splitImportLines(text: string): Array<{ line: number; text: string }> {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((lineText, index) => ({ line: index + 1, text: lineText }))
        .filter((line) => line.text.trim() !== '');
}

function parseCsvLine(line: string): { ok: true; fields: string[] } | { ok: false } {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    if (inQuotes) {
        return { ok: false };
    }

    fields.push(current.trim());
    return { ok: true, fields };
}

function parseDelimitedLine(
    line: string,
    delimiter: ',' | '\t',
): { ok: true; fields: string[] } | { ok: false } {
    if (delimiter === '\t') {
        return { ok: true, fields: line.split('\t').map((field) => field.trim()) };
    }

    return parseCsvLine(line);
}

function isHeaderRow(fields: string[]): boolean {
    const first = String(fields[0] ?? '').trim().toLowerCase();
    const second = String(fields[1] ?? '').trim().toLowerCase();

    return (
        (first === 'sourcetext' || first === 'source') &&
        (second === 'targettext' || second === 'target')
    );
}
```

Add the exported parser:

```ts
export function parseGlossaryImport(text: string): {
    ok: true;
    rows: GlossaryImportRow[];
    errors?: GlossaryImportRowError[];
} {
    const lines = splitImportLines(text);
    const delimiter = lines.some((line) => line.text.includes('\t')) ? '\t' : ',';
    const rows: GlossaryImportRow[] = [];
    const errors: GlossaryImportRowError[] = [];
    let sawFirstParsedRow = false;

    for (const line of lines) {
        const parsed = parseDelimitedLine(line.text, delimiter);
        if (!parsed.ok) {
            errors.push({ line: line.line, error: 'Malformed CSV row' });
            continue;
        }

        if (!sawFirstParsedRow && isHeaderRow(parsed.fields)) {
            sawFirstParsedRow = true;
            continue;
        }
        sawFirstParsedRow = true;

        if (rows.length >= MAX_GLOSSARY_IMPORT_ROWS) {
            errors.push({
                line: line.line,
                error: `Glossary import supports at most ${MAX_GLOSSARY_IMPORT_ROWS} rows`,
            });
            continue;
        }

        const input = sanitizeGlossaryInput({
            sourceText: parsed.fields[0] ?? '',
            targetText: parsed.fields[1] ?? '',
            notes: parsed.fields[2] ?? '',
        });

        if (!input.ok) {
            errors.push({ line: line.line, error: input.error });
            continue;
        }

        rows.push({
            line: line.line,
            input: {
                sourceText: input.value.sourceText,
                targetText: input.value.targetText,
                notes: input.value.notes,
            },
        });
    }

    return errors.length > 0 ? { ok: true, rows, errors } : { ok: true, rows };
}
```

- [ ] **Step 5: Run helper tests to verify green**

Run:

```bash
npm test -- tests/dashboard-helpers.test.ts -t "glossary"
```

Expected: PASS.

- [ ] **Step 6: Commit helper work**

Run:

```bash
git add src/modules/dashboard/glossary-input.ts tests/dashboard-helpers.test.ts
git commit -m "feat(dashboard): parse glossary imports"
```

Expected: commit succeeds.

### Task 2: Guild Glossary Import API

**Files:**
- Modify: `tests/dashboard.test.ts`
- Modify: `src/modules/dashboard/dashboard.ts`

- [ ] **Step 1: Write failing API tests**

In `tests/dashboard.test.ts`, add these tests after `it('should validate glossary entry input', ...)` and before the Babel Pocket glossary route test:

```ts
    it('should import glossary entries with case-insensitive skip and overwrite modes', async () => {
        cache.set('glossary-cache-key', 'cached translation');

        const initial = await request(server, 'POST', '/api/guild-glossary/guild-import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                sourceText: 'OpenAI',
                targetText: 'OpenAI',
                notes: 'Original brand note',
            },
        });
        expect(initial.status).toBe(200);
        cache.set('glossary-cache-key', 'cached translation');

        const skip = await request(server, 'POST', '/api/guild-glossary/guild-import/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'skip',
                text: 'sourceText,targetText,notes\nopenai,Open AI,Changed note\nraid,團本,Game term',
            },
        });

        expect(skip.status).toBe(200);
        expect(skip.body).toMatchObject({
            ok: true,
            created: 1,
            updated: 0,
            skipped: 1,
            failed: 0,
            cacheCleared: true,
        });
        expect(cache.stats().size).toBe(0);

        const afterSkip = await request(server, 'GET', '/api/guild-glossary/guild-import', {
            cookie: sessionCookie,
        });
        expect(afterSkip.body!.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sourceText: 'OpenAI',
                    targetText: 'OpenAI',
                    notes: 'Original brand note',
                }),
                expect.objectContaining({
                    sourceText: 'raid',
                    targetText: '團本',
                    notes: 'Game term',
                }),
            ]),
        );

        cache.set('glossary-cache-key', 'cached translation');
        const overwrite = await request(server, 'POST', '/api/guild-glossary/guild-import/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'overwrite',
                text: 'source,target,notes\nopenai,Open AI,Changed note\nRAID,レイド,JP term',
            },
        });

        expect(overwrite.status).toBe(200);
        expect(overwrite.body).toMatchObject({
            ok: true,
            created: 0,
            updated: 2,
            skipped: 0,
            failed: 0,
            cacheCleared: true,
        });
        expect(cache.stats().size).toBe(0);

        const afterOverwrite = await request(server, 'GET', '/api/guild-glossary/guild-import', {
            cookie: sessionCookie,
        });
        expect(afterOverwrite.body!.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sourceText: 'openai',
                    targetText: 'Open AI',
                    notes: 'Changed note',
                }),
                expect.objectContaining({
                    sourceText: 'RAID',
                    targetText: 'レイド',
                    notes: 'JP term',
                }),
            ]),
        );
    });

    it('should report glossary import row errors and avoid cache clearing when nothing changes', async () => {
        cache.set('unchanged-cache-key', 'cached translation');

        const res = await request(server, 'POST', '/api/guild-glossary/guild-import-errors/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'skip',
                text: 'source,target\n,團本\nraid,',
            },
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            ok: true,
            created: 0,
            updated: 0,
            skipped: 0,
            failed: 2,
            errors: [
                { line: 2, error: 'Glossary source and target are required' },
                { line: 3, error: 'Glossary source and target are required' },
            ],
            cacheCleared: false,
        });
        expect(cache.stats().size).toBe(1);
    });

    it('should validate glossary import requests', async () => {
        const res = await request(server, 'POST', '/api/guild-glossary/guild-1/import', {
            cookie: sessionCookie,
            csrf: csrfToken,
            body: {
                duplicateMode: 'replace',
                text: 'source,target\nOpenAI,OpenAI',
            },
        });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
            error: 'Glossary import duplicate mode must be skip or overwrite',
        });
    });
```

Extend the existing `it('should not expose guild glossary routes for Babel Pocket', ...)` test by adding this request inside its `try` block after the existing GET assertion:

```ts
            const csrfRes = await request(pocketServer, 'GET', '/api/auth/check', {
                cookie,
            });
            const pocketCsrf = csrfRes.body!.csrfToken as string;
            const importRes = await requestText(
                pocketServer,
                'POST',
                '/api/guild-glossary/guild-1/import',
                {
                    cookie,
                    csrf: pocketCsrf,
                },
            );
            expect(importRes.status).toBe(404);
```

- [ ] **Step 2: Run API tests to verify red**

Run:

```bash
npm test -- tests/dashboard.test.ts -t "glossary"
```

Expected: FAIL because `/api/guild-glossary/:guildId/import` does not exist.

- [ ] **Step 3: Import helper exports into dashboard route file**

In `src/modules/dashboard/dashboard.ts`, replace:

```ts
import { sanitizeGlossaryInput } from './glossary-input.js';
```

with:

```ts
import {
    parseGlossaryImport,
    sanitizeGlossaryImportRequest,
    sanitizeGlossaryInput,
} from './glossary-input.js';
```

- [ ] **Step 4: Add normalized duplicate helper**

In `src/modules/dashboard/dashboard.ts`, near the other top-level helper functions, add:

```ts
function normalizeGlossarySource(sourceText: string): string {
    return sourceText.trim().toLowerCase();
}
```

- [ ] **Step 5: Implement the import route**

In `src/modules/dashboard/dashboard.ts`, add this route between the current glossary POST route and DELETE route:

```ts
    api.postIf(
        'guildGlossary',
        '/guild-glossary/:guildId/import',
        auth.requireAuth,
        auth.requireCsrf,
        (req: Request, res: Response) => {
            const guildId = String(req.params.guildId ?? '').trim();
            if (!guildId) {
                res.status(400).json({ error: 'Guild id is required' });
                return;
            }

            const importRequest = sanitizeGlossaryImportRequest(req.body ?? {});
            if (!importRequest.ok) {
                res.status(400).json({ error: importRequest.error });
                return;
            }

            const parsed = parseGlossaryImport(importRequest.value.text);
            const existingBySource = new Map(
                guildGlossaryRepository
                    .listEntries(guildId)
                    .map((entry) => [normalizeGlossarySource(entry.sourceText), entry] as const),
            );
            let created = 0;
            let updated = 0;
            let skipped = 0;

            for (const row of parsed.rows) {
                const normalizedSource = normalizeGlossarySource(row.input.sourceText);
                const existing = existingBySource.get(normalizedSource);

                if (existing && importRequest.value.duplicateMode === 'skip') {
                    skipped++;
                    continue;
                }

                if (existing) {
                    const entry = guildGlossaryRepository.upsertEntry(guildId, {
                        id: existing.id,
                        ...row.input,
                    });
                    existingBySource.delete(normalizedSource);
                    existingBySource.set(normalizeGlossarySource(entry.sourceText), entry);
                    updated++;
                    continue;
                }

                const entry = guildGlossaryRepository.upsertEntry(guildId, row.input);
                existingBySource.set(normalizeGlossarySource(entry.sourceText), entry);
                created++;
            }

            const failed = parsed.errors?.length ?? 0;
            const changed = created + updated > 0;
            if (changed) {
                cache.clear();
            }

            res.json({
                ok: true,
                created,
                updated,
                skipped,
                failed,
                errors: parsed.errors ?? [],
                cacheCleared: changed,
            });
        },
    );
```

- [ ] **Step 6: Run API tests to verify green**

Run:

```bash
npm test -- tests/dashboard.test.ts -t "glossary"
```

Expected: PASS.

- [ ] **Step 7: Commit API work**

Run:

```bash
git add src/modules/dashboard/dashboard.ts tests/dashboard.test.ts
git commit -m "feat(dashboard): import guild glossary entries"
```

Expected: commit succeeds.

### Task 3: Dashboard Import UI

**Files:**
- Modify: `tests/dashboard-assets.test.ts`
- Modify: `src/public/index.html`
- Modify: `src/public/js/access.js`
- Modify: `src/public/css/settings.css`

- [ ] **Step 1: Write failing static asset tests**

In `tests/dashboard-assets.test.ts`, add this test after `it('keeps Access tab network calls aligned with the current app capabilities', ...)`:

```ts
    it('exposes Server Glossary import controls and client import flow', () => {
        const html = readFileSync('src/public/index.html', 'utf-8');
        const accessJs = readFileSync('src/public/js/access.js', 'utf-8');
        const settingsCss = readFileSync('src/public/css/settings.css', 'utf-8');

        expect(html).toContain('id="glossary-import-file"');
        expect(html).toContain('id="glossary-import-text"');
        expect(html).toContain('name="glossary-import-mode"');
        expect(html).toContain('onclick="importGlossaryEntries()"');
        expect(accessJs).toContain('function readGlossaryImportFile');
        expect(accessJs).toContain('function importGlossaryEntries');
        expect(accessJs).toContain("api('/guild-glossary/' + glossaryGuildId + '/import'");
        expect(accessJs).toContain('renderGlossaryImportResult');
        expect(accessJs).toContain('escapeHtml(error.error)');
        expect(settingsCss).toContain('.glossary-import');
        expect(settingsCss).toContain('.glossary-import-result');
    });
```

- [ ] **Step 2: Run asset tests to verify red**

Run:

```bash
npm test -- tests/dashboard-assets.test.ts -t "Glossary import"
```

Expected: FAIL because import controls and functions are not present.

- [ ] **Step 3: Add glossary import controls to HTML**

In `src/public/index.html`, inside the `data-capability="guildGlossary"` section, after the existing `.glossary-form` block and before `<div id="glossary-container">`, add:

```html
                    <div class="glossary-import">
                        <div class="settings-row">
                            <div class="input-group">
                                <label>Import Glossary</label>
                                <input
                                    type="file"
                                    id="glossary-import-file"
                                    accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
                                    onchange="readGlossaryImportFile(this)"
                                />
                            </div>
                            <div class="input-group">
                                <label>Duplicate Terms</label>
                                <div class="segmented-options">
                                    <label>
                                        <input
                                            type="radio"
                                            name="glossary-import-mode"
                                            value="skip"
                                            checked
                                        />
                                        Skip existing
                                    </label>
                                    <label>
                                        <input
                                            type="radio"
                                            name="glossary-import-mode"
                                            value="overwrite"
                                        />
                                        Overwrite existing
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div class="settings-row">
                            <div class="input-group">
                                <label>CSV or TSV Text</label>
                                <textarea
                                    id="glossary-import-text"
                                    rows="5"
                                    maxlength="131072"
                                    placeholder="sourceText,targetText,notes&#10;OpenAI,OpenAI,Preserve brand name&#10;raid,團本,Game term"
                                ></textarea>
                            </div>
                        </div>
                        <div class="glossary-actions">
                            <button class="btn btn-secondary btn-sm" onclick="clearGlossaryImport()">
                                Clear Import
                            </button>
                            <button class="btn btn-primary btn-sm" onclick="importGlossaryEntries()">
                                Import Terms
                            </button>
                        </div>
                        <div id="glossary-import-result" class="glossary-import-result" hidden></div>
                    </div>
```

- [ ] **Step 4: Add frontend import helpers**

In `src/public/js/access.js`, add these functions after `resetGlossaryForm()` and before `editGlossaryEntry()`:

```js
function selectedGlossaryImportMode() {
    const selected = document.querySelector('input[name="glossary-import-mode"]:checked');
    return selected?.value === 'overwrite' ? 'overwrite' : 'skip';
}

function renderGlossaryImportResult(result) {
    const container = document.getElementById('glossary-import-result');
    if (!container) return;

    const errors = Array.isArray(result.errors) ? result.errors : [];
    const summary = [
        `Created ${result.created || 0}`,
        `Updated ${result.updated || 0}`,
        `Skipped ${result.skipped || 0}`,
        `Failed ${result.failed || 0}`,
    ].join(' · ');
    const errorRows = errors
        .slice(0, 8)
        .map(
            (error) =>
                `<li>Line ${escapeHtml(error.line)}: ${escapeHtml(error.error)}</li>`,
        )
        .join('');
    const more = errors.length > 8 ? `<div class="dim">+${errors.length - 8} more errors</div>` : '';

    container.hidden = false;
    container.innerHTML = `<strong>${escapeHtml(summary)}</strong>${
        errorRows ? `<ul>${errorRows}</ul>${more}` : ''
    }`;
}

function clearGlossaryImport() {
    if (!hasDashboardCapability('guildGlossary')) return;

    const file = document.getElementById('glossary-import-file');
    const text = document.getElementById('glossary-import-text');
    const result = document.getElementById('glossary-import-result');
    if (file) file.value = '';
    if (text) text.value = '';
    if (result) {
        result.hidden = true;
        result.innerHTML = '';
    }
}

function readGlossaryImportFile(input) {
    if (!hasDashboardCapability('guildGlossary')) return;

    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const text = document.getElementById('glossary-import-text');
        if (text) text.value = String(reader.result || '');
    };
    reader.onerror = () => showToast('Failed to read import file', true);
    reader.readAsText(file);
}
```

Then add this function after `saveGlossaryEntry()` and before `deleteGlossaryEntry()`:

```js
async function importGlossaryEntries() {
    if (!hasDashboardCapability('guildGlossary')) return;

    if (!glossaryGuildId) {
        showToast('Select a server first', true);
        return;
    }

    const text = document.getElementById('glossary-import-text').value.trim();
    if (!text) {
        showToast('Import text is required', true);
        return;
    }

    const res = await api('/guild-glossary/' + glossaryGuildId + '/import', {
        method: 'POST',
        body: JSON.stringify({
            text,
            duplicateMode: selectedGlossaryImportMode(),
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
        renderGlossaryImportResult(data);
        await loadGlossaryEntries();
        showToast('Glossary import complete' + (data.failed ? ' with errors' : ''));
    } else {
        showToast(data.error || 'Import failed', true);
    }
}
```

- [ ] **Step 5: Add import CSS**

In `src/public/css/settings.css`, below the existing `.glossary-form` rule, add:

```css
.glossary-import {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
}

.glossary-import textarea {
    width: 100%;
    min-height: 8rem;
    resize: vertical;
}

.segmented-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
}

.segmented-options label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text);
    font-size: 0.85rem;
}

.glossary-import-result {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    font-size: 0.82rem;
}

.glossary-import-result ul {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
}
```

- [ ] **Step 6: Run asset tests to verify green**

Run:

```bash
npm test -- tests/dashboard-assets.test.ts -t "Glossary import"
```

Expected: PASS.

- [ ] **Step 7: Commit UI work**

Run:

```bash
git add src/public/index.html src/public/js/access.js src/public/css/settings.css tests/dashboard-assets.test.ts
git commit -m "feat(dashboard): add glossary import controls"
```

Expected: commit succeeds.

### Task 4: Demo Asset Refresh And Fixture Route

**Files:**
- Modify: `tests/build-demo.test.ts`
- Modify: `scripts/build-demo.ts`
- Generated: `docs/demo/guild/**`
- Generated: `docs/demo/pocket/**`

- [ ] **Step 1: Write failing demo test**

In `tests/build-demo.test.ts`, inside `it('should mirror public dashboard assets and inject demo mode scripts for both apps', ...)`, add these assertions after the existing `guildHtml` assertions:

```ts
        expect(guildHtml).toContain('id="glossary-import-file"');
        expect(guildHtml).toContain('id="glossary-import-text"');
```

Add this assertion near the existing demo API assertions for guild:

```ts
        expect(readFileSync(join(demoDir, 'guild', 'demo', 'demo-api.js'), 'utf-8')).toContain(
            '/guild-glossary/100000000000000001/import',
        );
```

- [ ] **Step 2: Run demo test to verify red**

Run:

```bash
npm test -- tests/build-demo.test.ts
```

Expected: FAIL because the demo API does not include the import route yet.

- [ ] **Step 3: Add demo import route**

In `scripts/build-demo.ts`, update `createDemoApiJs()` so the guild `userOnlyRoutes` string includes this route immediately after the existing `'/guild-glossary/100000000000000001': 'guild-glossary.json',` line:

```ts
    '/guild-glossary/100000000000000001/import': { ok: true, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], cacheCleared: false },
```

Do not add the route to the Pocket branch.

- [ ] **Step 4: Run demo build and test**

Run:

```bash
npm run demo:build
npm test -- tests/build-demo.test.ts
```

Expected: both commands exit 0, and `docs/demo/guild` plus `docs/demo/pocket` mirror the current public assets.

- [ ] **Step 5: Commit demo work**

Run:

```bash
git add scripts/build-demo.ts tests/build-demo.test.ts docs/demo
git commit -m "chore(demo): refresh glossary import dashboard demo"
```

Expected: commit succeeds.

### Task 5: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: exit 0.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/dashboard-helpers.test.ts tests/dashboard.test.ts tests/dashboard-assets.test.ts tests/build-demo.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: exit 0.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 6: Check formatting-sensitive diff issues**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 7: Review final diff**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
```

Expected: working tree is clean, and recent commits include parser, API, UI, and demo updates.
