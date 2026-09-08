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

function updateVisionLimit(scope, scopeId, limit) {
    return updateBudget(
        scope,
        scopeId,
        { visionMonthlyImageLimit: limit },
        limit === null ? 'Vision limit reset' : 'Vision limit saved',
    );
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
