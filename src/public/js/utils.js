
/**
 * Shared utility functions used across all modules.
 * Exposes: show, showToast, api, formatUptime, formatUsd, formatTokens, renderPagination, genAvatar
 */

let _csrfToken = '';

function setCsrfToken(token) { _csrfToken = token || ''; }

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? 'var(--red)' : 'var(--green)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (_csrfToken) headers['x-csrf-token'] = _csrfToken;
  const res = await fetch('/api' + path, { ...opts, headers });
  if (res.status === 401 && path !== '/login' && path !== '/auth/check') {
    show('login-view');
    throw new Error('Session expired');
  }
  return res;
}

function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function formatUsd(n) {
  if (n === 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function genAvatar(name) {
  const c = (name || '?')[0];
  return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2228%22 height=%2228%22><rect width=%2228%22 height=%2228%22 rx=%2214%22 fill=%22%2336393f%22/><text x=%2214%22 y=%2219%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2214%22>${c}</text></svg>`;
}

function renderPagination(targetId, { total, page, pageSize, onPageChange, onSizeChange }) {
  const totalPages = Math.ceil(total / pageSize) || 1;
  const container = document.getElementById(targetId);
  if (total <= pageSize) { container.innerHTML = ''; return; }

  let btns = '';
  btns += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${page - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - page) > 1) {
      if (i === 3 || i === totalPages - 2) btns += '<span style="padding:0 0.3rem">…</span>';
      continue;
    }
    btns += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="${onPageChange}(${i})">${i}</button>`;
  }
  btns += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${page + 1})">›</button>`;

  container.innerHTML = `<div class="pagination">
    <div class="page-info">
      <span>${total} items</span>
      <select onchange="${onSizeChange}(+this.value)">
        ${[15, 25, 50].map(s => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}/page</option>`).join('')}
      </select>
    </div>
    <div class="page-btns">${btns}</div>
  </div>`;
}
