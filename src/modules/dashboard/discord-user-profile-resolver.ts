import type { Client, User } from 'discord.js';
import { appLogger } from '../../shared/structured-logger.js';
import type { DiscordUserProfile } from '../../types.js';
import type { DiscordUserProfileRepository } from './discord-user-profile-repository.js';

const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeUserIds(userIds: string[]): string[] {
    return [...new Set(userIds.map((userId) => String(userId).trim()).filter(Boolean))];
}

function isFresh(profile: DiscordUserProfile, nowMs: number): boolean {
    const fetchedAtMs = Date.parse(profile.fetchedAt);
    return Number.isFinite(fetchedAtMs) && nowMs - fetchedAtMs < PROFILE_CACHE_TTL_MS;
}

export function profileFromDiscordUser(user: User, now = new Date()): DiscordUserProfile {
    const globalName = user.globalName ?? null;
    const username = user.username || user.id;
    const displayName = globalName || username || user.id;
    const avatarUrl = user.displayAvatarURL({ size: 64 }) || '';

    return {
        userId: user.id,
        username,
        globalName,
        displayName,
        avatarUrl,
        fetchedAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
    };
}

export async function resolveDiscordUserProfiles({
    client,
    repository,
    userIds,
    now = new Date(),
}: {
    client: Client;
    repository: DiscordUserProfileRepository;
    userIds: string[];
    now?: Date;
}): Promise<Record<string, DiscordUserProfile>> {
    const ids = normalizeUserIds(userIds);
    if (ids.length === 0) {
        return {};
    }

    const cached = repository.listProfiles(ids);
    const nowMs = now.getTime();
    const profiles = { ...cached };
    const missingOrStale = ids.filter(
        (userId) => !cached[userId] || !isFresh(cached[userId], nowMs),
    );

    for (const userId of missingOrStale) {
        try {
            const user = await client.users.fetch(userId);
            const profile = profileFromDiscordUser(user, now);
            repository.upsertProfile(profile);
            profiles[userId] = profile;
        } catch (error) {
            appLogger.warn('dashboard.discord_user_profile.fetch_failed', {
                component: 'dashboard',
                userId,
                error,
            });
        }
    }

    return profiles;
}
