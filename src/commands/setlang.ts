import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { BABEL_GUILD_PROFILE, type AppProfile } from '../apps/app-profile.js';
import { discordMessages, getDiscordLanguageName } from '../shared/messages/discord-messages.js';
import { localeToLang } from '../modules/translation/lang.js';
import { store } from '../persistence/store.js';

interface LanguagePreferenceCommandOptions {
    profile?: Pick<AppProfile, 'accessMode'>;
}

function resolvePreferenceGuildId(
    interaction: ChatInputCommandInteraction,
    profile: Pick<AppProfile, 'accessMode'>,
): string | null {
    if (profile.accessMode === 'user-install') {
        return '';
    }

    return interaction.guildId;
}

/** Handle /setlang command — set user's preferred translation language. */
export async function handleSetlang(
    interaction: ChatInputCommandInteraction,
    options: LanguagePreferenceCommandOptions = {},
): Promise<void> {
    const lang = interaction.options.getString('language')!;
    const profile = options.profile ?? BABEL_GUILD_PROFILE;
    const guildId = resolvePreferenceGuildId(interaction, profile);

    if (guildId === null) {
        await interaction.reply({
            content: 'Language preferences can only be changed inside a server.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (lang === 'auto') {
        store.deleteUserLanguage(guildId, interaction.user.id);
        await interaction.reply({
            content: discordMessages.languagePreferenceCleared(),
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    store.setUserLanguage(guildId, interaction.user.id, lang);
    await interaction.reply({
        content: discordMessages.languageTargetSet(lang),
        flags: MessageFlags.Ephemeral,
    });
}

/** Handle /mylang command — show user's current translation language. */
export async function handleMylang(
    interaction: ChatInputCommandInteraction,
    options: LanguagePreferenceCommandOptions = {},
): Promise<void> {
    const profile = options.profile ?? BABEL_GUILD_PROFILE;
    const guildId = resolvePreferenceGuildId(interaction, profile);
    const userPref = guildId !== null ? store.getUserLanguage(guildId, interaction.user.id) : null;
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
