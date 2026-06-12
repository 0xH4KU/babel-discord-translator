import { afterEach, describe, expect, it, vi } from 'vitest';

const EXPECTED_RUNTIME_CONFIG_KEYS = [
    'vertexAiApiKey',
    'gcpProject',
    'gcpLocation',
    'geminiModel',
    'allowedGuildIds',
    'allowedUserIds',
    'cooldownSeconds',
    'cacheMaxSize',
    'setupComplete',
    'inputPricePerMillion',
    'outputPricePerMillion',
    'dailyBudgetUsd',
    'defaultUserDailyBudgetUsd',
    'translationPrompt',
    'maxInputLength',
    'maxOutputTokens',
    'translationMaxConcurrent',
    'translationMaxGlobalQueue',
    'translationMaxGuildQueue',
    'translationMaxUserOutstanding',
    'translationMaxQueueWaitMs',
    'openaiApiKey',
    'openaiBaseUrl',
    'openaiModel',
    'translationProvider',
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
            allowedUserIds: [],
            cooldownSeconds: 5,
            cacheMaxSize: 2000,
            setupComplete: true,
            inputPricePerMillion: 0.2,
            outputPricePerMillion: 0.4,
            dailyBudgetUsd: 10,
            defaultUserDailyBudgetUsd: 0,
            translationPrompt: 'translate carefully',
            maxInputLength: 2000,
            maxOutputTokens: 1000,
            translationMaxConcurrent: 4,
            translationMaxGlobalQueue: 25,
            translationMaxGuildQueue: 5,
            translationMaxUserOutstanding: 1,
            translationMaxQueueWaitMs: 30000,
            openaiApiKey: '',
            openaiBaseUrl: '',
            openaiModel: '',
            translationProvider: 'vertex',
        };
        const getConfigValues = vi.fn(() => runtimeConfig);
        const getAll = vi.fn(() => {
            throw new Error('store.getAll() should not be used for runtime config');
        });

        vi.doMock('../src/persistence/store.js', () => ({
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

    it('includes user-install config keys in runtime config', async () => {
        vi.doMock('../src/persistence/store.js', () => ({
            store: {
                getConfigValues: vi.fn((keys: string[]) =>
                    Object.fromEntries(
                        keys.map((key) => [
                            key,
                            key === 'allowedUserIds'
                                ? []
                                : key === 'defaultUserDailyBudgetUsd'
                                  ? 0
                                  : null,
                        ]),
                    ),
                ),
                getAll: vi.fn(),
                update: vi.fn(),
                isSetupComplete: vi.fn(() => true),
            },
        }));

        const { configRepository } = await import('../src/modules/config/config-repository.js');
        const config = configRepository.getRuntimeConfig();

        expect(config.allowedUserIds).toEqual([]);
        expect(config.defaultUserDailyBudgetUsd).toBe(0);
    });
});
