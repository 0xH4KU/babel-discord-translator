import { store } from '../../persistence/store.js';
import type { GuildGlossaryEntry, GuildGlossaryInput } from '../../shared/types.js';

export interface GuildGlossaryRepository {
    listEntries(guildId: string): GuildGlossaryEntry[];
    upsertEntry(guildId: string, input: GuildGlossaryInput): GuildGlossaryEntry;
    deleteEntry(guildId: string, entryId: number): boolean;
}

class StoreBackedGuildGlossaryRepository implements GuildGlossaryRepository {
    listEntries(guildId: string): GuildGlossaryEntry[] {
        return store.listGuildGlossary(guildId);
    }

    upsertEntry(guildId: string, input: GuildGlossaryInput): GuildGlossaryEntry {
        return store.upsertGuildGlossaryEntry(guildId, input);
    }

    deleteEntry(guildId: string, entryId: number): boolean {
        return store.deleteGuildGlossaryEntry(guildId, entryId);
    }
}

export const guildGlossaryRepository = new StoreBackedGuildGlossaryRepository();
