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
function validateEnv(): AppConfig {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('❌ Missing required environment variable: DISCORD_TOKEN');
        console.error('   Create a .env file with: DISCORD_TOKEN=your_bot_token');
        process.exit(1);
    }

    const port = parseInt(process.env.DASHBOARD_PORT || '3000');
    if (isNaN(port) || port < 1 || port > 65535) {
        console.error('❌ Invalid DASHBOARD_PORT: must be 1-65535');
        process.exit(1);
    }

    const password = process.env.DASHBOARD_PASSWORD || 'admin';
    if (password === 'admin') {
        console.warn('⚠️  Using default dashboard password "admin" — change DASHBOARD_PASSWORD in .env for production');
    }

    return { discordToken: token, dashboardPort: port, dashboardPassword: password };
}

export const config: AppConfig = validateEnv();
