import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function budgetControls() {
    const input = { value: '1.5' };
    const api = vi.fn(async (_path: string, _options: { body?: string } = {}) => ({
        ok: true,
        json: async () => ({}),
    }));
    const showToast = vi.fn();
    const context = vm.createContext({
        document: { getElementById: () => input },
        hasDashboardCapability: () => true,
        api,
        showToast,
    });
    const source = ['access', 'vision-limits']
        .map((name) => readFileSync(`src/public/js/${name}.js`, 'utf-8'))
        .join('\n');
    vm.runInContext(source + '\nrenderGuilds = () => {}; renderAllowedUsers = () => {};', context);
    return { input, api, showToast, run: (code: string) => vm.runInContext(code, context) };
}

describe('shared budget dashboard controls', () => {
    it('validates and saves an integer Vision limit through the budget API', async () => {
        const { input, api, showToast, run } = budgetControls();
        await run("saveVisionLimit('guild', 'guild-1')");
        expect(api).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenLastCalledWith(
            'Vision limit must be a non-negative integer',
            true,
        );

        input.value = '12';
        await run("saveVisionLimit('guild', 'guild-1')");
        expect(api).toHaveBeenNthCalledWith(1, '/guild-budgets/guild-1', {
            method: 'POST',
            body: JSON.stringify({ visionMonthlyImageLimit: 12 }),
        });
        expect(api).toHaveBeenNthCalledWith(2, '/guild-budgets');
        expect(showToast).toHaveBeenLastCalledWith('Vision limit saved');
    });

    it.each(['Guild', 'User'])(
        'saves zero and resets an empty %s budget using the same flow',
        async (scope) => {
            const { input, api, run } = budgetControls();
            input.value = '0';
            await run(`save${scope}Budget('123')`);
            expect(api).toHaveBeenNthCalledWith(1, `/${scope.toLowerCase()}-budgets/123`, {
                method: 'POST',
                body: JSON.stringify({ monthlyBudgetUsd: 0 }),
            });
            expect(api).toHaveBeenNthCalledWith(2, `/${scope.toLowerCase()}-budgets`);
            input.value = '';
            await run(`save${scope}Budget('123')`);
            expect(api).toHaveBeenNthCalledWith(3, `/${scope.toLowerCase()}-budgets/123`, {
                method: 'POST',
                body: JSON.stringify({ monthlyBudgetUsd: null }),
            });
        },
    );

    it('rejects invalid amounts and preserves state when the server refuses a change', async () => {
        const { input, api, showToast, run } = budgetControls();
        for (const value of ['12junk', '-1', 'Infinity']) {
            input.value = value;
            await run("saveUserBudget('123')");
        }
        expect(api).not.toHaveBeenCalled();
        input.value = '12';
        api.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Rejected' }) });
        await run("saveUserBudget('123')");
        expect(api).toHaveBeenCalledOnce();
        expect(showToast).toHaveBeenLastCalledWith('Rejected', true);
    });
});
