#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

export function shouldSkipHuskyInstall({
    env = process.env,
    hasGitMetadata = existsSync('.git'),
} = {}) {
    if (env.HUSKY === '0') {
        return 'HUSKY=0';
    }

    if (env.CI) {
        return 'CI environment';
    }

    if (!hasGitMetadata) {
        return 'missing .git metadata';
    }

    return null;
}

export function runPrepareHusky({
    env = process.env,
    hasGitMetadata = existsSync('.git'),
    platform = process.platform,
    runner = spawnSync,
} = {}) {
    const skipReason = shouldSkipHuskyInstall({ env, hasGitMetadata });
    if (skipReason) {
        console.log(`[prepare] Skipping Husky install: ${skipReason}`);
        return 0;
    }

    const command = platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = runner(command, ['--no-install', 'husky'], {
        stdio: 'inherit',
        env,
    });

    if (result.error) {
        throw result.error;
    }

    return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exit(runPrepareHusky());
}
