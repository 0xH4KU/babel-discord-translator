import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { store } from '../store.js';
import { translate } from '../translate.js';
import { localeToLang, isSameLanguage } from '../lang.js';
import { usage } from '../usage.js';
import { sanitizeError } from './shared.js';
import crypto from 'crypto';
import type { TranslateCommandDeps } from '../types.js';
import type { TextChannel, GuildMember } from 'discord.js';

/**
 * Handle /translate command — translate text and send publicly via webhook.
 */
export async function handleTranslate(interaction: ChatInputCommandInteraction, { cache, cooldown, log, getOrCreateWebhook, stats }: TranslateCommandDeps): Promise<void> {
    const text = interaction.options.getString('text')!;
    const targetOpt = interaction.options.getString('to');

    if (!store.isSetupComplete()) {
        await interaction.reply({ content: 'Bot not configured yet.', flags: MessageFlags.Ephemeral });
        return;
    }
    const allowedGuilds = store.get('allowedGuildIds');
    if (!allowedGuilds.includes(interaction.guildId!)) {
        await interaction.reply({ content: 'This server is not authorized.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (usage.isBudgetExceeded()) {
        await interaction.reply({ content: 'Daily budget exceeded', flags: MessageFlags.Ephemeral });
        return;
    }
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        await interaction.reply({ content: `Please wait ${cd.remaining}s`, flags: MessageFlags.Ephemeral });
        return;
    }

    // --- Text length limit ---
    const maxLen = store.get('maxInputLength') || 2000;
    if (text.length > maxLen) {
        await interaction.reply({
            content: `Text too long (${text.length}/${maxLen} chars)`,
            flags: MessageFlags.Ephemeral,
        });
        return;
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
        await interaction.reply({
            content: 'This text is already in your target language!',
            flags: MessageFlags.Ephemeral,
        });
        return;
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
        let webhook = await getOrCreateWebhook(interaction.channel as TextChannel);
        const member = interaction.member as GuildMember | null;
        const sendPayload = {
            content: translated!,
            username: member?.displayName || interaction.user.displayName,
            avatarURL: interaction.user.displayAvatarURL({ size: 128 }),
        };

        try {
            await webhook.send(sendPayload);
        } catch (webhookErr: unknown) {
            const err = webhookErr as { code?: number; status?: number };
            // If webhook was deleted externally, clear cache and retry once
            if (err.code === 10015 || err.status === 404) {
                console.warn('[/translate] Webhook stale, retrying...');
                webhook = await getOrCreateWebhook(interaction.channel as TextChannel, true);
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
        console.error('[/translate]', (error as Error).message);
        log.addError({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            error: (error as Error).message,
            command: '/translate',
        });
        await interaction.editReply({ content: `Translation failed: ${sanitizeError((error as Error).message)}` });
    }
}
