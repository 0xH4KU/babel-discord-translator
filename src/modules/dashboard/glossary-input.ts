const MAX_GLOSSARY_TEXT_LENGTH = 120;
const MAX_GLOSSARY_NOTES_LENGTH = 200;

export function sanitizeGlossaryInput(body: Record<string, unknown>):
    | {
          ok: true;
          value: {
              id?: number;
              sourceText: string;
              targetText: string;
              notes: string;
          };
      }
    | { ok: false; error: string } {
    const sourceText = String(body.sourceText ?? '').trim();
    const targetText = String(body.targetText ?? '').trim();
    const notes = String(body.notes ?? '').trim();
    const rawId = body.id;
    const id =
        rawId === undefined || rawId === null || rawId === ''
            ? undefined
            : Number.parseInt(String(rawId), 10);

    if (!sourceText || !targetText) {
        return { ok: false, error: 'Glossary source and target are required' };
    }

    if (
        sourceText.length > MAX_GLOSSARY_TEXT_LENGTH ||
        targetText.length > MAX_GLOSSARY_TEXT_LENGTH
    ) {
        return {
            ok: false,
            error: `Glossary source and target must be ${MAX_GLOSSARY_TEXT_LENGTH} characters or fewer`,
        };
    }

    if (notes.length > MAX_GLOSSARY_NOTES_LENGTH) {
        return {
            ok: false,
            error: `Glossary notes must be ${MAX_GLOSSARY_NOTES_LENGTH} characters or fewer`,
        };
    }

    if (id !== undefined && (!Number.isInteger(id) || id < 1)) {
        return { ok: false, error: 'Glossary entry id must be a positive integer' };
    }

    return {
        ok: true,
        value: {
            ...(id !== undefined ? { id } : {}),
            sourceText,
            targetText,
            notes,
        },
    };
}
