const MAX_GLOSSARY_TEXT_LENGTH = 120;
const MAX_GLOSSARY_NOTES_LENGTH = 200;
const MAX_GLOSSARY_LANGUAGE_LENGTH = 20;
export const MAX_GLOSSARY_IMPORT_BYTES = 128 * 1024;
const MAX_GLOSSARY_IMPORT_ROWS = 500;

export type GlossaryImportDuplicateMode = 'skip' | 'overwrite';

export interface GlossaryImportRow {
    line: number;
    input: {
        sourceText: string;
        targetLanguage: string;
        targetText: string;
        notes: string;
    };
}

export interface GlossaryImportRowError {
    line: number;
    error: string;
}

export function sanitizeGlossaryInput(body: Record<string, unknown>):
    | {
          ok: true;
          value: {
              id?: number;
              sourceText: string;
              targetLanguage: string;
              targetText: string;
              notes: string;
          };
      }
    | { ok: false; error: string } {
    const sourceText = String(body.sourceText ?? '').trim();
    const hasTargetLanguage = body.targetLanguage !== undefined && body.targetLanguage !== null;
    const targetLanguage = hasTargetLanguage ? String(body.targetLanguage).trim() : 'auto';
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

    if (!targetLanguage) {
        return { ok: false, error: 'Glossary target language is required' };
    }

    if (targetLanguage.length > MAX_GLOSSARY_LANGUAGE_LENGTH) {
        return {
            ok: false,
            error: `Glossary target language must be ${MAX_GLOSSARY_LANGUAGE_LENGTH} characters or fewer`,
        };
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
            targetLanguage,
            targetText,
            notes,
        },
    };
}

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

    if (new TextEncoder().encode(text).byteLength > MAX_GLOSSARY_IMPORT_BYTES) {
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
    const first = String(fields[0] ?? '')
        .trim()
        .toLowerCase();
    const second = String(fields[1] ?? '')
        .trim()
        .toLowerCase();
    const third = String(fields[2] ?? '')
        .trim()
        .toLowerCase();

    return (
        (first === 'sourcetext' || first === 'source') &&
        (second === 'targettext' ||
            second === 'target' ||
            (second === 'targetlanguage' && (third === 'targettext' || third === 'target')))
    );
}

function isFourColumnImportRow(fields: string[]): boolean {
    return fields.length >= 4;
}

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

        const fourColumn = isFourColumnImportRow(parsed.fields);
        const input = sanitizeGlossaryInput(
            fourColumn
                ? {
                      sourceText: parsed.fields[0] ?? '',
                      targetLanguage: parsed.fields[1] ?? '',
                      targetText: parsed.fields[2] ?? '',
                      notes: parsed.fields[3] ?? '',
                  }
                : {
                      sourceText: parsed.fields[0] ?? '',
                      targetText: parsed.fields[1] ?? '',
                      notes: parsed.fields[2] ?? '',
                  },
        );

        if (!input.ok) {
            errors.push({ line: line.line, error: input.error });
            continue;
        }

        rows.push({
            line: line.line,
            input: {
                sourceText: input.value.sourceText,
                targetLanguage: input.value.targetLanguage,
                targetText: input.value.targetText,
                notes: input.value.notes,
            },
        });
    }

    return errors.length > 0 ? { ok: true, rows, errors } : { ok: true, rows };
}
