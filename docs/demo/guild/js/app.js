/**
 * Application entry point — init and setup check.
 */

async function checkSetup() {
  // Fetch CSRF token for this session
  const authRes = await api('/auth/check');
  const authData = await authRes.json();
  if (authData.csrfToken) setCsrfToken(authData.csrfToken);

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
    loadVersionMetadata();
    await checkSetup();
  } else {
    show('login-view');
  }
}

init();
