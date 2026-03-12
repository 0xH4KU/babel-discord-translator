import { MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {Record<string, object>} */
const HELP_TEXTS = JSON.parse(
    readFileSync(join(__dirname, '..', 'locales', 'help.json'), 'utf-8'),
);

/**
 * Handle /help command — show localized help text.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleHelp(interaction) {
    const locale = interaction.locale || 'en';
    const lang = locale.startsWith('zh') ? 'zh' : locale.split('-')[0];
    const t = HELP_TEXTS[lang] || HELP_TEXTS.en;

    const text = `## ${t.title}

**${t.translate[0]}**
${t.translate[1]}

**${t.quick[0]}**
${t.quick[1]}

**${t.setlang[0]}**
${t.setlang[1]}

**${t.mylang[0]}**
${t.mylang[1]}

**${t.tips[0]}**
${t.tips[1]}`;

    return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}
