import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '../src/shared/structured-logger.js';

function createLoggerMock(): StructuredLogger {
    const logger: StructuredLogger = {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child(fields: Record<string, unknown> = {}) {
            void fields;
            return logger;
        },
    };

    return logger;
}

describe('config validation', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(async () => {
        process.env = originalEnv;
        const configModule = await import('../src/modules/config/config.js');
        configModule._test.resetLoadedConfig();
    });

    it('should log and throw when DISCORD_TOKEN is missing', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        expect(() =>
            validateEnv(
                { DASHBOARD_PASSWORD: 'strong-password' },
                { logger, nodeEnv: 'development' },
            ),
        ).toThrow('Missing required environment variable DISCORD_TOKEN');

        expect(logger.error).toHaveBeenCalledWith('config.validation.failed', {
            field: 'DISCORD_TOKEN',
            error: 'Missing required environment variable',
            hint: 'Create a .env file with DISCORD_TOKEN=your_bot_token',
        });
    });

    it('should log and throw when DASHBOARD_PORT is invalid', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        expect(() =>
            validateEnv(
                {
                    DISCORD_TOKEN: 'test-token',
                    DASHBOARD_PORT: '70000',
                    DASHBOARD_PASSWORD: 'strong-password',
                },
                { logger, nodeEnv: 'development' },
            ),
        ).toThrow('Invalid DASHBOARD_PORT: 70000');

        expect(logger.error).toHaveBeenCalledWith('config.validation.failed', {
            field: 'DASHBOARD_PORT',
            error: 'Invalid dashboard port',
            value: '70000',
            hint: 'Use a number between 1 and 65535',
        });
    });

    it('should prefer Railway PORT over DASHBOARD_PORT when both are set', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        const config = validateEnv(
            {
                DISCORD_TOKEN: 'test-token',
                PORT: '4123',
                DASHBOARD_PORT: '3000',
                DASHBOARD_PASSWORD: 'strong-password',
            },
            { logger, nodeEnv: 'production' },
        );

        expect(config.dashboardPort).toBe(4123);
    });

    it('should include dashboardHost for platform public networking binds', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        const config = validateEnv(
            {
                DISCORD_TOKEN: 'test-token',
                DASHBOARD_HOST: '0.0.0.0',
                DASHBOARD_PASSWORD: 'strong-password',
            },
            { logger, nodeEnv: 'production' },
        );

        expect(config.dashboardHost).toBe('0.0.0.0');
    });

    it('should warn and allow the default dashboard password in development', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        const config = validateEnv(
            { DISCORD_TOKEN: 'test-token' },
            { logger, nodeEnv: 'development' },
        );

        expect(config.dashboardPassword).toBe('admin');
        expect(logger.warn).toHaveBeenCalledWith('config.default_dashboard_password', {
            field: 'DASHBOARD_PASSWORD',
            environment: 'development',
            hint: 'Set DASHBOARD_PASSWORD to a strong random value before exposing the dashboard',
        });
    });

    it('should resolve shared and profile-specific Discord tokens', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        const config = validateEnv(
            {
                DISCORD_TOKEN: 'shared-token',
                BABEL_GUILD_DISCORD_TOKEN: 'guild-token',
                BABEL_POCKET_DISCORD_TOKEN: 'pocket-token',
                DASHBOARD_PASSWORD: 'strong-password',
            },
            { logger, nodeEnv: 'production' },
        );

        expect(config.discordToken).toBe('shared-token');
        expect(config.discordTokens).toEqual({
            'babel-guild': 'guild-token',
            'babel-pocket': 'pocket-token',
        });
    });

    it('should require both profile-specific tokens for combined Railway mode', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        expect(() =>
            validateEnv(
                {
                    BABEL_APP: 'combined',
                    BABEL_GUILD_DISCORD_TOKEN: 'guild-token',
                    DASHBOARD_PASSWORD: 'strong-password',
                },
                { logger, nodeEnv: 'production' },
            ),
        ).toThrow('Missing required environment variable BABEL_POCKET_DISCORD_TOKEN');

        expect(logger.error).toHaveBeenCalledWith('config.validation.failed', {
            field: 'BABEL_POCKET_DISCORD_TOKEN',
            error: 'Missing required environment variable',
            hint: 'Set BABEL_GUILD_DISCORD_TOKEN and BABEL_POCKET_DISCORD_TOKEN for BABEL_APP=combined',
        });
    });

    it('should not use the shared Discord token as a combined-mode profile token', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        expect(() =>
            validateEnv(
                {
                    BABEL_APP: 'combined',
                    DISCORD_TOKEN: 'shared-token',
                    BABEL_GUILD_DISCORD_TOKEN: 'guild-token',
                    DASHBOARD_PASSWORD: 'strong-password',
                },
                { logger, nodeEnv: 'production' },
            ),
        ).toThrow('Missing required environment variable BABEL_POCKET_DISCORD_TOKEN');
    });

    it('should log and reject the default dashboard password in production', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        expect(() =>
            validateEnv({ DISCORD_TOKEN: 'test-token' }, { logger, nodeEnv: 'production' }),
        ).toThrow('Refusing to use the default DASHBOARD_PASSWORD in production');

        expect(logger.error).toHaveBeenCalledWith('config.validation.failed', {
            field: 'DASHBOARD_PASSWORD',
            error: 'Refusing to use the default dashboard password in production',
            environment: 'production',
            hint: 'Set DASHBOARD_PASSWORD to a strong random value before starting the app',
        });
    });

    it('should reject the documented placeholder dashboard password in production', async () => {
        const logger = createLoggerMock();
        const { validateEnv } = await import('../src/modules/config/config.js');

        expect(() =>
            validateEnv(
                { DISCORD_TOKEN: 'test-token', DASHBOARD_PASSWORD: 'change_me' },
                { logger, nodeEnv: 'production' },
            ),
        ).toThrow('Refusing to use the default DASHBOARD_PASSWORD in production');
    });
});
