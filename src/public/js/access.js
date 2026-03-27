/**
 * Access tab: guild whitelist management, per-guild budgets, and user language preferences.
 */

let allGuilds = [];
let guildBudgetData = {};
let guildPage = 1,
    guildPageSize = 15;
let manualGuildIds = [];
let accessAllowedGuildIdsDraft = [];
let accessWhitelistDirty = false;
let accessWhitelistLoaded = false;

function normalizeGuildIds(ids) {
    return [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
}

function sameGuildIds(a, b) {
    const left = normalizeGuildIds(a).sort();
    const right = normalizeGuildIds(b).sort();

    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
}

function updateAccessSaveState() {
    const status = accessWhitelistDirty
        ? `${accessAllowedGuildIdsDraft.length} enabled server(s) pending save`
        : 'No unsaved whitelist changes';

    document.querySelectorAll('[data-access-save-status]').forEach((node) => {
        node.textContent = status;
        node.classList.toggle('dirty', accessWhitelistDirty);
    });

    document.querySelectorAll('[data-access-save-button]').forEach((button) => {
        button.disabled = !accessWhitelistDirty;
    });
}

function setAccessWhitelistDraft(allowedGuildIds) {
    accessAllowedGuildIdsDraft = normalizeGuildIds(allowedGuildIds);
    accessWhitelistDirty = !sameGuildIds(
        accessAllowedGuildIdsDraft,
        currentConfig.allowedGuildIds || [],
    );
    updateAccessSaveState();
}

async function loadAccess() {
    try {
        const [cfgRes, guildRes, budgetRes] = await Promise.all([
            api('/config'),
            api('/guilds'),
            api('/guild-budgets'),
        ]);
        currentConfig = await cfgRes.json();
        currentConfig.allowedGuildIds = normalizeGuildIds(currentConfig.allowedGuildIds || []);
        if (!accessWhitelistLoaded || !accessWhitelistDirty) {
            accessAllowedGuildIdsDraft = [...currentConfig.allowedGuildIds];
        }
        accessWhitelistLoaded = true;
        allGuilds = await guildRes.json();
        guildBudgetData = await budgetRes.json();
        renderGuilds();
        updateAccessSaveState();
        loadUserPrefs();
    } catch {}
}

async function saveGuildWhitelist() {
    const allowedGuildIds = normalizeGuildIds(accessAllowedGuildIdsDraft);

    const res = await api('/config', {
        method: 'POST',
        body: JSON.stringify({ allowedGuildIds }),
    });

    if (res.ok) {
        currentConfig.allowedGuildIds = [...allowedGuildIds];
        accessAllowedGuildIdsDraft = [...allowedGuildIds];
        accessWhitelistDirty = false;
        updateAccessSaveState();
        renderGuilds();
        showToast('Access settings saved!');
    } else {
        showToast('Save failed', true);
    }
}

function toggleGuildAllowed(guildId, checked) {
    const nextAllowed = new Set(accessAllowedGuildIdsDraft);

    if (checked) {
        nextAllowed.add(guildId);
    } else {
        nextAllowed.delete(guildId);
    }

    setAccessWhitelistDraft([...nextAllowed]);
    renderGuilds();
}

function renderGuilds() {
    const container = document.getElementById('guild-list');
    const allowed = accessAllowedGuildIdsDraft;
    const globalBudget = currentConfig.dailyBudgetUsd || 0;

    const knownIds = new Set(allGuilds.map((g) => g.id));
    manualGuildIds = allowed.filter((id) => !knownIds.has(id));

    const allItems = [
        ...allGuilds.map((g) => ({ ...g, manual: false })),
        ...manualGuildIds.map((id) => ({ id, name: id, manual: true })),
    ];

    if (allItems.length === 0) {
        container.innerHTML =
            '<div class="no-guilds">Bot is not in any servers. Paste a Guild ID below to add manually.</div>';
        document.getElementById('guild-pagination').innerHTML = '';
        return;
    }

    const totalPages = Math.max(Math.ceil(allItems.length / guildPageSize), 1);
    guildPage = Math.min(guildPage, totalPages);
    const start = (guildPage - 1) * guildPageSize;
    const pageItems = allItems.slice(start, start + guildPageSize);

    const html = pageItems
        .map((g) => {
            const checked = allowed.includes(g.id);
            const bd = guildBudgetData[g.id];
            const hasCustomBudget = bd && bd.budget >= 0;
            const effectiveBudget = hasCustomBudget ? bd.budget : globalBudget;
            const todayCost = bd ? bd.usage.totalCost : 0;
            const budgetLabel = hasCustomBudget
                ? formatUsd(effectiveBudget)
                : globalBudget > 0
                  ? formatUsd(globalBudget) + ' (global)'
                  : 'Unlimited';
            const costLabel = bd ? formatUsd(todayCost) : '-';

            if (g.manual) {
                return `<div class="guild-item guild-item-col">
        <div class="guild-item-row">
          <img src="${genAvatar(g.id)}" alt="">
          <span class="guild-name" style="font-family:monospace;font-size:0.8rem">${g.id}</span>
          <span class="guild-members">manually added</span>
          <label class="toggle"><input type="checkbox" data-guild-id="${g.id}" onchange="toggleGuildAllowed('${g.id}', this.checked)" checked><span class="slider"></span></label>
          <button class="btn-danger" onclick="removeManualGuild('${g.id}')">✕</button>
        </div>
      </div>`;
            }

            const pct =
                effectiveBudget > 0 ? Math.min((todayCost / effectiveBudget) * 100, 100) : 0;
            const barClass = pct > 90 ? ' danger' : pct > 60 ? ' warning' : '';

            return `<div class="guild-item guild-item-col">
      <div class="guild-item-row">
        <img src="${g.icon || genAvatar(g.name || g.id)}" alt="">
        <span class="guild-name">${g.name || g.id}</span>
        <span class="guild-members">${g.memberCount ?? '?'} members</span>
        <label class="toggle"><input type="checkbox" data-guild-id="${g.id}" onchange="toggleGuildAllowed('${g.id}', this.checked)" ${checked ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="guild-budget-row">
        <div class="guild-budget-info">
          <span class="guild-budget-label">Budget: ${budgetLabel}</span>
          <span class="guild-budget-cost">Today: ${costLabel}${bd ? ' · ' + bd.usage.requests + ' req' : ''}</span>
        </div>
        ${effectiveBudget > 0 ? `<div class="guild-budget-bar"><div class="fill${barClass}" style="width:${pct}%"></div></div>` : ''}
        <div class="guild-budget-actions">
          <input type="number" class="guild-budget-input" id="gb-${g.id}" min="0" step="0.1"
            placeholder="${hasCustomBudget ? effectiveBudget : 'Global'}"
            value="${hasCustomBudget ? effectiveBudget : ''}"
            title="Set per-server budget (USD). Empty = use global.">
          <button class="btn btn-secondary btn-xs" onclick="saveGuildBudget('${g.id}')">Set</button>
          ${hasCustomBudget ? `<button class="btn-danger btn-xs" onclick="resetGuildBudget('${g.id}')" title="Reset to global">↺</button>` : ''}
        </div>
      </div>
    </div>`;
        })
        .join('');

    container.innerHTML = html;

    renderPagination('guild-pagination', {
        total: allItems.length,
        page: guildPage,
        pageSize: guildPageSize,
        onPageChange: 'setGuildPage',
        onSizeChange: 'setGuildPageSize',
    });
}

function setGuildPage(p) {
    guildPage = p;
    renderGuilds();
}
function setGuildPageSize(s) {
    guildPageSize = s;
    guildPage = 1;
    renderGuilds();
}

async function saveGuildBudget(guildId) {
    const input = document.getElementById('gb-' + guildId);
    const val = input.value.trim();

    if (val === '') {
        // Reset to global
        return resetGuildBudget(guildId);
    }

    const budget = parseFloat(val);
    if (isNaN(budget) || budget < 0) {
        showToast('Invalid budget value', true);
        return;
    }

    const res = await api('/guild-budgets/' + guildId, {
        method: 'POST',
        body: JSON.stringify({ dailyBudgetUsd: budget }),
    });

    if (res.ok) {
        showToast('Guild budget saved!');
        // Refresh data
        const budgetRes = await api('/guild-budgets');
        guildBudgetData = await budgetRes.json();
        renderGuilds();
    } else {
        showToast('Save failed', true);
    }
}

async function resetGuildBudget(guildId) {
    const res = await api('/guild-budgets/' + guildId, {
        method: 'POST',
        body: JSON.stringify({ dailyBudgetUsd: null }),
    });

    if (res.ok) {
        showToast('Reset to global budget');
        const budgetRes = await api('/guild-budgets');
        guildBudgetData = await budgetRes.json();
        renderGuilds();
    } else {
        showToast('Reset failed', true);
    }
}

function addManualGuild() {
    const input = document.getElementById('add-guild-input');
    const id = input.value.trim();
    if (!id || !/^\d+$/.test(id)) {
        showToast('Please enter a valid Guild ID (numbers only)', true);
        return;
    }

    const nextAllowed = new Set(accessAllowedGuildIdsDraft);
    if (nextAllowed.has(id)) {
        showToast('Guild already in whitelist draft');
        return;
    }

    nextAllowed.add(id);
    setAccessWhitelistDraft([...nextAllowed]);
    guildPage = Math.max(Math.ceil((allGuilds.length + nextAllowed.size) / guildPageSize), 1);
    input.value = '';
    renderGuilds();
    showToast('Guild added — click Save to apply');
}

function removeManualGuild(id) {
    setAccessWhitelistDraft(accessAllowedGuildIdsDraft.filter((g) => g !== id));
    renderGuilds();
    showToast('Guild removed — click Save to apply');
}

// ===== User Preferences =====

const LANG_NAMES = {
    'zh-TW': '繁體中文',
    'zh-CN': '简体中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    pt: 'Português',
    ru: 'Русский',
    it: 'Italiano',
    vi: 'Tiếng Việt',
    th: 'ไทย',
    ar: 'العربية',
    hi: 'हिन्दी',
    id: 'Bahasa Indonesia',
    tr: 'Türkçe',
};

let allPrefsData = {};
let prefsPage = 1,
    prefsPageSize = 15;

async function loadUserPrefs() {
    try {
        const res = await api('/user-prefs');
        if (!res.ok) return;
        const { prefs, count } = await res.json();
        allPrefsData = prefs;
        document.getElementById('prefs-count').textContent =
            count + ' user(s) with custom settings';
        prefsPage = 1;
        renderUserPrefs();
    } catch {}
}

function renderUserPrefs() {
    const container = document.getElementById('user-prefs-container');
    const entries = Object.entries(allPrefsData);

    if (entries.length === 0) {
        container.innerHTML =
            '<div class="empty-state">No users have set custom languages yet.</div>';
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

function setPrefsPage(p) {
    prefsPage = p;
    renderUserPrefs();
}
function setPrefsPageSize(s) {
    prefsPageSize = s;
    prefsPage = 1;
    renderUserPrefs();
}

async function deleteUserPref(userId) {
    const res = await api('/user-prefs/' + userId, { method: 'DELETE' });
    if (res.ok) {
        showToast('User preference deleted');
        delete allPrefsData[userId];
        document.getElementById('prefs-count').textContent =
            Object.keys(allPrefsData).length + ' user(s) with custom settings';
        renderUserPrefs();
    } else {
        showToast('Delete failed', true);
    }
}
