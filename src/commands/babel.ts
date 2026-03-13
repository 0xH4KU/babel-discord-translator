import { MessageFlags, type MessageContextMenuCommandInteraction } from 'discord.js';
import { store } from '../store.js';
import { translate } from '../translate.js';
import { localeToLang, isSameLanguage } from '../lang.js';
import { usage } from '../usage.js';
import { sanitizeError } from './shared.js';
import type { CommandDeps } from '../types.js';

/**
 * Handle Babel context menu command — translate a right-clicked message.
 */
export async function handleBabel(interaction: MessageContextMenuCommandInteraction, { cache, cooldown, log, stats }: CommandDeps): Promise<void> {
    // --- Setup check ---
    if (!store.isSetupComplete()) {
        await interaction.reply({
            content: 'Bot not configured yet. Please complete setup in the dashboard.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- Whitelist check ---
    const allowedGuilds = store.get('allowedGuildIds');
    if (!allowedGuilds.includes(interaction.guildId!)) {
        await interaction.reply({
            content: 'This server is not authorized.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- Budget check ---
    if (usage.isBudgetExceeded(interaction.guildId)) {
        await interaction.reply({
            content: 'Daily budget exceeded, try again tomorrow!',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- Cooldown check ---
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        await interaction.reply({
            content: `Please wait ${cd.remaining}s`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- No text content ---
    const content = interaction.targetMessage.content;
    if (!content?.trim()) {
        await interaction.reply({
            content: 'No text content',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- Text length limit ---
    const maxLen = store.get('maxInputLength') || 2000;
    if (content.length > maxLen) {
        await interaction.reply({
            content: `Text too long (${content.length}/${maxLen} chars)`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- Resolve target language ---
    const userPrefs = store.get('userLanguagePrefs') || {};
    const userPref = userPrefs[interaction.user.id];
    const localeLang = localeToLang(interaction.locale);
    const targetLanguage = userPref || localeLang || 'auto';
    const langSource = userPref ? 'setlang' : localeLang ? 'locale' : 'auto';
    console.log(`[Translate] user=${interaction.user.tag} lang=${targetLanguage} (from ${langSource}, locale=${interaction.locale})`);

    // --- Same-language check (skip redundant translations) ---
    if (isSameLanguage(content, targetLanguage, interaction.locale)) {
        console.log(`[Translate] Skipped: content already in target language`);
        await interaction.reply({
            content: 'This message is already in your language!',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // --- Defer + translate ---
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    cooldown.set(interaction.user.id);
    stats.totalTranslations++;

    try {
        // Cache key includes language to store per-language translations
        const cacheKey = `${interaction.targetMessage.id}:${targetLanguage}`;
        let translated = cache.get(cacheKey);
        const cached = !!translated;

        if (cached) {
            console.log(`[Translate] Cache HIT: ${cacheKey}`);
        } else {
            console.log(`[Translate] Cache MISS: ${cacheKey}, calling API...`);
            const result = await translate(content, targetLanguage);
            translated = result.text;
            cache.set(cacheKey, translated);
            usage.record(result.inputTokens, result.outputTokens, interaction.guildId);
            stats.apiCalls++;
        }

        // Log the translation
        log.add({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            contentPreview: content,
            cached,
            targetLanguage,
            langSource,
        });

        // Format: original (truncated) + translation
        const original = content.length > 200 ? content.slice(0, 200) + '…' : content;
        const reply = `> ${original.replace(/\n/g, '\n> ')}\n\n${translated}`;
        await interaction.editReply({ content: reply });
    } catch (error) {
        console.error('[Translate]', (error as Error).message);
        log.addError({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            error: (error as Error).message,
            command: 'Babel (context menu)',
        });
        await interaction.editReply({
            content: `Translation failed: ${sanitizeError((error as Error).message)}`,
        });
    }
}
