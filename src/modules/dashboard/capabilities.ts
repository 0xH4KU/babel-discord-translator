import type { AppProfile } from '../../apps/app-profile.js';

export interface DashboardCapabilities {
    guildAccess: boolean;
    userAccess: boolean;
    guildGlossary: boolean;
    pendingUserInstallOwners: boolean;
}

export function getDashboardCapabilities(profile: AppProfile): DashboardCapabilities {
    return {
        guildAccess: profile.enableGuildAccess,
        userAccess: profile.enableUserAccess,
        guildGlossary: profile.enableGuildGlossary,
        pendingUserInstallOwners: profile.enableUserAccess,
    };
}
