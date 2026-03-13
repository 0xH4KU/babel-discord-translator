
/**
 * Logs tab: translation log loading, filtering, and pagination.
 */

let currentLogFilter;
let allLogData = [];
let logPage = 1, logPageSize = 15;

function setLogFilter(filter) {
  currentLogFilter = filter;
  document.querySelectorAll('.log-filter-btn').forEach((btn, i) => {
    const filters = [undefined, 'translation', 'error'];
    btn.classList.toggle('active', filters[i] === filter);
  });
  loadLogs();
}

async function loadLogs() {
  try {
    const filterParam = currentLogFilter ? `&filter=${currentLogFilter}` : '';
    const res = await api('/logs?count=200' + filterParam);
    if (!res.ok) return;
    allLogData = await res.json();
    logPage = 1;
    renderLogs();
  } catch { }
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

  let html = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>Time</th><th>Type</th><th>Server</th><th>User</th><th>Detail</th><th>Source</th>
    </tr></thead><tbody>`;

  for (const e of pageData) {
    const time = new Date(e.timestamp).toLocaleTimeString();
    if (e.type === 'error') {
      const errMsg = (e.error || '').replace(/</g, '&lt;');
      html += `<tr style="background:rgba(240,71,71,0.04)">
        <td class="mono dim">${time}</td>
        <td><span class="badge badge-red">Error</span></td>
        <td>${e.guildName}</td>
        <td class="dim">${e.userTag}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${errMsg}">${errMsg}</td>
        <td class="dim">${e.command || ''}</td>
      </tr>`;
    } else {
      const preview = (e.contentPreview || '').replace(/</g, '&lt;');
      const sourceBadge = e.cached
        ? '<span class="badge badge-yellow">Cache</span>'
        : '<span class="badge badge-green">API</span>';
      const langLabel = e.targetLanguage === 'auto' ? 'auto' : e.targetLanguage;
      const langSrc = e.langSource === 'setlang' ? '⚙️' : e.langSource === 'locale' ? '🌐' : '';
      html += `<tr>
        <td class="mono dim">${time}</td>
        <td><span class="badge badge-green">OK</span></td>
        <td>${e.guildName}</td>
        <td class="dim">${e.userTag}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</td>
        <td>${langLabel} ${langSrc} ${sourceBadge}</td>
      </tr>`;
    }
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;

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
