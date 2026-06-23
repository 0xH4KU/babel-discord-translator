import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dashboardRoot = join(process.cwd(), 'dist/src/public');
const htmlPath = join(dashboardRoot, 'index.html');

function fail(message) {
    console.error(`[dashboard-smoke] ${message}`);
    process.exit(1);
}

if (!existsSync(htmlPath)) {
    fail(`Missing built dashboard HTML at ${htmlPath}. Run npm run build first.`);
}

const html = readFileSync(htmlPath, 'utf8');
const inlineEventPattern = /\s(onclick|onchange|oninput|onkeydown)=["']/i;
if (inlineEventPattern.test(html)) {
    fail('Built dashboard HTML contains inline event handlers.');
}

if (/\sstyle=["']/i.test(html)) {
    fail('Built dashboard HTML contains inline style attributes.');
}

const assetRefs = [
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+href="([^"]+)"/g),
]
    .map((match) => match[1])
    .filter((ref) => ref.startsWith('/js/') || ref.startsWith('/css/'));

if (assetRefs.length === 0) {
    fail('Built dashboard HTML does not reference any local JS or CSS assets.');
}

for (const ref of assetRefs) {
    const assetPath = join(dashboardRoot, ref.replace(/^\//, ''));
    if (!existsSync(assetPath)) {
        fail(`Missing built dashboard asset referenced by HTML: ${ref}`);
    }

    const content = readFileSync(assetPath, 'utf8');
    if (inlineEventPattern.test(content) || /\sstyle=["']/i.test(content)) {
        fail(`Built dashboard asset contains inline handlers/styles: ${ref}`);
    }
}

const serverFile = join(process.cwd(), 'dist/src/modules/dashboard/security-headers.js');
if (!existsSync(serverFile)) {
    fail('Missing built dashboard security headers module.');
}

const securityHeaders = readFileSync(serverFile, 'utf8');
if (securityHeaders.includes('unsafe-inline')) {
    fail('Built dashboard CSP still allows unsafe-inline.');
}

console.log(
    `[dashboard-smoke] Checked ${assetRefs.length} dashboard asset references in ${dirname(
        htmlPath,
    )}.`,
);
