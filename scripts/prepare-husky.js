#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

function shouldSkipHuskyInstall() {
    if (process.env.HUSKY === '0') {
        return 'HUSKY=0';
    }

    if (process.env.CI) {
        return 'CI environment';
    }

    if (!existsSync('.git')) {
        return 'missing .git metadata';
    }

    return null;
}

const skipReason = shouldSkipHuskyInstall();
if (skipReason) {
    console.log(`[prepare] Skipping Husky install: ${skipReason}`);
    process.exit(0);
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['--no-install', 'husky'], {
    stdio: 'inherit',
    env: process.env,
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
