/**
 * Access tab: guild whitelist management, Pocket user access, and user language preferences.
 */

let allGuilds = [];
let guildBudgetData = {};
let userBudgetData = {};
let accessUserIds = [];
let guildPage = 1,
    guildPageSize = 15;
let allowedUsersPage = 1,
    allowedUsersPageSize = 15;
let manualGuildIds = [];
let accessAllowedGuildIdsDraft = [];
let accessLensEnabledGuildIdsDraft = [];
let accessAllowedUserIdsDraft = [];
let accessWhitelistDirty = false;
let accessWhitelistLoaded = false;
let glossaryGuildId = '';
let glossaryEntries = [];
let selectedGuildId = '';
let selectedAccessUserId = '';

function normalizeIds(ids) {
    return [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
}

function sameIds(a, b) {
    const left = normalizeIds(a).sort();
    const right = normalizeIds(b).sort();

    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
}

function updateAccessSaveState() {
    const userAccess = hasDashboardCapability('pendingUserInstallOwners');
    const dirty = accessWhitelistDirty;
    const status = dirty
        ? userAccess
            ? `${accessAllowedUserIdsDraft.length} enabled user(s) pending save`
            : `${accessAllowedGuildIdsDraft.length} Translation · ${accessLensEnabledGuildIdsDraft.length} Lens server(s) pending save`
        : 'No unsaved access changes';

    document.querySelectorAll('[data-access-save-status]').forEach((node) => {
        node.textContent = status;
        node.classList.toggle('dirty', dirty);
    });

    document.querySelectorAll('[data-access-save-button]').forEach((button) => {
        button.disabled = !dirty;
    });
}

function refreshAccessDirty() {
    accessWhitelistDirty = hasDashboardCapability('guildAccess')
        ? !sameIds(accessAllowedGuildIdsDraft, currentConfig.allowedGuildIds || []) ||
          !sameIds(accessLensEnabledGuildIdsDraft, currentConfig.lensEnabledGuildIds || [])
        : !sameIds(accessAllowedUserIdsDraft, currentConfig.allowedUserIds || []);
}

function setAccessWhitelistDraft(allowedGuildIds) {
    accessAllowedGuildIdsDraft = normalizeIds(allowedGuildIds);
    refreshAccessDirty();
    updateAccessSaveState();
}

function setLensGuildDraft(guildIds) {
    accessLensEnabledGuildIdsDraft = normalizeIds(guildIds);
    refreshAccessDirty();
    updateAccessSaveState();
}

function setUserAllowlistDraft(allowedUserIds) {
    accessAllowedUserIdsDraft = normalizeIds(allowedUserIds);
    refreshAccessDirty();
    updateAccessSaveState();
}

function updateAccessUsersFromBudgetPayload(payload) {
    userBudgetData = payload.budgets || payload || {};
    const ids = normalizeIds(Object.keys(userBudgetData));
    const merged = new Set([...ids, ...accessAllowedUserIdsDraft]);
    accessUserIds = [...merged];
}

async function loadAccess() {
    try {
        const guildAccess = hasDashboardCapability('guildAccess');
        const guildGlossary = hasDashboardCapability('guildGlossary');
        const pendingUserInstallOwners = hasDashboardCapability('pendingUserInstallOwners');
        const requests = {
            config: api('/config'),
            guilds: guildAccess ? api('/guilds') : Promise.resolve(null),
            budgets: guildAccess ? api('/guild-budgets') : Promise.resolve(null),
            userBudgets: pendingUserInstallOwners ? api('/user-budgets') : Promise.resolve(null),
        };

        const [cfgRes, guildRes, budgetRes, userBudgetRes] = await Promise.all([
            requests.config,
            requests.guilds,
            requests.budgets,
            requests.userBudgets,
        ]);
        currentConfig = await cfgRes.json();
        currentConfig.allowedGuildIds = normalizeIds(currentConfig.allowedGuildIds || []);
        currentConfig.lensEnabledGuildIds = normalizeIds(currentConfig.lensEnabledGuildIds || []);
        currentConfig.allowedUserIds = normalizeIds(currentConfig.allowedUserIds || []);
        if (guildAccess && (!accessWhitelistLoaded || !accessWhitelistDirty)) {
            accessAllowedGuildIdsDraft = [...currentConfig.allowedGuildIds];
            accessLensEnabledGuildIdsDraft = [...currentConfig.lensEnabledGuildIds];
        }
        if (pendingUserInstallOwners && (!accessWhitelistLoaded || !accessWhitelistDirty)) {
            accessAllowedUserIdsDraft = [...currentConfig.allowedUserIds];
        }
        accessWhitelistLoaded = true;
        refreshAccessDirty();
        allGuilds = guildRes ? await guildRes.json() : [];
        guildBudgetData = budgetRes ? await budgetRes.json() : {};
        if (guildAccess) {
            renderGuilds();
        }
        if (guildGlossary) {
            renderGlossaryGuildSelect();
        }
        if (pendingUserInstallOwners) {
            const budgetPayload = await userBudgetRes.json();
            updateAccessUsersFromBudgetPayload(budgetPayload);
            userProfiles = { ...userProfiles, ...(budgetPayload.profiles || {}) };
            renderAllowedUsers();
        }
        updateAccessSaveState();
        loadUserPrefs();
    } catch {}
}

async function saveGuildWhitelist() {
    if (!hasDashboardCapability('guildAccess')) return;

    const allowedGuildIds = normalizeIds(accessAllowedGuildIdsDraft);
    const lensEnabledGuildIds = normalizeIds(accessLensEnabledGuildIdsDraft).filter((id) =>
        allowedGuildIds.includes(id),
    );

    const res = await api('/config', {
        method: 'POST',
        body: JSON.stringify({ allowedGuildIds, lensEnabledGuildIds }),
    });

    if (res.ok) {
        currentConfig.allowedGuildIds = [...allowedGuildIds];
        currentConfig.lensEnabledGuildIds = [...lensEnabledGuildIds];
        accessAllowedGuildIdsDraft = [...allowedGuildIds];
        accessLensEnabledGuildIdsDraft = [...lensEnabledGuildIds];
        accessWhitelistDirty = false;
        updateAccessSaveState();
        renderGuilds();
        showToast('Access settings saved!');
    } else {
        showToast('Save failed', true);
    }
}

async function saveUserWhitelist() {
    if (!hasDashboardCapability('pendingUserInstallOwners')) return;

    const allowedUserIds = normalizeIds(accessAllowedUserIdsDraft);

    const res = await api('/config', {
        method: 'POST',
        body: JSON.stringify({ allowedUserIds }),
    });

    if (res.ok) {
        currentConfig.allowedUserIds = [...allowedUserIds];
        accessAllowedUserIdsDraft = [...allowedUserIds];
        accessWhitelistDirty = false;
        const budgetRes = await api('/user-budgets');
        const budgetPayload = await budgetRes.json();
        updateAccessUsersFromBudgetPayload(budgetPayload);
        userProfiles = { ...userProfiles, ...(budgetPayload.profiles || {}) };
        updateAccessSaveState();
        renderAllowedUsers();
        showToast('Access settings saved!');
    } else {
        showToast('Save failed', true);
    }
}

function toggleGuildAllowed(guildId, checked) {
    if (!hasDashboardCapability('guildAccess')) return;

    const nextAllowed = new Set(accessAllowedGuildIdsDraft);

    if (checked) {
        nextAllowed.add(guildId);
    } else {
        nextAllowed.delete(guildId);
        accessLensEnabledGuildIdsDraft = accessLensEnabledGuildIdsDraft.filter(
            (id) => id !== guildId,
        );
    }

    setAccessWhitelistDraft([...nextAllowed]);
    renderGuilds();
}

function toggleGuildLens(guildId, checked) {
    if (!hasDashboardCapability('guildAccess')) return;

    const nextAllowed = new Set(accessAllowedGuildIdsDraft);
    const nextEnabled = new Set(accessLensEnabledGuildIdsDraft);
    if (checked) {
        nextAllowed.add(guildId);
        nextEnabled.add(guildId);
    } else {
        nextEnabled.delete(guildId);
    }

    accessAllowedGuildIdsDraft = [...nextAllowed];
    setLensGuildDraft([...nextEnabled]);
    renderGuilds();
}

function renderGuilds() {
    if (!hasDashboardCapability('guildAccess')) return;

    const container = document.getElementById('guild-list');
    if (!container) return;
    const allowed = accessAllowedGuildIdsDraft;
    const lensEnabled = accessLensEnabledGuildIdsDraft;
    const globalBudget = currentConfig.monthlyBudgetUsd || 0;

    const knownIds = new Set(allGuilds.map((g) => g.id));
    manualGuildIds = normalizeIds([...allowed, ...lensEnabled]).filter((id) => !knownIds.has(id));

    const allItems = [
        ...allGuilds.map((g) => ({ ...g, manual: false })),
        ...manualGuildIds.map((id) => ({ id, name: id, manual: true })),
    ];

    if (allItems.length === 0) {
        container.innerHTML =
            '<div class="no-guilds">Bot is not in any servers. Paste a Guild ID below to add manually.</div>';
        document.getElementById('guild-pagination').innerHTML = '';
        const detail = document.getElementById('guild-detail');
        if (detail) detail.innerHTML = '<div class="empty-state">No servers available.</div>';
        return;
    }

    const totalPages = Math.max(Math.ceil(allItems.length / guildPageSize), 1);
    guildPage = Math.min(guildPage, totalPages);
    const start = (guildPage - 1) * guildPageSize;
    const pageItems = allItems.slice(start, start + guildPageSize);
    if (!pageItems.some((item) => item.id === selectedGuildId)) selectedGuildId = pageItems[0].id;
    const selected = pageItems.find((item) => item.id === selectedGuildId);

    container.innerHTML = pageItems
        .map((guild) => {
            const translation = allowed.includes(guild.id);
            const lens = lensEnabled.includes(guild.id);
            return `<button class="access-master-item${guild.id === selectedGuildId ? ' active' : ''}" ${actionAttrs('selectGuildAccess', [guild.id])}>
          <img src="${escapeHtml(guild.icon || genAvatar(guild.name || guild.id))}" alt="">
          <span><strong>${escapeHtml(guild.name || guild.id)}</strong><small>${guild.manual ? 'Manual ID' : escapeHtml(guild.memberCount ?? '?') + ' members'}</small></span>
          <span class="access-master-status">${translation ? 'Translation' : 'Off'}${lens ? ' + Lens' : ''}</span>
        </button>`;
        })
        .join('');

    if (selected) {
        const checked = allowed.includes(selected.id);
        const lensChecked = lensEnabled.includes(selected.id);
        const bd = guildBudgetData[selected.id];
        const hasCustomBudget = bd && bd.budget >= 0;
        const effectiveBudget = hasCustomBudget ? bd.budget : globalBudget;
        const monthlyCost = bd ? bd.usage.totalCost : 0;
        const effectiveLimits = bd?.limits || {
            budgetFiveHourPercent: currentConfig.budgetFiveHourPercent ?? 5,
            budgetSevenDayPercent: currentConfig.budgetSevenDayPercent ?? 30,
            budgetFairShareMultiplier: currentConfig.budgetFairShareMultiplier ?? 1.5,
        };
        const limitOverrides = bd?.limitOverrides || {};
        const hasLimitOverrides = Object.keys(limitOverrides).length > 0;
        const budgetLabel = hasCustomBudget
            ? formatUsd(effectiveBudget)
            : globalBudget > 0
              ? formatUsd(globalBudget) + ' (global)'
              : 'Unlimited';
        const escapedId = escapeHtml(selected.id);
        const escapedName = escapeHtml(selected.name || selected.id);
        const featureControls = `<div class="guild-feature-row" role="group" aria-label="Feature access for ${escapedName}">
        <div class="guild-feature-control"><span class="guild-feature-label">Translation</span><span class="guild-feature-state${checked ? ' is-enabled' : ''}">${checked ? 'Enabled' : 'Disabled'}</span><label class="toggle"><input type="checkbox" aria-label="Enable Translation for ${escapedName}" data-guild-id="${escapedId}" ${actionAttrs('toggleGuildAllowed', [selected.id], { value: 'checked' })} ${checked ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="guild-feature-control"><span class="guild-feature-label">Babel Lens</span><span class="guild-feature-state${lensChecked ? ' is-enabled' : ''}">${lensChecked ? 'Enabled' : 'Disabled'}</span><label class="toggle"><input type="checkbox" aria-label="Enable Babel Lens for ${escapedName}" data-lens-guild-id="${escapedId}" ${actionAttrs('toggleGuildLens', [selected.id], { value: 'checked' })} ${lensChecked ? 'checked' : ''}><span class="slider"></span></label></div>
      </div>`;
        const routeUsesVision =
            typeof isVisionFallbackRequired !== 'function' || isVisionFallbackRequired();
        const detailHtml = `<button class="access-back-button btn btn-secondary btn-sm" data-action="showAccessMasterList" data-action-args="[&quot;guild&quot;]">Back to servers</button>
          <div class="guild-item guild-item-col access-selected-detail">
        <div class="guild-item-row">
          <img src="${escapeHtml(selected.icon || genAvatar(selected.name || selected.id))}" alt="">
          <span class="guild-name${selected.manual ? ' guild-name-mono' : ''}">${escapedName}</span>
          <span class="guild-members">${selected.manual ? 'manually added' : escapeHtml(selected.memberCount ?? '?') + ' members'}</span>
          ${selected.manual ? `<button class="btn-danger" ${actionAttrs('removeManualGuild', [selected.id])}>Remove</button>` : ''}
        </div>
        ${featureControls}
      <div class="guild-budget-row">
        <div class="guild-budget-info">
          <span class="guild-budget-label">Budget: ${budgetLabel}</span>
          <span class="guild-budget-cost">This month: ${bd ? formatUsd(monthlyCost) + ' · ' + bd.usage.requests + ' req' : '-'}</span>
        </div>
        <div class="guild-budget-actions">
          <input type="number" class="guild-budget-input" id="gb-${escapedId}" min="0" step="0.1"
            placeholder="${hasCustomBudget ? effectiveBudget : 'Global'}"
            value="${hasCustomBudget ? effectiveBudget : ''}"
            title="Set per-server monthly budget (USD). Empty = use global.">
          <button class="btn btn-secondary btn-xs" ${actionAttrs('saveGuildBudget', [selected.id])}>Apply</button>
          ${hasCustomBudget ? `<button class="btn-danger btn-xs" ${actionAttrs('resetGuildBudget', [selected.id])} title="Reset to global">Reset</button>` : ''}
        </div>
      </div>
      <div class="guild-budget-row">
        <div class="guild-budget-info">
          <span class="guild-budget-label">Fair-use limits</span>
          <span class="guild-budget-cost">Effective: 5h ${effectiveLimits.budgetFiveHourPercent}% · 7d ${effectiveLimits.budgetSevenDayPercent}% · ${effectiveLimits.budgetFairShareMultiplier}× share</span>
        </div>
        <div class="guild-budget-actions guild-limit-actions">
          <label class="guild-limit-field"><span>5h %</span><input type="number" class="guild-budget-input" id="gbl5-${escapedId}" min="0.1" max="100" step="0.1" placeholder="${effectiveLimits.budgetFiveHourPercent}" value="${limitOverrides.budgetFiveHourPercent ?? ''}" title="Leave empty to inherit the global five-hour limit."></label>
          <label class="guild-limit-field"><span>7d %</span><input type="number" class="guild-budget-input" id="gbl7-${escapedId}" min="0.1" max="100" step="0.1" placeholder="${effectiveLimits.budgetSevenDayPercent}" value="${limitOverrides.budgetSevenDayPercent ?? ''}" title="Leave empty to inherit the global seven-day limit."></label>
          <label class="guild-limit-field"><span>Share ×</span><input type="number" class="guild-budget-input" id="gblf-${escapedId}" min="1" step="0.1" placeholder="${effectiveLimits.budgetFairShareMultiplier}" value="${limitOverrides.budgetFairShareMultiplier ?? ''}" title="Leave empty to inherit the global fair-share multiplier."></label>
          <button class="btn btn-secondary btn-xs" ${actionAttrs('saveGuildBudgetLimits', [selected.id])}>Apply</button>
          ${hasLimitOverrides ? `<button class="btn-danger btn-xs" ${actionAttrs('resetGuildBudgetLimits', [selected.id])}>Reset</button>` : ''}
        </div>
      </div>
      ${routeUsesVision ? renderVisionLimitControl('guild', selected.id, bd) : ''}
    </div>`;
        const detail = document.getElementById('guild-detail');
        if (detail) detail.innerHTML = detailHtml;
        else container.innerHTML += detailHtml;
    }

    renderPagination('guild-pagination', {
        total: allItems.length,
        page: guildPage,
        pageSize: guildPageSize,
        onPageChange: 'setGuildPage',
        onSizeChange: 'setGuildPageSize',
    });
}

function selectGuildAccess(guildId) {
    selectedGuildId = guildId;
    renderGuilds();
    document.getElementById('guild-detail')?.parentElement?.classList.add('show-detail');
}

function showAccessMasterList(scope) {
    const id = scope === 'user' ? 'user-access-detail' : 'guild-detail';
    document.getElementById(id)?.parentElement?.classList.remove('show-detail');
}

function setGuildPage(p) {
    guildPage = p;
    selectedGuildId = '';
    renderGuilds();
}
function setGuildPageSize(s) {
    guildPageSize = s;
    guildPage = 1;
    selectedGuildId = '';
    renderGuilds();
}

async function saveGuildBudget(guildId) {
    if (!hasDashboardCapability('guildAccess')) return;

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
        body: JSON.stringify({ monthlyBudgetUsd: budget }),
    });

    if (res.ok) {
        showToast('Guild budget saved!');
        await reloadGuildBudgetData();
    } else {
        showToast('Save failed', true);
    }
}

async function resetGuildBudget(guildId) {
    if (!hasDashboardCapability('guildAccess')) return;

    const res = await api('/guild-budgets/' + guildId, {
        method: 'POST',
        body: JSON.stringify({ monthlyBudgetUsd: null }),
    });

    if (res.ok) {
        showToast('Reset to global budget');
        await reloadGuildBudgetData();
    } else {
        showToast('Reset failed', true);
    }
}

async function saveGuildBudgetLimits(guildId) {
    if (!hasDashboardCapability('guildAccess')) return;

    const fields = [
        ['budgetFiveHourPercent', 'gbl5-'],
        ['budgetSevenDayPercent', 'gbl7-'],
        ['budgetFairShareMultiplier', 'gblf-'],
    ];
    const budgetLimitOverrides = {};
    for (const [key, prefix] of fields) {
        const value = document.getElementById(prefix + guildId).value.trim();
        if (!value) continue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            showToast('Invalid budget limit', true);
            return;
        }
        budgetLimitOverrides[key] = parsed;
    }

    const res = await api('/guild-budgets/' + guildId, {
        method: 'POST',
        body: JSON.stringify({ budgetLimitOverrides }),
    });
    if (res.ok) {
        showToast('Guild fair-use limits saved!');
        await reloadGuildBudgetData();
    } else {
        const error = await res.json().catch(() => ({}));
        showToast(error.error || 'Save failed', true);
    }
}

async function resetGuildBudgetLimits(guildId) {
    if (!hasDashboardCapability('guildAccess')) return;

    const res = await api('/guild-budgets/' + guildId, {
        method: 'POST',
        body: JSON.stringify({ budgetLimitOverrides: null }),
    });
    if (res.ok) {
        showToast('Reset to global fair-use limits');
        await reloadGuildBudgetData();
    } else {
        showToast('Reset failed', true);
    }
}

async function reloadGuildBudgetData() {
    const budgetRes = await api('/guild-budgets');
    guildBudgetData = await budgetRes.json();
    renderGuilds();
}

function addManualGuild() {
    if (!hasDashboardCapability('guildAccess')) return;

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
    selectedGuildId = id;
    input.value = '';
    renderGuilds();
    showToast('Guild added — click Save to apply');
}

function removeManualGuild(id) {
    if (!hasDashboardCapability('guildAccess')) return;

    setAccessWhitelistDraft(accessAllowedGuildIdsDraft.filter((g) => g !== id));
    setLensGuildDraft(accessLensEnabledGuildIdsDraft.filter((g) => g !== id));
    renderGuilds();
    renderGlossaryGuildSelect();
    showToast('Guild removed — click Save to apply');
}

// ===== Server Glossary =====

function getGlossaryGuildOptions() {
    if (!hasDashboardCapability('guildGlossary')) return [];

    const known = allGuilds.map((g) => ({ id: g.id, name: g.name || g.id }));
    const knownIds = new Set(known.map((g) => g.id));
    const manual = accessAllowedGuildIdsDraft
        .filter((id) => !knownIds.has(id))
        .map((id) => ({ id, name: id }));

    return [...known, ...manual].sort((a, b) => a.name.localeCompare(b.name));
}

function renderGlossaryGuildSelect() {
    if (!hasDashboardCapability('guildGlossary')) return;

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
                `<option value="${escapeHtml(guild.id)}" ${guild.id === glossaryGuildId ? 'selected' : ''}>${escapeHtml(guild.name)}</option>`,
        )
        .join('');

    loadGlossaryEntries();
}

async function selectGlossaryGuild(guildId) {
    if (!hasDashboardCapability('guildGlossary')) return;

    glossaryGuildId = guildId || '';
    resetGlossaryForm();
    await loadGlossaryEntries();
}

async function loadGlossaryEntries() {
    if (!hasDashboardCapability('guildGlossary')) return;

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
    if (!hasDashboardCapability('guildGlossary')) return;

    const container = document.getElementById('glossary-container');
    if (!container) return;

    if (!glossaryGuildId) {
        container.innerHTML =
            '<div class="empty-state">Select a server to manage glossary terms.</div>';
        return;
    }

    if (glossaryEntries.length === 0) {
        container.innerHTML =
            '<div class="empty-state">No glossary terms for this server yet.</div>';
        return;
    }

    const rows = glossaryEntries
        .map(
            (entry) => `<tr>
      <td class="mono">${escapeHtml(entry.sourceText)}</td>
      <td class="mono">${escapeHtml(entry.targetLanguage || 'auto')}</td>
      <td class="mono">${escapeHtml(entry.targetText)}</td>
      <td class="dim">${entry.notes ? escapeHtml(entry.notes) : '-'}</td>
      <td>
        <button class="btn btn-secondary btn-xs" ${actionAttrs('editGlossaryEntry', [entry.id])}>Edit</button>
        <button class="btn-danger" ${actionAttrs('deleteGlossaryEntry', [entry.id])}>Delete</button>
      </td>
    </tr>`,
        )
        .join('');

    container.innerHTML = `<div class="table-scroll"><table class="data-table glossary-table">
      <thead><tr><th>Source</th><th>Language</th><th>Target</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function resetGlossaryForm() {
    if (!hasDashboardCapability('guildGlossary')) return;

    document.getElementById('glossary-entry-id').value = '';
    document.getElementById('glossary-source').value = '';
    document.getElementById('glossary-target-language').value = 'auto';
    document.getElementById('glossary-target').value = '';
    document.getElementById('glossary-notes').value = '';
}

function openGlossaryEditor() {
    if (!hasDashboardCapability('guildGlossary')) return;
    resetGlossaryForm();
    const title = document.getElementById('glossary-dialog-title');
    if (title) title.textContent = 'Add Glossary Term';
    document.getElementById('glossary-editor-dialog')?.showModal?.();
}

function closeGlossaryEditor() {
    document.getElementById('glossary-editor-dialog')?.close?.();
}

function openGlossaryImport() {
    if (!hasDashboardCapability('guildGlossary')) return;
    document.getElementById('glossary-import-dialog')?.showModal?.();
}

function closeGlossaryImport() {
    document.getElementById('glossary-import-dialog')?.close?.();
}

function selectedGlossaryImportMode() {
    const selected = document.querySelector('input[name="glossary-import-mode"]:checked');
    return selected?.value === 'overwrite' ? 'overwrite' : 'skip';
}

function renderGlossaryImportResult(result) {
    const container = document.getElementById('glossary-import-result');
    if (!container) return;

    const errors = Array.isArray(result.errors) ? result.errors : [];
    const summary = [
        `Created ${result.created || 0}`,
        `Updated ${result.updated || 0}`,
        `Skipped ${result.skipped || 0}`,
        `Failed ${result.failed || 0}`,
    ].join(' · ');
    const errorRows = errors
        .slice(0, 8)
        .map((error) => `<li>Line ${escapeHtml(error.line)}: ${escapeHtml(error.error)}</li>`)
        .join('');
    const more =
        errors.length > 8 ? `<div class="dim">+${errors.length - 8} more errors</div>` : '';

    container.hidden = false;
    container.innerHTML = `<strong>${escapeHtml(summary)}</strong>${
        errorRows ? `<ul>${errorRows}</ul>${more}` : ''
    }`;
}

function clearGlossaryImport() {
    if (!hasDashboardCapability('guildGlossary')) return;

    const file = document.getElementById('glossary-import-file');
    const fileName = document.getElementById('glossary-import-file-name');
    const text = document.getElementById('glossary-import-text');
    const result = document.getElementById('glossary-import-result');
    if (file) file.value = '';
    if (fileName) fileName.textContent = 'No file selected';
    if (text) text.value = '';
    if (result) {
        result.hidden = true;
        result.innerHTML = '';
    }
}

function readGlossaryImportFile(input) {
    if (!hasDashboardCapability('guildGlossary')) return;

    const file = input.files && input.files[0];
    if (!file) return;

    const fileName = document.getElementById('glossary-import-file-name');
    if (fileName) fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = () => {
        const text = document.getElementById('glossary-import-text');
        if (text) text.value = String(reader.result || '');
    };
    reader.onerror = () => showToast('Failed to read import file', true);
    reader.readAsText(file);
}

function editGlossaryEntry(entryId) {
    if (!hasDashboardCapability('guildGlossary')) return;

    const entry = glossaryEntries.find((item) => item.id === entryId);
    if (!entry) return;

    document.getElementById('glossary-entry-id').value = entry.id;
    document.getElementById('glossary-source').value = entry.sourceText;
    document.getElementById('glossary-target-language').value = entry.targetLanguage || 'auto';
    document.getElementById('glossary-target').value = entry.targetText;
    document.getElementById('glossary-notes').value = entry.notes || '';
    const title = document.getElementById('glossary-dialog-title');
    if (title) title.textContent = 'Edit Glossary Term';
    document.getElementById('glossary-editor-dialog')?.showModal?.();
}

async function saveGlossaryEntry() {
    if (!hasDashboardCapability('guildGlossary')) return;

    if (!glossaryGuildId) {
        showToast('Select a server first', true);
        return;
    }

    const id = document.getElementById('glossary-entry-id').value;
    const sourceText = document.getElementById('glossary-source').value.trim();
    const targetLanguage = document.getElementById('glossary-target-language').value.trim();
    const targetText = document.getElementById('glossary-target').value.trim();
    const notes = document.getElementById('glossary-notes').value.trim();

    if (!sourceText || !targetLanguage || !targetText) {
        showToast('Source, language, and target are required', true);
        return;
    }

    const res = await api('/guild-glossary/' + glossaryGuildId, {
        method: 'POST',
        body: JSON.stringify({
            ...(id ? { id: Number(id) } : {}),
            sourceText,
            targetLanguage,
            targetText,
            notes,
        }),
    });

    if (res.ok) {
        resetGlossaryForm();
        closeGlossaryEditor();
        await loadGlossaryEntries();
        showToast('Glossary term saved');
    } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Save failed', true);
    }
}

async function importGlossaryEntries() {
    if (!hasDashboardCapability('guildGlossary')) return;

    if (!glossaryGuildId) {
        showToast('Select a server first', true);
        return;
    }

    const text = document.getElementById('glossary-import-text').value.trim();
    if (!text) {
        showToast('Import text is required', true);
        return;
    }

    const res = await api('/guild-glossary/' + glossaryGuildId + '/import', {
        method: 'POST',
        body: JSON.stringify({
            text,
            duplicateMode: selectedGlossaryImportMode(),
        }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
        renderGlossaryImportResult(data);
        await loadGlossaryEntries();
        showToast('Glossary import complete' + (data.failed ? ' with errors' : ''));
    } else {
        showToast(data.error || 'Import failed', true);
    }
}

async function deleteGlossaryEntry(entryId) {
    if (!hasDashboardCapability('guildGlossary')) return;

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

// ===== Pocket User Whitelist =====

function renderAllowedUsers() {
    if (!hasDashboardCapability('pendingUserInstallOwners')) return;

    const container = document.getElementById('user-access-list');
    if (!container) return;

    const allowed = accessUserIds;
    const enabledIds = new Set(accessAllowedUserIdsDraft);
    const defaultBudget = currentConfig.defaultUserMonthlyBudgetUsd || 0;

    if (allowed.length === 0) {
        container.innerHTML =
            '<div class="no-guilds">No users have requested access yet. Paste a Discord User ID below to add one.</div>';
        document.getElementById('user-access-pagination').innerHTML = '';
        const detail = document.getElementById('user-access-detail');
        if (detail) detail.innerHTML = '<div class="empty-state">No users available.</div>';
        return;
    }

    const totalPages = Math.max(Math.ceil(allowed.length / allowedUsersPageSize), 1);
    allowedUsersPage = Math.min(allowedUsersPage, totalPages);
    const start = (allowedUsersPage - 1) * allowedUsersPageSize;
    const pageItems = allowed.slice(start, start + allowedUsersPageSize);
    if (!pageItems.includes(selectedAccessUserId)) selectedAccessUserId = pageItems[0];

    container.innerHTML = pageItems
        .map((userId) => {
            const enabled = enabledIds.has(userId);
            const pending = Boolean(userBudgetData[userId]?.pending) && !enabled;
            return `<button class="access-master-item${userId === selectedAccessUserId ? ' active' : ''}" ${actionAttrs('selectAccessUser', [userId])}>
          <img src="${escapeHtml(userAvatar(userId))}" alt="">
          <span><strong>${escapeHtml(userDisplayName(userId))}</strong><small>${escapeHtml(userId)}</small></span>
          <span class="access-master-status">${enabled ? 'Enabled' : pending ? 'Pending' : 'Disabled'}</span>
        </button>`;
        })
        .join('');

    const userId = selectedAccessUserId;
    if (userId) {
        const budgetData = userBudgetData[userId];
        const enabled = enabledIds.has(userId);
        const pending = Boolean(budgetData?.pending) && !enabled;
        const hasCustomBudget = budgetData && budgetData.isCustom;
        const effectiveBudget = hasCustomBudget ? budgetData.budget : defaultBudget;
        const budgetLabel = hasCustomBudget
            ? formatUsd(effectiveBudget)
            : defaultBudget > 0
              ? formatUsd(defaultBudget) + ' (default)'
              : 'Unlimited';
        const routeUsesVision =
            typeof isVisionFallbackRequired !== 'function' || isVisionFallbackRequired();
        const detailHtml = `<button class="access-back-button btn btn-secondary btn-sm" data-action="showAccessMasterList" data-action-args="[&quot;user&quot;]">Back to users</button>
          <div class="guild-item guild-item-col access-selected-detail">
      <div class="guild-item-row">
        <img src="${escapeHtml(userAvatar(userId))}" alt="">
        <span class="guild-name">${renderUserIdentity(userId)}</span>
        <span class="guild-members user-access-state">
          <span class="badge ${enabled ? 'badge-green' : pending ? 'badge-yellow' : 'badge-red'}">
            ${enabled ? 'Enabled' : pending ? 'Pending' : 'Disabled'}
          </span>
        </span>
        <label class="toggle user-access-toggle" title="${enabled ? 'Disable this user' : 'Enable this user'}">
          <input type="checkbox" ${enabled ? 'checked' : ''} ${actionAttrs('setAllowedUserEnabled', [userId], { value: 'checked' })}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="guild-budget-row">
        <div class="guild-budget-info">
          <span class="guild-budget-label">Budget: ${budgetLabel}</span>
        </div>
        <div class="guild-budget-actions">
          <input type="number" class="guild-budget-input" id="ub-${escapeHtml(userId)}" min="0" step="0.1"
            placeholder="${hasCustomBudget ? effectiveBudget : 'Default'}"
            value="${hasCustomBudget ? effectiveBudget : ''}"
            title="Set per-user monthly budget (USD). Empty = use default.">
          <button class="btn btn-secondary btn-xs" ${actionAttrs('saveUserBudget', [userId])}>Apply</button>
          ${hasCustomBudget ? `<button class="btn-danger btn-xs" ${actionAttrs('resetUserBudget', [userId])} title="Reset to default">Reset</button>` : ''}
        </div>
      </div>
      ${routeUsesVision ? renderVisionLimitControl('user', userId, budgetData) : ''}
    </div>`;
        const detail = document.getElementById('user-access-detail');
        if (detail) detail.innerHTML = detailHtml;
        else container.innerHTML += detailHtml;
    }

    renderPagination('user-access-pagination', {
        total: allowed.length,
        page: allowedUsersPage,
        pageSize: allowedUsersPageSize,
        onPageChange: 'setAllowedUsersPage',
        onSizeChange: 'setAllowedUsersPageSize',
    });
}

function selectAccessUser(userId) {
    selectedAccessUserId = userId;
    renderAllowedUsers();
    document.getElementById('user-access-detail')?.parentElement?.classList.add('show-detail');
}

function setAllowedUsersPage(p) {
    allowedUsersPage = p;
    selectedAccessUserId = '';
    renderAllowedUsers();
}
function setAllowedUsersPageSize(s) {
    allowedUsersPageSize = s;
    allowedUsersPage = 1;
    selectedAccessUserId = '';
    renderAllowedUsers();
}

function addAllowedUser() {
    if (!hasDashboardCapability('pendingUserInstallOwners')) return;

    const input = document.getElementById('add-user-input');
    const id = input.value.trim();
    if (!id || !/^\d+$/.test(id)) {
        showToast('Please enter a valid Discord User ID (numbers only)', true);
        return;
    }

    const nextAllowed = new Set(accessAllowedUserIdsDraft);
    if (nextAllowed.has(id)) {
        showToast('User already in whitelist draft');
        return;
    }

    nextAllowed.add(id);
    setUserAllowlistDraft([...nextAllowed]);
    accessUserIds = normalizeIds([...accessUserIds, id]);
    allowedUsersPage = Math.max(Math.ceil(accessUserIds.length / allowedUsersPageSize), 1);
    selectedAccessUserId = id;
    input.value = '';
    renderAllowedUsers();
    showToast('User added — click Save to apply');
}

function setAllowedUserEnabled(id, enabled) {
    if (!hasDashboardCapability('pendingUserInstallOwners')) return;

    const nextAllowed = new Set(accessAllowedUserIdsDraft);
    if (enabled) {
        nextAllowed.add(id);
    } else {
        nextAllowed.delete(id);
    }

    accessUserIds = normalizeIds([...accessUserIds, id]);
    setUserAllowlistDraft([...nextAllowed]);
    renderAllowedUsers();
    showToast(`${enabled ? 'User enabled' : 'User disabled'} — click Save to apply`);
}

async function saveUserBudget(userId) {
    if (!hasDashboardCapability('pendingUserInstallOwners')) return;

    const input = document.getElementById('ub-' + userId);
    const val = input.value.trim();

    if (val === '') {
        return resetUserBudget(userId);
    }

    const budget = parseFloat(val);
    if (isNaN(budget) || budget < 0) {
        showToast('Invalid budget value', true);
        return;
    }

    const res = await api('/user-budgets/' + userId, {
        method: 'POST',
        body: JSON.stringify({ monthlyBudgetUsd: budget }),
    });

    if (res.ok) {
        showToast('User budget saved!');
        const budgetRes = await api('/user-budgets');
        const budgetPayload = await budgetRes.json();
        updateAccessUsersFromBudgetPayload(budgetPayload);
        userProfiles = { ...userProfiles, ...(budgetPayload.profiles || {}) };
        renderAllowedUsers();
    } else {
        showToast('Save failed', true);
    }
}

async function resetUserBudget(userId) {
    if (!hasDashboardCapability('pendingUserInstallOwners')) return;

    const res = await api('/user-budgets/' + userId, {
        method: 'POST',
        body: JSON.stringify({ monthlyBudgetUsd: null }),
    });

    if (res.ok) {
        showToast('Reset to default user budget');
        const budgetRes = await api('/user-budgets');
        const budgetPayload = await budgetRes.json();
        updateAccessUsersFromBudgetPayload(budgetPayload);
        userProfiles = { ...userProfiles, ...(budgetPayload.profiles || {}) };
        renderAllowedUsers();
    } else {
        showToast('Reset failed', true);
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

let allPrefsData = [];
let userProfiles = {};
let prefsPage = 1,
    prefsPageSize = 15;
let prefsSearch = '';
let prefsGuildFilter = '';
let selectedPrefUserIds = new Set();

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
        const { entries, profiles } = await res.json();
        allPrefsData = Array.isArray(entries) ? entries : [];
        userProfiles = { ...userProfiles, ...(profiles || {}) };
        prefsPage = 1;
        selectedPrefUserIds = new Set(
            [...selectedPrefUserIds].filter((key) =>
                allPrefsData.some((entry) => prefSelectionKey(entry.guildId, entry.userId) === key),
            ),
        );
        ensurePrefsGuildFilter();
        renderUserPrefs();
    } catch {}
}

function prefSelectionKey(guildId, userId) {
    return `${guildId}\u0000${userId}`;
}

function prefRefFromKey(key) {
    const [guildId, userId] = String(key).split('\u0000');
    return { guildId, userId };
}

function userPrefsUseGuildFilter() {
    return hasDashboardCapability('guildAccess');
}

function prefsGuildOptions() {
    const options = [];
    const byGuildId = new Map();
    const entries = Array.isArray(allPrefsData) ? allPrefsData : [];

    for (const entry of entries) {
        const guildId = String(entry.guildId || '');
        if (!guildId) continue;

        if (!byGuildId.has(guildId)) {
            const option = {
                guildId,
                guildName: entry.guildName || guildId,
                guildIcon: entry.guildIcon || '',
                count: 0,
            };
            byGuildId.set(guildId, option);
            options.push(option);
        }

        byGuildId.get(guildId).count += 1;
    }

    return options;
}

function ensurePrefsGuildFilter() {
    const options = prefsGuildOptions();

    if (options.length === 0) {
        prefsGuildFilter = '';
        return;
    }

    if (!prefsGuildFilter || !options.some((guild) => guild.guildId === prefsGuildFilter)) {
        prefsGuildFilter = options[0].guildId;
    }
}

function selectedPrefsGuild() {
    ensurePrefsGuildFilter();
    return prefsGuildOptions().find((guild) => guild.guildId === prefsGuildFilter) || null;
}

function renderPrefsGuildFilter() {
    const select = document.getElementById('prefs-guild-filter');
    if (!select) return;
    const useGuildFilter = userPrefsUseGuildFilter();

    select.hidden = !useGuildFilter;
    if (!useGuildFilter) {
        select.disabled = true;
        select.innerHTML = '';
        select.value = '';
        return;
    }

    const options = prefsGuildOptions();
    if (options.length === 0) {
        select.disabled = true;
        select.innerHTML = '<option value="">No servers with preferences</option>';
        select.value = '';
        return;
    }

    select.disabled = false;
    select.innerHTML = options
        .map((guild) => {
            const selected = guild.guildId === prefsGuildFilter ? 'selected' : '';
            return `<option value="${escapeHtml(guild.guildId)}" ${selected}>${escapeHtml(guild.guildName)} (${guild.count})</option>`;
        })
        .join('');
    select.value = prefsGuildFilter;
}

function filteredPrefsEntries() {
    const query = prefsSearch.trim().toLowerCase();
    const useGuildFilter = userPrefsUseGuildFilter();
    if (useGuildFilter) {
        ensurePrefsGuildFilter();
    }
    const entries = (Array.isArray(allPrefsData) ? allPrefsData : []).filter((entry) =>
        useGuildFilter ? String(entry.guildId || '') === prefsGuildFilter : !entry.guildId,
    );

    if (!query) return entries;

    return entries.filter((entry) => {
        const name = LANG_NAMES[entry.language] || entry.language;
        return (
            String(entry.guildId).toLowerCase().includes(query) ||
            String(entry.guildName || '')
                .toLowerCase()
                .includes(query) ||
            String(entry.userId).toLowerCase().includes(query) ||
            userSearchText(entry.userId).includes(query) ||
            String(entry.language).toLowerCase().includes(query) ||
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
    if (!container) return;
    const useGuildFilter = userPrefsUseGuildFilter();
    if (useGuildFilter) {
        ensurePrefsGuildFilter();
    }
    renderPrefsGuildFilter();

    const selectedGuild = useGuildFilter ? selectedPrefsGuild() : null;
    const entries = filteredPrefsEntries();
    const count = document.getElementById('prefs-count');

    if (useGuildFilter && !selectedGuild) {
        container.innerHTML =
            '<div class="empty-state">No user language preferences have been saved yet.</div>';
        document.getElementById('prefs-pagination').innerHTML = '';
        if (count) count.textContent = '0 server user setting(s)';
        updatePrefBatchState();
        return;
    }

    if (count) {
        if (selectedGuild) {
            const selectedGuildName = selectedGuild.guildName || selectedGuild.guildId;
            count.textContent = `${entries.length} shown in ${selectedGuildName} / ${allPrefsData.length} total`;
        } else {
            count.textContent = `${entries.length} shown / ${allPrefsData.length} total`;
        }
    }

    if (entries.length === 0) {
        container.innerHTML = useGuildFilter
            ? '<div class="empty-state">No matching user language preferences in this server.</div>'
            : '<div class="empty-state">No matching user language preferences.</div>';
        document.getElementById('prefs-pagination').innerHTML = '';
        updatePrefBatchState();
        return;
    }

    const totalPages = Math.max(Math.ceil(entries.length / prefsPageSize), 1);
    prefsPage = Math.min(prefsPage, totalPages);
    const start = (prefsPage - 1) * prefsPageSize;
    const pageEntries = entries.slice(start, start + prefsPageSize);

    const heading = selectedGuild
        ? `<div class="user-prefs-guild-heading">
        ${selectedGuild.guildIcon ? `<img src="${escapeHtml(selectedGuild.guildIcon)}" alt="">` : ''}
        <span>${escapeHtml(selectedGuild.guildName || selectedGuild.guildId)}</span>
        <span class="user-prefs-guild-id">${escapeHtml(selectedGuild.guildId)}</span>
      </div>`
        : '';
    let html = `<div class="user-prefs-selected-server">
      ${heading}
      <div class="table-scroll"><table class="data-table user-prefs-table"><thead><tr>
        <th></th><th>User</th><th>Language</th><th></th>
      </tr></thead><tbody>`;

    for (const entry of pageEntries) {
        const name = LANG_NAMES[entry.language] || entry.language;
        const key = prefSelectionKey(entry.guildId, entry.userId);
        const checked = selectedPrefUserIds.has(key) ? 'checked' : '';
        html += `<tr>
      <td class="user-prefs-select-cell"><input type="checkbox" aria-label="Select ${escapeHtml(userDisplayName(entry.userId))}" ${actionAttrs('togglePrefSelection', [entry.guildId, entry.userId], { value: 'checked' })} ${checked}></td>
      <td data-label="User">${renderUserIdentity(entry.userId, true)}</td>
      <td data-label="Language">${escapeHtml(name)} (${escapeHtml(entry.language)})</td>
      <td data-label="Action"><button class="btn-danger" ${actionAttrs('deleteUserPref', [entry.guildId, entry.userId])}>Delete</button></td>
    </tr>`;
    }

    html += '</tbody></table></div></div>';
    container.innerHTML = html;

    renderPagination('prefs-pagination', {
        total: entries.length,
        page: prefsPage,
        pageSize: prefsPageSize,
        onPageChange: 'setPrefsPage',
        onSizeChange: 'setPrefsPageSize',
    });
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

function setPrefsGuildFilter(guildId) {
    prefsGuildFilter = guildId || '';
    prefsPage = 1;
    selectedPrefUserIds = new Set();
    ensurePrefsGuildFilter();
    renderUserPrefs();
}

function togglePrefSelection(guildId, userId, checked) {
    const key = prefSelectionKey(guildId, userId);
    if (checked) {
        selectedPrefUserIds.add(key);
    } else {
        selectedPrefUserIds.delete(key);
    }

    updatePrefBatchState();
}

async function deleteSelectedUserPrefs() {
    const entries = [...selectedPrefUserIds].map(prefRefFromKey);
    if (entries.length === 0) return;

    const res = await api('/user-prefs/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ entries }),
    });

    if (res.ok) {
        const data = await res.json();
        for (const entry of data.deleted || []) {
            const key = prefSelectionKey(entry.guildId, entry.userId);
            allPrefsData = allPrefsData.filter(
                (pref) => prefSelectionKey(pref.guildId, pref.userId) !== key,
            );
            selectedPrefUserIds.delete(key);
        }
        showToast(`${(data.deleted || []).length} user preference(s) cleared`);
        renderUserPrefs();
    } else {
        showToast('Batch delete failed', true);
    }
}

async function deleteUserPref(guildId, userId) {
    const query = userPrefsUseGuildFilter() ? '?guildId=' + encodeURIComponent(guildId) : '';
    const res = await api('/user-prefs/' + encodeURIComponent(userId) + query, {
        method: 'DELETE',
    });
    if (res.ok) {
        showToast('User preference deleted');
        const key = prefSelectionKey(guildId, userId);
        allPrefsData = allPrefsData.filter(
            (pref) => prefSelectionKey(pref.guildId, pref.userId) !== key,
        );
        selectedPrefUserIds.delete(key);
        document.getElementById('prefs-count').textContent =
            allPrefsData.length + ' server user setting(s)';
        renderUserPrefs();
    } else {
        showToast('Delete failed', true);
    }
}
