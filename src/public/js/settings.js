/**
 * Settings tab: load/save configuration, translation test, prompt editor.
 */

let currentConfig = {};
let settingsDirty = false;
let settingsLoaded = false;

function providerUses(mode, provider) {
  return String(mode || '')
    .split('+')
    .includes(provider);
}

function selectedProviderMode() {
  const primary = configElement('cfg-provider')?.value || 'vertex';
  const fallback = configElement('cfg-provider-fallback')?.value || '';
  return fallback && fallback !== primary ? `${primary}+${fallback}` : primary;
}

function configElement(id) {
  return document.getElementById(id);
}

function setSettingsDirty(dirty) {
  settingsDirty = dirty;
  const status = configElement('settings-save-status');
  const button = configElement('settings-save-button');
  if (status) {
    status.textContent = dirty ? 'Unsaved changes' : 'No unsaved changes';
    status.classList?.toggle('dirty', dirty);
  }
  if (button) button.disabled = !dirty;
}

function markSettingsDirty() {
  if (settingsLoaded) setSettingsDirty(true);
}

function confirmSettingsNavigation() {
  if (!settingsDirty) return true;
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  if (!window.confirm('Discard unsaved settings changes?')) return false;
  settingsLoaded = false;
  setSettingsDirty(false);
  return true;
}

function isVisionFallbackRequired() {
  const mode = settingsLoaded ? selectedProviderMode() : currentConfig.translationProvider;
  const vertexImages = settingsLoaded
    ? Boolean(configElement('cfg-vertex-images')?.checked)
    : Boolean(currentConfig.vertexAiSupportsImages);
  const openaiImages = settingsLoaded
    ? Boolean(configElement('cfg-openai-images')?.checked)
    : Boolean(currentConfig.openaiSupportsImages);
  return (
    (providerUses(mode, 'vertex') && !vertexImages) ||
    (providerUses(mode, 'openai') && !openaiImages)
  );
}

function refreshLensRoutes() {
  const mode = settingsLoaded
    ? selectedProviderMode()
    : currentConfig.translationProvider || 'vertex';
  const routes = [
    ['vertex', 'lens-route-vertex', configElement('cfg-vertex-images')?.checked],
    ['openai', 'lens-route-openai', configElement('cfg-openai-images')?.checked],
  ];

  routes.forEach(([provider, id, supportsImages]) => {
    const node = configElement(id);
    if (!node) return;
    node.textContent = !providerUses(mode, provider)
      ? 'Disabled'
      : supportsImages
        ? 'Direct multimodal'
        : 'Vision fallback';
    node.className =
      supportsImages && providerUses(mode, provider) ? 'route-direct' : 'route-vision';
  });

  const needsVision = isVisionFallbackRequired();
  document.querySelectorAll?.('.vision-fallback-only').forEach((node) => {
    node.hidden = !needsVision;
  });
}

function onProviderModeChange() {
  const primary = configElement('cfg-provider').value;
  const fallback = configElement('cfg-provider-fallback');
  if (fallback.value === primary) fallback.value = '';
  for (const option of fallback.options) option.disabled = option.value === primary;

  const mode = selectedProviderMode();
  const vertexSection = configElement('section-vertex');
  const openaiSection = configElement('section-openai');

  const showVertex = providerUses(mode, 'vertex');
  const showOpenai = providerUses(mode, 'openai');

  if (vertexSection) vertexSection.hidden = !showVertex;
  if (openaiSection) openaiSection.hidden = !showOpenai;
  refreshLensRoutes();
}

function onProviderCapabilityChange() {
  refreshLensRoutes();
  markSettingsDirty();
}

function onVertexIdentityChanged() {
  const changed = configElement('cfg-model').value.trim() !== (currentConfig.geminiModel || '');
  if (changed) configElement('cfg-vertex-images').checked = false;
  refreshLensRoutes();
}

function onOpenaiIdentityChanged() {
  const baseChanged =
    configElement('cfg-openai-baseurl').value.trim() !== (currentConfig.openaiBaseUrl || '');
  const modelChanged =
    configElement('cfg-openai-model').value.trim() !== (currentConfig.openaiModel || '');
  if (baseChanged || modelChanged) configElement('cfg-openai-images').checked = false;
  refreshLensRoutes();
}

function switchSettingsCategory(category) {
  document.querySelectorAll?.('.settings-category-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.settingsCategory === category);
  });
  document.querySelectorAll?.('.settings-category-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === 'settings-' + category);
  });
  const select = configElement('settings-category-select');
  if (select) select.value = category;
}

function previewVisionLimit(value) {
  const usage = currentConfig.visionUsage || {};
  const parsed = Number(value);
  const limit =
    Number.isSafeInteger(parsed) && parsed >= 0
      ? parsed
      : (usage.limit ?? currentConfig.visionMonthlyImageLimit ?? 900);
  document.getElementById('cfg-vision-usage').textContent =
    `${usage.images || 0} / ${limit} images used · ${usage.month || 'current UTC month'}`;
}

function renderSessions(sessions) {
  const container = document.getElementById('session-list');
  if (!container) return;

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="session-empty">No active sessions</div>';
    return;
  }

  container.innerHTML = sessions
    .map((session) => {
      const expires = session.expiresAt ? new Date(session.expiresAt).toLocaleString() : 'Unknown';
      const currentBadge = session.current ? '<span class="session-badge">Current</span>' : '';
      const escapedId = escapeHtml(session.id);
      const action = session.current
        ? '<span class="session-muted">This browser</span>'
        : `<button class="btn-danger btn-xs" ${actionAttrs('revokeSession', [session.id])}>Revoke</button>`;

      return `<div class="session-item">
      <div>
        <div class="session-title">Session ${escapedId} ${currentBadge}</div>
        <div class="session-meta">Expires ${escapeHtml(expires)}</div>
      </div>
      ${action}
    </div>`;
    })
    .join('');
}

async function loadSessions() {
  try {
    const res = await api('/sessions');
    if (!res.ok) return;

    const data = await res.json();
    renderSessions(data.sessions || []);
  } catch {}
}

async function loadSettings(force = false) {
  if (settingsLoaded && !force) return;
  try {
    const requests = [api('/config')];
    if (hasDashboardCapability('guildAccess')) requests.push(api('/guilds'));

    const [cfgRes, guildRes] = await Promise.all(requests);
    currentConfig = await cfgRes.json();
    allGuilds = guildRes ? await guildRes.json() : [];

    document.getElementById('cfg-apikey').value = '';
    document.getElementById('cfg-apikey').placeholder = currentConfig.hasApiKey
      ? currentConfig.vertexAiApiKey + ' (leave blank to keep)'
      : 'Not set';
    document.getElementById('cfg-vision-apikey').value = '';
    document.getElementById('cfg-vision-apikey').placeholder = currentConfig.hasVisionApiKey
      ? currentConfig.visionApiKey + ' (leave blank to keep)'
      : 'Not set';
    document.getElementById('cfg-project').value = currentConfig.gcpProject || '';
    document.getElementById('cfg-location').value = currentConfig.gcpLocation || 'global';
    document.getElementById('cfg-model').value = currentConfig.geminiModel || '';
    document.getElementById('cfg-vertex-images').checked = Boolean(
      currentConfig.vertexAiSupportsImages,
    );
    document.getElementById('cfg-media-resolution').value =
      currentConfig.geminiMediaResolution || 'default';
    document.getElementById('cfg-cooldown').value = currentConfig.cooldownSeconds || 5;
    document.getElementById('cfg-cache').value = currentConfig.cacheMaxSize || 2000;
    document.getElementById('cfg-max-input').value = currentConfig.maxInputLength || 2000;
    document.getElementById('cfg-max-output').value = currentConfig.maxOutputTokens || 4096;
    document.getElementById('cfg-max-concurrent').value =
      currentConfig.translationMaxConcurrent || 4;
    document.getElementById('cfg-max-global-queue').value =
      currentConfig.translationMaxGlobalQueue || 25;
    document.getElementById('cfg-max-guild-queue').value =
      currentConfig.translationMaxGuildQueue || 5;
    document.getElementById('cfg-max-user-outstanding').value =
      currentConfig.translationMaxUserOutstanding || 1;
    document.getElementById('cfg-max-queue-wait').value =
      currentConfig.translationMaxQueueWaitMs || 30000;
    document.getElementById('cfg-input-price').value = currentConfig.inputPricePerMillion || 0;
    document.getElementById('cfg-output-price').value = currentConfig.outputPricePerMillion || 0;
    document.getElementById('cfg-budget').value = currentConfig.monthlyBudgetUsd || 0;
    document.getElementById('cfg-vision-limit').value =
      currentConfig.visionMonthlyImageLimit ?? 900;
    previewVisionLimit(currentConfig.visionMonthlyImageLimit ?? 900);
    document.getElementById('cfg-prompt').value = currentConfig.translationPrompt || '';

    // Provider settings
    const [primaryProvider, fallbackProvider = ''] = (
      currentConfig.translationProvider || 'vertex'
    ).split('+');
    document.getElementById('cfg-provider').value = primaryProvider;
    document.getElementById('cfg-provider-fallback').value = fallbackProvider;
    document.getElementById('cfg-openai-apikey').value = '';
    document.getElementById('cfg-openai-apikey').placeholder = currentConfig.hasOpenaiApiKey
      ? currentConfig.openaiApiKey + ' (leave blank to keep)'
      : 'Not set';
    document.getElementById('cfg-openai-baseurl').value = currentConfig.openaiBaseUrl || '';
    document.getElementById('cfg-openai-model').value = currentConfig.openaiModel || '';
    document.getElementById('cfg-openai-images').checked = Boolean(
      currentConfig.openaiSupportsImages,
    );
    settingsLoaded = true;
    setSettingsDirty(false);
    onProviderModeChange();
    loadSessions();
  } catch {}
}

async function saveSettings() {
  const updates = {};

  const newKey = document.getElementById('cfg-apikey').value.trim();
  if (newKey) updates.vertexAiApiKey = newKey;
  const newVisionKey = document.getElementById('cfg-vision-apikey').value.trim();
  if (newVisionKey) updates.visionApiKey = newVisionKey;

  updates.gcpProject = document.getElementById('cfg-project').value.trim();
  updates.gcpLocation = document.getElementById('cfg-location').value.trim() || 'global';
  updates.geminiModel = document.getElementById('cfg-model').value.trim();
  updates.vertexAiSupportsImages = Boolean(document.getElementById('cfg-vertex-images')?.checked);
  updates.geminiMediaResolution =
    document.getElementById('cfg-media-resolution')?.value || 'default';
  updates.cooldownSeconds = parseInt(document.getElementById('cfg-cooldown').value) || 5;
  updates.cacheMaxSize = parseInt(document.getElementById('cfg-cache').value) || 2000;
  updates.maxInputLength = parseInt(document.getElementById('cfg-max-input').value) || 2000;
  updates.maxOutputTokens = parseInt(document.getElementById('cfg-max-output').value) || 4096;
  updates.translationMaxConcurrent =
    parseInt(document.getElementById('cfg-max-concurrent').value) || 4;
  updates.translationMaxGlobalQueue =
    parseInt(document.getElementById('cfg-max-global-queue').value) || 25;
  updates.translationMaxGuildQueue =
    parseInt(document.getElementById('cfg-max-guild-queue').value) || 5;
  updates.translationMaxUserOutstanding =
    parseInt(document.getElementById('cfg-max-user-outstanding').value) || 1;
  updates.translationMaxQueueWaitMs =
    parseInt(document.getElementById('cfg-max-queue-wait').value) || 30000;
  updates.inputPricePerMillion = parseFloat(document.getElementById('cfg-input-price').value) || 0;
  updates.outputPricePerMillion =
    parseFloat(document.getElementById('cfg-output-price').value) || 0;
  updates.monthlyBudgetUsd = parseFloat(document.getElementById('cfg-budget').value) || 0;
  updates.visionMonthlyImageLimit =
    parseInt(document.getElementById('cfg-vision-limit').value) || 0;
  updates.translationPrompt = document.getElementById('cfg-prompt').value;

  // Provider settings
  updates.translationProvider = selectedProviderMode();
  const newOpenaiKey = document.getElementById('cfg-openai-apikey').value.trim();
  if (newOpenaiKey) updates.openaiApiKey = newOpenaiKey;
  updates.openaiBaseUrl = document.getElementById('cfg-openai-baseurl').value.trim();
  updates.openaiModel = document.getElementById('cfg-openai-model').value.trim();
  updates.openaiSupportsImages = Boolean(document.getElementById('cfg-openai-images')?.checked);

  const res = await api('/config', {
    method: 'POST',
    body: JSON.stringify(updates),
  });

  if (res.ok) {
    showToast('Settings saved!');
    settingsLoaded = false;
    setSettingsDirty(false);
    await loadSettings(true);
  } else {
    showToast('Save failed', true);
  }
}

async function clearCache() {
  const res = await api('/cache/clear', { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    showToast(`Caches cleared (${data.cleared} entries removed)`);
    loadStats();
  } else {
    showToast('Clear failed', true);
  }
}

async function testTranslate() {
  const text = document.getElementById('test-text').value.trim();
  const lang = document.getElementById('test-lang').value;
  if (!text) {
    showToast('Enter some text first', true);
    return;
  }

  const btn = document.getElementById('test-btn');
  btn.disabled = true;
  btn.textContent = '...';
  const resultDiv = document.getElementById('test-result');
  resultDiv.classList.remove('show');

  try {
    const res = await api('/translate/test', {
      method: 'POST',
      body: JSON.stringify({ text, targetLanguage: lang }),
    });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('test-output').textContent = data.translation;
      document.getElementById('test-meta').textContent =
        `${data.latencyMs}ms · ${data.inputTokens} in / ${data.outputTokens} out tokens`;
      resultDiv.classList.add('show');
    } else {
      showToast('Test failed: ' + data.error, true);
    }
  } catch (err) {
    showToast('Test failed: ' + err.message, true);
  }
  btn.disabled = false;
  btn.textContent = 'Test';
}

function restoreDefaultPrompt() {
  document.getElementById('cfg-prompt').value = '';
  markSettingsDirty();
  showToast('Default prompt will be used — click Save to apply');
}

if (document.addEventListener) {
  const markConfigInput = (event) => {
    if (event.target?.id?.startsWith('cfg-')) markSettingsDirty();
  };
  document.addEventListener('input', markConfigInput);
  document.addEventListener('change', markConfigInput);
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('beforeunload', (event) => {
    if (!settingsDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function revokeSession(id) {
  const res = await api('/sessions/revoke', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });

  if (res.ok) {
    showToast('Session revoked');
    loadSessions();
  } else {
    showToast('Revoke failed', true);
  }
}
