import { MessageFlags, type MessageContextMenuCommandInteraction } from 'discord.js';
import { buildTranslationMessages } from '../shared/discord-message-format.js';
import { extractTranslatableMessageText } from '../shared/message-extraction.js';
import { createRequestId } from '../shared/structured-logger.js';
import type { CommandDeps } from '../types.js';

async function editReplyWithChunks(
    interaction: MessageContextMenuCommandInteraction,
    messages: string[],
): Promise<void> {
    await interaction.editReply({ content: messages[0] ?? '' });

    for (const message of messages.slice(1)) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    }
}

/**
 * Handle Babel context menu command — translate a right-clicked message.
 */
export async function handleBabel(
    interaction: MessageContextMenuCommandInteraction,
    { translationService }: CommandDeps,
): Promise<void> {
    const requestId = createRequestId();
    const result = await translationService.process({
        command: 'babel',
        commandLabel: 'Babel (context menu)',
        guildId: interaction.guildId,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        locale: interaction.locale,
        text: extractTranslatableMessageText(interaction.targetMessage),
        requestId,
        beforeTranslate: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    });

    if (result.status === 'blocked') {
        await interaction.reply({
            content: result.message,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (result.status === 'error') {
        if (result.deferred) {
            await interaction.editReply({ content: result.message });
        } else {
            await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
        }
        return;
    }

    await editReplyWithChunks(
        interaction,
        buildTranslationMessages({
            originalText: result.originalText,
            translatedText: result.translatedText,
            targetLanguage: result.targetLanguage,
            cached: result.cached,
            provider: result.provider,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
        }),
    );
}
