/* eslint-disable no-unused-vars */

/**
 * Access tab: guild whitelist management and user language preferences.
 */

let allGuilds = [];
let guildPage = 1, guildPageSize = 15;
let manualGuildIds = [];

async function loadAccess() {
  try {
    const [cfgRes, guildRes] = await Promise.all([api('/config'), api('/guilds')]);
    currentConfig = await cfgRes.json();
    allGuilds = await guildRes.json();
    renderGuilds();
    loadUserPrefs();
  } catch { }
}

function renderGuilds() {
  const container = document.getElementById('guild-list');
  const allowed = currentConfig.allowedGuildIds || [];

  const knownIds = new Set(allGuilds.map(g => g.id));
  manualGuildIds = allowed.filter(id => !knownIds.has(id));

  const allItems = [
    ...allGuilds.map(g => ({ ...g, manual: false })),
    ...manualGuildIds.map(id => ({ id, name: id, manual: true })),
  ];

  if (allItems.length === 0) {
    container.innerHTML = '<div class="no-guilds">Bot is not in any servers. Paste a Guild ID below to add manually.</div>';
    document.getElementById('guild-pagination').innerHTML = '';
    return;
  }

  const start = (guildPage - 1) * guildPageSize;
  const pageItems = allItems.slice(start, start + guildPageSize);

  const html = pageItems.map(g => {
    const checked = allowed.includes(g.id);
    if (g.manual) {
      return `<div class="guild-item">
        <img src="${genAvatar(g.id)}" alt="">
        <span class="guild-name" style="font-family:monospace;font-size:0.8rem">${g.id}</span>
        <span class="guild-members">manually added</span>
        <label class="toggle"><input type="checkbox" data-guild-id="${g.id}" checked><span class="slider"></span></label>
        <button class="btn-danger" onclick="removeManualGuild('${g.id}')">✕</button>
      </div>`;
    }
    return `<div class="guild-item">
      <img src="${g.icon || genAvatar(g.name || g.id)}" alt="">
      <span class="guild-name">${g.name || g.id}</span>
      <span class="guild-members">${g.memberCount ?? '?'} members</span>
      <label class="toggle"><input type="checkbox" data-guild-id="${g.id}" ${checked ? 'checked' : ''}><span class="slider"></span></label>
    </div>`;
  }).join('');

  container.innerHTML = html;

  renderPagination('guild-pagination', {
    total: allItems.length,
    page: guildPage,
    pageSize: guildPageSize,
    onPageChange: 'setGuildPage',
    onSizeChange: 'setGuildPageSize',
  });
}

function setGuildPage(p) { guildPage = p; renderGuilds(); }
function setGuildPageSize(s) { guildPageSize = s; guildPage = 1; renderGuilds(); }

function addManualGuild() {
  const input = document.getElementById('add-guild-input');
  const id = input.value.trim();
  if (!id || !/^\d+$/.test(id)) {
    showToast('Please enter a valid Guild ID (numbers only)', true);
    return;
  }
  if (!currentConfig.allowedGuildIds) currentConfig.allowedGuildIds = [];
  if (!currentConfig.allowedGuildIds.includes(id)) {
    currentConfig.allowedGuildIds.push(id);
  }
  input.value = '';
  renderGuilds();
  showToast('Guild added — click Save to apply');
}

function removeManualGuild(id) {
  if (!currentConfig.allowedGuildIds) return;
  currentConfig.allowedGuildIds = currentConfig.allowedGuildIds.filter(g => g !== id);
  renderGuilds();
  showToast('Guild removed — click Save to apply');
}

// ===== User Preferences =====

const LANG_NAMES = {
  'zh-TW': '繁體中文', 'zh-CN': '简体中文', en: 'English',
  ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français',
  de: 'Deutsch', pt: 'Português', ru: 'Русский', it: 'Italiano',
  vi: 'Tiếng Việt', th: 'ไทย', ar: 'العربية', hi: 'हिन्दी',
  id: 'Bahasa Indonesia', tr: 'Türkçe',
};

let allPrefsData = {};
let prefsPage = 1, prefsPageSize = 15;

async function loadUserPrefs() {
  try {
    const res = await api('/user-prefs');
    if (!res.ok) return;
    const { prefs, count } = await res.json();
    allPrefsData = prefs;
    document.getElementById('prefs-count').textContent = count + ' user(s) with custom settings';
    prefsPage = 1;
    renderUserPrefs();
  } catch { }
}

function renderUserPrefs() {
  const container = document.getElementById('user-prefs-container');
  const entries = Object.entries(allPrefsData);

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No users have set custom languages yet.</div>';
    document.getElementById('prefs-pagination').innerHTML = '';
    return;
  }

  const start = (prefsPage - 1) * prefsPageSize;
  const pageEntries = entries.slice(start, start + prefsPageSize);

  let html = `<div class="table-scroll"><table class="data-table"><thead><tr>
    <th>User ID</th><th>Language</th><th></th>
  </tr></thead><tbody>`;
  for (const [userId, lang] of pageEntries) {
    const name = LANG_NAMES[lang] || lang;
    html += `<tr>
      <td class="mono" style="font-size:0.8rem">${userId}</td>
      <td>${name} (${lang})</td>
      <td><button class="btn-danger" onclick="deleteUserPref('${userId}')">Delete</button></td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  container.innerHTML = html;

  renderPagination('prefs-pagination', {
    total: entries.length,
    page: prefsPage,
    pageSize: prefsPageSize,
    onPageChange: 'setPrefsPage',
    onSizeChange: 'setPrefsPageSize',
  });
}

function setPrefsPage(p) { prefsPage = p; renderUserPrefs(); }
function setPrefsPageSize(s) { prefsPageSize = s; prefsPage = 1; renderUserPrefs(); }

async function deleteUserPref(userId) {
  const res = await api('/user-prefs/' + userId, { method: 'DELETE' });
  if (res.ok) {
    showToast('User preference deleted');
    delete allPrefsData[userId];
    document.getElementById('prefs-count').textContent = Object.keys(allPrefsData).length + ' user(s) with custom settings';
    renderUserPrefs();
  } else {
    showToast('Delete failed', true);
  }
}
