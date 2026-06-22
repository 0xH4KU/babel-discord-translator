import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { discordMessages, getDiscordLanguageName } from '../shared/messages/discord-messages.js';
import { localeToLang } from '../modules/translation/lang.js';
import { userPreferenceRepository } from '../modules/translation/user-preference-repository.js';

/** Handle /setlang command — set user's preferred translation language. */
export async function handleSetlang(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = interaction.options.getString('language')!;
    const guildId = interaction.guildId;

    if (!guildId) {
        await interaction.reply({
            content: 'Language preferences can only be changed inside a server.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (lang === 'auto') {
        userPreferenceRepository.clearLanguage(guildId, interaction.user.id);
        await interaction.reply({
            content: discordMessages.languagePreferenceCleared(),
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    userPreferenceRepository.setLanguage(guildId, interaction.user.id, lang);
    await interaction.reply({
        content: discordMessages.languageTargetSet(lang),
        flags: MessageFlags.Ephemeral,
    });
}

/** Handle /mylang command — show user's current translation language. */
export async function handleMylang(interaction: ChatInputCommandInteraction): Promise<void> {
    const userPref = interaction.guildId
        ? userPreferenceRepository.getLanguage(interaction.guildId, interaction.user.id)
        : null;
    const localeLang = localeToLang(interaction.locale);

    let reply: string;
    if (userPref) {
        reply = discordMessages.currentLanguageFromPreference(
            getDiscordLanguageName(userPref),
            userPref,
        );
    } else if (localeLang) {
        reply = discordMessages.currentLanguageFromLocale(
            getDiscordLanguageName(localeLang),
            interaction.locale,
        );
    } else {
        reply = discordMessages.currentLanguageAuto(interaction.locale);
    }

    await interaction.reply({ content: reply, flags: MessageFlags.Ephemeral });
}
