/**
 * Application entry point — init and setup check.
 */

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

init();
