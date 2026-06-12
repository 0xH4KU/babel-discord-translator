import type { AccessMode } from '../../apps/app-profile.js';
import type { TranslationScope } from '../../shared/types.js';
import type { RuntimeConfig } from '../config/config-repository.js';

export interface AccessDecision {
    authorized: boolean;
    blockReason?: 'guild_not_allowed' | 'user_not_allowed';
    pendingUserId?: string;
}

export function decideTranslationAccess(
    accessMode: AccessMode,
    runtimeConfig: RuntimeConfig,
    scope: TranslationScope,
): AccessDecision {
    if (accessMode === 'user-install') {
        const billingUserId = scope.billingUserId ?? scope.actorUserId;
        const authorized = runtimeConfig.allowedUserIds.includes(billingUserId);

        return authorized
            ? { authorized: true }
            : {
                  authorized: false,
                  blockReason: 'user_not_allowed',
                  pendingUserId: billingUserId,
              };
    }

    const guildId = scope.guildId;
    const authorized = !!guildId && runtimeConfig.allowedGuildIds.includes(guildId);

    return authorized
        ? { authorized: true }
        : {
              authorized: false,
              blockReason: 'guild_not_allowed',
          };
}
