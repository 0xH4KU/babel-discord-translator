
/**
 * Setup wizard step navigation.
 */

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
