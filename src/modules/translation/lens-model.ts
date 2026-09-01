import type { ImageTranslationResult, LensRegion } from '../../shared/types.js';

const MAX_REGIONS = 99;

function unwrapJson(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    return fenced?.[1] ?? trimmed;
}

function normalizeRegion(value: unknown): LensRegion | null {
    const region = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    const box2d = Array.isArray(value) ? value : region?.box_2d;
    if (!Array.isArray(box2d) || box2d.length !== 4) return null;

    const box = box2d.map(Number);
    if (
        box.some((coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1000)
    ) {
        return null;
    }
    const normalized = box.map(Math.round) as [number, number, number, number];
    if (normalized[0] >= normalized[2] || normalized[1] >= normalized[3]) return null;
    return {
        translation: typeof region?.translation === 'string' ? region.translation.trim() : '',
        box_2d: normalized,
    };
}

export function parseImageTranslationResponse(
    raw: string,
    inputTokens: number,
    outputTokens: number,
): ImageTranslationResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(unwrapJson(raw));
    } catch {
        throw new Error('Invalid Babel Lens JSON response');
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid Babel Lens response structure');
    }

    const value = parsed as Record<string, unknown>;
    if (typeof value.has_text !== 'boolean') {
        throw new Error('Invalid Babel Lens response: has_text is required');
    }
    if (!value.has_text) {
        return { text: '', hasText: false, regions: [], inputTokens, outputTokens };
    }

    const translation = typeof value.translation === 'string' ? value.translation.trim() : '';
    if (!translation) {
        throw new Error('Invalid Babel Lens response: translation is required');
    }

    const rawRegions = value.regions;
    const regions = Array.isArray(rawRegions) ? rawRegions.map(normalizeRegion) : [];
    const regionsValid =
        Array.isArray(rawRegions) &&
        rawRegions.length > 0 &&
        rawRegions.length <= MAX_REGIONS &&
        regions.every((region): region is LensRegion => region !== null);

    return {
        text: translation,
        hasText: true,
        regions: regionsValid ? regions : [],
        inputTokens,
        outputTokens,
        ...(!regionsValid ? { warnings: ['invalid_regions'] } : {}),
    };
}

export const _test = { normalizeRegion, unwrapJson, MAX_REGIONS };
