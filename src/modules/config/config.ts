/**
 * Application configuration loaded from environment variables.
 * Validates required variables at startup to fail fast.
 */
import 'dotenv/config';
import { appLogger, type StructuredLogger } from '../../shared/structured-logger.js';

const DEFAULT_DASHBOARD_PORT = 3000;
const DEFAULT_DASHBOARD_PASSWORD = 'admin';

let loadedConfig: AppConfig | null = null;

export interface AppConfig {
    /** Discord bot token for authentication. */
    discordToken: string;
    /** Port for the web dashboard server. */
    dashboardPort: number;
    /** Password for dashboard login. */
    dashboardPassword: string;
}

interface ValidateEnvOptions {
    logger?: StructuredLogger;
    nodeEnv?: string;
}

function getConfigLogger(logger?: StructuredLogger): StructuredLogger {
    return logger ?? appLogger.child({ component: 'config' });
}

function resolveNodeEnv(env: NodeJS.ProcessEnv, nodeEnv?: string): string {
    return nodeEnv ?? env.NODE_ENV ?? 'development';
}

/** Validate that required environment variables are set. */
export function validateEnv(
    env: NodeJS.ProcessEnv = process.env,
    { logger, nodeEnv }: ValidateEnvOptions = {},
): AppConfig {
    const configLogger = getConfigLogger(logger);
    const resolvedNodeEnv = resolveNodeEnv(env, nodeEnv);
    const token = env.DISCORD_TOKEN;

    if (!token) {
        configLogger.error('config.validation.failed', {
            field: 'DISCORD_TOKEN',
            error: 'Missing required environment variable',
            hint: 'Create a .env file with DISCORD_TOKEN=your_bot_token',
        });
        throw new Error(
            'Missing required environment variable DISCORD_TOKEN. ' +
                'Create a .env file with DISCORD_TOKEN=your_bot_token',
        );
    }

    const rawPort = env.DASHBOARD_PORT ?? String(DEFAULT_DASHBOARD_PORT);
    const port = Number.parseInt(rawPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        configLogger.error('config.validation.failed', {
            field: 'DASHBOARD_PORT',
            error: 'Invalid dashboard port',
            value: rawPort,
            hint: 'Use a number between 1 and 65535',
        });
        throw new Error(
            `Invalid DASHBOARD_PORT: ${rawPort}. ` + 'Must be a number between 1 and 65535.',
        );
    }

    const password = env.DASHBOARD_PASSWORD || DEFAULT_DASHBOARD_PASSWORD;
    if (password === DEFAULT_DASHBOARD_PASSWORD) {
        if (resolvedNodeEnv === 'production') {
            configLogger.error('config.validation.failed', {
                field: 'DASHBOARD_PASSWORD',
                error: 'Refusing to use the default dashboard password in production',
                environment: resolvedNodeEnv,
                hint: 'Set DASHBOARD_PASSWORD to a strong random value before starting the app',
            });
            throw new Error(
                'Refusing to use the default DASHBOARD_PASSWORD in production. ' +
                    'Set DASHBOARD_PASSWORD to a strong random value before starting the app.',
            );
        }

        configLogger.warn('config.default_dashboard_password', {
            field: 'DASHBOARD_PASSWORD',
            environment: resolvedNodeEnv,
            hint: 'Set DASHBOARD_PASSWORD to a strong random value before exposing the dashboard',
        });
    }

    return { discordToken: token, dashboardPort: port, dashboardPassword: password };
}

export function loadConfig(
    options: ValidateEnvOptions & { env?: NodeJS.ProcessEnv } = {},
): AppConfig {
    loadedConfig = validateEnv(options.env ?? process.env, options);
    return loadedConfig;
}

export function getConfig(): AppConfig {
    if (!loadedConfig) {
        loadedConfig = loadConfig();
    }
    return loadedConfig;
}

export const config: AppConfig = new Proxy({} as AppConfig, {
    get(_target, prop: keyof AppConfig) {
        return getConfig()[prop];
    },
});

export const _test = {
    resetLoadedConfig(): void {
        loadedConfig = null;
    },
};
