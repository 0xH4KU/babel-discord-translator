/**
 * Application configuration loaded from environment variables.
 * @module config
 */
import 'dotenv/config';

/** @type {{ discordToken: string, dashboardPort: number, dashboardPassword: string }} */
export const config = {
    /** Discord bot token for authentication. */
    discordToken: process.env.DISCORD_TOKEN,
    /** Port for the web dashboard server. */
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
    /** Password for dashboard login. */
    dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin',
};
