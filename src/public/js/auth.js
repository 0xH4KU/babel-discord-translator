
/**
 * Login / Logout authentication logic.
 */

async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  const res = await api('/login', {
    method: 'POST',
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    await checkSetup();
  } else {
    let message = res.statusText || 'Login failed';
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (_error) {
      // Ignore JSON parse errors and keep the HTTP status text fallback.
    }
    document.getElementById('login-error').textContent = message;
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
