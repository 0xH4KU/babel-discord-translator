import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BABEL_GUILD_PROFILE, type AppProfile } from '../apps/app-profile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HelpText {
    title: string;
    translate: [string, string];
    lens: [string, string];
    quick: [string, string];
    setlang: [string, string];
    mylang: [string, string];
    tips: [string, string];
}

const HELP_TEXTS: Record<string, HelpText> = JSON.parse(
    readFileSync(join(__dirname, '..', 'locales', 'help.json'), 'utf-8'),
);

interface HelpCommandDeps {
    profile?: AppProfile;
}

function personalizeForProfile(text: string, profile: AppProfile): string {
    if (profile.commandName === BABEL_GUILD_PROFILE.commandName) {
        return text;
    }
    const suffix = profile.commandName.replace(/^Babel\s*/, '');
    return text.replace(
        new RegExp(`\\bBabel\\b(?!\\s+(?:${suffix}|Lens)\\b)`, 'g'),
        profile.commandName,
    );
}

/** Handle /help command — show localized help text. */
export async function handleHelp(
    interaction: ChatInputCommandInteraction,
    { profile = BABEL_GUILD_PROFILE }: HelpCommandDeps = {},
): Promise<void> {
    const locale = interaction.locale || 'en';
    const lang = locale.startsWith('zh') ? 'zh' : locale.split('-')[0]!;
    const t = HELP_TEXTS[lang] ?? HELP_TEXTS['en']!;
    const sections = [
        [t.translate[0], t.translate[1]],
        [t.lens[0], t.lens[1]],
        ...(profile.enableTranslateCommand ? [[t.quick[0], t.quick[1]]] : []),
        [t.setlang[0], t.setlang[1]],
        [t.mylang[0], t.mylang[1]],
        [t.tips[0], t.tips[1]],
    ];

    const text = [
        `## ${t.title}`,
        ...sections.map(([title, body]) => `**${title}**\n${body}`),
    ].join('\n\n');
    const profileText = profile.enableTranslateCommand
        ? text
        : text.replace(/^.*\/translate.*$/gm, '').replace(/\n{3,}/g, '\n\n');

    await interaction.reply({
        content: personalizeForProfile(profileText, profile),
        flags: MessageFlags.Ephemeral,
    });
}

export const _test = { personalizeForProfile };
