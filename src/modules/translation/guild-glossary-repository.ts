import { store } from '../../persistence/store.js';
import type { GuildGlossaryEntry, GuildGlossaryInput } from '../../shared/types.js';

export const guildGlossaryRepository = {
    listEntries(guildId: string): GuildGlossaryEntry[] {
        return store.listGuildGlossary(guildId);
    },

    upsertEntry(guildId: string, input: GuildGlossaryInput): GuildGlossaryEntry {
        return store.upsertGuildGlossaryEntry(guildId, input);
    },

    deleteEntry(guildId: string, entryId: number): boolean {
        return store.deleteGuildGlossaryEntry(guildId, entryId);
    },
};
