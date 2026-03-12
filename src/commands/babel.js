import { MessageFlags } from 'discord.js';
import { store } from '../store.js';
import { translate } from '../translate.js';
import { localeToLang, isSameLanguage } from '../lang.js';
import { usage } from '../usage.js';
import { sanitizeError } from './shared.js';

/**
 * Handle Babel context menu command — translate a right-clicked message.
 * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
 * @param {{ cache: import('../cache.js').TranslationCache, cooldown: import('../cooldown.js').CooldownManager, log: import('../log.js').TranslationLog, stats: { totalTranslations: number, apiCalls: number } }} deps
 */
export async function handleBabel(interaction, { cache, cooldown, log, stats }) {
    // --- Setup check ---
    if (!store.isSetupComplete()) {
        return interaction.reply({
            content: 'Bot not configured yet. Please complete setup in the dashboard.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Whitelist check ---
    const allowedGuilds = store.get('allowedGuildIds');
    if (!allowedGuilds.includes(interaction.guildId)) {
        return interaction.reply({
            content: 'This server is not authorized.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Budget check ---
    if (usage.isBudgetExceeded()) {
        return interaction.reply({
            content: 'Daily budget exceeded, try again tomorrow!',
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- Cooldown check ---
    const cd = cooldown.check(interaction.user.id);
    if (!cd.allowed) {
        return interaction.reply({
            content: `Please wait ${cd.remaining}s`,
            flags: MessageFlags.Ephemeral,
        });
    }

    // --- No text content ---
    const content = interaction.targetMessage.content;
    if (!content?.trim()) {
        return interaction.reply({
            content: 'No text content',
            flags: MessageFlags.Ephemeral,
        });
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
        return interaction.reply({
            content: 'This message is already in your language!',
            flags: MessageFlags.Ephemeral,
        });
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
            usage.record(result.inputTokens, result.outputTokens);
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
        console.error('[Translate]', error.message);
        log.addError({
            guildId: interaction.guildId,
            guildName: interaction.guild?.name,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            error: error.message,
            command: 'Babel (context menu)',
        });
        await interaction.editReply({
            content: `Translation failed: ${sanitizeError(error.message)}`,
        });
    }
}
