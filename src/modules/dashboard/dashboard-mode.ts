export type DashboardMode = 'full' | 'health-only' | 'off';

export function resolveDashboardMode(value = process.env.BABEL_DASHBOARD_MODE): DashboardMode {
    const normalized = value?.trim().toLowerCase();

    if (normalized === 'health-only' || normalized === 'off' || normalized === 'full') {
        return normalized;
    }

    return 'full';
}
