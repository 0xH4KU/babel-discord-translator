
/**
 * Setup wizard step navigation.
 */

let wizStep = 0;

function wizProviderUsesVertex(mode) {
  return mode === 'vertex' || mode === 'vertex+openai' || mode === 'openai+vertex';
}

function wizProviderUsesOpenai(mode) {
  return mode === 'openai' || mode === 'vertex+openai' || mode === 'openai+vertex';
}

function wizProviderChanged() {
  const mode = document.getElementById('wiz-provider').value;
  document.getElementById('wiz-section-vertex').style.display = wizProviderUsesVertex(mode) ? '' : 'none';
  document.getElementById('wiz-section-openai').style.display = wizProviderUsesOpenai(mode) ? '' : 'none';
}

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
    const mode = document.getElementById('wiz-provider').value;
    const key = document.getElementById('wiz-apikey').value.trim();
    const proj = document.getElementById('wiz-project').value.trim();
    const openaiKey = document.getElementById('wiz-openai-apikey').value.trim();
    const openaiBaseUrl = document.getElementById('wiz-openai-baseurl').value.trim();
    const openaiModel = document.getElementById('wiz-openai-model').value.trim();
    if (wizProviderUsesVertex(mode) && (!key || !proj)) {
      showToast('Please fill in API Key and Project ID', true);
      return;
    }
    if (wizProviderUsesOpenai(mode) && (!openaiKey || !openaiBaseUrl || !openaiModel)) {
      showToast('Please fill in OpenAI-compatible API settings', true);
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
  const mode = document.getElementById('wiz-provider').value;
  const cfg = {
    translationProvider: mode,
    vertexAiApiKey: document.getElementById('wiz-apikey').value.trim(),
    gcpProject: document.getElementById('wiz-project').value.trim(),
    gcpLocation: document.getElementById('wiz-location').value.trim() || 'global',
    geminiModel: document.getElementById('wiz-model').value.trim(),
    openaiApiKey: document.getElementById('wiz-openai-apikey').value.trim(),
    openaiBaseUrl: document.getElementById('wiz-openai-baseurl').value.trim(),
    openaiModel: document.getElementById('wiz-openai-model').value.trim(),
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

wizProviderChanged();
