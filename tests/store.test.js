import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock fs and dotenv ---
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
}));

vi.mock('dotenv/config', () => ({}));

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

describe('ConfigStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        existsSync.mockReturnValue(false);
    });

    async function createFreshStore() {
        // Clear module cache to get fresh instance
        vi.resetModules();

        // Re-mock after reset
        vi.doMock('fs', () => ({
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
            existsSync: vi.fn(() => false),
        }));
        vi.doMock('dotenv/config', () => ({}));

        const { store } = await import('../src/store.js');
        return store;
    }

    it('should initialize with defaults when no config file exists', async () => {
        const store = await createFreshStore();
        expect(store.get('cooldownSeconds')).toBe(5);
        expect(store.get('cacheMaxSize')).toBe(2000);
        expect(store.get('setupComplete')).toBe(false);
    });

    it('should load and merge config from file', async () => {
        vi.resetModules();
        vi.doMock('fs', () => ({
            readFileSync: vi.fn(() => JSON.stringify({ cooldownSeconds: 10, setupComplete: true })),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
            existsSync: vi.fn(() => true),
        }));
        vi.doMock('dotenv/config', () => ({}));

        const { store } = await import('../src/store.js');
        expect(store.get('cooldownSeconds')).toBe(10);
        expect(store.get('setupComplete')).toBe(true);
        // Non-overridden defaults remain
        expect(store.get('cacheMaxSize')).toBe(2000);
    });

    it('should handle corrupt JSON gracefully', async () => {
        vi.resetModules();
        vi.doMock('fs', () => ({
            readFileSync: vi.fn(() => 'not json at all {{{'),
            writeFileSync: vi.fn(),
            mkdirSync: vi.fn(),
            existsSync: vi.fn(() => true),
        }));
        vi.doMock('dotenv/config', () => ({}));

        // Should not throw — falls back to defaults
        const { store } = await import('../src/store.js');
        expect(store.get('cooldownSeconds')).toBe(5);
    });

    it('should set value and persist to disk', async () => {
        vi.resetModules();
        const mockWrite = vi.fn();
        vi.doMock('fs', () => ({
            readFileSync: vi.fn(),
            writeFileSync: mockWrite,
            mkdirSync: vi.fn(),
            existsSync: vi.fn(() => false),
        }));
        vi.doMock('dotenv/config', () => ({}));

        const { store } = await import('../src/store.js');
        store.set('cooldownSeconds', 15);

        expect(store.get('cooldownSeconds')).toBe(15);
        expect(mockWrite).toHaveBeenCalled();
        const written = JSON.parse(mockWrite.mock.calls[0][1]);
        expect(written.cooldownSeconds).toBe(15);
    });

    it('should update multiple values at once', async () => {
        const store = await createFreshStore();
        store.update({ cooldownSeconds: 20, cacheMaxSize: 500 });

        expect(store.get('cooldownSeconds')).toBe(20);
        expect(store.get('cacheMaxSize')).toBe(500);
    });

    it('should return a copy from getAll()', async () => {
        const store = await createFreshStore();
        const all = store.getAll();
        all.cooldownSeconds = 999;

        // Original should not be affected
        expect(store.get('cooldownSeconds')).toBe(5);
    });

    it('should return default for unknown key', async () => {
        const store = await createFreshStore();
        expect(store.get('nonExistentKey')).toBeUndefined();
    });

    it('should report isSetupComplete correctly', async () => {
        const store = await createFreshStore();
        expect(store.isSetupComplete()).toBe(false);

        store.set('setupComplete', true);
        expect(store.isSetupComplete()).toBe(true);
    });
});
