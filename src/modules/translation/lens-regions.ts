import type { VisionTextResult } from '../../infra/cloud-vision-client.js';

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
