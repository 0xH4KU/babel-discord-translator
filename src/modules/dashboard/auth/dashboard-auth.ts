import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SessionData } from '../../../types.js';
import { dashboardMessages } from '../../../dashboard-messages.js';
import { InMemorySessionRepository } from './in-memory-session-repository.js';
import type { SessionRepository } from './session-repository.js';

const SESSION_TTL_MS = 86400 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

declare module 'express-serve-static-core' {
    interface Request {
        csrfToken?: string;
    }
}

export interface SessionState {
    token: string;
    session: SessionData;
}

export interface DashboardAuth {
    login(password: string | undefined, req: Request): { ok: true; csrfToken: string; cookie: string } | { ok: false };
    check(req: Request): { authenticated: boolean; csrfToken?: string };
    logout(req: Request): { cookie: string };
    getSessionState(req: Request): SessionState | null;
    requireAuth(req: Request, res: Response, next: NextFunction): void;
    requireCsrf(req: Request, res: Response, next: NextFunction): void;
    dispose(): void;
}

export function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export function buildSessionCookie(token: string, maxAge: number, req?: Request): string {
    const parts = [`session=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${maxAge}`];
    const isSecure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
    if (isSecure) parts.push('Secure');
    return parts.join('; ');
}

function getSessionToken(req: Request): string | null {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/session=([^;]+)/);
    return match?.[1] ?? null;
}

export function createDashboardAuth({
    password,
    sessionRepository = new InMemorySessionRepository(),
    sessionTtlMs = SESSION_TTL_MS,
    cleanupIntervalMs = SESSION_CLEANUP_INTERVAL_MS,
}: {
    password: string;
    sessionRepository?: SessionRepository;
    sessionTtlMs?: number;
    cleanupIntervalMs?: number;
}): DashboardAuth {
    const cleanupExpiredSessions = (): void => {
        const now = Date.now();
        for (const [token, session] of sessionRepository.entries()) {
            if (now > session.expiry) {
                sessionRepository.delete(token);
            }
        }
    };

    const sessionCleanupInterval = setInterval(cleanupExpiredSessions, cleanupIntervalMs);
    sessionCleanupInterval.unref?.();

    const getSessionState = (req: Request): SessionState | null => {
        const token = getSessionToken(req);
        if (!token) {
            return null;
        }

        const session = sessionRepository.get(token);
        if (!session) {
            return null;
        }

        if (Date.now() > session.expiry) {
            sessionRepository.delete(token);
            return null;
        }

        return { token, session };
    };

    return {
        login(passwordCandidate: string | undefined, req: Request) {
            if (!passwordCandidate || !safeCompare(hashPassword(passwordCandidate), hashPassword(password))) {
                return { ok: false };
            }

            const token = crypto.randomBytes(32).toString('hex');
            const csrfToken = crypto.randomBytes(32).toString('hex');
            const session = { expiry: Date.now() + sessionTtlMs, csrf: csrfToken };
            sessionRepository.set(token, session);

            return {
                ok: true,
                csrfToken,
                cookie: buildSessionCookie(token, Math.floor(sessionTtlMs / 1000), req),
            };
        },
        check(req: Request) {
            const state = getSessionState(req);
            return {
                authenticated: !!state,
                csrfToken: state?.session.csrf,
            };
        },
        logout(req: Request) {
            const token = getSessionToken(req);
            if (token) {
                sessionRepository.delete(token);
            }

            return {
                cookie: buildSessionCookie('', 0, req),
            };
        },
        getSessionState,
        requireAuth(req: Request, res: Response, next: NextFunction): void {
            const state = getSessionState(req);
            if (!state) {
                res.status(401).json({ error: dashboardMessages.auth.unauthorized });
                return;
            }

            req.csrfToken = state.session.csrf;
            next();
        },
        requireCsrf(req: Request, res: Response, next: NextFunction): void {
            const headerToken = req.headers['x-csrf-token'] as string | undefined;
            if (!headerToken || !req.csrfToken || !safeCompare(headerToken, req.csrfToken)) {
                res.status(403).json({ error: dashboardMessages.auth.invalidCsrfToken });
                return;
            }

            next();
        },
        dispose(): void {
            clearInterval(sessionCleanupInterval);
        },
    };
}

export const _test = {
    getSessionToken,
};
