#!/usr/bin/env node

/**
 * One-time script to register the "Translate / 翻譯" context menu command.
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

const command = {
    name: 'Translate / 翻譯',
    type: 3, // MESSAGE command (right-click context menu)
};

const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const response = await fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify(command),
});

if (response.ok) {
    const data = await response.json();
    console.log(`✅ Registered: "${data.name}" (ID: ${data.id})`);
} else {
    const error = await response.text();
    console.error(`❌ Failed: ${response.status}`, error);
}
