import type { DatabaseSync } from 'node:sqlite';
import type { SessionData } from '../../../types.js';
import { getSqliteDatabase } from '../../../persistence/sqlite-database.js';
import type { SessionRepository } from './session-repository.js';

interface SqliteSessionRepositoryOptions {
    db?: DatabaseSync;
}

export class SQLiteSessionRepository implements SessionRepository {
    private readonly db: DatabaseSync;

    constructor({ db = getSqliteDatabase() }: SqliteSessionRepositoryOptions = {}) {
        this.db = db;
    }

    get(token: string): SessionData | null {
        const row = this.db.prepare(`
            SELECT expiry, csrf
            FROM sessions
            WHERE token = ?
        `).get(token) as { expiry: number; csrf: string } | undefined;

        if (!row) {
            return null;
        }

        return {
            expiry: row.expiry,
            csrf: row.csrf,
        };
    }

    set(token: string, session: SessionData): void {
        this.db.prepare(`
            INSERT INTO sessions (token, expiry, csrf)
            VALUES (?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET
                expiry = excluded.expiry,
                csrf = excluded.csrf
        `).run(token, session.expiry, session.csrf);
    }

    delete(token: string): void {
        this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }

    entries(): Iterable<[string, SessionData]> {
        const rows = this.db.prepare(`
            SELECT token, expiry, csrf
            FROM sessions
            ORDER BY expiry ASC, token ASC
        `).all() as Array<{ token: string; expiry: number; csrf: string }>;

        return rows.map((row) => [
            row.token,
            {
                expiry: row.expiry,
                csrf: row.csrf,
            },
        ]);
    }

    clear(): void {
        this.db.exec('DELETE FROM sessions');
    }
}
