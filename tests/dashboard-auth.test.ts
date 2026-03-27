import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createDashboardAuth } from '../src/auth/dashboard-auth.js';
import { InMemorySessionRepository } from '../src/auth/in-memory-session-repository.js';

function createRequest({
    cookie,
    csrf,
    secure,
}: {
    cookie?: string;
    csrf?: string;
    secure?: boolean;
} = {}): Request {
    return {
        headers: {
            ...(cookie ? { cookie } : {}),
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        secure,
    } as Request;
}

function createResponse(): Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
} {
    const response = {
        status: vi.fn(),
        json: vi.fn(),
    };

    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);

    return response as unknown as Response & {
        status: ReturnType<typeof vi.fn>;
        json: ReturnType<typeof vi.fn>;
    };
}

describe('createDashboardAuth', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should login, authenticate, and logout using the session repository', () => {
        const auth = createDashboardAuth({ password: 'secret-pass' });
        const login = auth.login('secret-pass', createRequest());

        expect(login.ok).toBe(true);
        if (!login.ok) {
            return;
        }

        const cookie = login.cookie.split(';')[0];
        const check = auth.check(createRequest({ cookie }));
        expect(check.authenticated).toBe(true);
        expect(check.csrfToken).toBe(login.csrfToken);

        auth.logout(createRequest({ cookie }));
        expect(auth.check(createRequest({ cookie })).authenticated).toBe(false);
        auth.dispose();
    });

    it('should reject unauthenticated requests and allow authenticated ones through requireAuth', () => {
        const auth = createDashboardAuth({ password: 'secret-pass' });
        const unauthenticatedRes = createResponse();
        const authenticatedRes = createResponse();
        const next = vi.fn() as unknown as NextFunction;

        auth.requireAuth(createRequest(), unauthenticatedRes, next);
        expect(unauthenticatedRes.status).toHaveBeenCalledWith(401);

        const login = auth.login('secret-pass', createRequest());
        if (!login.ok) {
            return;
        }

        const req = createRequest({ cookie: login.cookie.split(';')[0] });
        auth.requireAuth(req, authenticatedRes, next);
        expect(req.csrfToken).toBe(login.csrfToken);
        expect(next).toHaveBeenCalledTimes(1);
        auth.dispose();
    });

    it('should validate CSRF tokens independently of the dashboard routes', () => {
        const auth = createDashboardAuth({ password: 'secret-pass' });
        const next = vi.fn() as unknown as NextFunction;
        const login = auth.login('secret-pass', createRequest());
        if (!login.ok) {
            return;
        }

        const invalidReq = createRequest({ csrf: 'wrong-token' });
        invalidReq.csrfToken = login.csrfToken;
        const invalidRes = createResponse();
        auth.requireCsrf(invalidReq, invalidRes, next);
        expect(invalidRes.status).toHaveBeenCalledWith(403);

        const validReq = createRequest({ csrf: login.csrfToken });
        validReq.csrfToken = login.csrfToken;
        const validRes = createResponse();
        auth.requireCsrf(validReq, validRes, next);
        expect(next).toHaveBeenCalledTimes(1);
        auth.dispose();
    });

    it('should clean up expired sessions from the repository', async () => {
        vi.useFakeTimers();
        const repository = new InMemorySessionRepository();
        const auth = createDashboardAuth({
            password: 'secret-pass',
            sessionRepository: repository,
            sessionTtlMs: 50,
            cleanupIntervalMs: 10,
        });

        const login = auth.login('secret-pass', createRequest());
        expect(login.ok).toBe(true);
        expect(Array.from(repository.entries())).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(60);
        expect(Array.from(repository.entries())).toHaveLength(0);
        auth.dispose();
    });
});
