/**
 * Application configuration loaded from environment variables.
 */
import 'dotenv/config';
import type { AppConfig } from './types.js';

export const config: AppConfig = {
    /** Discord bot token for authentication. */
    discordToken: process.env.DISCORD_TOKEN,
    /** Port for the web dashboard server. */
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
    /** Password for dashboard login. */
    dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin',
};
