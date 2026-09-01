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
    const markers = [...text.matchAll(REGION_MARKER_PATTERN)].map((match) => Number(match[1]));
    if (regionCount === 0 && markers.length === 0) {
        return { markersMatch: true, displayText: text };
    }
    const markersMatch =
        regionCount > 0 &&
        markers.length === regionCount &&
        markers.every((marker, index) => marker === index + 1);
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

    const regions = matches.map((match, index) => ({
        translation: text
            .slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length)
            .trim(),
        box_2d: boxes[index]!,
    }));
    return regions.every((region) => region.translation) ? regions : [];
}

export function visionRegionsToBoxes(detected: VisionTextResult): LensRegion['box_2d'][] {
    if (detected.imageWidth <= 0 || detected.imageHeight <= 0) return [];
    return detected.regions.slice(0, 99).map((region) => {
        const ymin = Math.max(0, Math.min(999, Math.round((region.y / detected.imageHeight) * 1000)));
        const xmin = Math.max(0, Math.min(999, Math.round((region.x / detected.imageWidth) * 1000)));
        const ymax = Math.min(
            1000,
            Math.max(
                ymin + 1,
                Math.round(((region.y + region.height) / detected.imageHeight) * 1000),
            ),
        );
        const xmax = Math.min(
            1000,
            Math.max(
                xmin + 1,
                Math.round(((region.x + region.width) / detected.imageWidth) * 1000),
            ),
        );
        return [ymin, xmin, ymax, xmax];
    });
}
