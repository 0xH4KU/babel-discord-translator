import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredLogger } from '../src/structured-logger.js';

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
});
