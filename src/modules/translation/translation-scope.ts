import type { TranslationScope } from '../../types.js';

export function createTranslationScope(input: {
    guildId?: string | null;
    userId: string;
    billingUserId?: string | null;
}): TranslationScope {
    return {
        guildId: input.guildId ?? null,
        actorUserId: input.userId,
        billingUserId: input.billingUserId ?? null,
    };
}

export function getBillingUsageUserId(scope: TranslationScope): string | null {
    return scope.billingUserId ?? null;
}

export function getRuntimeLimiterUserId(scope: TranslationScope): string {
    return scope.billingUserId ?? scope.actorUserId;
}
