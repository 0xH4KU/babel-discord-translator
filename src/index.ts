import { resolveAppProfile } from './apps/app-profile.js';
import { startBabelApp } from './apps/bootstrap.js';

await startBabelApp(resolveAppProfile());
