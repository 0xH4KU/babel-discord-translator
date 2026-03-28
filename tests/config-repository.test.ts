import { afterEach, describe, expect, it, vi } from 'vitest';

const EXPECTED_RUNTIME_CONFIG_KEYS = [
    'vertexAiApiKey',
    'gcpProject',
    'gcpLocation',
    'geminiModel',
    'allowedGuildIds',
    'cooldownSeconds',
    'cacheMaxSize',
    'setupComplete',
    'inputPricePerMillion',
    'outputPricePerMillion',
    'dailyBudgetUsd',
    'translationPrompt',
    'maxInputLength',
    'maxOutputTokens',
];

describe('configRepository', () => {
    afterEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('should read runtime config via store.getConfigValues instead of store.getAll', async () => {
        const runtimeConfig = {
            vertexAiApiKey: 'test-key',
            gcpProject: 'test-project',
            gcpLocation: 'global',
            geminiModel: 'gemini-2.5-flash-lite',
            allowedGuildIds: ['guild-1'],
            cooldownSeconds: 5,
            cacheMaxSize: 2000,
            setupComplete: true,
            inputPricePerMillion: 0.2,
            outputPricePerMillion: 0.4,
            dailyBudgetUsd: 10,
            translationPrompt: 'translate carefully',
            maxInputLength: 2000,
            maxOutputTokens: 1000,
        };
        const getConfigValues = vi.fn(() => runtimeConfig);
        const getAll = vi.fn(() => {
            throw new Error('store.getAll() should not be used for runtime config');
        });

        vi.doMock('../src/store.js', () => ({
            store: {
                getConfigValues,
                getAll,
                update: vi.fn(),
                isSetupComplete: vi.fn(() => true),
            },
        }));

        const { configRepository } = await import('../src/modules/config/config-repository.js');
        const result = configRepository.getRuntimeConfig();

        expect(result).toEqual(runtimeConfig);
        expect(getConfigValues).toHaveBeenCalledOnce();
        expect(getConfigValues).toHaveBeenCalledWith(EXPECTED_RUNTIME_CONFIG_KEYS);
        expect(getAll).not.toHaveBeenCalled();
    });
});
