import { MessageFlags } from 'discord.js';
import { store } from '../store.js';
import { translate } from '../translate.js';
import { localeToLang, isSameLanguage } from '../lang.js';
import { usage } from '../usage.js';
import { sanitizeError } from './shared.js';
import crypto from 'crypto';

/**
 * Handle /translate command — translate text and send publicly via webhook.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ cache: import('../cache.js').TranslationCache, cooldown: import('../cooldown.js').CooldownManager, log: import('../log.js').TranslationLog, getOrCreateWebhook: Function, stats: { totalTranslations: number, apiCalls: number } }} deps
 */
export async function handleTranslate(interaction, { cache, cooldown, log, getOrCreateWebhook, stats }) {
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

    // --- Text length limit ---
    const maxLen = store.get('maxInputLength') || 2000;
    if (text.length > maxLen) {
        return interaction.reply({
            content: `Text too long (${text.length}/${maxLen} chars)`,
            flags: MessageFlags.Ephemeral,
        });
    }

    // Resolve target language
    const userPrefs = store.get('userLanguagePrefs') || {};
    const userPref = userPrefs[interaction.user.id];
    const localeLang = localeToLang(interaction.locale);
    const targetLanguage = targetOpt && targetOpt !== 'auto'
        ? targetOpt
        : (userPref || localeLang || 'auto');

    // --- Same-language check ---
    if (isSameLanguage(text, targetLanguage, interaction.locale)) {
        return interaction.reply({
            content: 'This text is already in your target language!',
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    cooldown.set(interaction.user.id);
    stats.totalTranslations++;

    try {
        // --- Cache lookup ---
        const cacheKey = `translate:${crypto.createHash('md5').update(text).digest('hex')}:${targetLanguage}`;
        let translated = cache.get(cacheKey);
        const cached = !!translated;

        if (!cached) {
            const result = await translate(text, targetLanguage);
            translated = result.text;
            cache.set(cacheKey, translated);
            usage.record(result.inputTokens, result.outputTokens);
            stats.apiCalls++;
        }

        // --- Send via webhook with retry on stale cache ---
        let webhook = await getOrCreateWebhook(interaction.channel);
        const member = interaction.member;
        const sendPayload = {
            content: translated,
            username: member?.displayName || interaction.user.displayName,
            avatarURL: interaction.user.displayAvatarURL({ size: 128 }),
        };

        try {
            await webhook.send(sendPayload);
        } catch (webhookErr) {
            // If webhook was deleted externally, clear cache and retry once
            if (webhookErr.code === 10015 || webhookErr.status === 404) {
                console.warn('[/translate] Webhook stale, retrying...');
                webhook = await getOrCreateWebhook(interaction.channel, true);
                await webhook.send(sendPayload);
            } else {
                throw webhookErr;
            }
        }

        // --- Log successful translation ---
        log.add({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            contentPreview: text,
            cached,
            targetLanguage,
            langSource: targetOpt ? 'option' : userPref ? 'setlang' : localeLang ? 'locale' : 'auto',
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
