/* eslint-disable no-unused-vars */

/**
 * Settings tab: load/save configuration, translation test, prompt editor.
 */

let currentConfig = {};

async function loadSettings() {
  try {
    const [cfgRes, guildRes] = await Promise.all([api('/config'), api('/guilds')]);
    currentConfig = await cfgRes.json();
    allGuilds = await guildRes.json();

    document.getElementById('cfg-apikey').value = '';
    document.getElementById('cfg-apikey').placeholder =
      currentConfig.hasApiKey ? currentConfig.vertexAiApiKey + ' (leave blank to keep)' : 'Not set';
    document.getElementById('cfg-project').value = currentConfig.gcpProject || '';
    document.getElementById('cfg-location').value = currentConfig.gcpLocation || 'global';
    document.getElementById('cfg-model').value = currentConfig.geminiModel || '';
    document.getElementById('cfg-cooldown').value = currentConfig.cooldownSeconds || 5;
    document.getElementById('cfg-cache').value = currentConfig.cacheMaxSize || 2000;
    document.getElementById('cfg-max-input').value = currentConfig.maxInputLength || 2000;
    document.getElementById('cfg-max-output').value = currentConfig.maxOutputTokens || 1000;
    document.getElementById('cfg-input-price').value = currentConfig.inputPricePerMillion || 0;
    document.getElementById('cfg-output-price').value = currentConfig.outputPricePerMillion || 0;
    document.getElementById('cfg-budget').value = currentConfig.dailyBudgetUsd || 0;
    document.getElementById('cfg-prompt').value = currentConfig.translationPrompt || '';
  } catch { }
}

async function saveSettings() {
  const updates = {};

  const newKey = document.getElementById('cfg-apikey').value.trim();
  if (newKey) updates.vertexAiApiKey = newKey;

  updates.gcpProject = document.getElementById('cfg-project').value.trim();
  updates.gcpLocation = document.getElementById('cfg-location').value.trim() || 'global';
  updates.geminiModel = document.getElementById('cfg-model').value.trim();
  updates.cooldownSeconds = parseInt(document.getElementById('cfg-cooldown').value) || 5;
  updates.cacheMaxSize = parseInt(document.getElementById('cfg-cache').value) || 2000;
  updates.maxInputLength = parseInt(document.getElementById('cfg-max-input').value) || 2000;
  updates.maxOutputTokens = parseInt(document.getElementById('cfg-max-output').value) || 1000;
  updates.inputPricePerMillion = parseFloat(document.getElementById('cfg-input-price').value) || 0;
  updates.outputPricePerMillion = parseFloat(document.getElementById('cfg-output-price').value) || 0;
  updates.dailyBudgetUsd = parseFloat(document.getElementById('cfg-budget').value) || 0;
  updates.translationPrompt = document.getElementById('cfg-prompt').value;

  // Whitelist: always save the explicit list of enabled IDs
  const checkboxes = document.querySelectorAll('[data-guild-id]');
  updates.allowedGuildIds = [...checkboxes]
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.guildId);

  const res = await api('/config', {
    method: 'POST',
    body: JSON.stringify(updates),
  });

  if (res.ok) {
    showToast('Settings saved!');
    loadSettings();
  } else {
    showToast('Save failed', true);
  }
}

async function clearCache() {
  const res = await api('/cache/clear', { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    showToast(`Cache cleared (${data.cleared} entries removed)`);
    loadStats();
  } else {
    showToast('Clear failed', true);
  }
}

async function testTranslate() {
  const text = document.getElementById('test-text').value.trim();
  const lang = document.getElementById('test-lang').value;
  if (!text) { showToast('Enter some text first', true); return; }

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
  showToast('Default prompt will be used — click Save to apply');
}
