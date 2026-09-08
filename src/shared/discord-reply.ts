import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

type TranslationInteraction = Pick<ChatInputCommandInteraction, 'reply' | 'editReply' | 'followUp'>;

export async function sendPrivateChunks(
    interaction: TranslationInteraction,
    messages: string[],
): Promise<void> {
    await interaction.editReply({ content: messages[0] ?? '' });
    for (const message of messages.slice(1)) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    }
}

export async function replyToTranslationFailure(
    interaction: TranslationInteraction,
    result: { message: string; deferred?: boolean },
): Promise<void> {
    if (result.deferred) await interaction.editReply({ content: result.message });
    else await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
}
