/**
 * Application configuration loaded from environment variables.
 * Validates required variables at startup to fail fast.
 */
import 'dotenv/config';
import { appLogger } from './structured-logger.js';

export interface AppConfig {
    /** Discord bot token for authentication. */
    discordToken: string;
    /** Port for the web dashboard server. */
    dashboardPort: number;
    /** Password for dashboard login. */
    dashboardPassword: string;
}

/** Validate that required environment variables are set. */
function validateEnv(): AppConfig {
    const logger = appLogger.child({ component: 'config' });
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        logger.error('config.validation.failed', {
            field: 'DISCORD_TOKEN',
            error: 'Missing required environment variable',
            hint: 'Create a .env file with DISCORD_TOKEN=your_bot_token',
        });
        process.exit(1);
    }

    const port = parseInt(process.env.DASHBOARD_PORT || '3000');
    if (isNaN(port) || port < 1 || port > 65535) {
        logger.error('config.validation.failed', {
            field: 'DASHBOARD_PORT',
            error: 'Invalid dashboard port',
            value: process.env.DASHBOARD_PORT ?? '3000',
        });
        process.exit(1);
    }

    const password = process.env.DASHBOARD_PASSWORD || 'admin';
    if (password === 'admin') {
        logger.warn('config.default_dashboard_password', {
            field: 'DASHBOARD_PASSWORD',
        });
    }

    return { discordToken: token, dashboardPort: port, dashboardPassword: password };
}

export const config: AppConfig = validateEnv();
