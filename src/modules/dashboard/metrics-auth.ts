import crypto from 'crypto';
import type { Request, RequestHandler } from 'express';

interface MetricsAuthOptions {
    token?: string | null;
    host?: string | null;
    nodeEnv?: string;
}

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

function isPublicBind(host?: string | null): boolean {
    if (!host) {
        return false;
    }

    const normalized = host.trim().toLowerCase();
    return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
}

function requiresDefaultMetricsProtection({ host, nodeEnv = process.env.NODE_ENV }: MetricsAuthOptions): boolean {
    return nodeEnv === 'production' && isPublicBind(host);
}

export function getPresentedMetricsToken(req: Request): string | null {
    return firstHeaderValue(req.headers['x-metrics-token'])?.trim() || extractBearerToken(req);
}

export function createMetricsAuthMiddleware(
    configuredTokenOrOptions?: string | null | MetricsAuthOptions,
): RequestHandler {
    const options =
        typeof configuredTokenOrOptions === 'object' && configuredTokenOrOptions !== null
            ? configuredTokenOrOptions
            : { token: configuredTokenOrOptions };
    const configuredToken = resolveMetricsToken(options.token);
    const expectedToken =
        configuredToken ||
        (requiresDefaultMetricsProtection(options)
            ? crypto.randomBytes(32).toString('hex')
            : '');

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
