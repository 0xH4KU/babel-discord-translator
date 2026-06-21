# Guild Glossary Import Design

## Summary

Babel Guild should let dashboard operators import many Server Glossary terms at once. The feature will add an import control to the existing Server Glossary dashboard section and a batch API endpoint for the selected guild.

Import should support plain CSV or TSV text with `sourceText`, `targetText`, and optional `notes` fields. Operators choose how duplicate source terms are handled for that guild:

- Skip existing terms.
- Overwrite existing terms.

Duplicate matching is case-insensitive after trimming whitespace. Stored entries still preserve the imported source text casing.

## Goals

- Add a practical bulk import path for server-specific glossary terms.
- Reuse the existing glossary validation limits and cache invalidation behavior.
- Let operators choose skip or overwrite behavior per import.
- Report clear import results, including created, updated, skipped, failed, and row-level errors.
- Keep the feature Guild-only and hidden for Babel Pocket.
- Avoid a database migration for the first implementation.

## Non-Goals

- Do not add glossary import to Babel Pocket.
- Do not redesign the full glossary management UI.
- Do not add XLSX or Google Sheets import.
- Do not add glossary rollback/version history.
- Do not add a unique database constraint in this iteration.

## Import Format

The importer accepts CSV or TSV text. The recommended CSV shape is:

```csv
sourceText,targetText,notes
OpenAI,OpenAI,Preserve brand name
raid,團本,Game term
```

Rules:

- `sourceText` and `targetText` are required.
- `notes` is optional and defaults to an empty string.
- A header row is allowed.
- Pure data rows without a header are allowed.
- Existing single-entry limits still apply: source and target are at most 120 characters, notes are at most 200 characters.
- The import request is bounded to 500 parsed data rows and 128KB of text, so the dashboard cannot submit very large payloads.

Header detection is based on the first non-empty row. A row whose first two normalized fields are `sourceText`/`source` and `targetText`/`target` is treated as a header.

The CSV parser supports comma-delimited fields, quoted fields, escaped double quotes, and commas inside quoted values. Embedded newlines inside quoted fields are not supported. TSV is treated as tab-delimited rows. No new runtime dependency is needed for this bounded parser.

## Duplicate Handling

Duplicates are compared within the selected guild by normalized source:

```text
sourceText.trim().toLowerCase()
```

If an imported row matches an existing entry:

- `skip` leaves the existing entry unchanged and increments `skipped`.
- `overwrite` updates the existing entry's source text, target text, and notes from the imported row and increments `updated`.

If multiple imported rows share the same normalized source, the importer should process them deterministically in file order. After the first row creates or updates the normalized source, later matching rows should be handled by the selected duplicate mode against that newly current entry.

## API

Add a Guild-only dashboard route:

```http
POST /api/guild-glossary/:guildId/import
```

Request body:

```json
{
  "text": "sourceText,targetText,notes\nOpenAI,OpenAI,Preserve brand name",
  "duplicateMode": "skip"
}
```

`duplicateMode` accepts:

- `skip`
- `overwrite`

Response body:

```json
{
  "ok": true,
  "created": 10,
  "updated": 2,
  "skipped": 3,
  "failed": 1,
  "errors": [
    { "line": 7, "error": "Glossary source and target are required" }
  ],
  "cacheCleared": true
}
```

The route requires the same authentication and CSRF protection as single-entry glossary changes.

Cache behavior:

- Clear translation cache when at least one entry is created or updated.
- Do not clear cache if every row is skipped or failed.

## Server Design

Keep the first implementation close to the existing dashboard glossary flow:

- Extend `src/modules/dashboard/glossary-input.ts` with import parsing and validation helpers.
- Keep single-entry validation as the source of truth for row validation.
- In `src/modules/dashboard/dashboard.ts`, add the import route beside the current glossary routes.
- Use `guildGlossaryRepository.listEntries(guildId)` to build a case-insensitive lookup by normalized source.
- Use `guildGlossaryRepository.upsertEntry(guildId, input)` for both created and overwritten rows.

The current SQLite table has an index on `(guild_id, source_text)` but no unique constraint. The import implementation should not depend on SQLite `ON CONFLICT`; it should resolve duplicates in application code.

## Frontend Design

Add an import area inside the existing Server Glossary section:

- File input for `.csv` and `.tsv`.
- Optional textarea for paste-based import.
- A duplicate handling control with `Skip existing terms` and `Overwrite existing terms`.
- An `Import` button disabled when no guild or text is selected.
- A compact result summary after import.

The frontend should read the selected file as text and send it to the new JSON API. It should not duplicate all validation logic; the server remains authoritative. After a successful import, reload the selected guild glossary entries.

The UI should continue using the existing dashboard visual language and capability gating. No import controls should appear when `guildGlossary` is unavailable.

## Demo

The GitHub Pages dashboard demo mirrors `src/public`. After implementation, `npm run demo:build` should refresh `docs/demo/guild` assets. The demo API can return read-only success for POST requests as it does for other disabled dashboard mutations.

## Error Handling

The importer should return row-level errors for invalid rows and continue processing other valid rows. Request-level errors should be reserved for invalid guild id, unsupported duplicate mode, empty import text, or payloads over the configured limits.

Examples of row-level errors:

- Missing source or target.
- Source or target exceeds 120 characters.
- Notes exceed 200 characters.
- Malformed CSV row.

The frontend should show a toast for request-level failures and render a short summary for row-level failures.

## Testing

Add focused tests for:

- CSV parsing with header.
- CSV parsing without header.
- TSV parsing.
- Case-insensitive duplicate matching.
- `skip` mode preserving existing entries.
- `overwrite` mode updating existing entries.
- Partial success with row-level errors.
- Cache clearing only when entries change.
- Babel Pocket not exposing the import route.
- Dashboard assets containing the import controls.

Existing glossary tests should keep covering single-entry create, update, delete, and validation.

## Acceptance Criteria

- Babel Guild dashboard operators can import CSV or TSV glossary terms for a selected server.
- Operators can choose skip or overwrite behavior for duplicate source terms.
- Duplicate source matching is case-insensitive.
- Import results report created, updated, skipped, failed, and row-level errors.
- Translation cache is cleared only when imported rows create or update entries.
- Babel Pocket does not expose the import UI or import API.
- Tests cover helper parsing, dashboard API behavior, and static dashboard assets.
