export interface UsageScope {
    guildId?: string | null;
    userId?: string | null;
}

export type LegacyUsageScope = UsageScope | string | null | undefined;

export function normalizeUsageScope(scope: LegacyUsageScope): UsageScope {
    if (typeof scope === 'string') {
        return { guildId: scope };
    }

    if (!scope) {
        return {};
    }

    return {
        guildId: scope.guildId ?? null,
        userId: scope.userId ?? null,
    };
}
