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

async function init() {
  const res = await api('/auth/check');
  const data = await res.json();
  if (data.authenticated) {
    if (data.csrfToken) setCsrfToken(data.csrfToken);
    await checkSetup();
  } else {
    show('login-view');
  }
}

init();
