export type AccessMode = 'guild' | 'user-install';

export interface AppProfile {
    id: 'babel-guild' | 'babel-pocket';
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
