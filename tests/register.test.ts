import { describe, expect, it } from 'vitest';
import {
    BABEL_GUILD_PROFILE,
    BABEL_POCKET_PROFILE,
    resolveAppProfile,
} from '../src/apps/app-profile.js';
import { getCommandsForProfile } from '../src/apps/commands.js';
import { resolveRegistrationEnv } from '../src/apps/register.js';

describe('Discord command registration profiles', () => {
    it('resolves the default root app profile from BABEL_APP-compatible values', () => {
        expect(resolveAppProfile()).toBe(BABEL_GUILD_PROFILE);
        expect(resolveAppProfile('guild')).toBe(BABEL_GUILD_PROFILE);
        expect(resolveAppProfile('babel-guild')).toBe(BABEL_GUILD_PROFILE);
        expect(resolveAppProfile('pocket')).toBe(BABEL_POCKET_PROFILE);
        expect(resolveAppProfile('babel-pocket')).toBe(BABEL_POCKET_PROFILE);
    });

    it('registers Babel Guild server-install commands', () => {
        const commands = getCommandsForProfile(BABEL_GUILD_PROFILE);
        const names = commands.map((command) => command.name);

        expect(names).toEqual(['Babel', 'setlang', 'translate', 'help', 'mylang']);
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

        expect(names).toEqual(['Babel Pocket', 'setlang', 'help', 'mylang']);
        expect(names).not.toContain('translate');
        expect(commands.every((command) => command.integration_types?.includes(1))).toBe(true);
        expect(commands.every((command) => command.contexts)).toBe(true);
        expect(commands.find((command) => command.name === 'Babel Pocket')).toMatchObject({
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
});
