import type { AppProfile } from './app-profile.js';
import { getCommandsForProfile } from './commands.js';

interface RegistrationEnvOptions {
    requireProfileSpecificEnv?: boolean;
}

interface RegisterCommandsOptions extends RegistrationEnvOptions {
    env?: NodeJS.ProcessEnv;
}

export const DISCORD_API_TIMEOUT_MS = 10_000;

type ProfileRegistrar = (profile: AppProfile, options?: RegisterCommandsOptions) => Promise<void>;

function profileEnvPrefix(profile: AppProfile): 'BABEL_GUILD' | 'BABEL_POCKET' {
    return profile.id === 'babel-pocket' ? 'BABEL_POCKET' : 'BABEL_GUILD';
}

function isAppProfile(value: AppProfile | NodeJS.ProcessEnv): value is AppProfile {
    return 'productName' in value && 'commandName' in value && 'accessMode' in value;
}

export function resolveRegistrationEnv(env?: NodeJS.ProcessEnv): {
    appId?: string;
    botToken?: string;
};
export function resolveRegistrationEnv(
    profile: AppProfile,
    env?: NodeJS.ProcessEnv,
    options?: RegistrationEnvOptions,
): {
    appId?: string;
    botToken?: string;
};
export function resolveRegistrationEnv(
    profileOrEnv: AppProfile | NodeJS.ProcessEnv = process.env,
    env: NodeJS.ProcessEnv = process.env,
    options: RegistrationEnvOptions = {},
): {
    appId?: string;
    botToken?: string;
} {
    if (isAppProfile(profileOrEnv)) {
        const prefix = profileEnvPrefix(profileOrEnv);
        const profileAppId = env[`${prefix}_DISCORD_APP_ID`];
        const profileBotToken =
            env[`${prefix}_DISCORD_BOT_TOKEN`] || env[`${prefix}_DISCORD_TOKEN`];

        if (options.requireProfileSpecificEnv) {
            return {
                appId: profileAppId,
                botToken: profileBotToken,
            };
        }

        return {
            appId: profileAppId || env.DISCORD_APP_ID,
            botToken: profileBotToken || env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN,
        };
    }

    const legacyEnv = profileOrEnv;
    return {
        appId: legacyEnv.DISCORD_APP_ID,
        botToken: legacyEnv.DISCORD_BOT_TOKEN || legacyEnv.DISCORD_TOKEN,
    };
}

export async function registerCommandsForProfile(
    profile: AppProfile,
    options: RegisterCommandsOptions = {},
): Promise<void> {
    const { appId, botToken } = resolveRegistrationEnv(profile, options.env, {
        requireProfileSpecificEnv: options.requireProfileSpecificEnv,
    });

    if (!appId || !botToken) {
        console.error(
            '❌ Missing env vars. Usage:\n' +
                '   DISCORD_APP_ID=xxx DISCORD_TOKEN=xxx npm run register\n' +
                '   BABEL_GUILD_DISCORD_APP_ID=xxx BABEL_GUILD_DISCORD_TOKEN=xxx npm run register:guild\n' +
                '   BABEL_POCKET_DISCORD_APP_ID=xxx BABEL_POCKET_DISCORD_TOKEN=xxx npm run register:pocket',
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
        signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS),
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

export async function registerCommandsForProfiles(
    profiles: AppProfile[],
    registrar: ProfileRegistrar = registerCommandsForProfile,
): Promise<void> {
    const requireProfileSpecificEnv = profiles.length > 1;
    for (const profile of profiles) {
        await registrar(profile, { requireProfileSpecificEnv });
    }
}
