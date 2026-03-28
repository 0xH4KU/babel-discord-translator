import { performance } from 'perf_hooks';
import { configRepository } from '../src/modules/config/config-repository.js';
import { store } from '../src/store.js';

const iterations = Number.parseInt(process.argv[2] ?? '10000', 10);
if (!Number.isFinite(iterations) || iterations <= 0) {
    throw new Error(`Invalid iteration count: ${process.argv[2] ?? ''}`);
}

interface BenchmarkResult {
    label: string;
    elapsedMs: number;
    opsPerSecond: number;
}

function benchmark(label: string, fn: () => void): BenchmarkResult {
    const startedAt = performance.now();
    for (let i = 0; i < iterations; i += 1) {
        fn();
    }
    const elapsedMs = performance.now() - startedAt;

    return {
        label,
        elapsedMs,
        opsPerSecond: (iterations / elapsedMs) * 1000,
    };
}

function printResult(result: BenchmarkResult): void {
    console.log(
        `${result.label}: ${result.elapsedMs.toFixed(2)}ms total, ${result.opsPerSecond.toFixed(0)} ops/sec`,
    );
}

console.log(`Benchmarking runtime config access over ${iterations} iterations`);

const runtimeConfigResult = benchmark('configRepository.getRuntimeConfig()', () => {
    configRepository.getRuntimeConfig();
});
const fullSnapshotResult = benchmark('store.getAll()', () => {
    store.getAll();
});

printResult(runtimeConfigResult);
printResult(fullSnapshotResult);

console.log(
    `Speedup vs full snapshot: ${(fullSnapshotResult.elapsedMs / runtimeConfigResult.elapsedMs).toFixed(2)}x`,
);
