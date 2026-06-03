import { describe, expect, it } from 'vitest';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import { getCommandsForProfile } from '../src/apps/commands.js';

describe('Discord command registration profiles', () => {
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
});
