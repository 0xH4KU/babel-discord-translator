import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('Vision limit dashboard controls', () => {
    it('validates and saves an integer limit through the existing budget API', async () => {
        const source = readFileSync('src/public/js/vision-limits.js', 'utf-8');
        const input = { value: '1.5' };
        const requests: Array<{ path: string; body?: string }> = [];
        const toasts: Array<{ message: string; error?: boolean }> = [];
        const context = {
            document: {
                getElementById() {
                    return input;
                },
            },
            escapeHtml: String,
            actionAttrs() {
                return '';
            },
            async api(path: string, options: { body?: string } = {}) {
                requests.push({ path, body: options.body });
                return {
                    ok: true,
                    json: async () => ({
                        'guild-1': { vision: { images: 3, limit: 12 } },
                    }),
                };
            },
            showToast(message: string, error?: boolean) {
                toasts.push({ message, error });
            },
            renderGuilds() {},
        };

        vm.createContext(context);
        vm.runInContext(source, context);

        await vm.runInContext("saveVisionLimit('guild', 'guild-1')", context);
        expect(requests).toHaveLength(0);
        expect(toasts.at(-1)).toEqual({
            message: 'Vision limit must be a non-negative integer',
            error: true,
        });

        input.value = '12';
        await vm.runInContext("saveVisionLimit('guild', 'guild-1')", context);
        expect(requests[0]).toEqual({
            path: '/guild-budgets/guild-1',
            body: JSON.stringify({ visionMonthlyImageLimit: 12 }),
        });
        expect(requests[1].path).toBe('/guild-budgets');
    });
});
