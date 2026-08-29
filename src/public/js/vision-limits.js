/** Per-server and per-user Babel Lens image limits. */

function renderVisionLimitControl(scope, scopeId, data) {
    const vision = data?.vision || {};
    const images = Number.isSafeInteger(vision.images) ? vision.images : 0;
    const hasCustomLimit = Number.isSafeInteger(vision.limit);
    const limitLabel = hasCustomLimit
        ? `${images} / ${vision.limit} this month`
        : `${images} this month · global cap`;
    const escapedId = escapeHtml(scopeId);

    return `<div class="guild-budget-row">
      <div class="guild-budget-info">
        <span class="guild-budget-label">Vision: ${limitLabel}</span>
      </div>
      <div class="guild-budget-actions">
        <input type="number" class="guild-budget-input" id="vl-${scope}-${escapedId}" min="0" step="1"
          placeholder="Global" value="${hasCustomLimit ? vision.limit : ''}"
          title="Monthly image limit. Empty = global cap only.">
        <button class="btn btn-secondary btn-xs" ${actionAttrs('saveVisionLimit', [scope, scopeId])}>Set</button>
        ${hasCustomLimit ? `<button class="btn-danger btn-xs" ${actionAttrs('resetVisionLimit', [scope, scopeId])} title="Reset to global cap">↺</button>` : ''}
      </div>
    </div>`;
}

async function refreshVisionLimits(scope) {
    if (scope === 'guild') {
        const response = await api('/guild-budgets');
        guildBudgetData = await response.json();
        renderGuilds();
        return;
    }

    const response = await api('/user-budgets');
    const payload = await response.json();
    updateAccessUsersFromBudgetPayload(payload);
    userProfiles = { ...userProfiles, ...(payload.profiles || {}) };
    renderAllowedUsers();
}

async function updateVisionLimit(scope, scopeId, limit) {
    if (scope !== 'guild' && scope !== 'user') return;
    const path = scope === 'guild' ? '/guild-budgets/' : '/user-budgets/';
    const response = await api(path + scopeId, {
        method: 'POST',
        body: JSON.stringify({ visionMonthlyImageLimit: limit }),
    });

    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        showToast(result.error || 'Save failed', true);
        return;
    }

    showToast(limit === null ? 'Vision limit reset' : 'Vision limit saved');
    await refreshVisionLimits(scope);
}

async function saveVisionLimit(scope, scopeId) {
    const input = document.getElementById(`vl-${scope}-${scopeId}`);
    const raw = input?.value.trim() ?? '';
    if (!raw) return resetVisionLimit(scope, scopeId);

    const limit = Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 0) {
        showToast('Vision limit must be a non-negative integer', true);
        return;
    }
    await updateVisionLimit(scope, scopeId, limit);
}

async function resetVisionLimit(scope, scopeId) {
    await updateVisionLimit(scope, scopeId, null);
}
