import { resolveAppProfiles } from './apps/app-profile.js';
import { startBabelApps } from './apps/bootstrap.js';

await startBabelApps(resolveAppProfiles());
