import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    BABEL_GUILD_PROFILE,
    BABEL_POCKET_PROFILE,
    resolveAppProfile,
    resolveAppProfiles,
} from '../src/apps/app-profile.js';
import { getCommandsForProfile } from '../src/apps/commands.js';
import {
    registerCommandsForProfile,
    registerCommandsForProfiles,
    resolveRegistrationEnv,
} from '../src/apps/register.js';

describe('Discord command registration profiles', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('resolves the default root app profile from BABEL_APP-compatible values', () => {
        expect(resolveAppProfile()).toBe(BABEL_GUILD_PROFILE);
        expect(resolveAppProfile('guild')).toBe(BABEL_GUILD_PROFILE);
        expect(resolveAppProfile('babel-guild')).toBe(BABEL_GUILD_PROFILE);
        expect(resolveAppProfile('pocket')).toBe(BABEL_POCKET_PROFILE);
        expect(resolveAppProfile('babel-pocket')).toBe(BABEL_POCKET_PROFILE);
    });

    it('resolves combined runtime profiles without changing explicit single app entrypoints', () => {
        expect(resolveAppProfiles()).toEqual([BABEL_GUILD_PROFILE]);
        expect(resolveAppProfiles('guild')).toEqual([BABEL_GUILD_PROFILE]);
        expect(resolveAppProfiles('pocket')).toEqual([BABEL_POCKET_PROFILE]);
        expect(resolveAppProfiles('combined')).toEqual([BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE]);
        expect(resolveAppProfiles('both')).toEqual([BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE]);
    });

    it('registers Babel Guild server-install commands', () => {
        const commands = getCommandsForProfile(BABEL_GUILD_PROFILE);
        const names = commands.map((command) => command.name);

        expect(names).toEqual(['Babel', 'Babel Lens', 'setlang', 'translate', 'help', 'mylang']);
        expect(commands.find((command) => command.name === 'translate')).toMatchObject({
            type: 1,
            description: 'Translate text',
        });
        expect(commands.every((command) => command.integration_types === undefined)).toBe(true);
        expect(commands.every((command) => command.contexts === undefined)).toBe(true);
    });

    it('registers Babel Pocket user-install commands without public translate', () => {
        const commands = getCommandsForProfile(BABEL_POCKET_PROFILE);
        const names = commands.map((command) => command.name);

        expect(names).toEqual(['Babel Pocket', 'Babel Lens', 'setlang', 'help', 'mylang']);
        expect(names).not.toContain('translate');
        expect(commands.every((command) => command.integration_types?.includes(1))).toBe(true);
        expect(commands.every((command) => command.contexts)).toBe(true);
        expect(commands.find((command) => command.name === 'Babel Pocket')).toMatchObject({
            type: 3,
            integration_types: [1],
            contexts: [0, 1, 2],
        });
        expect(commands.find((command) => command.name === 'Babel Lens')).toMatchObject({
            type: 3,
            integration_types: [1],
            contexts: [0, 1, 2],
        });
    });

    it('sends Pocket Lens in the actual global registration payload', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        await registerCommandsForProfile(BABEL_POCKET_PROFILE, {
            env: {
                BABEL_POCKET_DISCORD_APP_ID: 'pocket-app',
                BABEL_POCKET_DISCORD_TOKEN: 'pocket-token',
            },
        });

        const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
        const commands = JSON.parse(String(request.body)) as Array<Record<string, unknown>>;

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            'https://discord.com/api/v10/applications/pocket-app/commands',
        );
        expect(commands.find((command) => command.name === 'Babel Lens')).toMatchObject({
            type: 3,
            integration_types: [1],
            contexts: [0, 1, 2],
        });
    });

    it('can reuse the runtime Discord token for command registration', () => {
        expect(
            resolveRegistrationEnv({
                DISCORD_APP_ID: 'app-123',
                DISCORD_TOKEN: 'runtime-token',
            }),
        ).toEqual({
            appId: 'app-123',
            botToken: 'runtime-token',
        });
    });

    it('prefers an explicit command registration bot token when both tokens are set', () => {
        expect(
            resolveRegistrationEnv({
                DISCORD_APP_ID: 'app-123',
                DISCORD_TOKEN: 'runtime-token',
                DISCORD_BOT_TOKEN: 'registration-token',
            }),
        ).toEqual({
            appId: 'app-123',
            botToken: 'registration-token',
        });
    });

    it('resolves profile-specific registration env before shared registration env', () => {
        expect(
            resolveRegistrationEnv(BABEL_POCKET_PROFILE, {
                DISCORD_APP_ID: 'shared-app',
                DISCORD_TOKEN: 'shared-token',
                BABEL_POCKET_DISCORD_APP_ID: 'pocket-app',
                BABEL_POCKET_DISCORD_TOKEN: 'pocket-runtime-token',
                BABEL_POCKET_DISCORD_BOT_TOKEN: 'pocket-registration-token',
            }),
        ).toEqual({
            appId: 'pocket-app',
            botToken: 'pocket-registration-token',
        });
    });

    it('can require profile-specific registration env for combined registration', () => {
        expect(
            resolveRegistrationEnv(
                BABEL_GUILD_PROFILE,
                {
                    DISCORD_APP_ID: 'shared-app',
                    DISCORD_TOKEN: 'shared-token',
                },
                { requireProfileSpecificEnv: true },
            ),
        ).toEqual({
            appId: undefined,
            botToken: undefined,
        });
    });

    it('registers combined profiles with profile-specific env requirements', async () => {
        const calls: Array<{
            profile: typeof BABEL_GUILD_PROFILE;
            requireProfileSpecificEnv?: boolean;
        }> = [];

        await registerCommandsForProfiles(
            [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE],
            async (profile, options) => {
                calls.push({
                    profile,
                    requireProfileSpecificEnv: options?.requireProfileSpecificEnv,
                });
            },
        );

        expect(calls).toEqual([
            { profile: BABEL_GUILD_PROFILE, requireProfileSpecificEnv: true },
            { profile: BABEL_POCKET_PROFILE, requireProfileSpecificEnv: true },
        ]);
    });
});
