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
let glossaryGuildId = '';
let glossaryEntries = [];

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
        renderGlossaryGuildSelect();
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
    renderGlossaryGuildSelect();
    showToast('Guild removed — click Save to apply');
}

// ===== Server Glossary =====

function getGlossaryGuildOptions() {
    const known = allGuilds.map((g) => ({ id: g.id, name: g.name || g.id }));
    const knownIds = new Set(known.map((g) => g.id));
    const manual = accessAllowedGuildIdsDraft
        .filter((id) => !knownIds.has(id))
        .map((id) => ({ id, name: id }));

    return [...known, ...manual].sort((a, b) => a.name.localeCompare(b.name));
}

function renderGlossaryGuildSelect() {
    const select = document.getElementById('glossary-guild');
    if (!select) return;

    const options = getGlossaryGuildOptions();
    if (options.length === 0) {
        select.innerHTML = '<option value="">No servers available</option>';
        glossaryGuildId = '';
        glossaryEntries = [];
        renderGlossaryEntries();
        return;
    }

    if (!glossaryGuildId || !options.some((guild) => guild.id === glossaryGuildId)) {
        glossaryGuildId = options[0].id;
    }

    select.innerHTML = options
        .map(
            (guild) =>
                `<option value="${guild.id}" ${guild.id === glossaryGuildId ? 'selected' : ''}>${guild.name}</option>`,
        )
        .join('');

    loadGlossaryEntries();
}

async function selectGlossaryGuild(guildId) {
    glossaryGuildId = guildId || '';
    resetGlossaryForm();
    await loadGlossaryEntries();
}

async function loadGlossaryEntries() {
    const container = document.getElementById('glossary-container');
    if (!container || !glossaryGuildId) {
        renderGlossaryEntries();
        return;
    }

    try {
        const res = await api('/guild-glossary/' + glossaryGuildId);
        if (!res.ok) {
            showToast('Failed to load glossary', true);
            return;
        }

        const data = await res.json();
        glossaryEntries = data.entries || [];
        renderGlossaryEntries();
    } catch {
        showToast('Failed to load glossary', true);
    }
}

function renderGlossaryEntries() {
    const container = document.getElementById('glossary-container');
    if (!container) return;

    if (!glossaryGuildId) {
        container.innerHTML = '<div class="empty-state">Select a server to manage glossary terms.</div>';
        return;
    }

    if (glossaryEntries.length === 0) {
        container.innerHTML = '<div class="empty-state">No glossary terms for this server yet.</div>';
        return;
    }

    const rows = glossaryEntries
        .map(
            (entry) => `<tr>
      <td class="mono">${entry.sourceText}</td>
      <td class="mono">${entry.targetText}</td>
      <td class="dim">${entry.notes || '-'}</td>
      <td>
        <button class="btn btn-secondary btn-xs" onclick="editGlossaryEntry(${entry.id})">Edit</button>
        <button class="btn-danger" onclick="deleteGlossaryEntry(${entry.id})">Delete</button>
      </td>
    </tr>`,
        )
        .join('');

    container.innerHTML = `<div class="table-scroll"><table class="data-table glossary-table">
      <thead><tr><th>Source</th><th>Target</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function resetGlossaryForm() {
    document.getElementById('glossary-entry-id').value = '';
    document.getElementById('glossary-source').value = '';
    document.getElementById('glossary-target').value = '';
    document.getElementById('glossary-notes').value = '';
}

function editGlossaryEntry(entryId) {
    const entry = glossaryEntries.find((item) => item.id === entryId);
    if (!entry) return;

    document.getElementById('glossary-entry-id').value = entry.id;
    document.getElementById('glossary-source').value = entry.sourceText;
    document.getElementById('glossary-target').value = entry.targetText;
    document.getElementById('glossary-notes').value = entry.notes || '';
}

async function saveGlossaryEntry() {
    if (!glossaryGuildId) {
        showToast('Select a server first', true);
        return;
    }

    const id = document.getElementById('glossary-entry-id').value;
    const sourceText = document.getElementById('glossary-source').value.trim();
    const targetText = document.getElementById('glossary-target').value.trim();
    const notes = document.getElementById('glossary-notes').value.trim();

    if (!sourceText || !targetText) {
        showToast('Source and target are required', true);
        return;
    }

    const res = await api('/guild-glossary/' + glossaryGuildId, {
        method: 'POST',
        body: JSON.stringify({
            ...(id ? { id: Number(id) } : {}),
            sourceText,
            targetText,
            notes,
        }),
    });

    if (res.ok) {
        resetGlossaryForm();
        await loadGlossaryEntries();
        showToast('Glossary term saved');
    } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Save failed', true);
    }
}

async function deleteGlossaryEntry(entryId) {
    if (!glossaryGuildId) return;

    const res = await api('/guild-glossary/' + glossaryGuildId + '/' + entryId, {
        method: 'DELETE',
    });

    if (res.ok) {
        glossaryEntries = glossaryEntries.filter((entry) => entry.id !== entryId);
        renderGlossaryEntries();
        showToast('Glossary term deleted');
    } else {
        showToast('Delete failed', true);
    }
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
let userProfiles = {};
let prefsPage = 1,
    prefsPageSize = 15;
let prefsSearch = '';
let selectedPrefUserIds = new Set();

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };
        return entities[char];
    });
}

function userProfile(userId) {
    return userProfiles[userId] || null;
}

function userDisplayName(userId) {
    const profile = userProfile(userId);
    return profile?.displayName || profile?.globalName || profile?.username || userId;
}

function userAvatar(userId) {
    return userProfile(userId)?.avatarUrl || genAvatar(userDisplayName(userId));
}

function userSearchText(userId) {
    const profile = userProfile(userId);
    return [userId, profile?.displayName, profile?.globalName, profile?.username]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function renderUserIdentity(userId, withAvatar = false) {
    const displayName = escapeHtml(userDisplayName(userId));
    const escapedUserId = escapeHtml(userId);
    const avatar = withAvatar
        ? `<img class="user-identity-avatar" src="${escapeHtml(userAvatar(userId))}" alt="">`
        : '';

    return `<span class="user-identity">
        ${avatar}
        <span class="user-identity-text">
          <span class="user-identity-name">${displayName}</span>
          <span class="user-identity-id">${escapedUserId}</span>
        </span>
      </span>`;
}

async function loadUserPrefs() {
    try {
        const res = await api('/user-prefs');
        if (!res.ok) return;
        const { prefs, count, profiles } = await res.json();
        allPrefsData = prefs;
        userProfiles = profiles || {};
        document.getElementById('prefs-count').textContent =
            count + ' user(s) with custom settings';
        prefsPage = 1;
        selectedPrefUserIds = new Set(
            [...selectedPrefUserIds].filter((userId) =>
                Object.prototype.hasOwnProperty.call(prefs, userId),
            ),
        );
        renderUserPrefs();
    } catch {}
}

function filteredPrefsEntries() {
    const query = prefsSearch.trim().toLowerCase();
    const entries = Object.entries(allPrefsData);

    if (!query) return entries;

    return entries.filter(([userId, lang]) => {
        const name = LANG_NAMES[lang] || lang;
        return (
            userId.toLowerCase().includes(query) ||
            userSearchText(userId).includes(query) ||
            String(lang).toLowerCase().includes(query) ||
            String(name).toLowerCase().includes(query)
        );
    });
}

function updatePrefBatchState() {
    const button = document.getElementById('prefs-batch-delete');
    if (!button) return;

    button.disabled = selectedPrefUserIds.size === 0;
    button.textContent =
        selectedPrefUserIds.size === 0
            ? 'Clear Selected'
            : `Clear Selected (${selectedPrefUserIds.size})`;
}

function renderUserPrefs() {
    const container = document.getElementById('user-prefs-container');
    const entries = filteredPrefsEntries();

    if (entries.length === 0) {
        container.innerHTML =
            '<div class="empty-state">No matching user language preferences.</div>';
        document.getElementById('prefs-pagination').innerHTML = '';
        updatePrefBatchState();
        return;
    }

    const start = (prefsPage - 1) * prefsPageSize;
    const pageEntries = entries.slice(start, start + prefsPageSize);

    let html = `<div class="table-scroll"><table class="data-table user-prefs-table"><thead><tr>
    <th></th><th>User</th><th>Language</th><th></th>
  </tr></thead><tbody>`;
    for (const [userId, lang] of pageEntries) {
        const name = LANG_NAMES[lang] || lang;
        const checked = selectedPrefUserIds.has(userId) ? 'checked' : '';
        html += `<tr>
      <td><input type="checkbox" onchange="togglePrefSelection('${userId}', this.checked)" ${checked}></td>
      <td>${renderUserIdentity(userId, true)}</td>
      <td>${escapeHtml(name)} (${escapeHtml(lang)})</td>
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
    document.getElementById('prefs-count').textContent =
        `${entries.length} shown / ${Object.keys(allPrefsData).length} total`;
    updatePrefBatchState();
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

function setPrefsSearch(value) {
    prefsSearch = value || '';
    prefsPage = 1;
    renderUserPrefs();
}

function togglePrefSelection(userId, checked) {
    if (checked) {
        selectedPrefUserIds.add(userId);
    } else {
        selectedPrefUserIds.delete(userId);
    }

    updatePrefBatchState();
}

async function deleteSelectedUserPrefs() {
    const userIds = [...selectedPrefUserIds];
    if (userIds.length === 0) return;

    const res = await api('/user-prefs/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ userIds }),
    });

    if (res.ok) {
        const data = await res.json();
        for (const userId of data.deleted || []) {
            delete allPrefsData[userId];
            selectedPrefUserIds.delete(userId);
        }
        showToast(`${(data.deleted || []).length} user preference(s) cleared`);
        renderUserPrefs();
    } else {
        showToast('Batch delete failed', true);
    }
}

async function deleteUserPref(userId) {
    const res = await api('/user-prefs/' + userId, { method: 'DELETE' });
    if (res.ok) {
        showToast('User preference deleted');
        delete allPrefsData[userId];
        selectedPrefUserIds.delete(userId);
        document.getElementById('prefs-count').textContent =
            Object.keys(allPrefsData).length + ' user(s) with custom settings';
        renderUserPrefs();
    } else {
        showToast('Delete failed', true);
    }
}
