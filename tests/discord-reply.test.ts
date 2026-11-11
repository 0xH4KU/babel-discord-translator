import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { replyToTranslationFailure, sendPrivateChunks } from '../src/shared/discord-reply.js';

describe('shared private Discord replies', () => {
    it('edits the first chunk and keeps follow-ups ephemeral, including empty content', async () => {
        const interaction = { editReply: vi.fn(), followUp: vi.fn(), reply: vi.fn() };
        await sendPrivateChunks(interaction as never, ['first', 'second']);
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'first' });
        expect(interaction.followUp).toHaveBeenCalledWith({
            content: 'second',
            flags: MessageFlags.Ephemeral,
        });
        await sendPrivateChunks(interaction as never, []);
        expect(interaction.editReply).toHaveBeenLastCalledWith({ content: '' });
    });
    it.each([true, false])('uses the correct failure reply after deferral=%s', async (deferred) => {
        const interaction = { editReply: vi.fn(), followUp: vi.fn(), reply: vi.fn() };
        await replyToTranslationFailure(interaction as never, { message: 'blocked', deferred });
        expect(deferred ? interaction.editReply : interaction.reply).toHaveBeenCalledOnce();
        expect(deferred ? interaction.reply : interaction.editReply).not.toHaveBeenCalled();
    });
});
