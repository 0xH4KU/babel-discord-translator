import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/types.ts'],
            reporter: ['text', 'text-summary', 'html'],
            reportsDirectory: './coverage',
            thresholds: {
                'src/**/*.ts': {
                    statements: 85,
                    branches: 75,
                    functions: 88,
                    lines: 85,
                },
            },
        },
    },
});
