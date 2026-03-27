import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveDatabasePath', () => {
    afterEach(async () => {
        delete process.env.BABEL_DB_PATH;
        delete process.env.NODE_ENV;
        vi.resetModules();

        const { closeSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        closeSqliteDatabase();
    });

    it('should prefer the explicit BABEL_DB_PATH override', async () => {
        process.env.BABEL_DB_PATH = '/tmp/custom-babel.sqlite';

        const { resolveDatabasePath } = await import('../src/persistence/sqlite-database.js');

        expect(resolveDatabasePath()).toBe('/tmp/custom-babel.sqlite');
    });

    it('should use an in-memory database during tests when no override is set', async () => {
        process.env.NODE_ENV = 'test';

        const { resolveDatabasePath } = await import('../src/persistence/sqlite-database.js');

        expect(resolveDatabasePath()).toBe(':memory:');
    });

    it('should resolve the production default relative to the current working directory', async () => {
        process.env.NODE_ENV = 'production';

        const { resolveDatabasePath } = await import('../src/persistence/sqlite-database.js');

        expect(resolveDatabasePath()).toBe('/Users/HAKU/github/discord-translator/data/babel.sqlite');
    });
});
