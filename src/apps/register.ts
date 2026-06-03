import type { AppProfile } from './app-profile.js';
import { getCommandsForProfile } from './commands.js';

export async function registerCommandsForProfile(profile: AppProfile): Promise<void> {
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;

    if (!appId || !botToken) {
        console.error(
            '❌ Missing env vars. Usage:\n' +
                '   DISCORD_APP_ID=xxx DISCORD_BOT_TOKEN=xxx npm run register',
        );
        process.exit(1);
    }

    const response = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify(getCommandsForProfile(profile)),
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
