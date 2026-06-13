export type AccessMode = 'guild' | 'user-install';
export type AppProfileId = 'babel-guild' | 'babel-pocket';

export interface AppProfile {
    id: AppProfileId;
    productName: 'Babel Guild' | 'Babel Pocket';
    commandName: 'Babel' | 'Babel Pocket';
    accessMode: AccessMode;
    enableTranslateCommand: boolean;
    enableWebhookOutput: boolean;
    enableGuildAccess: boolean;
    enableUserAccess: boolean;
    enableGuildGlossary: boolean;
}

export const BABEL_GUILD_PROFILE: AppProfile = {
    id: 'babel-guild',
    productName: 'Babel Guild',
    commandName: 'Babel',
    accessMode: 'guild',
    enableTranslateCommand: true,
    enableWebhookOutput: true,
    enableGuildAccess: true,
    enableUserAccess: false,
    enableGuildGlossary: true,
};

export const BABEL_POCKET_PROFILE: AppProfile = {
    id: 'babel-pocket',
    productName: 'Babel Pocket',
    commandName: 'Babel Pocket',
    accessMode: 'user-install',
    enableTranslateCommand: false,
    enableWebhookOutput: false,
    enableGuildAccess: false,
    enableUserAccess: true,
    enableGuildGlossary: false,
};

export function resolveAppProfile(value = process.env.BABEL_APP): AppProfile {
    return value === 'pocket' || value === 'babel-pocket'
        ? BABEL_POCKET_PROFILE
        : BABEL_GUILD_PROFILE;
}

export function isCombinedAppProfileValue(value = process.env.BABEL_APP): boolean {
    return value === 'combined' || value === 'both' || value === 'babel-combined';
}

export function resolveAppProfiles(value = process.env.BABEL_APP): AppProfile[] {
    return isCombinedAppProfileValue(value)
        ? [BABEL_GUILD_PROFILE, BABEL_POCKET_PROFILE]
        : [resolveAppProfile(value)];
}
