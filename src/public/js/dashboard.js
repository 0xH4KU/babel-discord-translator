
/**
 * Dashboard overview: stats loading, tab switching, health check, auto-refresh.
 */

let refreshTimer;

function formatRatio(value) {
  return (Number(value || 0) * 100).toFixed(1) + '%';
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
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

    // Cost card
    document.getElementById('stat-cost').textContent = formatUsd(d.usage.totalCost);
    const parts = [];
    if (d.usage.inputTokens > 0) parts.push(formatTokens(d.usage.inputTokens) + ' in');
    if (d.usage.outputTokens > 0) parts.push(formatTokens(d.usage.outputTokens) + ' out');
    document.getElementById('stat-cost-breakdown').textContent = parts.join(' / ') || 'No usage today';

    // Budget overview — per-server
    const budgetCard = document.getElementById('budget-card');
    const guilds = d.guildBudgets || [];
    const hasAnyBudget = guilds.some(g => g.budget > 0);

    if (hasAnyBudget || d.usage.dailyBudget > 0) {
      budgetCard.style.display = '';
      document.getElementById('budget-amount').textContent =
        'Total: ' + formatUsd(d.usage.totalCost);

      const container = document.getElementById('guild-budget-overview');
      if (guilds.length > 0) {
        container.innerHTML = guilds.map(g => {
          if (g.budget <= 0) {
            return `<div class="guild-budget-overview-item">
              <span class="gbo-name">${g.name}</span>
              <span class="gbo-cost">${formatUsd(g.totalCost)} · ${g.requests} req</span>
              <span class="gbo-limit">Unlimited</span>
            </div>`;
          }
          const pct = Math.min((g.totalCost / g.budget) * 100, 100);
          const barClass = pct > 90 ? ' danger' : pct > 60 ? ' warning' : '';
          return `<div class="guild-budget-overview-item">
            <span class="gbo-name">${g.name}${g.isCustom ? '' : ' <span class="gbo-tag">global</span>'}</span>
            <span class="gbo-cost">${formatUsd(g.totalCost)} / ${formatUsd(g.budget)}</span>
            <div class="gbo-bar"><div class="fill${barClass}" style="width:${pct}%"></div></div>
            ${g.exceeded ? '<span class="gbo-exceeded">EXCEEDED</span>' : ''}
          </div>`;
        }).join('');
      } else {
        container.innerHTML = '';
      }
    } else {
      budgetCard.style.display = 'none';
    }

    // Stats cards
    document.getElementById('stat-total').textContent = d.translations.total;
    document.getElementById('stat-total-detail').textContent =
      d.translations.apiCalls + ' API calls · ' +
      formatRatio(d.translations.failureRate) + ' failure · ' +
      d.translations.budgetExceeded + ' budget blocks';
    document.getElementById('stat-hitrate').textContent = formatRatio(d.translations.cacheHitRate);
    document.getElementById('stat-saved').textContent =
      d.cache.size + ' / ' + d.cache.maxSize + ' cached' +
      (d.metrics.translationCacheHitsTotal > 0 ? ' · ' + d.metrics.translationCacheHitsTotal + ' hits' : '') +
      (d.translations.webhookRecreated > 0 ? ' · ' + d.translations.webhookRecreated + ' webhook resets' : '');
    document.getElementById('stat-uptime').textContent = formatUptime(d.bot.uptime);
    document.getElementById('stat-memory').textContent =
      d.bot.memoryMB + ' MB · ' +
      d.bot.guilds + ' servers · ' +
      d.runtime.inflight + '/' + d.runtime.limits.maxConcurrent + ' running · ' +
      d.runtime.queued + ' queued · ' +
      d.runtime.rejectedTotal + ' shed';
  } catch { }
}

async function checkApiHealth() {
  const badge = document.getElementById('api-health');
  badge.className = 'health-badge checking';
  badge.textContent = 'API';
  badge.title = 'Checking...';
  try {
    const res = await api('/health');
    const data = await res.json();
    if (data.healthy) {
      badge.className = 'health-badge ok';
      badge.textContent = 'API';
      badge.title = 'Ready · ' + (data.vertexAi.latencyMs ?? '?') + 'ms';
    } else {
      badge.className = 'health-badge fail';
      badge.textContent = 'API';
      badge.title = data.vertexAi.error || data.checks.configuration.detail || 'Unknown error';
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
