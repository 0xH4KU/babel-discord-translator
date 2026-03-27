import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { normalizeStoreData } from '../repositories/store-data-normalizer.js';
import type { StoreData } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '..', '..', 'data');
const DEFAULT_LEGACY_CONFIG_PATH = join(DEFAULT_DATA_DIR, 'config.json');

export function resolveLegacyConfigPath(): string {
    return process.env.BABEL_LEGACY_CONFIG_PATH || DEFAULT_LEGACY_CONFIG_PATH;
}

export function readLegacyStoreData(path: string = resolveLegacyConfigPath()): StoreData | null {
    if (!existsSync(path)) {
        return null;
    }

    const raw = readFileSync(path, 'utf-8');
    return normalizeStoreData(JSON.parse(raw) as Partial<StoreData>);
}

export function writeLegacyStoreData(data: StoreData, path: string = resolveLegacyConfigPath()): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
}
