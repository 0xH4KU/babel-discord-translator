import type { VisionTextResult } from '../../infra/cloud-vision-client.js';
import type { LensRegion } from '../../shared/types.js';

const REGION_MARKER_PATTERN = /\[\[BABEL_REGION_(\d+)\]\]/gu;

function regionMarker(index: number): string {
    return `[[BABEL_REGION_${index}]]`;
}

export function formatDetectedText(detected: VisionTextResult): string {
    if (detected.regions.length === 0) return detected.text;
    return detected.regions
        .map((region, index) => `${regionMarker(index + 1)} ${region.text}`)
        .join('\n\n');
}

export function normalizeRegionTranslation(
    text: string,
    regionCount: number,
): { markersMatch: boolean; displayText: string } {
    if (regionCount === 0) return { markersMatch: true, displayText: text };

    const markers = [...text.matchAll(REGION_MARKER_PATTERN)].map((match) => Number(match[1]));
    const markersMatch =
        markers.length === regionCount && markers.every((marker, index) => marker === index + 1);
    const displayText = text
        .replace(REGION_MARKER_PATTERN, (_match, marker: string) =>
            markersMatch ? `[${marker}]` : '',
        )
        .replace(/^[ \t]+/gmu, '')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();

    return { markersMatch, displayText };
}

export function extractRegionTranslations(text: string, boxes: LensRegion['box_2d'][]): LensRegion[] {
    const matches = [...text.matchAll(REGION_MARKER_PATTERN)];
    if (
        matches.length !== boxes.length ||
        !matches.every((match, index) => Number(match[1]) === index + 1)
    ) {
        return [];
    }

    return matches.map((match, index) => ({
        translation: text
            .slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length)
            .trim(),
        box_2d: boxes[index]!,
    }));
}
