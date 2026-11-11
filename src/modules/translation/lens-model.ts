import { ProviderResponseError } from '../../infra/provider-errors.js';
import type { ImageTranslationResult, LensRegion, OcrTextUnit } from '../../shared/types.js';

const MAX_REGIONS = 99;

function unwrapJson(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    return fenced?.[1] ?? trimmed;
}

export function comparableText(value: string): string {
    return value.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

export function isUsefulImageText(value: string): boolean {
    const text = value.replace(/\s+/gu, ' ').trim();
    if (!text || !/\p{L}/u.test(text)) return false;
    if (/^(?:https?:\/\/|www\.|@[A-Za-z0-9_.-]+$)/iu.test(text)) return false;
    if (
        /^(?:4G|5G|LTE|[+-]?\d+(?:[.,:]\d+)*\s*(?:[KMBkmb]|%|fps|p|px|dB|ms|s|m|h|d|w|mo|yr|AM|PM))$/iu.test(
            text,
        )
    ) {
        return false;
    }
    return true;
}

export function isUsefulImageRegion(region: LensRegion): boolean {
    const [ymin, xmin, ymax, xmax] = region.box_2d;
    if (ymax - ymin < 8 || xmax - xmin < 8) return false;
    return isUsefulImageText(region.translation);
}

export function mergeDenseImageRegions(regions: LensRegion[]): LensRegion[] {
    if (regions.length <= 1) return regions;
    const items = regions.map((region) => ({
        box_2d: [...region.box_2d] as [number, number, number, number],
        translation: region.translation.trim(),
        ...(region.source ? { source: region.source } : {}),
    }));
    const merged: LensRegion[] = [];
    const consumed = new Array<boolean>(items.length).fill(false);

    for (let i = 0; i < items.length; i += 1) {
        if (consumed[i]) continue;
        const current: LensRegion = { ...items[i]!, box_2d: [...items[i]!.box_2d] };
        consumed[i] = true;

        let changed = true;
        while (changed) {
            changed = false;
            for (let j = i + 1; j < items.length; j += 1) {
                if (consumed[j]) continue;
                const candidate = items[j]!;
                const [curYmin, curXmin, curYmax, curXmax] = current.box_2d;
                const [nextYmin, nextXmin, nextYmax, nextXmax] = candidate.box_2d;
                const curWidth = Math.max(1, curXmax - curXmin);
                const curHeight = Math.max(1, curYmax - curYmin);
                const nextWidth = Math.max(1, nextXmax - nextXmin);
                const nextHeight = Math.max(1, nextYmax - nextYmin);

                const vGap = nextYmin - curYmax;
                const maxAllowedGap = Math.min(18, Math.min(curHeight, nextHeight) * 0.45);
                if (vGap < -8 || vGap > maxAllowedGap) continue;
                if (nextHeight > 70 || curHeight > 220) continue;

                const overlapX = Math.min(curXmax, nextXmax) - Math.max(curXmin, nextXmin);
                const maxWidth = Math.max(curWidth, nextWidth);
                const leftDiff = Math.abs(curXmin - nextXmin);
                if (leftDiff > 20 || overlapX / maxWidth < 0.75) continue;

                const newYmin = Math.min(curYmin, nextYmin);
                const newYmax = Math.max(curYmax, nextYmax);
                if (newYmax - newYmin > 260) continue;

                current.box_2d = [
                    newYmin,
                    Math.min(curXmin, nextXmin),
                    newYmax,
                    Math.max(curXmax, nextXmax),
                ];
                current.translation = [current.translation, candidate.translation]
                    .filter(Boolean)
                    .join('\n');
                if (current.source || candidate.source) {
                    current.source = [current.source, candidate.source].filter(Boolean).join('\n');
                }
                consumed[j] = true;
                changed = true;
            }
        }
        merged.push(current);
    }
    return merged;
}

function normalizeRegion(value: unknown): LensRegion | null {
    const region =
        value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    const box2d = region?.box_2d;
    if (!Array.isArray(box2d) || box2d.length !== 4) return null;

    const box = box2d.map(Number);
    if (
        box.some(
            (coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1000,
        )
    ) {
        return null;
    }
    const normalized = box.map(Math.round) as [number, number, number, number];
    if (normalized[0] >= normalized[2] || normalized[1] >= normalized[3]) return null;
    const translation = typeof region?.translation === 'string' ? region.translation.trim() : '';
    if (!translation) return null;

    return {
        translation,
        box_2d: normalized,
    };
}

function readImageRegions(raw: string, inputTokens: number, outputTokens: number): unknown[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(unwrapJson(raw));
    } catch {
        throw new ProviderResponseError(
            'Invalid Babel Lens JSON response',
            inputTokens,
            outputTokens,
        );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ProviderResponseError(
            'Invalid Babel Lens response structure',
            inputTokens,
            outputTokens,
        );
    }

    const value = parsed as Record<string, unknown>;
    if (typeof value.has_text !== 'boolean') {
        throw new ProviderResponseError(
            'Invalid Babel Lens response: has_text is required',
            inputTokens,
            outputTokens,
        );
    }
    if (!value.has_text) return null;

    const rawRegions = value.regions;
    if (!Array.isArray(rawRegions) || rawRegions.length === 0 || rawRegions.length > MAX_REGIONS) {
        throw new ProviderResponseError(
            'Invalid Babel Lens response: regions array is required',
            inputTokens,
            outputTokens,
        );
    }
    return rawRegions;
}

function formatNumberedRegions(regions: LensRegion[]): string {
    return regions.map((region, index) => `[${index + 1}] ${region.translation}`).join('\n\n');
}

export function parseImageTranslationResponse(
    raw: string,
    inputTokens: number,
    outputTokens: number,
): ImageTranslationResult {
    const rawRegions = readImageRegions(raw, inputTokens, outputTokens);
    if (!rawRegions) {
        return { text: '', hasText: false, regions: [], inputTokens, outputTokens };
    }

    const normalized = rawRegions.map(normalizeRegion);
    if (normalized.some((region) => region === null)) {
        throw new ProviderResponseError(
            'Invalid Babel Lens region coordinates or translation',
            inputTokens,
            outputTokens,
        );
    }

    const useful = (normalized as LensRegion[]).filter(isUsefulImageRegion);
    if (useful.length === 0) {
        return { text: '', hasText: false, regions: [], inputTokens, outputTokens };
    }

    const merged = mergeDenseImageRegions(useful);
    return {
        text: formatNumberedRegions(merged),
        hasText: true,
        regions: merged,
        inputTokens,
        outputTokens,
    };
}

export function parseOcrImageTranslationResponse(
    raw: string,
    units: OcrTextUnit[],
    inputTokens: number,
    outputTokens: number,
): ImageTranslationResult {
    const rawRegions = readImageRegions(raw, inputTokens, outputTokens);
    if (!rawRegions) {
        return { text: '', hasText: false, regions: [], inputTokens, outputTokens };
    }

    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const used = new Set<number>();
    const result: LensRegion[] = [];

    for (const item of rawRegions) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new ProviderResponseError(
                'Invalid Babel Lens OCR region structure',
                inputTokens,
                outputTokens,
            );
        }
        const record = item as Record<string, unknown>;
        if (!Array.isArray(record.ids) || typeof record.translation !== 'string') {
            throw new ProviderResponseError(
                'Invalid Babel Lens OCR region fields',
                inputTokens,
                outputTokens,
            );
        }
        const ids = record.ids.map(Number).filter((id) => byId.has(id) && !used.has(id));
        const translation = record.translation.trim();
        if (ids.length === 0 || !translation) continue;

        const matched = ids.map((id) => byId.get(id)!);
        const source = matched.map((unit) => unit.text).join('\n');
        // Identical output means the model echoed the source (names, logos, or already target language).
        if (comparableText(source) === comparableText(translation)) continue;

        const candidate: LensRegion = {
            box_2d: [
                Math.min(...matched.map((unit) => unit.box_2d[0])),
                Math.min(...matched.map((unit) => unit.box_2d[1])),
                Math.max(...matched.map((unit) => unit.box_2d[2])),
                Math.max(...matched.map((unit) => unit.box_2d[3])),
            ],
            source,
            translation,
        };
        ids.forEach((id) => used.add(id));
        if (!isUsefulImageRegion(candidate)) continue;
        result.push(candidate);
    }

    return {
        text: formatNumberedRegions(result),
        hasText: result.length > 0,
        regions: result,
        inputTokens,
        outputTokens,
    };
}

export const _test = {
    normalizeRegion,
    unwrapJson,
    MAX_REGIONS,
};
