
/**
 * Logs tab: translation log loading, filtering, and pagination.
 */

let currentLogFilter;
let currentErrorTypeFilter;
let allLogData = [];
let logPage = 1, logPageSize = 15;

function createCell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text ?? '';
  return td;
}

function createBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = 'badge ' + className;
  badge.textContent = text;
  return badge;
}

function appendTextBadge(container, label, value) {
  const badge = document.createElement('span');
  badge.className = 'log-diagnostic-badge';
  badge.textContent = label + ': ' + (value || '-');
  container.appendChild(badge);
}

function updateLogFilterButtons() {
  document.querySelectorAll('.log-filter-btn').forEach((btn) => {
    const errorFilter = btn.dataset.errorFilter;
    const filter = btn.dataset.logFilter;
    if (errorFilter) {
      btn.classList.toggle('active', currentErrorTypeFilter === errorFilter);
    } else {
      btn.classList.toggle(
        'active',
        !currentErrorTypeFilter && filter === (currentLogFilter || 'all'),
      );
    }
  });
}

function setLogFilter(filter) {
  currentLogFilter = filter;
  if (filter !== 'error') currentErrorTypeFilter = undefined;
  updateLogFilterButtons();
  loadLogs();
}

function setErrorTypeFilter(errorType) {
  currentLogFilter = 'error';
  currentErrorTypeFilter = currentErrorTypeFilter === errorType ? undefined : errorType;
  updateLogFilterButtons();
  loadLogs();
}

async function loadLogs() {
  try {
    const params = new URLSearchParams({ count: '200' });
    if (currentLogFilter) params.set('filter', currentLogFilter);
    if (currentErrorTypeFilter) params.set('errorType', currentErrorTypeFilter);
    const res = await api('/logs?' + params.toString());
    if (!res.ok) return;
    allLogData = await res.json();
    logPage = 1;
    renderLogs();
  } catch { }
}

function renderHeaderRow(thead) {
  const tr = document.createElement('tr');
  ['Time', 'Type', 'Server', 'User', 'Detail', 'Diagnostic'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}

function createDetailCell(text) {
  const td = document.createElement('td');
  td.className = 'log-detail-cell';
  td.title = text || '';
  td.textContent = text || '';
  return td;
}

function createErrorDetailCell(entry) {
  const td = document.createElement('td');
  const errorText = document.createElement('div');
  errorText.className = 'log-error-text';
  errorText.title = entry.error || '';
  errorText.textContent = entry.error || '';
  td.appendChild(errorText);

  if (entry.suggestedAction) {
    const suggestion = document.createElement('div');
    suggestion.className = 'log-suggestion';
    suggestion.textContent = entry.suggestedAction;
    td.appendChild(suggestion);
  }

  return td;
}

function createTranslationDiagnosticCell(entry) {
  const td = document.createElement('td');
  td.className = 'log-diagnostics';

  const langLabel = entry.targetLanguage === 'auto' ? 'auto' : entry.targetLanguage;
  appendTextBadge(td, 'lang', langLabel);
  appendTextBadge(td, 'source', entry.langSource);
  td.appendChild(createBadge(entry.cached ? 'Cache' : 'API', entry.cached ? 'badge-yellow' : 'badge-green'));

  return td;
}

function createErrorDiagnosticCell(entry) {
  const td = document.createElement('td');
  td.className = 'log-diagnostics';
  appendTextBadge(td, 'provider', entry.provider);
  appendTextBadge(td, 'type', entry.errorType);
  appendTextBadge(td, 'request', entry.requestId);
  return td;
}

function renderLogRow(entry) {
  const tr = document.createElement('tr');
  if (entry.type === 'error') tr.className = 'log-row-error';

  const time = new Date(entry.timestamp).toLocaleTimeString();
  tr.appendChild(createCell(time, 'mono dim'));

  const typeCell = document.createElement('td');
  typeCell.appendChild(createBadge(entry.type === 'error' ? 'Error' : 'OK', entry.type === 'error' ? 'badge-red' : 'badge-green'));
  tr.appendChild(typeCell);

  tr.appendChild(createCell(entry.guildName));
  tr.appendChild(createCell(entry.userTag, 'dim'));

  if (entry.type === 'error') {
    tr.appendChild(createErrorDetailCell(entry));
    tr.appendChild(createErrorDiagnosticCell(entry));
  } else {
    tr.appendChild(createDetailCell(entry.contentPreview));
    tr.appendChild(createTranslationDiagnosticCell(entry));
  }

  return tr;
}

function renderLogs() {
  const container = document.getElementById('log-table-container');
  document.getElementById('log-count').textContent = allLogData.length + ' entries';

  if (allLogData.length === 0) {
    container.innerHTML = '<div class="empty-state">No entries found.</div>';
    document.getElementById('log-pagination').innerHTML = '';
    return;
  }

  const start = (logPage - 1) * logPageSize;
  const pageData = allLogData.slice(start, start + logPageSize);

  const tableScroll = document.createElement('div');
  tableScroll.className = 'table-scroll';

  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  renderHeaderRow(thead);

  const tbody = document.createElement('tbody');
  pageData.forEach((entry) => tbody.appendChild(renderLogRow(entry)));

  table.append(thead, tbody);
  tableScroll.appendChild(table);
  container.replaceChildren(tableScroll);

  renderPagination('log-pagination', {
    total: allLogData.length,
    page: logPage,
    pageSize: logPageSize,
    onPageChange: 'setLogPage',
    onSizeChange: 'setLogPageSize',
  });
}

function setLogPage(p) { logPage = p; renderLogs(); }
function setLogPageSize(s) { logPageSize = s; logPage = 1; renderLogs(); }
