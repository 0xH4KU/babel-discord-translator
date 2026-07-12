import type { Express, RequestHandler, Response } from 'express';
import type { AppProfile } from '../../apps/app-profile.js';
import type { DashboardCapabilities } from './capabilities.js';
import type { DashboardDeps } from '../../shared/types.js';

export interface DashboardApiScope {
    profile: AppProfile;
    profiles: AppProfile[];
    capabilities: DashboardCapabilities;
    client: DashboardDeps['client'];
    appProfileIdForLogs?: AppProfile['id'];
}

export type DashboardCapabilityName = keyof DashboardCapabilities;

interface ScopedRoute {
    prefix: string;
    scope: DashboardApiScope;
}

export function getDashboardScope(res: Response, fallback: DashboardApiScope): DashboardApiScope {
    return res.locals.dashboardScope ?? fallback;
}

export function createScopedApiRouter(
    app: Express,
    routes: ScopedRoute[],
    getScope: (res: Response) => DashboardApiScope,
) {
    const setScope =
        (scope: DashboardApiScope): RequestHandler =>
        (_req, res, next) => {
            res.locals.dashboardScope = scope;
            next();
        };
    const requireDashboardCapability =
        (capability: DashboardCapabilityName): RequestHandler =>
        (_req, res, next) => {
            if (!getScope(res).capabilities[capability]) {
                res.status(404).json({ error: 'Not found' });
                return;
            }

            next();
        };
    const registerApiRoute = (
        method: 'get' | 'post' | 'delete',
        path: string,
        handlers: RequestHandler[],
    ): void => {
        for (const { prefix, scope } of routes) {
            app[method](prefix + path, setScope(scope), ...handlers);
        }
    };

    return {
        get(path: string, ...handlers: RequestHandler[]): void {
            registerApiRoute('get', path, handlers);
        },
        post(path: string, ...handlers: RequestHandler[]): void {
            registerApiRoute('post', path, handlers);
        },
        delete(path: string, ...handlers: RequestHandler[]): void {
            registerApiRoute('delete', path, handlers);
        },
        getIf(capability: DashboardCapabilityName, path: string, ...handlers: RequestHandler[]) {
            registerApiRoute('get', path, [requireDashboardCapability(capability), ...handlers]);
        },
        postIf(capability: DashboardCapabilityName, path: string, ...handlers: RequestHandler[]) {
            registerApiRoute('post', path, [requireDashboardCapability(capability), ...handlers]);
        },
        deleteIf(capability: DashboardCapabilityName, path: string, ...handlers: RequestHandler[]) {
            registerApiRoute('delete', path, [requireDashboardCapability(capability), ...handlers]);
        },
    };
}
