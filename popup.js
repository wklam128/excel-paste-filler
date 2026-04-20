'use strict';

(async function () {

  // ── Field count ───────────────────────────────────────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'EPF_GET_STATE' }, (resp) => {
      const el = document.getElementById('field-count');
      if (chrome.runtime.lastError || !resp) {
        el.textContent = '—';
        el.style.color = '#9ca3af';
      } else {
        el.textContent = `${resp.fieldCount} fields`;
      }
    });
  });

  // ── Paste history ─────────────────────────────────────────────────────────────
  const listEl = document.getElementById('history-list');

  function renderHistory(hist) {
    if (!hist || !hist.length) {
      listEl.innerHTML = '<div class="history-empty">No paste history yet.</div>';
      return;
    }
    listEl.innerHTML = hist.slice(0, 10).map(e => {
      const icon   = e.mode === 'table' ? '⊞' : '≡';
      const detail = e.mode === 'table'
        ? (e.filled === e.total
            ? `Filled ${e.filled} cells`
            : `Filled ${e.filled}/${e.total} cells`)
        : `Filled ${e.filled} field${e.filled !== 1 ? 's' : ''}`;
      const host = e.host || new URL(e.url).hostname;
      return `
        <div class="history-item">
          <span class="history-icon">${icon}</span>
          <div class="history-info">
            <div class="history-host" title="${escHtml(e.url)}">${escHtml(host)}</div>
            <div class="history-detail">${escHtml(detail)}</div>
          </div>
          <span class="history-time">${timeAgo(e.ts)}</span>
        </div>`;
    }).join('');
  }

  const stored = await new Promise(r => chrome.storage.local.get('epf_paste_history', r));
  renderHistory(stored.epf_paste_history);

  document.getElementById('btn-clear-history').addEventListener('click', () => {
    chrome.storage.local.remove('epf_paste_history');
    renderHistory([]);
  });

  // ── Options link ──────────────────────────────────────────────────────────────
  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
