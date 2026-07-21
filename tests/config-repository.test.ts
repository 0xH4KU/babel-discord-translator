import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_VALUE_KEYS, DEFAULT_STORE_DATA } from '../src/persistence/store-defaults.js';

describe('configRepository', () => {
    afterEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('reads and updates only config values', async () => {
        const getConfigValues = vi.fn(() => ({ ...DEFAULT_STORE_DATA }));
        const updateConfigValues = vi.fn();

        vi.doMock('../src/persistence/store.js', () => ({
            store: {
                getConfigValues,
                updateConfigValues,
                isSetupComplete: vi.fn(() => true),
            },
        }));

        const { configRepository } = await import('../src/modules/config/config-repository.js');

        expect(configRepository.getRuntimeConfig().allowedUserIds).toEqual([]);
        expect(getConfigValues).toHaveBeenCalledWith(CONFIG_VALUE_KEYS);

        configRepository.updateConfig({ cooldownSeconds: 10 });
        expect(updateConfigValues).toHaveBeenCalledWith({ cooldownSeconds: 10 });
    });
});
