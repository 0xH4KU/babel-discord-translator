/** Guild glossary editing and import. */
let glossaryGuildId = '';
let glossaryEntries = [];

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
