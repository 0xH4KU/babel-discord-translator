import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { discordMessages, getDiscordLanguageName } from '../discord-messages.js';
import { localeToLang } from '../lang.js';
import { userPreferenceRepository } from '../repositories/user-preference-repository.js';

/** Handle /setlang command — set user's preferred translation language. */
export async function handleSetlang(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = interaction.options.getString('language')!;

    if (lang === 'auto') {
        userPreferenceRepository.clearLanguage(interaction.user.id);
        await interaction.reply({
            content: discordMessages.languagePreferenceCleared(),
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    userPreferenceRepository.setLanguage(interaction.user.id, lang);
    await interaction.reply({
        content: discordMessages.languageTargetSet(lang),
        flags: MessageFlags.Ephemeral,
    });
}

/** Handle /mylang command — show user's current translation language. */
export async function handleMylang(interaction: ChatInputCommandInteraction): Promise<void> {
    const userPref = userPreferenceRepository.getLanguage(interaction.user.id);
    const localeLang = localeToLang(interaction.locale);

    let reply: string;
    if (userPref) {
        reply = discordMessages.currentLanguageFromPreference(getDiscordLanguageName(userPref), userPref);
    } else if (localeLang) {
        reply = discordMessages.currentLanguageFromLocale(getDiscordLanguageName(localeLang), interaction.locale);
    } else {
        reply = discordMessages.currentLanguageAuto(interaction.locale);
    }

    await interaction.reply({ content: reply, flags: MessageFlags.Ephemeral });
}
