import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE } from '../src/apps/app-profile.js';
import { handleMylang, handleSetlang } from '../src/commands/setlang.js';
import { store } from '../src/persistence/store.js';

vi.mock('../src/persistence/store.js', () => ({
    store: {
        getUserLanguage: vi.fn(),
        setUserLanguage: vi.fn(),
        deleteUserLanguage: vi.fn(),
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

const mockStore = vi.mocked(store);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleSetlang', () => {
    it('should clear the stored preference when language is auto', async () => {
        const interaction = createInteraction({ language: 'auto' });

        await handleSetlang(interaction as never);

        expect(mockStore.deleteUserLanguage).toHaveBeenCalledWith('guild-1', 'user-1');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('cleared'),
            flags: MessageFlags.Ephemeral,
        });
        expect(mockStore.setUserLanguage).not.toHaveBeenCalled();
    });

    it('should store the chosen language and confirm it ephemerally', async () => {
        const interaction = createInteraction({ language: 'ja' });

        await handleSetlang(interaction as never);

        expect(mockStore.setUserLanguage).toHaveBeenCalledWith('guild-1', 'user-1', 'ja');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**ja**'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should store Babel Pocket preferences by user without requiring a guild', async () => {
        const interaction = createInteraction({ language: 'ko', guildId: null });

        await handleSetlang(interaction as never, { profile: BABEL_POCKET_PROFILE });

        expect(mockStore.setUserLanguage).toHaveBeenCalledWith('', 'user-1', 'ko');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**ko**'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should reject guild-scoped language changes outside a server', async () => {
        const interaction = createInteraction({ language: 'ja', guildId: null });

        await handleSetlang(interaction as never, { profile: BABEL_GUILD_PROFILE });

        expect(mockStore.setUserLanguage).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('inside a server'),
            flags: MessageFlags.Ephemeral,
        });
    });
});

describe('handleMylang', () => {
    it('should report a language set via /setlang when a preference exists', async () => {
        mockStore.getUserLanguage.mockReturnValue('ja');
        const interaction = createInteraction();

        await handleMylang(interaction as never);

        expect(mockStore.getUserLanguage).toHaveBeenCalledWith('guild-1', 'user-1');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**日本語** (`ja`), set via /setlang'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should fall back to the Discord locale when no preference is set', async () => {
        mockStore.getUserLanguage.mockReturnValue(null);
        const interaction = createInteraction({ locale: 'ko' });

        await handleMylang(interaction as never);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('auto-detected from Discord locale: `ko`'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should report auto mode for Chinese and English locales', async () => {
        mockStore.getUserLanguage.mockReturnValue(null);
        const interaction = createInteraction({ locale: 'en-US' });

        await handleMylang(interaction as never);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**Auto**'),
            flags: MessageFlags.Ephemeral,
        });
    });

    it('should read Babel Pocket preferences from user scope', async () => {
        mockStore.getUserLanguage.mockReturnValue('ko');
        const interaction = createInteraction({ guildId: null });

        await handleMylang(interaction as never, { profile: BABEL_POCKET_PROFILE });

        expect(mockStore.getUserLanguage).toHaveBeenCalledWith('', 'user-1');
        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('**한국어** (`ko`), set via /setlang'),
            flags: MessageFlags.Ephemeral,
        });
    });
});
