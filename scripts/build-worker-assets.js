import { createHash } from 'node:crypto';
import { cpSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(rootDir, 'src/public');
const outputDir = join(rootDir, 'dist/worker-public');

rmSync(outputDir, { force: true, recursive: true });
cpSync(sourceDir, outputDir, { recursive: true });

const htmlPath = join(outputDir, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const assetRefs = [
    ...new Set(
        [...html.matchAll(/(?:src|href)="(\/(?:css|js)\/[^"?]+)"/g)].map((match) => match[1]),
    ),
];

for (const ref of assetRefs) {
    const path = join(outputDir, ref.slice(1));
    const content = readFileSync(path);
    const extension = extname(path);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    const hashedPath = path.slice(0, -extension.length) + `.${hash}${extension}`;
    const hashedRef = ref.slice(0, -extension.length) + `.${hash}${extension}`;

    renameSync(path, hashedPath);
    html = html.replaceAll(ref, hashedRef);
}

writeFileSync(htmlPath, html);
