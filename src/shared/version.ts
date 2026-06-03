export const APP_VERSION = '0.1.3';

export const REPOSITORY_URL = 'https://github.com/0xH4KU/babel-discord-translator';

const LATEST_RELEASE_URL =
    'https://api.github.com/repos/0xH4KU/babel-discord-translator/releases/latest';
const VERSION_UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;

export type VersionUpdateStatus =
    | {
          status: 'current' | 'outdated';
          latestVersion: string;
          latestUrl: string;
      }
    | {
          status: 'unknown';
      };

export interface VersionMetadata {
    version: string;
    repositoryUrl: string;
}

export interface VersionMetadataWithUpdate extends VersionMetadata {
    update: VersionUpdateStatus;
}

interface LatestReleaseResponse {
    tag_name?: unknown;
    html_url?: unknown;
}

interface VersionUpdateOptions {
    currentVersion?: string;
    latestReleaseUrl?: string;
    cacheTtlMs?: number;
    fetchImpl?: typeof fetch;
    forceRefresh?: boolean;
}

let versionUpdateCache: {
    checkedAt: number;
    currentVersion: string;
    update: VersionUpdateStatus;
} | null = null;

function normalizeVersion(version: string): string {
    return version.trim().replace(/^v/i, '');
}

function compareSemver(left: string, right: string): number {
    const leftParts = normalizeVersion(left).split('.').map(Number);
    const rightParts = normalizeVersion(right).split('.').map(Number);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index]! : 0;
        const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index]! : 0;

        if (leftPart > rightPart) return 1;
        if (leftPart < rightPart) return -1;
    }

    return 0;
}

export function getVersionMetadata(): VersionMetadata {
    return {
        version: APP_VERSION,
        repositoryUrl: REPOSITORY_URL,
    };
}

export async function getVersionUpdateStatus({
    currentVersion = APP_VERSION,
    latestReleaseUrl = LATEST_RELEASE_URL,
    cacheTtlMs = VERSION_UPDATE_CACHE_TTL_MS,
    fetchImpl = fetch,
    forceRefresh = false,
}: VersionUpdateOptions = {}): Promise<VersionUpdateStatus> {
    const now = Date.now();
    if (
        !forceRefresh &&
        versionUpdateCache &&
        versionUpdateCache.currentVersion === currentVersion &&
        now - versionUpdateCache.checkedAt < cacheTtlMs
    ) {
        return versionUpdateCache.update;
    }

    try {
        const response = await fetchImpl(latestReleaseUrl, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'babel-discord-translator',
            },
        });

        if (!response.ok) {
            throw new Error(`GitHub release lookup failed with ${response.status}`);
        }

        const latest = (await response.json()) as LatestReleaseResponse;
        const latestVersion =
            typeof latest.tag_name === 'string' ? normalizeVersion(latest.tag_name) : '';
        const latestUrl =
            typeof latest.html_url === 'string'
                ? latest.html_url
                : `${REPOSITORY_URL}/releases/latest`;

        if (!latestVersion) {
            throw new Error('Latest release response did not include tag_name');
        }

        const update: VersionUpdateStatus = {
            status: compareSemver(currentVersion, latestVersion) < 0 ? 'outdated' : 'current',
            latestVersion,
            latestUrl,
        };

        versionUpdateCache = {
            checkedAt: now,
            currentVersion,
            update,
        };

        return update;
    } catch {
        return { status: 'unknown' };
    }
}

export async function getVersionMetadataWithUpdate(
    options: VersionUpdateOptions = {},
): Promise<VersionMetadataWithUpdate> {
    const currentVersion = options.currentVersion ?? APP_VERSION;

    return {
        version: currentVersion,
        repositoryUrl: REPOSITORY_URL,
        update: await getVersionUpdateStatus({ ...options, currentVersion }),
    };
}

export const _test = {
    resetVersionUpdateCache(): void {
        versionUpdateCache = null;
    },
};
