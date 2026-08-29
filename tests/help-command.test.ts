import { describe, expect, it, vi } from 'vitest';
import { handleHelp, _test } from '../src/commands/help.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';

function createInteraction(locale = 'en-US') {
    return {
        locale,
        reply: vi.fn(),
    };
}

describe('handleHelp', () => {
    it('shows the public /translate help for Babel Guild', async () => {
        const interaction = createInteraction();

        await handleHelp(interaction as never, { profile: BABEL_GUILD_PROFILE });

        const reply = interaction.reply.mock.calls[0]?.[0];
        expect(reply.content).toContain('How to Use Babel');
        expect(reply.content).toContain('/translate');
        expect(reply.content).toContain('Apps → **Babel**');
        expect(reply.content).toContain('Babel Lens');
    });

    it('hides /translate and uses the Pocket command name for Babel Pocket', async () => {
        const interaction = createInteraction();

        await handleHelp(interaction as never, { profile: BABEL_POCKET_PROFILE });

        const reply = interaction.reply.mock.calls[0]?.[0];
        expect(reply.content).toContain('How to Use Babel Pocket');
        expect(reply.content).toContain('Apps → **Babel Pocket**');
        expect(reply.content).toContain('Babel Lens');
        expect(reply.content).not.toContain('Babel Pocket Lens');
        expect(reply.content).not.toContain('/translate');
    });

    it('does not duplicate Pocket when localized text already contains Babel Pocket', () => {
        expect(
            _test.personalizeForProfile(
                'Open Babel from Apps, or use Babel Pocket if already installed.',
                BABEL_POCKET_PROFILE,
            ),
        ).toBe('Open Babel Pocket from Apps, or use Babel Pocket if already installed.');
    });

    it.each([
        'en-US',
        'zh-TW',
        'ja',
        'ko',
        'es',
        'fr',
        'de',
        'pt-BR',
        'ru',
        'it',
        'vi',
        'th',
        'ar',
        'hi',
        'id',
        'tr',
    ])('shows localized Lens help within Discord limits for %s', async (locale) => {
        const interaction = createInteraction(locale);

        await handleHelp(interaction as never);

        const reply = interaction.reply.mock.calls[0]?.[0];
        expect(reply.content).toContain('Babel Lens');
        expect(reply.content.length).toBeLessThanOrEqual(2_000);
    });
});
