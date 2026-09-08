import { Router, type Request, type Response } from 'express';
import { store } from '../../persistence/store.js';
import type { GuildGlossaryInput } from '../../shared/types.js';
import type { TranslationCache } from '../translation/cache.js';
import {
    parseGlossaryImport,
    sanitizeGlossaryImportRequest,
    sanitizeGlossaryInput,
} from './glossary-input.js';

function normalizeGlossaryKey(source: string, language: string): string {
    return `${source.trim().toLowerCase()}\u0000${language.trim().toLowerCase()}`;
}

export function createGlossaryRouter(cache: TranslationCache): Router {
    const router = Router();
    router.get('/:guildId', (req: Request, res: Response) => {
        const guildId = String(req.params.guildId ?? '').trim();
        if (!guildId) {
            res.status(400).json({ error: 'Guild id is required' });
            return;
        }

        const entries = store.listGuildGlossary(guildId);
        res.json({ entries, count: entries.length });
    });

    router.post('/:guildId', (req: Request, res: Response) => {
        const guildId = String(req.params.guildId ?? '').trim();
        if (!guildId) {
            res.status(400).json({ error: 'Guild id is required' });
            return;
        }

        const input = sanitizeGlossaryInput(req.body ?? {});
        if (!input.ok) {
            res.status(400).json({ error: input.error });
            return;
        }

        try {
            const entry = store.upsertGuildGlossaryEntry(guildId, input.value);
            cache.clear();
            res.json({ ok: true, entry, cacheCleared: true });
        } catch (error) {
            res.status(404).json({ error: (error as Error).message });
        }
    });

    router.post('/:guildId/import', (req: Request, res: Response) => {
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
        const existingIdsByKey = new Map(
            store
                .listGuildGlossary(guildId)
                .map(
                    (entry) =>
                        [
                            normalizeGlossaryKey(entry.sourceText, entry.targetLanguage),
                            entry.id,
                        ] as const,
                ),
        );
        const pendingIndexesByKey = new Map<string, number>();
        const upserts: GuildGlossaryInput[] = [];
        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const row of parsed.rows) {
            const normalizedKey = normalizeGlossaryKey(
                row.input.sourceText,
                row.input.targetLanguage,
            );
            const existingId = existingIdsByKey.get(normalizedKey);
            const pendingIndex = pendingIndexesByKey.get(normalizedKey);
            const duplicate = existingId !== undefined || pendingIndex !== undefined;

            if (duplicate && importRequest.value.duplicateMode === 'skip') {
                skipped++;
                continue;
            }

            const input = existingId === undefined ? row.input : { id: existingId, ...row.input };
            if (pendingIndex === undefined) {
                pendingIndexesByKey.set(normalizedKey, upserts.length);
                upserts.push(input);
            } else {
                upserts[pendingIndex] = input;
            }

            if (duplicate) {
                updated++;
                continue;
            }

            created++;
        }

        store.upsertGuildGlossaryEntries(guildId, upserts);

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
    });

    router.delete('/:guildId/:entryId', (req: Request, res: Response) => {
        const guildId = String(req.params.guildId ?? '').trim();
        const entryId = Number.parseInt(String(req.params.entryId ?? ''), 10);

        if (!guildId || !Number.isInteger(entryId) || entryId < 1) {
            res.status(400).json({
                error: 'Valid guild id and glossary entry id are required',
            });
            return;
        }

        if (!store.deleteGuildGlossaryEntry(guildId, entryId)) {
            res.status(404).json({ error: 'Glossary entry not found' });
            return;
        }

        cache.clear();
        res.json({ ok: true, deleted: entryId });
    });

    return router;
}
