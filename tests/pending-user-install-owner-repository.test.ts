import { afterEach, describe, expect, it } from 'vitest';

describe('PendingUserInstallOwnerRepository', () => {
    afterEach(async () => {
        const { closeSqliteDatabase } = await import('../src/persistence/sqlite-database.js');
        closeSqliteDatabase();
    });

    it('records first and last seen timestamps for unauthorized user-install owners', async () => {
        const { PendingUserInstallOwnerRepository } =
            await import('../src/modules/dashboard/pending-user-install-owner-repository.js');
        const repository = new PendingUserInstallOwnerRepository();

        repository.recordSeen('user-1');
        repository.recordSeen('user-1');

        const owners = repository.list();
        expect(owners).toHaveLength(1);
        expect(owners[0]).toMatchObject({
            userId: 'user-1',
            source: 'user-install',
        });
        expect(Date.parse(owners[0]?.firstSeenAt ?? '')).not.toBeNaN();
        expect(Date.parse(owners[0]?.lastSeenAt ?? '')).not.toBeNaN();
    });
});
