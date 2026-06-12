import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    APP_VERSION,
    getVersionMetadataWithUpdate,
    getVersionUpdateStatus,
    _test,
} from '../src/shared/version.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
}

describe('version metadata', () => {
    it('keeps root, workspace, and runtime app versions synchronized', () => {
        const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as {
            version: string;
        };
        const guildPackage = JSON.parse(readFileSync('apps/babel-guild/package.json', 'utf8')) as {
            version: string;
        };
        const pocketPackage = JSON.parse(
            readFileSync('apps/babel-pocket/package.json', 'utf8'),
        ) as { version: string };
        const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
            version: string;
            packages: Record<string, { version?: string }>;
        };

        expect(APP_VERSION).toBe('0.1.3');
        expect(rootPackage.version).toBe(APP_VERSION);
        expect(guildPackage.version).toBe(APP_VERSION);
        expect(pocketPackage.version).toBe(APP_VERSION);
        expect(lockfile.version).toBe(APP_VERSION);
        expect(lockfile.packages[''].version).toBe(APP_VERSION);
        expect(lockfile.packages['apps/babel-guild'].version).toBe(APP_VERSION);
        expect(lockfile.packages['apps/babel-pocket'].version).toBe(APP_VERSION);
    });

    it('should report outdated when the latest release tag is newer', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                tag_name: 'v0.1.3',
                html_url: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.3',
            }),
        );

        const update = await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
            cacheTtlMs: 0,
        });

        expect(update).toEqual({
            status: 'outdated',
            latestVersion: '0.1.3',
            latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.3',
        });
        expect(fetchImpl).toHaveBeenCalledWith('https://example.test/releases/latest', {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'babel-discord-translator',
            },
        });
    });

    it('should report current when the latest release matches the app version', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                tag_name: 'v0.1.2',
                html_url: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.2',
            }),
        );

        const metadata = await getVersionMetadataWithUpdate({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
            cacheTtlMs: 0,
        });

        expect(metadata).toEqual({
            version: '0.1.2',
            repositoryUrl: 'https://github.com/0xH4KU/babel-discord-translator',
            update: {
                status: 'current',
                latestVersion: '0.1.2',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.2',
            },
        });
    });

    it('should refresh the latest release lookup when forced before the cache TTL expires', async () => {
        _test.resetVersionUpdateCache();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));

        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse({
                    tag_name: 'v0.1.2',
                    html_url:
                        'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.2',
                }),
            )
            .mockResolvedValueOnce(
                jsonResponse({
                    tag_name: 'v0.1.3',
                    html_url:
                        'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.3',
                }),
            );

        try {
            const first = await getVersionUpdateStatus({
                currentVersion: '0.1.2',
                fetchImpl,
                latestReleaseUrl: 'https://example.test/releases/latest',
            });

            const second = await getVersionUpdateStatus({
                currentVersion: '0.1.2',
                fetchImpl,
                latestReleaseUrl: 'https://example.test/releases/latest',
                forceRefresh: true,
            });

            expect(first).toEqual({
                status: 'current',
                latestVersion: '0.1.2',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.2',
            });
            expect(second).toEqual({
                status: 'outdated',
                latestVersion: '0.1.3',
                latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.3',
            });
            expect(fetchImpl).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should serve cached results within the TTL for the same version', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                tag_name: 'v0.1.3',
                html_url: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.3',
            }),
        );

        const first = await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
        });
        const second = await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
        });

        expect(second).toEqual(first);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('should bypass the cache when checking a different current version', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () =>
            jsonResponse({
                tag_name: 'v0.1.3',
                html_url: 'https://github.com/0xH4KU/babel-discord-translator/releases/tag/v0.1.3',
            }),
        );

        await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
        });
        const other = await getVersionUpdateStatus({
            currentVersion: '0.1.3',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
        });

        expect(other.status).toBe('current');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('should return unknown when the release response lacks a tag name', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () => jsonResponse({ html_url: 'https://example.test' }));

        const update = await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
            cacheTtlMs: 0,
        });

        expect(update).toEqual({ status: 'unknown' });
    });

    it('should fall back to the releases page when html_url is missing', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () => jsonResponse({ tag_name: 'v0.2' }));

        const update = await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
            cacheTtlMs: 0,
        });

        expect(update).toEqual({
            status: 'outdated',
            latestVersion: '0.2',
            latestUrl: 'https://github.com/0xH4KU/babel-discord-translator/releases/latest',
        });
    });

    it('should return unknown when release lookup fails', async () => {
        _test.resetVersionUpdateCache();
        const fetchImpl = vi.fn(async () =>
            jsonResponse({ message: 'rate limited' }, { status: 403 }),
        );

        const update = await getVersionUpdateStatus({
            currentVersion: '0.1.2',
            fetchImpl,
            latestReleaseUrl: 'https://example.test/releases/latest',
            cacheTtlMs: 0,
        });

        expect(update).toEqual({ status: 'unknown' });
    });
});
