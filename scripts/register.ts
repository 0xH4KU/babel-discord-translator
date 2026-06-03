#!/usr/bin/env node

import { resolveAppProfile } from '../src/apps/app-profile.js';
import { getCommandsForProfile } from '../src/apps/commands.js';

export async function registerCommands(): Promise<void> {
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const profile = resolveAppProfile();

    if (!appId || !botToken) {
        console.error(
            '❌ Missing env vars. Usage:\n' +
                '   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=xxx npm run register',
        );
        process.exit(1);
    }

    const commands = getCommandsForProfile(profile);
    const url = `https://discord.com/api/v10/applications/${appId}/commands`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify(commands),
    });

    if (response.ok) {
        const data = (await response.json()) as Array<{ name: string; id: string }>;
        console.log(`✅ Registered ${data.length} ${profile.productName} commands:`);
        data.forEach((cmd) => console.log(`   - "${cmd.name}" (ID: ${cmd.id})`));
        return;
    }

    const error = await response.text();
    console.error(`❌ Failed: ${response.status}`, error);
    process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await registerCommands();
}
