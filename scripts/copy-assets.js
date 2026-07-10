import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeAssetDirs = ['locales', 'public'];

function copyRuntimeAssets(targetSrcDir) {
    for (const assetDir of runtimeAssetDirs) {
        const source = join(rootDir, 'src', assetDir);
        const target = join(targetSrcDir, assetDir);

        rmSync(target, { force: true, recursive: true });
        cpSync(source, target, { recursive: true });
    }
}

copyRuntimeAssets(join(rootDir, 'dist', 'src'));
