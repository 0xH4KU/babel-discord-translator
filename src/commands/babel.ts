import { sendPrivateChunks, replyToTranslationFailure } from '../shared/discord-reply.js';
import { MessageFlags, type MessageContextMenuCommandInteraction } from 'discord.js';
import { buildTranslationMessages } from '../shared/discord-message-format.js';
import { extractTranslatableMessageText } from '../shared/message-extraction.js';
import { createRequestId } from '../shared/structured-logger.js';
import type { CommandDeps } from '../shared/types.js';
import { BABEL_GUILD_PROFILE, type AppProfile } from '../apps/app-profile.js';

interface BabelCommandDeps extends CommandDeps {
    profile?: AppProfile;
}

/**
 * Handle Babel context menu command — translate a right-clicked message.
 */
export async function handleBabel(
    interaction: MessageContextMenuCommandInteraction,
    { translationService, profile = BABEL_GUILD_PROFILE }: BabelCommandDeps,
): Promise<void> {
    const requestId = createRequestId();
    const billingUserId =
        profile.accessMode === 'user-install'
            ? (interaction.authorizingIntegrationOwners?.['1'] ?? interaction.user.id)
            : null;
    const result = await translationService.process({
        command: 'babel',
        commandLabel: `${profile.commandName} (context menu)`,
        guildId: interaction.guildId,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        billingUserId,
        userTag: interaction.user.tag,
        locale: interaction.locale,
        text: extractTranslatableMessageText(interaction.targetMessage),
        requestId,
        beforeTranslate: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    });

    if (result.status !== 'success') {
        await replyToTranslationFailure(interaction, result);
        return;
    }

    await sendPrivateChunks(
        interaction,
        buildTranslationMessages({
            originalText: result.originalText,
            translatedText: result.translatedText,
            targetLanguage: result.targetLanguage,
            cached: result.cached,
            provider: result.provider,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            includeOriginalPreview: true,
        }),
    );
}
