/**
 * Application configuration loaded from environment variables.
 * Validates required variables at startup to fail fast.
 */
import 'dotenv/config';

export interface AppConfig {
    /** Discord bot token for authentication. */
    discordToken: string;
    /** Port for the web dashboard server. */
    dashboardPort: number;
    /** Password for dashboard login. */
    dashboardPassword: string;
}

/** Validate that required environment variables are set. */
export function validateEnv(): AppConfig {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        throw new Error(
            'Missing required environment variable DISCORD_TOKEN. ' +
                'Create a .env file with DISCORD_TOKEN=your_bot_token',
        );
    }

    const port = parseInt(process.env.DASHBOARD_PORT || '3000');
    if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(
            `Invalid DASHBOARD_PORT: ${process.env.DASHBOARD_PORT ?? '3000'}. ` +
                'Must be a number between 1 and 65535.',
        );
    }

    const password = process.env.DASHBOARD_PASSWORD || 'admin';

    return { discordToken: token, dashboardPort: port, dashboardPassword: password };
}

export const config: AppConfig = validateEnv();
