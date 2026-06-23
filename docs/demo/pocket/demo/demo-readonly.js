
(function () {
  const appName = "Babel Pocket";

  function installDemoBanner() {
    if (document.querySelector('.demo-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML =
      '<div><strong>' + appName + ' dashboard demo</strong><span>Mock data only. No Discord or AI provider is connected.</span></div>' +
      '<div class="demo-badge">Read-only demo</div>';
    document.body.prepend(banner);
  }

  async function installPocketDemoSections() {
    const accessTab = document.getElementById('tab-access');
    if (!accessTab || accessTab.querySelector('[data-pocket-demo-summary]')) return;

    accessTab.querySelectorAll('.settings-section').forEach((section) => {
      const heading = section.querySelector('h3')?.textContent || '';
      if (heading.includes('Server Whitelist') || heading.includes('Server Glossary')) {
        section.style.display = 'none';
      }
    });
    accessTab.querySelectorAll('.save-bar[data-capability="guildAccess"]').forEach((saveBar) => {
      saveBar.style.display = 'none';
    });

    const summary = document.createElement('div');
    summary.className = 'demo-only-section';
    summary.dataset.pocketDemoSummary = 'true';
    summary.innerHTML =
      '<h3>User Install Access</h3>' +
      '<div class="desc-text">Babel Pocket uses user allowlists and per-user budgets. The demo fixtures include approved installing users and one pending owner request.</div>' +
      '<ul><li>Approved users: Alex Chen, Mei Lin</li><li>Pending user-install owner: Waiting Operator</li><li>Default user budget: $0.50/day</li></ul>';
    accessTab.prepend(summary);
  }

  function disableMutations() {
    const selectors = [
      '#login-view',
      '#wizard-view',
      '#cfg-apikey',
      '#cfg-openai-apikey',
      '#add-guild-input',
      '#prefs-batch-delete',
      '[data-action^="save"]',
      '[data-action^="delete"]',
      '[data-action="clearCache"]',
      '[data-action="testTranslate"]',
      '[data-action="revokeSession"]',
      '[data-action="wizFinish"]',
      '[data-action="doLogout"]'
    ];

    document.querySelectorAll(selectors.join(',')).forEach((element) => {
      if (element.id === 'login-view' || element.id === 'wizard-view') return;
      element.classList.add('demo-disabled');
      if ('disabled' in element) element.disabled = true;
      element.title = 'Demo mode: changes are disabled.';
    });
  }

  function wrapToast() {
    const originalToast = window.showToast;
    window.showToast = function demoToast(message, isError) {
      originalToast(message || 'Demo mode: changes are disabled.', isError);
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    installDemoBanner();
    installPocketDemoSections();
    wrapToast();
    setTimeout(disableMutations, 100);
    setInterval(disableMutations, 1000);
  });
})();
