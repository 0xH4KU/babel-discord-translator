import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase } from '../src/persistence/sqlite-database.js';
import { DiscordUserProfileRepository } from '../src/modules/dashboard/discord-user-profile-repository.js';

describe('DiscordUserProfileRepository', () => {
    let db: DatabaseSync | undefined;

    afterEach(() => {
        if (db?.isOpen) {
            db.close();
        }
    });

    it('should upsert and list Discord user profiles by id', () => {
        db = createSqliteDatabase(':memory:');
        const repository = new DiscordUserProfileRepository(db);

        repository.upsertProfile({
            userId: '123',
            username: 'haku',
            globalName: 'Haku',
            displayName: 'Haku',
            avatarUrl: 'https://cdn.discordapp.com/avatars/123/avatar.png',
            fetchedAt: '2026-06-02T10:00:00.000Z',
            lastSeenAt: '2026-06-02T10:01:00.000Z',
        });

        repository.upsertProfile({
            userId: '456',
            username: 'babel-user',
            globalName: null,
            displayName: 'babel-user',
            avatarUrl: '',
            fetchedAt: '2026-06-02T10:02:00.000Z',
            lastSeenAt: null,
        });

        const profiles = repository.listProfiles(['123', 'missing', '456']);

        expect(profiles).toEqual({
            '123': {
                userId: '123',
                username: 'haku',
                globalName: 'Haku',
                displayName: 'Haku',
                avatarUrl: 'https://cdn.discordapp.com/avatars/123/avatar.png',
                fetchedAt: '2026-06-02T10:00:00.000Z',
                lastSeenAt: '2026-06-02T10:01:00.000Z',
            },
            '456': {
                userId: '456',
                username: 'babel-user',
                globalName: null,
                displayName: 'babel-user',
                avatarUrl: '',
                fetchedAt: '2026-06-02T10:02:00.000Z',
                lastSeenAt: null,
            },
        });
    });

    it('should update an existing profile', () => {
        db = createSqliteDatabase(':memory:');
        const repository = new DiscordUserProfileRepository(db);

        repository.upsertProfile({
            userId: '123',
            username: 'old-name',
            globalName: null,
            displayName: 'old-name',
            avatarUrl: '',
            fetchedAt: '2026-06-02T10:00:00.000Z',
            lastSeenAt: null,
        });

        repository.upsertProfile({
            userId: '123',
            username: 'new-name',
            globalName: 'New Name',
            displayName: 'New Name',
            avatarUrl: 'https://cdn.discordapp.com/avatars/123/new.png',
            fetchedAt: '2026-06-02T11:00:00.000Z',
            lastSeenAt: '2026-06-02T11:01:00.000Z',
        });

        expect(repository.listProfiles(['123'])['123']).toEqual({
            userId: '123',
            username: 'new-name',
            globalName: 'New Name',
            displayName: 'New Name',
            avatarUrl: 'https://cdn.discordapp.com/avatars/123/new.png',
            fetchedAt: '2026-06-02T11:00:00.000Z',
            lastSeenAt: '2026-06-02T11:01:00.000Z',
        });
    });
});
