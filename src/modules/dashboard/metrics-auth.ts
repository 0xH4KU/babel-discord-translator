import crypto from 'crypto';
import type { Request, RequestHandler } from 'express';

function safeTokenCompare(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

function extractBearerToken(req: Request): string | null {
    const authorization = firstHeaderValue(req.headers.authorization);
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

export function resolveMetricsToken(configuredToken?: string | null): string {
    return (configuredToken ?? process.env.BABEL_METRICS_TOKEN ?? '').trim();
}

export function getPresentedMetricsToken(req: Request): string | null {
    return firstHeaderValue(req.headers['x-metrics-token'])?.trim() || extractBearerToken(req);
}

export function createMetricsAuthMiddleware(configuredToken?: string | null): RequestHandler {
    const expectedToken = resolveMetricsToken(configuredToken);

    return (req, res, next) => {
        if (!expectedToken) {
            next();
            return;
        }

        const presentedToken = getPresentedMetricsToken(req);
        if (presentedToken && safeTokenCompare(presentedToken, expectedToken)) {
            next();
            return;
        }

        res.status(401).type('text/plain').send('Metrics token required\n');
    };
}
