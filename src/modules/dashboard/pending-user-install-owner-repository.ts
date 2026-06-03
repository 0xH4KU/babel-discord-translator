import { getSqliteDatabase } from '../../persistence/sqlite-database.js';

export interface PendingUserInstallOwner {
    userId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    source: 'user-install';
}

export class PendingUserInstallOwnerRepository {
    recordSeen(userId: string): void {
        const now = new Date().toISOString();

        getSqliteDatabase()
            .prepare(
                `
                INSERT INTO pending_user_install_owners (
                    user_id,
                    first_seen_at,
                    last_seen_at,
                    source
                )
                VALUES (?, ?, ?, 'user-install')
                ON CONFLICT(user_id) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at
            `,
            )
            .run(userId, now, now);
    }

    list(): PendingUserInstallOwner[] {
        const rows = getSqliteDatabase()
            .prepare(
                `
                SELECT
                    user_id AS userId,
                    first_seen_at AS firstSeenAt,
                    last_seen_at AS lastSeenAt,
                    source
                FROM pending_user_install_owners
                ORDER BY last_seen_at DESC
            `,
            )
            .all() as unknown as PendingUserInstallOwner[];

        return rows.map((row) => ({
            ...row,
            source: 'user-install',
        }));
    }

    clear(userId: string): boolean {
        const result = getSqliteDatabase()
            .prepare('DELETE FROM pending_user_install_owners WHERE user_id = ?')
            .run(userId);

        return result.changes > 0;
    }
}
