import type { TranslationScope } from '../../shared/types.js';

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

export function getEffectiveUserId(scope: TranslationScope): string {
    return scope.billingUserId ?? scope.actorUserId;
}
