import 'dotenv/config';

export const config = {
    discordToken: process.env.DISCORD_TOKEN,
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000'),
    dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin',
};
