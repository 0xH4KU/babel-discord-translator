import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleMylang, handleSetlang } from '../src/commands/setlang.js';
import { userPreferenceRepository } from '../src/modules/translation/user-preference-repository.js';

vi.mock('../src/modules/translation/user-preference-repository.js', () => ({
    userPreferenceRepository: {
        getLanguage: vi.fn(),
        setLanguage: vi.fn(),
        clearLanguage: vi.fn(),
    },
}));

function createInteraction({
    language = null as string | null,
    locale = 'en-US',
    guildId = 'guild-1' as string | null,
} = {}) {
    return {
        options: {
            getString: vi.fn(() => language),
        },
        guildId,
        user: { id: 'user-1' },
        locale,
        reply: vi.fn(),
    };
}

const mockRepository = vi.mocked(userPreferenceRepository);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleSetlang', () => {
    it('should clear the stored preference when language is auto', async () => {
        const interaction = createInteraction({ language: 'auto' });

        await handleSetlang(interaction as never);

        expect(mockRepository.clearLanguage).toHaveBeenCalledWith('guild-1', 'user-1');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('cleared'),
            flags: MessageFlags.Ephemeral,
        });
        expect(mockRepository.setLanguage).not.toHaveBeenCalled();
    });

    it('should store the chosen language and confirm it ephemerally', async () => {
        const interaction = createInteraction({ language: 'ja' });

        await handleSetlang(interaction as never);

        expect(mockRepository.setLanguage).toHaveBeenCalledWith('guild-1', 'user-1', 'ja');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**ja**'),
            flags: MessageFlags.Ephemeral,
        });
    });
});

describe('handleMylang', () => {
    it('should report a language set via /setlang when a preference exists', async () => {
        mockRepository.getLanguage.mockReturnValue('ja');
        const interaction = createInteraction();

        await handleMylang(interaction as never);

        expect(mockRepository.getLanguage).toHaveBeenCalledWith('guild-1', 'user-1');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**日本語** (`ja`), set via /setlang'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should fall back to the Discord locale when no preference is set', async () => {
        mockRepository.getLanguage.mockReturnValue(null);
        const interaction = createInteraction({ locale: 'ko' });

        await handleMylang(interaction as never);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('auto-detected from Discord locale: `ko`'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should report auto mode for Chinese and English locales', async () => {
        mockRepository.getLanguage.mockReturnValue(null);
        const interaction = createInteraction({ locale: 'en-US' });

        await handleMylang(interaction as never);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**Auto**'),
            flags: MessageFlags.Ephemeral,
        });
    });
});
