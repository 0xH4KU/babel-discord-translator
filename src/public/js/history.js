/* eslint-disable no-unused-vars */

/**
 * History tab: usage history chart, table, and pagination.
 */

let historyPage = 1, historyPageSize = 15;
let allHistoryData = [];

async function loadHistory() {
  try {
    const res = await api('/usage/history');
    if (!res.ok) return;
    allHistoryData = await res.json();
    historyPage = 1;
    renderHistory();
  } catch { }
}

function renderHistory() {
  const container = document.getElementById('history-table-container');
  const chart = document.getElementById('history-chart');

  if (allHistoryData.length === 0) {
    container.innerHTML = '<div class="empty-state">No history data yet. Usage is archived daily.</div>';
    chart.innerHTML = '';
    document.getElementById('history-summary').textContent = '';
    document.getElementById('history-pagination').innerHTML = '';
    return;
  }

  const totalCost = allHistoryData.reduce((sum, d) => sum + d.cost, 0);
  const totalReqs = allHistoryData.reduce((sum, d) => sum + d.requests, 0);
  document.getElementById('history-summary').textContent =
    `${allHistoryData.length} days · ${totalReqs} requests · ${formatUsd(totalCost)} total`;

  // Bar chart (always shows all data)
  const maxReqs = Math.max(...allHistoryData.map(d => d.requests), 1);
  chart.innerHTML = allHistoryData.map(d => {
    const h = Math.max((d.requests / maxReqs) * 100, 3);
    return `<div class="bar" style="height:${h}%" data-tip="${d.date}: ${d.requests} reqs · ${formatUsd(d.cost)}"></div>`;
  }).join('');

  // Table with pagination (newest first)
  const reversed = [...allHistoryData].reverse();
  const start = (historyPage - 1) * historyPageSize;
  const pageData = reversed.slice(start, start + historyPageSize);

  let html = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>Date</th><th>Requests</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th>
    </tr></thead><tbody>`;

  for (const d of pageData) {
    html += `<tr>
      <td class="mono">${d.date}</td>
      <td>${d.requests}</td>
      <td class="dim">${formatTokens(d.inputTokens)}</td>
      <td class="dim">${formatTokens(d.outputTokens)}</td>
      <td>${formatUsd(d.cost)}</td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;

  renderPagination('history-pagination', {
    total: reversed.length,
    page: historyPage,
    pageSize: historyPageSize,
    onPageChange: 'setHistoryPage',
    onSizeChange: 'setHistoryPageSize',
  });
}

function setHistoryPage(p) { historyPage = p; renderHistory(); }
function setHistoryPageSize(s) { historyPageSize = s; historyPage = 1; renderHistory(); }
