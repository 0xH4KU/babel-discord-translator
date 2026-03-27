import { MessageFlags, type MessageContextMenuCommandInteraction } from 'discord.js';
import type { CommandDeps } from '../types.js';

/**
 * Handle Babel context menu command — translate a right-clicked message.
 */
export async function handleBabel(interaction: MessageContextMenuCommandInteraction, { translationService }: CommandDeps): Promise<void> {
    const result = await translationService.process({
        command: 'babel',
        commandLabel: 'Babel (context menu)',
        guildId: interaction.guildId,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        locale: interaction.locale,
        text: interaction.targetMessage.content,
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

    const original = result.originalText.length > 200 ? result.originalText.slice(0, 200) + '…' : result.originalText;
    const reply = `> ${original.replace(/\n/g, '\n> ')}\n\n${result.translatedText}`;
    await interaction.editReply({ content: reply });
}
