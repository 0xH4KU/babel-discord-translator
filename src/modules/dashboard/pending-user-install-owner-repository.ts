import type { DatabaseSync } from 'node:sqlite';
import { getSqliteDatabase } from '../../persistence/sqlite-database.js';

export interface PendingUserInstallOwner {
    userId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    source: 'user-install';
}

interface PendingUserInstallOwnerRepositoryOptions {
    db?: DatabaseSync;
}

export class PendingUserInstallOwnerRepository {
    private readonly db: DatabaseSync;

    constructor({ db = getSqliteDatabase() }: PendingUserInstallOwnerRepositoryOptions = {}) {
        this.db = db;
    }

    recordSeen(userId: string): void {
        const now = new Date().toISOString();

        this.db
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
        const rows = this.db
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

    listUserIds(): string[] {
        return this.list().map((owner) => owner.userId);
    }
}
