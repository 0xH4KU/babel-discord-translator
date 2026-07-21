#!/usr/bin/env node

import { resolveAppProfiles } from '../src/apps/app-profile.js';
import { registerCommandsForProfiles } from '../src/apps/register.js';

export async function registerCommands(): Promise<void> {
    await registerCommandsForProfiles(resolveAppProfiles(process.argv[2]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await registerCommands();
}
