import type { DatabaseSync } from 'node:sqlite';
import { getSqliteDatabase } from '../../persistence/sqlite-database.js';
import type { DiscordUserProfile } from '../../types.js';

interface DiscordUserProfileRepositoryOptions {
    db?: DatabaseSync;
}

interface DiscordUserProfileRow {
    userId: string;
    username: string;
    globalName: string | null;
    displayName: string;
    avatarUrl: string;
    fetchedAt: string;
    lastSeenAt: string | null;
}

export class DiscordUserProfileRepository {
    private readonly db: DatabaseSync;

    constructor({ db = getSqliteDatabase() }: DiscordUserProfileRepositoryOptions = {}) {
        this.db = db;
    }

    listProfiles(userIds: string[]): Record<string, DiscordUserProfile> {
        const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
        if (ids.length === 0) {
            return {};
        }

        const placeholders = ids.map(() => '?').join(', ');
        const rows = this.db
            .prepare(
                `
                SELECT
                    user_id as userId,
                    username,
                    global_name as globalName,
                    display_name as displayName,
                    avatar_url as avatarUrl,
                    fetched_at as fetchedAt,
                    last_seen_at as lastSeenAt
                FROM discord_user_profiles
                WHERE user_id IN (${placeholders})
            `,
            )
            .all(...ids) as unknown as DiscordUserProfileRow[];

        return Object.fromEntries(rows.map((row) => [row.userId, row]));
    }

    upsertProfile(profile: DiscordUserProfile): void {
        this.db
            .prepare(
                `
                INSERT INTO discord_user_profiles (
                    user_id,
                    username,
                    global_name,
                    display_name,
                    avatar_url,
                    fetched_at,
                    last_seen_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    username = excluded.username,
                    global_name = excluded.global_name,
                    display_name = excluded.display_name,
                    avatar_url = excluded.avatar_url,
                    fetched_at = excluded.fetched_at,
                    last_seen_at = excluded.last_seen_at
            `,
            )
            .run(
                profile.userId,
                profile.username,
                profile.globalName,
                profile.displayName,
                profile.avatarUrl,
                profile.fetchedAt,
                profile.lastSeenAt,
            );
    }

    upsertProfiles(profiles: DiscordUserProfile[]): void {
        for (const profile of profiles) {
            this.upsertProfile(profile);
        }
    }
}
