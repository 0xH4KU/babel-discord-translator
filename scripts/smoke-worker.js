import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(rootDir, 'node_modules', '.bin', 'wrangler');
const config = join(rootDir, 'apps', 'babel-worker', 'wrangler.jsonc');
const stateDir = mkdtempSync(join(tmpdir(), 'babel-worker-smoke-'));
const output = [];

function fail(message) {
    throw new Error(`[worker-smoke] ${message}`);
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Could not allocate a local port.')));
                return;
            }
            server.close(() => resolve(address.port));
        });
    });
}

async function waitForWorker(url, child) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            fail(`Wrangler exited early.\n${output.join('')}`);
        }
        try {
            const response = await fetch(`${url}/livez`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail(`Wrangler did not become ready.\n${output.join('')}`);
}

function stop(child) {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

const migration = spawnSync(
    wrangler,
    [
        'd1',
        'migrations',
        'apply',
        'babel-worker',
        '--local',
        '--persist-to',
        stateDir,
        '--config',
        config,
    ],
    { cwd: rootDir, encoding: 'utf8', env: { ...process.env, CI: '1' } },
);
if (migration.status !== 0) {
    fail(`D1 migrations failed.\n${migration.stdout}${migration.stderr}`);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(
    wrangler,
    [
        'dev',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--persist-to',
        stateDir,
        '--config',
        config,
        '--log-level',
        'error',
    ],
    { cwd: rootDir, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stdout.on('data', (chunk) => output.push(chunk.toString()));
child.stderr.on('data', (chunk) => output.push(chunk.toString()));

try {
    await waitForWorker(baseUrl, child);

    const page = await fetch(`${baseUrl}/`);
    if (!page.ok) fail(`Dashboard returned HTTP ${page.status}.`);
    if (!page.headers.get('content-security-policy')) fail('Dashboard CSP header is missing.');
    if (page.headers.get('x-frame-options') !== 'DENY') fail('Dashboard frame policy is missing.');
    const html = await page.text();
    const cssPath = html.match(/href="(\/css\/[^"]+\.css)"/)?.[1];
    if (!cssPath) fail('Dashboard HTML does not reference a CSS asset.');

    const css = await fetch(`${baseUrl}${cssPath}`);
    if (!css.ok) fail(`Dashboard CSS returned HTTP ${css.status}.`);
    if (css.headers.get('cache-control') !== 'public, max-age=31536000, immutable') {
        fail('Hashed dashboard CSS is missing immutable caching.');
    }

    const auth = await fetch(`${baseUrl}/api/auth/check`);
    if (!auth.ok) fail(`Dashboard auth check returned HTTP ${auth.status}.`);
    const authPayload = await auth.json();
    if (authPayload.authenticated !== false) fail('Fresh dashboard session should be signed out.');

    const readiness = await fetch(`${baseUrl}/readyz`);
    const readinessPayload = await readiness.json();
    if (readinessPayload.checks?.database !== true) {
        fail('Worker readiness did not recognize the migrated D1 schema.');
    }

    console.log(`[worker-smoke] Wrangler, D1 migrations, and Assets passed on ${baseUrl}.`);
} finally {
    await stop(child);
    rmSync(stateDir, { force: true, recursive: true });
}
