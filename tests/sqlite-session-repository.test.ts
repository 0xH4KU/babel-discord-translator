import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase } from '../src/persistence/sqlite-database.js';
import { SQLiteSessionRepository } from '../src/auth/sqlite-session-repository.js';

describe('SQLiteSessionRepository', () => {
    let tempDir: string;
    let dbPath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'babel-sessions-'));
        dbPath = join(tempDir, 'babel.sqlite');
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it('should persist sessions across repository instances', () => {
        const firstDb = createSqliteDatabase(dbPath);
        const firstRepository = new SQLiteSessionRepository({ db: firstDb });

        firstRepository.set('token-1', {
            expiry: 123456789,
            csrf: 'csrf-1',
        });
        firstDb.close();

        const secondDb = createSqliteDatabase(dbPath);
        const secondRepository = new SQLiteSessionRepository({ db: secondDb });

        expect(secondRepository.get('token-1')).toEqual({
            expiry: 123456789,
            csrf: 'csrf-1',
        });
        secondDb.close();
    });

    it('should enumerate and delete stored sessions', () => {
        const db = createSqliteDatabase(dbPath);
        const repository = new SQLiteSessionRepository({ db });

        repository.set('token-a', { expiry: 10, csrf: 'a' });
        repository.set('token-b', { expiry: 20, csrf: 'b' });

        expect(Array.from(repository.entries())).toEqual([
            ['token-a', { expiry: 10, csrf: 'a' }],
            ['token-b', { expiry: 20, csrf: 'b' }],
        ]);

        repository.delete('token-a');
        expect(repository.get('token-a')).toBeNull();

        repository.clear();
        expect(Array.from(repository.entries())).toEqual([]);
        db.close();
    });
});
