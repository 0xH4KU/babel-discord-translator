/**
 * Application entry point — init, app capabilities, and setup check.
 */

let dashboardCapabilities = null;

function hasDashboardCapability(name) {
  return Boolean(dashboardCapabilities?.capabilities?.[name]);
}

function getDashboardProfile() {
  return dashboardCapabilities?.profile || null;
}

function getDashboardUsageScopeLabel(stats) {
  if (hasDashboardCapability('guildAccess')) {
    const guildCount = Number(stats?.bot?.guilds || 0);
    return guildCount === 1 ? '1 server' : guildCount + ' servers';
  }

  if (hasDashboardCapability('userAccess')) return 'user installs';

  return 'active scope';
}

function applyDashboardCapabilities(data) {
  dashboardCapabilities = data || null;
  const profile = getDashboardProfile();

  document.body.dataset.appProfile = profile?.id || 'babel-guild';
  document.querySelectorAll('[data-profile-product-name]').forEach((node) => {
    node.textContent = profile?.productName || 'Babel';
  });
  document.title = profile?.productName
    ? profile.productName + ' — Dashboard'
    : 'Babel — Dashboard';

  document.querySelectorAll('[data-capability]').forEach((node) => {
    const capability = node.dataset.capability;
    const enabled = hasDashboardCapability(capability);
    node.hidden = !enabled;
    node.setAttribute('aria-hidden', String(!enabled));
  });

  const budgetLabel = document.getElementById('budget-card-label');
  if (budgetLabel) {
    budgetLabel.textContent = hasDashboardCapability('guildAccess')
      ? 'Server Budgets'
      : 'Daily Budget';
  }

  const budgetSettingsLabel = document.getElementById('cfg-budget-label');
  if (budgetSettingsLabel) {
    budgetSettingsLabel.textContent = hasDashboardCapability('userAccess')
      ? 'Global Safety Budget (USD, 0 = unlimited)'
      : 'Global Daily Budget (USD, 0 = unlimited)';
  }

  const budgetHint = document.getElementById('cfg-budget-hint');
  if (budgetHint) {
    budgetHint.textContent = hasDashboardCapability('userAccess')
      ? 'Safety cap across all user-install usage. Pocket does not use server whitelist or per-server budgets.'
      : 'Default for servers without custom budgets. Set per-server budgets in Access tab.';
  }
}

async function loadDashboardCapabilities() {
  const res = await api('/capabilities');
  if (!res.ok) return;

  applyDashboardCapabilities(await res.json());
}

async function checkSetup() {
  // Fetch CSRF token for this session
  const authRes = await api('/auth/check');
  const authData = await authRes.json();
  if (authData.csrfToken) setCsrfToken(authData.csrfToken);

  if (!dashboardCapabilities) await loadDashboardCapabilities();

  const res = await api('/setup-status');
  const { complete } = await res.json();
  if (complete) {
    show('dashboard-view');
    loadDashboard();
  } else {
    show('wizard-view');
  }
}

function renderVersionMetadata(data) {
  const link = document.getElementById('version-link');
  if (!link) return;

  link.textContent = data.version ? 'v' + data.version : 'version';
  if (data.repositoryUrl) link.href = data.repositoryUrl;
  link.classList.remove('update-available', 'update-current');
  link.title = '';

  if (data.update?.status === 'outdated') {
    link.classList.add('update-available');
    link.textContent = `v${data.version} → v${data.update.latestVersion}`;
    link.title = `Update available: v${data.update.latestVersion}`;
    if (data.update.latestUrl) link.href = data.update.latestUrl;
  } else if (data.update?.status === 'current') {
    link.classList.add('update-current');
    link.title = `Babel is up to date: v${data.version}`;
  } else if (data.update?.status === 'unknown') {
    link.title = 'Could not check the latest Babel release';
  }
}

async function loadVersionMetadata(options = {}) {
  try {
    const res = await api(options.forceRefresh ? '/version/refresh' : '/version', {
      method: options.forceRefresh ? 'POST' : 'GET',
    });
    if (!res.ok) return;

    renderVersionMetadata(await res.json());
  } catch {
    // Version metadata is helpful, but it should never block dashboard boot.
  }
}

async function refreshVersionMetadata() {
  const button = document.getElementById('version-refresh');
  if (button) button.disabled = true;

  try {
    await loadVersionMetadata({ forceRefresh: true });
  } finally {
    if (button) button.disabled = false;
  }
}

async function init() {
  const res = await api('/auth/check');
  const data = await res.json();
  if (data.authenticated) {
    if (data.csrfToken) setCsrfToken(data.csrfToken);
    await loadDashboardCapabilities();
    loadVersionMetadata();
    await checkSetup();
  } else {
    show('login-view');
  }
}

init();
