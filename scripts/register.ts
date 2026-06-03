#!/usr/bin/env node

import { resolveAppProfile } from '../src/apps/app-profile.js';
import { registerCommandsForProfile } from '../src/apps/register.js';

export async function registerCommands(): Promise<void> {
    await registerCommandsForProfile(resolveAppProfile());
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await registerCommands();
}
