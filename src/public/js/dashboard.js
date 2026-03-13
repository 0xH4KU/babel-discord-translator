
/**
 * Dashboard overview: stats loading, tab switching, health check, auto-refresh.
 */

let refreshTimer;

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

    // Budget bar
    const budgetCard = document.getElementById('budget-card');
    if (d.usage.dailyBudget > 0) {
      budgetCard.style.display = '';
      const pct = d.usage.budgetUsedPercent;
      document.getElementById('budget-amount').textContent =
        formatUsd(d.usage.totalCost) + ' / ' + formatUsd(d.usage.dailyBudget);

      const fill = document.getElementById('budget-fill');
      fill.style.width = Math.min(pct, 100) + '%';
      fill.className = 'fill' + (pct > 90 ? ' danger' : pct > 60 ? ' warning' : '');

      document.getElementById('budget-tokens').textContent =
        formatTokens(d.usage.inputTokens + d.usage.outputTokens) + ' tokens';
      document.getElementById('budget-requests').textContent =
        d.usage.requests + ' requests today';
    } else {
      budgetCard.style.display = 'none';
    }

    // Stats cards
    document.getElementById('stat-total').textContent = d.translations.total;
    document.getElementById('stat-hitrate').textContent = d.cache.hitRate;
    document.getElementById('stat-saved').textContent =
      d.cache.size + ' / ' + d.cache.maxSize + ' cached' +
      (d.cache.hits > 0 ? ' · ' + d.cache.hits + ' hits' : '');
    document.getElementById('stat-uptime').textContent = formatUptime(d.bot.uptime);
    document.getElementById('stat-memory').textContent = d.bot.memoryMB + ' MB · ' + d.bot.guilds + ' servers';
  } catch { }
}

async function checkApiHealth() {
  const badge = document.getElementById('api-health');
  badge.className = 'health-badge checking';
  badge.textContent = '⟳ API';
  try {
    const res = await api('/health');
    const data = await res.json();
    if (data.healthy) {
      badge.className = 'health-badge ok';
      badge.textContent = '✓ API ' + data.latencyMs + 'ms';
    } else {
      badge.className = 'health-badge fail';
      badge.textContent = '✗ API';
      badge.title = data.error || 'Unknown error';
    }
  } catch {
    badge.className = 'health-badge fail';
    badge.textContent = '✗ API';
  }
}

async function loadDashboard() {
  loadStats();
  checkApiHealth();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadStats, 5000);
}
