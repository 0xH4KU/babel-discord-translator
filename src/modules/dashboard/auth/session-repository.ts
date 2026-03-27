import type { SessionData } from '../../../types.js';

export interface SessionRepository {
    get(token: string): SessionData | null;
    set(token: string, session: SessionData): void;
    delete(token: string): void;
    entries(): Iterable<[string, SessionData]>;
    clear(): void;
}
