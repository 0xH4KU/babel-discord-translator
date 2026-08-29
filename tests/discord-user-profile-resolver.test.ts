import { describe, expect, it, vi } from 'vitest';
import type { User } from 'discord.js';
import {
    profileFromDiscordUser,
    resolveDiscordUserProfiles,
} from '../src/modules/dashboard/discord-user-profile-resolver.js';
import type { DiscordUserProfile } from '../src/shared/types.js';

const NOW = new Date('2026-06-13T00:00:00.000Z');

function discordUser(overrides: Partial<User> = {}): User {
    return {
        id: 'user-1',
        username: 'tester',
        globalName: 'Tester Global',
        displayAvatarURL: vi.fn(() => 'https://cdn.example/avatar.png'),
        ...overrides,
    } as unknown as User;
}

function storedProfile(userId: string, fetchedAt: string): DiscordUserProfile {
    return {
        userId,
        username: `name-${userId}`,
        globalName: null,
        displayName: `name-${userId}`,
        avatarUrl: '',
        fetchedAt,
        lastSeenAt: fetchedAt,
    };
}

function createRepository(cached: Record<string, DiscordUserProfile> = {}) {
    return {
        listProfiles: vi.fn(() => cached),
        upsertProfile: vi.fn(),
        recordSeen: vi.fn(),
    };
}

describe('profileFromDiscordUser', () => {
    it('should prefer the global name and fall back through username to id', () => {
        const profile = profileFromDiscordUser(discordUser(), NOW);
        expect(profile).toMatchObject({
            userId: 'user-1',
            username: 'tester',
            globalName: 'Tester Global',
            displayName: 'Tester Global',
            avatarUrl: 'https://cdn.example/avatar.png',
            fetchedAt: NOW.toISOString(),
        });

        const noGlobal = profileFromDiscordUser(discordUser({ globalName: null }), NOW);
        expect(noGlobal.displayName).toBe('tester');

        const bare = profileFromDiscordUser(
            discordUser({
                globalName: null,
                username: '',
                displayAvatarURL: vi.fn(() => ''),
            } as never),
            NOW,
        );
        expect(bare).toMatchObject({ username: 'user-1', displayName: 'user-1', avatarUrl: '' });
    });
});

describe('resolveDiscordUserProfiles', () => {
    it('should return early for an empty or blank id list', async () => {
        const repository = createRepository();
        const client = { users: { fetch: vi.fn() } };

        const profiles = await resolveDiscordUserProfiles({
            client: client as never,
            repository: repository as never,
            userIds: ['  ', ''],
        });

        expect(profiles).toEqual({});
        expect(repository.listProfiles).not.toHaveBeenCalled();
    });

    it('should serve fresh cached profiles without fetching', async () => {
        const fresh = storedProfile('user-1', NOW.toISOString());
        const repository = createRepository({ 'user-1': fresh });
        const client = { users: { fetch: vi.fn() } };

        const profiles = await resolveDiscordUserProfiles({
            client: client as never,
            repository: repository as never,
            userIds: ['user-1', 'user-1'],
            now: NOW,
        });

        expect(profiles).toEqual({ 'user-1': fresh });
        expect(client.users.fetch).not.toHaveBeenCalled();
    });

    it('should refetch stale or invalid cache entries and upsert the result', async () => {
        const staleDate = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
        const repository = createRepository({
            'user-1': storedProfile('user-1', staleDate),
            'user-2': storedProfile('user-2', 'not-a-date'),
        });
        const client = {
            users: {
                fetch: vi.fn((userId: string) => Promise.resolve(discordUser({ id: userId }))),
            },
        };

        const profiles = await resolveDiscordUserProfiles({
            client: client as never,
            repository: repository as never,
            userIds: ['user-1', 'user-2'],
            now: NOW,
        });

        expect(client.users.fetch).toHaveBeenCalledTimes(2);
        expect(repository.upsertProfile).toHaveBeenCalledTimes(2);
        expect(profiles['user-1']!.fetchedAt).toBe(NOW.toISOString());
        expect(profiles['user-2']!.displayName).toBe('Tester Global');
    });

    it('should start stale profile fetches in parallel', async () => {
        let resolveFirst!: (user: User) => void;
        const first = new Promise<User>((resolve) => {
            resolveFirst = resolve;
        });
        const repository = createRepository();
        const client = {
            users: {
                fetch: vi
                    .fn()
                    .mockReturnValueOnce(first)
                    .mockResolvedValueOnce(discordUser({ id: 'user-2' })),
            },
        };

        const pending = resolveDiscordUserProfiles({
            client: client as never,
            repository: repository as never,
            userIds: ['user-1', 'user-2'],
            now: NOW,
        });
        await Promise.resolve();

        expect(client.users.fetch).toHaveBeenCalledTimes(2);
        resolveFirst(discordUser({ id: 'user-1' }));
        await expect(pending).resolves.toMatchObject({
            'user-1': { userId: 'user-1' },
            'user-2': { userId: 'user-2' },
        });
    });

    it('should keep going when a Discord fetch fails and fall back to the stale entry', async () => {
        const staleDate = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
        const stale = storedProfile('user-1', staleDate);
        const repository = createRepository({ 'user-1': stale });
        const client = {
            users: {
                fetch: vi
                    .fn()
                    .mockRejectedValueOnce(new Error('Unknown User'))
                    .mockResolvedValueOnce(discordUser({ id: 'user-2' })),
            },
        };

        const profiles = await resolveDiscordUserProfiles({
            client: client as never,
            repository: repository as never,
            userIds: ['user-1', 'user-2'],
            now: NOW,
        });

        expect(profiles['user-1']).toEqual(stale);
        expect(profiles['user-2']!.userId).toBe('user-2');
        expect(repository.upsertProfile).toHaveBeenCalledTimes(1);
    });
});
