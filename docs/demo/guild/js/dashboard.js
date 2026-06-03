/**
 * Dashboard overview: stats loading, tab switching, health check, auto-refresh.
 */

let refreshTimer;

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

function renderGuildBudgetOverview(container, guilds) {
    container.replaceChildren();

    guilds.forEach((guild) => {
        const item = document.createElement('div');
        item.className = 'guild-budget-overview-item';

        const name = document.createElement('span');
        name.className = 'gbo-name';
        name.textContent = guild.name || 'Unknown server';
        if (!guild.isCustom && guild.budget > 0) {
            const tag = document.createElement('span');
            tag.className = 'gbo-tag';
            tag.textContent = 'global';
            name.append(' ', tag);
        }

        const cost = document.createElement('span');
        cost.className = 'gbo-cost';

        if (guild.budget <= 0) {
            cost.textContent =
                formatUsd(guild.totalCost) + ' · ' + formatOpsNumber(guild.requests) + ' req';

            const limit = document.createElement('span');
            limit.className = 'gbo-limit';
            limit.textContent = 'Unlimited';

            item.append(name, cost, limit);
            container.append(item);
            return;
        }

        cost.textContent = formatUsd(guild.totalCost) + ' / ' + formatUsd(guild.budget);

        const rawPct = (Number(guild.totalCost || 0) / Number(guild.budget || 1)) * 100;
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

        if (guild.exceeded) {
            const exceeded = document.createElement('span');
            exceeded.className = 'gbo-exceeded';
            exceeded.textContent = 'EXCEEDED';
            item.append(exceeded);
        }

        container.append(item);
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

        const pressure = Number(runtimePressure.inflight || 0) + Number(runtimePressure.queued || 0);
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

function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    document.querySelector(`[onclick="switchTab('${name}')"]`).classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
    if (name === 'settings') loadSettings();
    if (name === 'access') loadAccess();
    if (name === 'history') loadHistory();
    if (name === 'logs') loadLogs();
}

async function loadStats() {
    try {
        const res = await api('/stats');
        if (!res.ok) return;
        const d = await res.json();

        // Header
        document.getElementById('bot-name').textContent = d.bot.name.split('#')[0];
        document.getElementById('bot-tag').textContent = d.bot.name;
        if (d.bot.avatar) document.getElementById('bot-avatar').src = d.bot.avatar;

        renderOperations(d.operations);

        // Cost card
        document.getElementById('stat-cost').textContent = formatUsd(d.usage.totalCost);
        const parts = [];
        if (d.usage.inputTokens > 0) parts.push(formatTokens(d.usage.inputTokens) + ' in');
        if (d.usage.outputTokens > 0) parts.push(formatTokens(d.usage.outputTokens) + ' out');
        document.getElementById('stat-cost-breakdown').textContent =
            parts.join(' / ') || 'No usage today';

        // Budget overview — per-server
        const budgetCard = document.getElementById('budget-card');
        const guilds = d.guildBudgets || [];
        const hasAnyBudget = guilds.some((g) => g.budget > 0);

        if (hasAnyBudget || d.usage.dailyBudget > 0) {
            budgetCard.style.display = '';
            document.getElementById('budget-amount').textContent =
                'Total: ' + formatUsd(d.usage.totalCost);

            const container = document.getElementById('guild-budget-overview');
            if (guilds.length > 0) {
                renderGuildBudgetOverview(container, guilds);
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
        document.getElementById('stat-saved').textContent =
            d.cache.size + ' / ' + d.cache.maxSize + ' cached';
        document.getElementById('stat-uptime').textContent = formatUptime(d.bot.uptime);
        const memory = d.bot.memory || {};
        const rssMB = memory.rssMB || d.bot.memoryMB || '?';
        document.getElementById('stat-memory').textContent =
            'RSS ' + rssMB + ' MB · ' + d.bot.guilds + ' servers';
    } catch {}
}

async function checkApiHealth() {
    const badge = document.getElementById('api-health');
    badge.className = 'health-badge checking';
    badge.textContent = 'API';
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
            badge.textContent = 'API';
            badge.title = 'Ready · ' + (passingProvider?.latencyMs ?? '?') + 'ms';
        } else {
            badge.className = 'health-badge fail';
            badge.textContent = 'API';
            badge.title =
                failedProvider?.error || checks.configuration?.detail || 'Unknown error';
        }
    } catch {
        badge.className = 'health-badge fail';
        badge.textContent = 'API';
        badge.title = 'Connection failed';
    }
}

async function loadDashboard() {
    loadStats();
    checkApiHealth();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadStats, 5000);
}
