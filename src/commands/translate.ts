import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { sanitizeError } from './shared.js';
import { appLogger, createRequestId } from '../structured-logger.js';
import type { TranslateCommandDeps } from '../types.js';
import type { TextChannel, GuildMember } from 'discord.js';

/**
 * Handle /translate command — translate text and send publicly via webhook.
 */
export async function handleTranslate(interaction: ChatInputCommandInteraction, { translationService, getOrCreateWebhook }: TranslateCommandDeps): Promise<void> {
    const text = interaction.options.getString('text')!;
    const targetOpt = interaction.options.getString('to');
    const requestId = createRequestId();
    const logger = appLogger.child({
        component: 'translate_command',
        requestId,
        guildId: interaction.guildId ?? null,
        userId: interaction.user.id,
        command: 'translate',
    });
    const result = await translationService.process({
        command: 'translate',
        commandLabel: '/translate',
        guildId: interaction.guildId,
        guildName: interaction.guild?.name,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        locale: interaction.locale,
        text,
        targetLanguageOption: targetOpt,
        requestId,
        beforeTranslate: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
    });

    if (result.status === 'blocked') {
        await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
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

    try {
        logger.info('translate.webhook.send.started');
        let webhook = await getOrCreateWebhook(interaction.channel as TextChannel);
        const member = interaction.member as GuildMember | null;
        const sendPayload = {
            content: result.translatedText,
            username: member?.displayName || interaction.user.displayName,
            avatarURL: interaction.user.displayAvatarURL({ size: 128 }),
        };

        try {
            await webhook.send(sendPayload);
        } catch (webhookErr: unknown) {
            const err = webhookErr as { code?: number; status?: number };
            if (err.code === 10015 || err.status === 404) {
                logger.warn('translate.webhook.stale', {
                    statusCode: err.status,
                    discordCode: err.code,
                });
                webhook = await getOrCreateWebhook(interaction.channel as TextChannel, true);
                await webhook.send(sendPayload);
            } else {
                throw webhookErr;
            }
        }

        logger.info('translate.webhook.send.completed');
        await interaction.deleteReply();
    } catch (error) {
        logger.error('translate.webhook.send.failed', {
            error: (error as Error).message,
        });
        await interaction.editReply({
            content: `Translation failed: ${sanitizeError((error as Error).message)}`,
        });
    }
}
