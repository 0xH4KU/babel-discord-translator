/* eslint-disable no-unused-vars */

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? 'var(--red)' : 'var(--green)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401 && path !== '/login' && path !== '/auth/check') {
    show('login-view');
    throw new Error('Session expired');
  }
  return res;
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function formatUsd(n) {
  if (n === 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ========== Login ==========

async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  const res = await api('/login', {
    method: 'POST',
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    await checkSetup();
  } else {
    document.getElementById('login-error').textContent = 'Wrong password';
  }
}

async function doLogout() {
  await api('/logout', { method: 'POST' });
  if (refreshTimer) clearInterval(refreshTimer);
  show('login-view');
}

document.getElementById('login-pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

// ========== Wizard ==========

let wizStep = 0;

function wizUpdateDots() {
  for (let i = 0; i < 3; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.className = 'step-dot';
    if (i < wizStep) dot.classList.add('done');
    if (i === wizStep) dot.classList.add('active');
  }
  document.querySelectorAll('.wizard-step').forEach((s, i) => {
    s.classList.toggle('active', i === wizStep);
  });
}

function wizNext() {
  if (wizStep === 0) {
    const key = document.getElementById('wiz-apikey').value.trim();
    const proj = document.getElementById('wiz-project').value.trim();
    if (!key || !proj) {
      showToast('Please fill in API Key and Project ID', true);
      return;
    }
  }
  wizStep++;
  wizUpdateDots();
}

function wizPrev() {
  wizStep--;
  wizUpdateDots();
}

async function wizFinish() {
  const cfg = {
    vertexAiApiKey: document.getElementById('wiz-apikey').value.trim(),
    gcpProject: document.getElementById('wiz-project').value.trim(),
    gcpLocation: document.getElementById('wiz-location').value.trim() || 'global',
    geminiModel: document.getElementById('wiz-model').value.trim(),
    cooldownSeconds: parseInt(document.getElementById('wiz-cooldown').value) || 5,
    cacheMaxSize: parseInt(document.getElementById('wiz-cache').value) || 2000,
    setupComplete: true,
  };

  const res = await api('/config', {
    method: 'POST',
    body: JSON.stringify(cfg),
  });

  if (res.ok) {
    showToast('Setup complete!');
    show('dashboard-view');
    loadDashboard();
  } else {
    showToast('Save failed', true);
  }
}

// ========== Dashboard ==========

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

// ========== Pagination Helper ==========

function renderPagination(targetId, { total, page, pageSize, onPageChange, onSizeChange }) {
  const totalPages = Math.ceil(total / pageSize) || 1;
  const container = document.getElementById(targetId);
  if (total <= pageSize) { container.innerHTML = ''; return; }

  let btns = '';
  btns += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${page - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - page) > 1) {
      if (i === 3 || i === totalPages - 2) btns += '<span style="padding:0 0.3rem">…</span>';
      continue;
    }
    btns += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="${onPageChange}(${i})">${i}</button>`;
  }
  btns += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${page + 1})">›</button>`;

  container.innerHTML = `<div class="pagination">
    <div class="page-info">
      <span>${total} items</span>
      <select onchange="${onSizeChange}(+this.value)">
        ${[15, 25, 50].map(s => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}/page</option>`).join('')}
      </select>
    </div>
    <div class="page-btns">${btns}</div>
  </div>`;
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

let currentConfig = {};
let allGuilds = [];
let guildPage = 1, guildPageSize = 15;
let prefsPage = 1, prefsPageSize = 15;
let logPage = 1, logPageSize = 15;

async function loadAccess() {
  try {
    const [cfgRes, guildRes] = await Promise.all([api('/config'), api('/guilds')]);
    currentConfig = await cfgRes.json();
    allGuilds = await guildRes.json();
    renderGuilds();
    loadUserPrefs();
  } catch { }
}

async function loadSettings() {
  try {
    const [cfgRes, guildRes] = await Promise.all([api('/config'), api('/guilds')]);
    currentConfig = await cfgRes.json();
    allGuilds = await guildRes.json();

    document.getElementById('cfg-apikey').value = '';
    document.getElementById('cfg-apikey').placeholder =
      currentConfig.hasApiKey ? currentConfig.vertexAiApiKey + ' (leave blank to keep)' : 'Not set';
    document.getElementById('cfg-project').value = currentConfig.gcpProject || '';
    document.getElementById('cfg-location').value = currentConfig.gcpLocation || 'global';
    document.getElementById('cfg-model').value = currentConfig.geminiModel || '';
    document.getElementById('cfg-cooldown').value = currentConfig.cooldownSeconds || 5;
    document.getElementById('cfg-cache').value = currentConfig.cacheMaxSize || 2000;
    document.getElementById('cfg-input-price').value = currentConfig.inputPricePerMillion || 0;
    document.getElementById('cfg-output-price').value = currentConfig.outputPricePerMillion || 0;
    document.getElementById('cfg-budget').value = currentConfig.dailyBudgetUsd || 0;
    document.getElementById('cfg-prompt').value = currentConfig.translationPrompt || '';
  } catch { }
}

// Track manually added guild IDs separately
let manualGuildIds = [];

function renderGuilds() {
  const container = document.getElementById('guild-list');
  const allowed = currentConfig.allowedGuildIds || [];

  const knownIds = new Set(allGuilds.map(g => g.id));
  manualGuildIds = allowed.filter(id => !knownIds.has(id));

  const allItems = [
    ...allGuilds.map(g => ({ ...g, manual: false })),
    ...manualGuildIds.map(id => ({ id, name: id, manual: true })),
  ];

  if (allItems.length === 0) {
    container.innerHTML = '<div class="no-guilds">Bot is not in any servers. Paste a Guild ID below to add manually.</div>';
    document.getElementById('guild-pagination').innerHTML = '';
    return;
  }

  const start = (guildPage - 1) * guildPageSize;
  const pageItems = allItems.slice(start, start + guildPageSize);

  const html = pageItems.map(g => {
    const checked = allowed.includes(g.id);
    if (g.manual) {
      return `<div class="guild-item">
        <img src="${genAvatar(g.id)}" alt="">
        <span class="guild-name" style="font-family:monospace;font-size:0.8rem">${g.id}</span>
        <span class="guild-members">manually added</span>
        <label class="toggle"><input type="checkbox" data-guild-id="${g.id}" checked><span class="slider"></span></label>
        <button class="btn-danger" onclick="removeManualGuild('${g.id}')">✕</button>
      </div>`;
    }
    return `<div class="guild-item">
      <img src="${g.icon || genAvatar(g.name || g.id)}" alt="">
      <span class="guild-name">${g.name || g.id}</span>
      <span class="guild-members">${g.memberCount ?? '?'} members</span>
      <label class="toggle"><input type="checkbox" data-guild-id="${g.id}" ${checked ? 'checked' : ''}><span class="slider"></span></label>
    </div>`;
  }).join('');

  container.innerHTML = html;

  renderPagination('guild-pagination', {
    total: allItems.length,
    page: guildPage,
    pageSize: guildPageSize,
    onPageChange: 'setGuildPage',
    onSizeChange: 'setGuildPageSize',
  });
}

function setGuildPage(p) { guildPage = p; renderGuilds(); }
function setGuildPageSize(s) { guildPageSize = s; guildPage = 1; renderGuilds(); }

function genAvatar(name) {
  const c = (name || '?')[0];
  return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22><rect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%2336393f%22/><text x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22>${c}</text></svg>`;
}

function addManualGuild() {
  const input = document.getElementById('add-guild-input');
  const id = input.value.trim();
  if (!id || !/^\d+$/.test(id)) {
    showToast('Please enter a valid Guild ID (numbers only)', true);
    return;
  }
  if (!currentConfig.allowedGuildIds) currentConfig.allowedGuildIds = [];
  if (!currentConfig.allowedGuildIds.includes(id)) {
    currentConfig.allowedGuildIds.push(id);
  }
  input.value = '';
  renderGuilds();
  showToast('Guild added — click Save to apply');
}

function removeManualGuild(id) {
  if (!currentConfig.allowedGuildIds) return;
  currentConfig.allowedGuildIds = currentConfig.allowedGuildIds.filter(g => g !== id);
  renderGuilds();
  showToast('Guild removed — click Save to apply');
}

async function saveSettings() {
  const updates = {};

  const newKey = document.getElementById('cfg-apikey').value.trim();
  if (newKey) updates.vertexAiApiKey = newKey;

  updates.gcpProject = document.getElementById('cfg-project').value.trim();
  updates.gcpLocation = document.getElementById('cfg-location').value.trim() || 'global';
  updates.geminiModel = document.getElementById('cfg-model').value.trim();
  updates.cooldownSeconds = parseInt(document.getElementById('cfg-cooldown').value) || 5;
  updates.cacheMaxSize = parseInt(document.getElementById('cfg-cache').value) || 2000;
  updates.inputPricePerMillion = parseFloat(document.getElementById('cfg-input-price').value) || 0;
  updates.outputPricePerMillion = parseFloat(document.getElementById('cfg-output-price').value) || 0;
  updates.dailyBudgetUsd = parseFloat(document.getElementById('cfg-budget').value) || 0;
  updates.translationPrompt = document.getElementById('cfg-prompt').value;

  // Whitelist: always save the explicit list of enabled IDs
  const checkboxes = document.querySelectorAll('[data-guild-id]');
  updates.allowedGuildIds = [...checkboxes]
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.guildId);

  const res = await api('/config', {
    method: 'POST',
    body: JSON.stringify(updates),
  });

  if (res.ok) {
    showToast('Settings saved!');
    loadSettings();
  } else {
    showToast('Save failed', true);
  }
}

// ========== Init ==========

let refreshTimer;

async function loadDashboard() {
  loadStats();
  checkApiHealth();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadStats, 5000);
}

async function checkSetup() {
  const res = await api('/setup-status');
  const { complete } = await res.json();
  if (complete) {
    show('dashboard-view');
    loadDashboard();
  } else {
    show('wizard-view');
  }
}

async function init() {
  const res = await api('/auth/check');
  const { authenticated } = await res.json();
  if (authenticated) {
    await checkSetup();
  } else {
    show('login-view');
  }
}

// ========== History ==========

let historyPage = 1, historyPageSize = 15;
let allHistoryData = [];

async function loadHistory() {
  try {
    const res = await api('/usage/history');
    if (!res.ok) return;
    allHistoryData = await res.json();
    historyPage = 1;
    renderHistory();
  } catch { }
}

function renderHistory() {
  const container = document.getElementById('history-table-container');
  const chart = document.getElementById('history-chart');

  if (allHistoryData.length === 0) {
    container.innerHTML = '<div class="empty-state">No history data yet. Usage is archived daily.</div>';
    chart.innerHTML = '';
    document.getElementById('history-summary').textContent = '';
    document.getElementById('history-pagination').innerHTML = '';
    return;
  }

  const totalCost = allHistoryData.reduce((sum, d) => sum + d.cost, 0);
  const totalReqs = allHistoryData.reduce((sum, d) => sum + d.requests, 0);
  document.getElementById('history-summary').textContent =
    `${allHistoryData.length} days · ${totalReqs} requests · ${formatUsd(totalCost)} total`;

  // Bar chart (always shows all data)
  const maxReqs = Math.max(...allHistoryData.map(d => d.requests), 1);
  chart.innerHTML = allHistoryData.map(d => {
    const h = Math.max((d.requests / maxReqs) * 100, 3);
    return `<div class="bar" style="height:${h}%" data-tip="${d.date}: ${d.requests} reqs · ${formatUsd(d.cost)}"></div>`;
  }).join('');

  // Table with pagination (newest first)
  const reversed = [...allHistoryData].reverse();
  const start = (historyPage - 1) * historyPageSize;
  const pageData = reversed.slice(start, start + historyPageSize);

  let html = `<table class="data-table">
    <thead><tr>
      <th>Date</th><th>Requests</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th>
    </tr></thead><tbody>`;

  for (const d of pageData) {
    html += `<tr>
      <td class="mono">${d.date}</td>
      <td>${d.requests}</td>
      <td class="dim">${formatTokens(d.inputTokens)}</td>
      <td class="dim">${formatTokens(d.outputTokens)}</td>
      <td>${formatUsd(d.cost)}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  renderPagination('history-pagination', {
    total: reversed.length,
    page: historyPage,
    pageSize: historyPageSize,
    onPageChange: 'setHistoryPage',
    onSizeChange: 'setHistoryPageSize',
  });
}

function setHistoryPage(p) { historyPage = p; renderHistory(); }
function setHistoryPageSize(s) { historyPageSize = s; historyPage = 1; renderHistory(); }

// ========== Logs ==========

let currentLogFilter;

function setLogFilter(filter) {
  currentLogFilter = filter;
  document.querySelectorAll('.log-filter-btn').forEach((btn, i) => {
    const filters = [undefined, 'translation', 'error'];
    btn.classList.toggle('active', filters[i] === filter);
  });
  loadLogs();
}

let allLogData = [];

async function loadLogs() {
  try {
    const filterParam = currentLogFilter ? `&filter=${currentLogFilter}` : '';
    const res = await api('/logs?count=200' + filterParam);
    if (!res.ok) return;
    allLogData = await res.json();
    logPage = 1;
    renderLogs();
  } catch { }
}

function renderLogs() {
  const container = document.getElementById('log-table-container');
  document.getElementById('log-count').textContent = allLogData.length + ' entries';

  if (allLogData.length === 0) {
    container.innerHTML = '<div class="empty-state">No entries found.</div>';
    document.getElementById('log-pagination').innerHTML = '';
    return;
  }

  const start = (logPage - 1) * logPageSize;
  const pageData = allLogData.slice(start, start + logPageSize);

  let html = `<table class="data-table">
    <thead><tr>
      <th>Time</th><th>Type</th><th>Server</th><th>User</th><th>Detail</th><th>Source</th>
    </tr></thead><tbody>`;

  for (const e of pageData) {
    const time = new Date(e.timestamp).toLocaleTimeString();
    if (e.type === 'error') {
      const errMsg = (e.error || '').replace(/</g, '&lt;');
      html += `<tr style="background:rgba(240,71,71,0.04)">
        <td class="mono dim">${time}</td>
        <td><span class="badge badge-red">Error</span></td>
        <td>${e.guildName}</td>
        <td class="dim">${e.userTag}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${errMsg}">${errMsg}</td>
        <td class="dim">${e.command || ''}</td>
      </tr>`;
    } else {
      const preview = (e.contentPreview || '').replace(/</g, '&lt;');
      const sourceBadge = e.cached
        ? '<span class="badge badge-yellow">Cache</span>'
        : '<span class="badge badge-green">API</span>';
      const langLabel = e.targetLanguage === 'auto' ? 'auto' : e.targetLanguage;
      const langSrc = e.langSource === 'setlang' ? '⚙️' : e.langSource === 'locale' ? '🌐' : '';
      html += `<tr>
        <td class="mono dim">${time}</td>
        <td><span class="badge badge-green">OK</span></td>
        <td>${e.guildName}</td>
        <td class="dim">${e.userTag}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</td>
        <td>${langLabel} ${langSrc} ${sourceBadge}</td>
      </tr>`;
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  renderPagination('log-pagination', {
    total: allLogData.length,
    page: logPage,
    pageSize: logPageSize,
    onPageChange: 'setLogPage',
    onSizeChange: 'setLogPageSize',
  });
}

function setLogPage(p) { logPage = p; renderLogs(); }
function setLogPageSize(s) { logPageSize = s; logPage = 1; renderLogs(); }

// ========== Health Check ==========

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

// ========== User Prefs ==========

const LANG_NAMES = {
  'zh-TW': '繁體中文', 'zh-CN': '简体中文', en: 'English',
  ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français',
  de: 'Deutsch', pt: 'Português', ru: 'Русский', it: 'Italiano',
  vi: 'Tiếng Việt', th: 'ไทย', ar: 'العربية', hi: 'हिन्दी',
  id: 'Bahasa Indonesia', tr: 'Türkçe',
};

let allPrefsData = {};

async function loadUserPrefs() {
  try {
    const res = await api('/user-prefs');
    if (!res.ok) return;
    const { prefs, count } = await res.json();
    allPrefsData = prefs;
    document.getElementById('prefs-count').textContent = count + ' user(s) with custom settings';
    prefsPage = 1;
    renderUserPrefs();
  } catch { }
}

function renderUserPrefs() {
  const container = document.getElementById('user-prefs-container');
  const entries = Object.entries(allPrefsData);

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No users have set custom languages yet.</div>';
    document.getElementById('prefs-pagination').innerHTML = '';
    return;
  }

  const start = (prefsPage - 1) * prefsPageSize;
  const pageEntries = entries.slice(start, start + prefsPageSize);

  let html = `<table class="data-table"><thead><tr>
    <th>User ID</th><th>Language</th><th></th>
  </tr></thead><tbody>`;
  for (const [userId, lang] of pageEntries) {
    const name = LANG_NAMES[lang] || lang;
    html += `<tr>
      <td class="mono" style="font-size:0.8rem">${userId}</td>
      <td>${name} (${lang})</td>
      <td><button class="btn-danger" onclick="deleteUserPref('${userId}')">Delete</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  renderPagination('prefs-pagination', {
    total: entries.length,
    page: prefsPage,
    pageSize: prefsPageSize,
    onPageChange: 'setPrefsPage',
    onSizeChange: 'setPrefsPageSize',
  });
}

function setPrefsPage(p) { prefsPage = p; renderUserPrefs(); }
function setPrefsPageSize(s) { prefsPageSize = s; prefsPage = 1; renderUserPrefs(); }

async function deleteUserPref(userId) {
  const res = await api('/user-prefs/' + userId, { method: 'DELETE' });
  if (res.ok) {
    showToast('User preference deleted');
    delete allPrefsData[userId];
    document.getElementById('prefs-count').textContent = Object.keys(allPrefsData).length + ' user(s) with custom settings';
    renderUserPrefs();
  } else {
    showToast('Delete failed', true);
  }
}

// ========== Cache Clear ==========

async function clearCache() {
  const res = await api('/cache/clear', { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    showToast(`Cache cleared (${data.cleared} entries removed)`);
    loadStats();
  } else {
    showToast('Clear failed', true);
  }
}

// ========== Translation Test ==========

async function testTranslate() {
  const text = document.getElementById('test-text').value.trim();
  const lang = document.getElementById('test-lang').value;
  if (!text) { showToast('Enter some text first', true); return; }

  const btn = document.getElementById('test-btn');
  btn.disabled = true;
  btn.textContent = '...';
  const resultDiv = document.getElementById('test-result');
  resultDiv.classList.remove('show');

  try {
    const res = await api('/translate/test', {
      method: 'POST',
      body: JSON.stringify({ text, targetLanguage: lang }),
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('test-output').textContent = data.translation;
      document.getElementById('test-meta').textContent =
        `${data.latencyMs}ms · ${data.inputTokens} in / ${data.outputTokens} out tokens`;
      resultDiv.classList.add('show');
    } else {
      showToast('Test failed: ' + data.error, true);
    }
  } catch (err) {
    showToast('Test failed: ' + err.message, true);
  }
  btn.disabled = false;
  btn.textContent = 'Test';
}

// ========== Prompt ==========

function restoreDefaultPrompt() {
  document.getElementById('cfg-prompt').value = '';
  showToast('Default prompt will be used — click Save to apply');
}

init();
