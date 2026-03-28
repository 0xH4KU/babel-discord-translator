import { describe, expect, it, vi } from 'vitest';
import { runPrepareHusky, shouldSkipHuskyInstall } from '../scripts/prepare-husky.js';

describe('prepare-husky', () => {
    it('should skip when HUSKY=0', () => {
        expect(
            shouldSkipHuskyInstall({
                env: { HUSKY: '0' },
                hasGitMetadata: true,
            }),
        ).toBe('HUSKY=0');
    });

    it('should skip in CI', () => {
        expect(
            shouldSkipHuskyInstall({
                env: { CI: '1' },
                hasGitMetadata: true,
            }),
        ).toBe('CI environment');
    });

    it('should skip when git metadata is missing', () => {
        expect(
            shouldSkipHuskyInstall({
                env: {},
                hasGitMetadata: false,
            }),
        ).toBe('missing .git metadata');
    });

    it('should invoke husky on a normal local checkout', () => {
        const runner = vi.fn(() => ({ status: 0 }));

        const exitCode = runPrepareHusky({
            env: {},
            hasGitMetadata: true,
            platform: 'darwin',
            runner,
        });

        expect(exitCode).toBe(0);
        expect(runner).toHaveBeenCalledWith('npx', ['--no-install', 'husky'], {
            stdio: 'inherit',
            env: {},
        });
    });

    it('should use npx.cmd on Windows', () => {
        const runner = vi.fn(() => ({ status: 0 }));

        runPrepareHusky({
            env: {},
            hasGitMetadata: true,
            platform: 'win32',
            runner,
        });

        expect(runner).toHaveBeenCalledWith('npx.cmd', ['--no-install', 'husky'], {
            stdio: 'inherit',
            env: {},
        });
    });
});
