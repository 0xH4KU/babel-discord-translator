#!/usr/bin/env node

/**
 * Register commands for the Babel translation bot.
 * Uses bulk overwrite to register all commands at once.
 *
 * Usage:
 *   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=xxx node scripts/register.js
 */

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
    console.error(
        '❌ Missing env vars. Usage:\n' +
        '   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=xxx node scripts/register.js',
    );
    process.exit(1);
}

const commands = [
    {
        name: 'Translate / 翻譯',
        type: 3, // MESSAGE command (right-click context menu)
    },
    {
        name: 'setlang',
        type: 1, // CHAT_INPUT (slash command)
        description: 'Set your preferred translation language / 設定偏好翻譯語言',
        options: [
            {
                name: 'language',
                description: 'Target language / 目標語言',
                type: 3, // STRING
                required: true,
                choices: [
                    { name: 'Auto (use Discord locale)', value: 'auto' },
                    { name: '繁體中文', value: 'zh-TW' },
                    { name: 'English', value: 'en' },
                    { name: '日本語', value: 'ja' },
                    { name: '한국어', value: 'ko' },
                    { name: 'Español', value: 'es' },
                    { name: 'Français', value: 'fr' },
                    { name: 'Deutsch', value: 'de' },
                    { name: 'Português', value: 'pt' },
                    { name: 'Русский', value: 'ru' },
                    { name: 'Italiano', value: 'it' },
                    { name: 'Tiếng Việt', value: 'vi' },
                    { name: 'ไทย', value: 'th' },
                    { name: 'العربية', value: 'ar' },
                    { name: 'Bahasa Indonesia', value: 'id' },
                ],
            },
        ],
    },
];

// Bulk overwrite all commands
const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const response = await fetch(url, {
    method: 'PUT', // Bulk overwrite
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(commands),
});

if (response.ok) {
    const data = await response.json();
    console.log(`✅ Registered ${data.length} commands:`);
    data.forEach((cmd) => console.log(`   - "${cmd.name}" (ID: ${cmd.id})`));
} else {
    const error = await response.text();
    console.error(`❌ Failed: ${response.status}`, error);
}
