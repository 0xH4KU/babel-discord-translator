/* eslint-disable no-unused-vars */

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
