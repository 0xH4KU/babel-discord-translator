import type { SessionData } from '../types.js';
import type { SessionRepository } from './session-repository.js';

/**
 * Single-process session storage for the dashboard.
 * Multi-instance deployments should replace this with a shared store.
 */
export class InMemorySessionRepository implements SessionRepository {
    private readonly sessions = new Map<string, SessionData>();

    get(token: string): SessionData | null {
        return this.sessions.get(token) ?? null;
    }

    set(token: string, session: SessionData): void {
        this.sessions.set(token, session);
    }

    delete(token: string): void {
        this.sessions.delete(token);
    }

    entries(): Iterable<[string, SessionData]> {
        return this.sessions.entries();
    }

    clear(): void {
        this.sessions.clear();
    }
}
