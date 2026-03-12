import { MessageFlags } from 'discord.js';
import { store } from '../store.js';
import { translate } from '../translate.js';
import { localeToLang } from '../lang.js';
import { usage } from '../usage.js';
import { sanitizeError } from './shared.js';

/**
 * Handle /translate command — translate text and send publicly via webhook.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ cooldown: import('../cooldown.js').CooldownManager, log: import('../log.js').TranslationLog, getOrCreateWebhook: Function, stats: { totalTranslations: number, apiCalls: number } }} deps
 */
export async function handleTranslate(interaction, { cooldown, log, getOrCreateWebhook, stats }) {
    const text = interaction.options.getString('text');
    const targetOpt = interaction.options.getString('to');

    if (!store.isSetupComplete()) {
        return interaction.reply({ content: 'Bot not configured yet.', flags: MessageFlags.Ephemeral });
    }
    const allowedGuilds = store.get('allowedGuildIds');
    if (!allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({ content: 'This server is not authorized.', flags: MessageFlags.Ephemeral });
    }
    if (usage.isBudgetExceeded()) {
        return interaction.reply({ content: 'Daily budget exceeded', flags: MessageFlags.Ephemeral });
    }
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        return interaction.reply({ content: `Please wait ${cd.remaining}s`, flags: MessageFlags.Ephemeral });
    }

    // Resolve target language
    const userPrefs = store.get('userLanguagePrefs') || {};
    const userPref = userPrefs[interaction.user.id];
    const localeLang = localeToLang(interaction.locale);
    const targetLanguage = targetOpt && targetOpt !== 'auto'
        ? targetOpt
        : (userPref || localeLang || 'auto');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    cooldown.set(interaction.user.id);
    stats.totalTranslations++;

    try {
        const result = await translate(text, targetLanguage);
        usage.record(result.inputTokens, result.outputTokens);
        stats.apiCalls++;

        // Send translation publicly via webhook with user's avatar and name
        const webhook = await getOrCreateWebhook(interaction.channel);
        const member = interaction.member;
        await webhook.send({
            content: result.text,
            username: member?.displayName || interaction.user.displayName,
            avatarURL: interaction.user.displayAvatarURL({ size: 128 }),
        });

        // Dismiss the ephemeral "thinking" message
        await interaction.deleteReply();
    } catch (error) {
        console.error('[/translate]', error.message);
        log.addError({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            error: error.message,
            command: '/translate',
        });
        await interaction.editReply({ content: `Translation failed: ${sanitizeError(error.message)}` });
    }
}
