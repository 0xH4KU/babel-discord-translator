/**
 * Dashboard overview: stats loading, tab switching, health check, auto-refresh.
 */

let refreshTimer;
let statsLoading = false;
const STATS_REFRESH_MS = 15000;

function formatRatio(value) {
    return (Number(value || 0) * 100).toFixed(1) + '%';
}

function formatOpsNumber(value) {
    return Number(value || 0).toLocaleString();
}

function setStatusPillClass(element, status) {
    element.className = 'operations-pill';
    if (status) element.classList.add(status);
}

function createOpsMetric(label, value) {
    const metric = document.createElement('div');
    metric.className = 'operations-metric';

    const labelEl = document.createElement('span');
    labelEl.className = 'operations-metric-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('strong');
    valueEl.textContent = value;

    metric.append(labelEl, valueEl);
    return metric;
}

function createBudgetOverviewItem({
    name: itemName,
    tags = [],
    budget,
    totalCost,
    requests,
    exceeded,
}) {
    const item = document.createElement('div');
    item.className = 'guild-budget-overview-item';

    const name = document.createElement('span');
    name.className = 'gbo-name';
    name.textContent = itemName;

    tags.forEach((tagText) => {
        if (!tagText) return;
        const tag = document.createElement('span');
        tag.className = 'gbo-tag';
        tag.textContent = tagText;
        name.append(' ', tag);
    });

    const cost = document.createElement('span');
    cost.className = 'gbo-cost';

    if (budget <= 0) {
        cost.textContent = formatUsd(totalCost) + ' · ' + formatOpsNumber(requests) + ' req';

        const limit = document.createElement('span');
        limit.className = 'gbo-limit';
        limit.textContent = 'Unlimited';

        item.append(name, cost, limit);
        return item;
    }

    cost.textContent = formatUsd(totalCost) + ' / ' + formatUsd(budget);

    const rawPct = (Number(totalCost || 0) / Number(budget || 1)) * 100;
    const pct = Number.isFinite(rawPct) ? Math.min(Math.max(rawPct, 0), 100) : 0;
    const bar = document.createElement('div');
    bar.className = 'gbo-bar';

    const fill = document.createElement('div');
    fill.className = 'fill';
    if (pct > 90) {
        fill.classList.add('danger');
    } else if (pct > 60) {
        fill.classList.add('warning');
    }
    fill.style.width = pct + '%';
    bar.append(fill);

    item.append(name, cost, bar);

    if (exceeded) {
        const exceededLabel = document.createElement('span');
        exceededLabel.className = 'gbo-exceeded';
        exceededLabel.textContent = 'EXCEEDED';
        item.append(exceededLabel);
    }

    return item;
}

function renderGuildBudgetOverview(container, guilds) {
    container.replaceChildren();

    guilds.forEach((guild) => {
        container.append(
            createBudgetOverviewItem({
                name: guild.name || 'Unknown server',
                tags: !guild.isCustom && guild.budget > 0 ? ['global'] : [],
                budget: Number(guild.budget || 0),
                totalCost: Number(guild.totalCost || 0),
                requests: Number(guild.requests || 0),
                exceeded: Boolean(guild.exceeded),
            }),
        );
    });
}

function renderMonthlyBudgetOverview(container, usage, users = []) {
    container.replaceChildren();

    const budget = Number(usage?.monthlyBudget || 0);
    const totalCost = Number(usage?.totalCost || 0);
    const requests = Number(usage?.requests || 0);

    container.append(
        createBudgetOverviewItem({
            name: 'Global Safety Budget',
            budget,
            totalCost,
            requests,
            exceeded: Boolean(usage?.budgetExceeded),
        }),
    );

    users.forEach((user) => {
        const tags = [];
        if (user.pending) {
            tags.push('pending');
        } else if (!user.allowed) {
            tags.push('disabled');
        }
        tags.push(user.isCustom ? 'custom' : 'default');

        container.append(
            createBudgetOverviewItem({
                name: user.name || user.displayName || user.username || user.id || 'Unknown user',
                tags,
                budget: Number(user.budget || 0),
                totalCost: Number(user.totalCost || 0),
                requests: Number(user.requests || 0),
                exceeded: Boolean(user.exceeded),
            }),
        );
    });
}

function renderProviderCard(id, label, providerKey, provider, fallbackTotal, lastFallback) {
    const card = document.getElementById(id);
    if (!card) return;

    const data = provider || {};
    const enabled = Boolean(data.enabled);
    const configured = Boolean(data.configured);
    const status = enabled && configured ? 'ok' : enabled ? 'warn' : 'muted';
    const lastFallbackText =
        lastFallback && (lastFallback.from === providerKey || lastFallback.to === providerKey)
            ? 'Last fallback: ' + lastFallback.from + ' to ' + lastFallback.to
            : 'No recent fallback';

    card.replaceChildren();

    const header = document.createElement('div');
    header.className = 'operations-card-header';

    const title = document.createElement('h3');
    title.textContent = label;

    const pill = document.createElement('span');
    setStatusPillClass(pill, status);
    pill.textContent = enabled ? (configured ? 'Ready' : 'Setup needed') : 'Disabled';

    header.append(title, pill);

    const metrics = document.createElement('div');
    metrics.className = 'operations-metrics';
    metrics.append(
        createOpsMetric('Successes', formatOpsNumber(data.successTotal)),
        createOpsMetric('Failures', formatOpsNumber(data.failureTotal)),
        createOpsMetric('Fallback from', formatOpsNumber(data.fallbackFromTotal)),
        createOpsMetric('Fallback to', formatOpsNumber(data.fallbackToTotal)),
    );

    const sub = document.createElement('div');
    sub.className = 'operations-card-sub';
    sub.textContent =
        'Fallback attempts: ' + formatOpsNumber(fallbackTotal) + ' · ' + lastFallbackText;

    card.append(header, metrics, sub);
}

function renderOperations(operations) {
    const ops = operations || {};
    const providers = ops.providers || {};
    const runtimePressure = ops.runtimePressure || {};
    const budgetRisk = ops.budgetRisk || {};
    const guidance = ops.guidance || [];
    const lastFallback = ops.lastFallback || null;
    const fallbackTotal = ops.fallbackTotal;

    const modeEl = document.getElementById('ops-provider-mode');
    if (modeEl) {
        modeEl.textContent = ops.providerMode || '-';
    }

    renderProviderCard(
        'ops-provider-vertex',
        'Vertex AI',
        'vertex',
        providers.vertex || {},
        fallbackTotal,
        lastFallback,
    );
    renderProviderCard(
        'ops-provider-openai',
        'OpenAI-compatible',
        'openai',
        providers.openai || {},
        fallbackTotal,
        lastFallback,
    );

    const runtimeEl = document.getElementById('ops-runtime');
    if (runtimeEl) {
        runtimeEl.replaceChildren();

        const header = document.createElement('div');
        header.className = 'operations-card-header';

        const title = document.createElement('h3');
        title.textContent = 'Runtime';

        const pressure =
            Number(runtimePressure.inflight || 0) + Number(runtimePressure.queued || 0);
        const pill = document.createElement('span');
        setStatusPillClass(pill, pressure > 0 ? 'warn' : 'ok');
        pill.textContent = pressure > 0 ? 'Busy' : 'Clear';

        header.append(title, pill);

        const metrics = document.createElement('div');
        metrics.className = 'operations-metrics';
        metrics.append(
            createOpsMetric('Inflight', formatOpsNumber(runtimePressure.inflight)),
            createOpsMetric('Queued', formatOpsNumber(runtimePressure.queued)),
            createOpsMetric('Rejected', formatOpsNumber(runtimePressure.rejectedTotal)),
        );

        runtimeEl.append(header, metrics);
    }

    const budgetEl = document.getElementById('ops-budget-risk');
    if (budgetEl) {
        budgetEl.replaceChildren();

        const header = document.createElement('div');
        header.className = 'operations-card-header';

        const title = document.createElement('h3');
        title.textContent = 'Budget Risk';

        const exceeded = Number(budgetRisk.exceededCount || 0);
        const warnings = Number(budgetRisk.warningCount || 0);
        const pill = document.createElement('span');
        setStatusPillClass(pill, exceeded > 0 ? 'danger' : warnings > 0 ? 'warn' : 'ok');
        pill.textContent = exceeded > 0 ? 'Exceeded' : warnings > 0 ? 'Warning' : 'Normal';

        header.append(title, pill);

        const metrics = document.createElement('div');
        metrics.className = 'operations-metrics';
        metrics.append(
            createOpsMetric('Warnings', formatOpsNumber(warnings)),
            createOpsMetric('Exceeded', formatOpsNumber(exceeded)),
        );

        budgetEl.append(header, metrics);
    }

    const guidanceEl = document.getElementById('ops-guidance');
    if (guidanceEl) {
        guidanceEl.replaceChildren();

        guidance.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'operations-guidance-item ' + (item.severity || 'info');

            const title = document.createElement('strong');
            title.textContent = item.title || item.area || 'Action';

            const action = document.createElement('span');
            action.textContent = item.action || '';

            row.append(title, action);
            guidanceEl.append(row);
        });
    }
}

let currentDashboardTab = 'overview';
let currentActivityView = 'usage';
let currentAccessView = 'servers';

function switchTabFromSelect(name) {
    switchTab(name);
}

function switchActivityView(name) {
    currentActivityView = name === 'logs' ? 'logs' : 'usage';
    document.querySelectorAll('.secondary-nav-btn[data-activity-view]').forEach((button) => {
        button.classList.toggle('active', button.dataset.activityView === currentActivityView);
    });
    document.querySelectorAll('.activity-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'activity-' + currentActivityView);
    });
    if (currentActivityView === 'logs') loadLogs();
    else loadHistory();
}

function switchAccessView(name) {
    const target = document.getElementById('access-' + name);
    if (!target || target.hidden) return;
    currentAccessView = name;
    document.querySelectorAll('.secondary-nav-btn[data-access-view]').forEach((button) => {
        button.classList.toggle('active', button.dataset.accessView === name);
    });
    document.querySelectorAll('.access-panel').forEach((panel) => {
        panel.classList.toggle('active', panel === target);
    });
    const select = document.getElementById('access-view-select');
    if (select) select.value = name;
}

function configureAccessNavigation() {
    const preferred = hasDashboardCapability('guildAccess')
        ? 'servers'
        : hasDashboardCapability('pendingUserInstallOwners')
          ? 'users'
          : 'languages';
    if (
        !document.getElementById('access-' + currentAccessView) ||
        document.getElementById('access-' + currentAccessView).hidden
    ) {
        currentAccessView = preferred;
    }
    switchAccessView(currentAccessView);
}

function switchTab(name) {
    if (
        currentDashboardTab === 'settings' &&
        name !== 'settings' &&
        typeof confirmSettingsNavigation === 'function' &&
        !confirmSettingsNavigation()
    ) {
        const mobileNav = document.getElementById('mobile-main-nav');
        if (mobileNav) mobileNav.value = currentDashboardTab;
        return;
    }

    document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    const activeButton = document.querySelector(
        `.tab-btn[data-action="switchTab"][data-action-args='["${name}"]']`,
    );
    activeButton?.classList.add('active');
    activeButton?.setAttribute('aria-current', 'page');
    const target = document.getElementById('tab-' + name);
    if (!target) return;
    target.classList.add('active');
    currentDashboardTab = name;
    const mobileNav = document.getElementById('mobile-main-nav');
    if (mobileNav) mobileNav.value = name;
    if (name === 'settings') loadSettings();
    if (name === 'access') {
        configureAccessNavigation();
        loadAccess();
    }
    if (name === 'activity') switchActivityView(currentActivityView);
}

async function loadStats() {
    if (statsLoading) return;
    statsLoading = true;
    try {
        const res = await api('/stats');
        if (!res.ok) return;
        const d = await res.json();

        // Header
        document.getElementById('bot-name').textContent = d.bot.name.split('#')[0];
        document.getElementById('bot-tag').textContent = d.bot.name;
        document.getElementById('bot-avatar').src = d.bot.avatar || genAvatar(d.bot.name);

        renderOperations(d.operations);

        // Cost card
        document.getElementById('stat-cost').textContent = formatUsd(d.usage.totalCost);
        const parts = [];
        if (d.usage.inputTokens > 0) parts.push(formatTokens(d.usage.inputTokens) + ' in');
        if (d.usage.outputTokens > 0) parts.push(formatTokens(d.usage.outputTokens) + ' out');
        document.getElementById('stat-cost-breakdown').textContent =
            parts.join(' / ') || 'No usage this month';

        // Budget overview — per-server
        const budgetCard = document.getElementById('budget-card');
        const guilds = d.guildBudgets || [];
        const hasGuildBudgetCapability = hasDashboardCapability('guildAccess');
        const hasUserBudgetCapability = hasDashboardCapability('userAccess');
        const hasAnyBudget = guilds.some((g) => g.budget > 0);
        const hasMonthlyBudget = Number(d.usage.monthlyBudget || 0) > 0;
        const hasBudgetUsage =
            Number(d.usage.totalCost || 0) > 0 || Number(d.usage.requests || 0) > 0;

        if (
            (hasGuildBudgetCapability && (hasAnyBudget || hasMonthlyBudget)) ||
            (hasUserBudgetCapability && (hasMonthlyBudget || hasBudgetUsage))
        ) {
            budgetCard.style.display = '';
            document.getElementById('budget-amount').textContent =
                'Total: ' + formatUsd(d.usage.totalCost);

            const container = document.getElementById('guild-budget-overview');
            if (hasGuildBudgetCapability && guilds.length > 0) {
                renderGuildBudgetOverview(container, guilds);
            } else if (hasUserBudgetCapability) {
                renderMonthlyBudgetOverview(container, d.usage, d.userBudgets || []);
            } else {
                container.replaceChildren();
            }
        } else {
            budgetCard.style.display = 'none';
        }

        // Stats cards
        document.getElementById('stat-total').textContent = d.translations.total;
        document.getElementById('stat-total-detail').textContent =
            d.translations.apiCalls + ' API calls';
        document.getElementById('stat-hitrate').textContent = formatRatio(
            d.translations.cacheHitRate,
        );
        const ocrCache = d.ocrCache || { size: 0, maxSize: 0, hitRate: 'N/A' };
        document.getElementById('stat-saved').textContent =
            d.cache.size +
            ' / ' +
            d.cache.maxSize +
            ' translations · ' +
            ocrCache.size +
            ' / ' +
            ocrCache.maxSize +
            ' OCR (' +
            ocrCache.hitRate +
            ')';
        document.getElementById('stat-uptime').textContent = formatUptime(d.bot.uptime);
        const memory = d.bot.memory || {};
        const rssMB = memory.rssMB || d.bot.memoryMB || '?';
        document.getElementById('stat-memory').textContent =
            'RSS ' + rssMB + ' MB · ' + getDashboardUsageScopeLabel(d);
    } catch {
    } finally {
        statsLoading = false;
    }
}

async function checkApiHealth() {
    const badge = document.getElementById('api-health');
    badge.className = 'health-badge checking';
    badge.textContent = 'Checking';
    badge.title = 'Checking...';
    try {
        const res = await api('/health');
        const data = await res.json();
        const checks = data.checks || {};
        const providerChecks = [checks.vertexAi, checks.openAi].filter(
            (check) => check && check.status !== 'skip',
        );
        const passingProvider = providerChecks.find((check) => check.status === 'pass');
        const failedProvider = providerChecks.find((check) => check.status === 'fail');
        if (data.healthy) {
            badge.className = 'health-badge ok';
            badge.textContent = 'Ready';
            badge.title = 'Ready · ' + (passingProvider?.latencyMs ?? '?') + 'ms';
        } else {
            badge.className = 'health-badge fail';
            badge.textContent = 'Issue';
            badge.title = failedProvider?.error || checks.configuration?.detail || 'Unknown error';
        }
    } catch {
        badge.className = 'health-badge fail';
        badge.textContent = 'Offline';
        badge.title = 'Connection failed';
    }
}

function setupDoctorStatusLabel(status) {
    if (status === 'pass') return 'PASS';
    if (status === 'warn') return 'WARN';
    if (status === 'fail') return 'FAIL';
    return 'SKIP';
}

function renderSetupDoctorReport(report) {
    const container = document.getElementById('setup-doctor-results');
    if (!container) return;

    container.replaceChildren();
    (report.checks || []).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'setup-doctor-row ' + (item.status || 'skipped');

        const status = document.createElement('span');
        status.className = 'setup-doctor-status';
        status.textContent = setupDoctorStatusLabel(item.status);

        const body = document.createElement('div');
        body.className = 'setup-doctor-body';

        const title = document.createElement('strong');
        title.textContent = item.title || item.id || 'Check';

        const detail = document.createElement('span');
        detail.textContent = item.detail || '';

        body.append(title, detail);
        if (item.action) {
            const action = document.createElement('em');
            action.textContent = item.action;
            body.append(action);
        }

        row.append(status, body);
        container.append(row);
    });
}

async function runSetupDoctor() {
    const button = document.getElementById('setup-doctor-run');
    const container = document.getElementById('setup-doctor-results');
    if (button) {
        button.disabled = true;
        button.textContent = 'Checking...';
    }
    if (container) container.setAttribute('aria-busy', 'true');

    try {
        const res = await api('/setup-doctor/run', { method: 'POST' });
        const report = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(report.error || 'Setup Doctor failed');
        renderSetupDoctorReport(report);
        const hasWarnings = (report.checks || []).some((item) => item.status === 'warn');
        const message = report.ok
            ? hasWarnings
                ? 'Setup Doctor completed with warnings'
                : 'Setup Doctor passed'
            : 'Setup Doctor found issues';
        showToast(message, !report.ok);
    } catch (error) {
        const message = error?.message || 'Setup Doctor failed';
        renderSetupDoctorReport({
            checks: [
                {
                    id: 'setup-doctor',
                    status: 'fail',
                    title: 'Setup Doctor',
                    detail: message,
                },
            ],
        });
        showToast(message, true);
    } finally {
        if (container) container.setAttribute('aria-busy', 'false');
        if (button) {
            button.disabled = false;
            button.textContent = 'Run Doctor';
        }
    }
}

async function loadDashboard() {
    loadStats();
    checkApiHealth();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (!document.hidden) loadStats();
    }, STATS_REFRESH_MS);
}
