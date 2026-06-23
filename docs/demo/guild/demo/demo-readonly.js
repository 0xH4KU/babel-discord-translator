
(function () {
  const appName = "Babel Guild";

  function installDemoBanner() {
    if (document.querySelector('.demo-banner')) return;

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.innerHTML =
      '<div><strong>' + appName + ' dashboard demo</strong><span>Mock data only. No Discord or AI provider is connected.</span></div>' +
      '<div class="demo-badge">Read-only demo</div>';
    document.body.prepend(banner);
  }

  async function installPocketDemoSections() {}

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
