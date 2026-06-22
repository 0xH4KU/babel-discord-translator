
(function () {
  const fixtureMap = {
    '/auth/check': { authenticated: true, csrfToken: 'demo-csrf-token' },
    '/setup-status': { complete: true },
    '/capabilities': 'capabilities.json',
    '/stats': 'stats.json',
    '/health': 'health.json',
    '/version': 'version.json',
    '/version/refresh': 'version.json',
    '/config': 'config.json',
    '/guilds': 'guilds.json',
    '/guild-budgets': 'guild-budgets.json',
    '/usage/history': 'history.json',
    '/logs': 'logs.json',
    '/user-prefs': 'user-prefs.json',
    '/user-budgets': 'user-budgets.json',
    '/guild-glossary/100000000000000001': { error: 'No demo fixture for /guild-glossary/100000000000000001', status: 404 },
    '/sessions': 'sessions.json'
  };

  function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || data.status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function normalizePath(path) {
    return String(path).split('?')[0];
  }

  async function loadFixture(name) {
    const response = await fetch('demo/fixtures/' + name);
    return response.json();
  }

  window.BABEL_DEMO = true;
  window.BABEL_DEMO_APP = "pocket";
  window.api = async function demoApi(path, opts) {
    const method = (opts && opts.method ? opts.method : 'GET').toUpperCase();
    const route = normalizePath(path);
    if (method !== 'GET' && route !== '/version/refresh') {
      return jsonResponse({ ok: true, demo: true, message: 'Demo mode: changes are disabled.' });
    }

    const fixture = fixtureMap[route];
    if (!fixture) {
      return jsonResponse({ error: 'No demo fixture for ' + route }, 404);
    }

    if (typeof fixture === 'string') {
      return jsonResponse(await loadFixture(fixture));
    }

    return jsonResponse(fixture);
  };
})();
