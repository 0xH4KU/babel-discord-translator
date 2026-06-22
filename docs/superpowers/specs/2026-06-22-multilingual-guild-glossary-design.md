# Multilingual Guild Glossary Design

## Summary

Babel Guild's Server Glossary should support server-specific terminology across multiple target languages. The current glossary model is effectively bilingual: each row stores `sourceText -> targetText` without saying which target language the row is for. That works for one preferred output language, but it becomes ambiguous when the same source term needs different translations for Traditional Chinese, Japanese, Korean, English, or any other configured target language.

The first multilingual pass should keep the existing glossary shape and add one explicit language dimension:

```text
sourceText + targetLanguage => targetText
```

For example:

```text
raid + zh-TW => 團本
raid + ja    => レイド
raid + ko    => 레이드
```

Translation prompt construction should prefer glossary entries that match the resolved target language for the current request. Existing rows should migrate to `targetLanguage = auto` so current operators keep their glossary behavior until they add more precise language-specific entries.

## Goals

- Let one server define different glossary targets for the same source term across multiple target languages.
- Keep the feature Guild-only and hidden for Babel Pocket.
- Preserve existing glossary entries during migration.
- Avoid forcing operators to immediately reclassify old glossary data.
- Keep single-entry management and CSV/TSV import close to the existing dashboard flow.
- Make duplicate matching language-aware: same server, same normalized source, and same target language.
- Improve prompt clarity so the provider receives only relevant or clearly labeled glossary mappings.

## Non-Goals

- Do not redesign Server Glossary into a full terminology-management system with concept records and nested translations.
- Do not add XLSX, Google Sheets, or external terminology imports.
- Do not add glossary version history, rollback, approval workflows, or per-entry audit logs.
- Do not add Babel Pocket glossary support.
- Do not require a manual data cleanup before deployment.
- Do not rely on the model to infer target language from notes.

## Chosen Approach

Add `targetLanguage` to each glossary entry.

The normalized identity of a glossary row becomes:

```text
guildId + normalize(sourceText) + normalize(targetLanguage)
```

This keeps the data model straightforward and limits the blast radius:

- The repository still lists, creates, updates, and deletes flat glossary entries.
- The dashboard still renders a table and an edit form.
- The importer still processes rows one at a time with skip or overwrite behavior.
- The translation flow can filter the flat list before building the prompt.

The heavier alternative, a concept table with child translation rows, is intentionally out of scope for this implementation because the current problem is solved by adding a target-language dimension to flat glossary entries.

## Data Model

Extend `GuildGlossaryEntry` and `GuildGlossaryInput` with:

```ts
targetLanguage: string;
```

`targetLanguage` accepts:

- `auto`, for migrated or intentionally generic entries.
- Existing Discord or app language codes already used by target-language resolution, such as `zh-TW`, `zh-CN`, `ja`, `ko`, `en-US`, `fr`, and `de`.

Validation should trim the value and reject empty strings. To keep the first pass small, validation should accept any non-empty language code string up to a conservative length, such as 20 characters, rather than introducing a separate canonical language registry. UI controls can offer common supported languages, while the API remains forward-compatible with existing target-language settings.

SQLite migration:

```sql
ALTER TABLE guild_glossary
ADD COLUMN target_language TEXT NOT NULL DEFAULT 'auto';

CREATE INDEX IF NOT EXISTS idx_guild_glossary_language_lookup
ON guild_glossary (guild_id, target_language, source_text);
```

Do not add a unique database constraint in this pass. Existing data may already contain duplicate source terms, and SQLite case-insensitive uniqueness across trimmed source text would need careful cleanup. Application code should continue handling duplicates deterministically.

Rows should still preserve source and target casing exactly as operators entered them.

## Migration Behavior

Existing glossary entries should become `targetLanguage = auto`.

This is more conservative than assuming old targets are Traditional Chinese. Some operators may already have English-preservation entries, Japanese terms, or brand-specific mappings. `auto` means "legacy or generic mapping" and lets current behavior continue after deployment.

When operators later add a language-specific row for the same source term, that precise row should take priority over the `auto` fallback for matching target-language requests.

## API

Existing endpoints remain:

```http
GET /api/guild-glossary/:guildId
POST /api/guild-glossary/:guildId
POST /api/guild-glossary/:guildId/import
DELETE /api/guild-glossary/:guildId/:entryId
```

Single-entry create/update accepts:

```json
{
  "id": 12,
  "sourceText": "raid",
  "targetLanguage": "ja",
  "targetText": "レイド",
  "notes": "Game term"
}
```

For backward compatibility, if `targetLanguage` is omitted, the server should default it to `auto`.

List response entries include `targetLanguage`:

```json
{
  "entries": [
    {
      "id": 12,
      "guildId": "100000000000000001",
      "sourceText": "raid",
      "targetLanguage": "ja",
      "targetText": "レイド",
      "notes": "Game term",
      "createdAt": "2026-06-22T00:00:00.000Z",
      "updatedAt": "2026-06-22T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

Errors should remain request-level for invalid guild id, invalid entry id, missing source or target, empty target language, or field length violations.

Cache behavior remains unchanged: creating, updating, or deleting glossary entries clears translation cache.

## Import Format

The recommended CSV/TSV shape becomes:

```csv
sourceText,targetLanguage,targetText,notes
OpenAI,auto,OpenAI,Preserve brand name
raid,zh-TW,團本,Game term
raid,ja,レイド,Game term
```

For backward compatibility, imports should also accept the old three-column shape:

```csv
sourceText,targetText,notes
raid,團本,Game term
```

Old-shape rows default to `targetLanguage = auto`.

Header detection should support both:

- `sourceText,targetText,notes`
- `sourceText,targetLanguage,targetText,notes`

Duplicate handling changes from "same source" to "same source and same target language" within the selected guild:

```text
sourceText.trim().toLowerCase() + '\0' + targetLanguage.trim().toLowerCase()
```

The existing duplicate modes keep their meaning:

- `skip` leaves the current language-specific row unchanged.
- `overwrite` updates the matching row's source text, target language, target text, and notes.

If a single import contains repeated rows for the same source and target language, process them in file order, as the current importer does.

## Translation Prompt Behavior

When resolving glossary entries for a translation request, choose entries in this order:

1. Entries whose `targetLanguage` exactly matches the resolved target language.
2. `auto` entries for source terms that do not already have a precise match.

This gives new multilingual entries precedence without making migrated data disappear.

Example with target language `ja`:

```text
raid + ja => レイド
raid + auto => 團本
OpenAI + auto => OpenAI
```

Prompt glossary should include:

```text
raid => レイド
OpenAI => OpenAI
```

It should not include `raid => 團本`, because a precise Japanese row exists.

When the resolved target language is `auto`, include all usable glossary entries but label language-specific rows clearly:

```text
- raid [zh-TW] => 團本 (Game term)
- raid [ja] => レイド (Game term)
- OpenAI [auto] => OpenAI (Preserve brand name)
```

This preserves the current broad auto behavior while reducing ambiguity.

Prompt rendering for non-auto target languages can stay compact:

```text
- raid => レイド (Game term)
- OpenAI => OpenAI (Preserve brand name)
```

## Frontend Design

Keep the existing Server Glossary section and add a target language control to the entry form.

Table columns should become:

- Source
- Language
- Target
- Notes
- Actions

The language field should default to `auto` for new entries. Editing an existing entry should populate the stored language. The dashboard can use a select control with common target languages plus `auto`, matching the language choices already exposed by the bot where practical.

The import UI should update its placeholder/example text to show the four-column format while still accepting old three-column files.

The UI should not appear when `guildGlossary` capability is unavailable.

## Demo

The GitHub Pages dashboard demo mirrors `src/public`. After implementation, `npm run demo:build` should refresh `docs/demo/guild` and `docs/demo/pocket` assets. Guild demo fixtures should include at least two entries with the same `sourceText` and different `targetLanguage` values.

Pocket demo capability should remain `guildGlossary: false`.

## Error Handling

Validation should keep existing messages where possible and add language-specific errors only where needed:

- Missing source or target: existing message remains.
- Empty target language: return a clear glossary target-language error.
- Overlong source, target, notes, or target language: return a bounded validation error.
- Malformed CSV row: existing import row-level behavior remains.

Import should continue processing valid rows when other rows fail validation.

## Testing

Add or update focused tests for:

- SQLite migration adds `target_language` with existing rows defaulting to `auto`.
- Store/repository list, create, update, and delete include `targetLanguage`.
- Single-entry validation defaults omitted `targetLanguage` to `auto`.
- Single-entry validation rejects empty or overlong `targetLanguage`.
- Import parses the new four-column format.
- Import still parses the old three-column format as `auto`.
- Duplicate matching uses source plus target language.
- `skip` and `overwrite` only affect matching language rows.
- Prompt filtering prefers exact target-language entries over `auto`.
- Prompt filtering includes `auto` fallbacks when no precise row exists.
- `auto` target prompt labels language-specific rows.
- Dashboard assets contain the language column and form control.
- Babel Pocket does not expose glossary UI or API routes.

Verification commands:

```bash
npm run typecheck
npm test
npm run demo:build
```

## Acceptance Criteria

- A server can store multiple glossary rows with the same source term when their target languages differ.
- Existing glossary rows survive deployment and appear as `auto` entries.
- Dashboard operators can create, edit, delete, and import language-specific glossary rows.
- Import supports both old three-column and new four-column CSV/TSV files.
- Duplicate import behavior is language-aware.
- Translation requests use exact-language glossary mappings before `auto` fallbacks.
- Translation cache clears when glossary entries change.
- Babel Pocket remains unaffected.
