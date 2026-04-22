'use strict';

(async function () {

  // ── Version ───────────────────────────────────────────────────────────────────
  document.getElementById('ext-version').textContent = 'v' + chrome.runtime.getManifest().version;

  // ── Collapsible sections ──────────────────────────────────────────────────────
  [['howto-header', 'howto-body'], ['history-header', 'history-body']].forEach(([hId, bId]) => {
    const header = document.getElementById(hId);
    const body   = document.getElementById(bId);
    header.addEventListener('click', (e) => {
      // Don't collapse when clicking clear button inside history header.
      if (e.target.closest('.btn-clear')) return;
      const open = body.classList.toggle('open');
      header.classList.toggle('open', open);
    });
  });

  // ── Paste history ─────────────────────────────────────────────────────────────
  const listEl  = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');

  async function decompressTSV(b64) {
    try {
      const bin    = atob(b64);
      const bytes  = Uint8Array.from(bin, c => c.charCodeAt(0));
      const ds     = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const chunks = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out   = new Uint8Array(total);
      let   off   = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return new TextDecoder().decode(out);
    } catch { return null; }
  }

  let _histData = [];

  function renderHistory(hist) {
    _histData = hist?.length ? hist.slice(0, 10) : [];
    countEl.textContent = _histData.length ? `${_histData.length}` : '';
    if (!_histData.length) {
      listEl.innerHTML = '<div class="history-empty">No paste history yet.</div>';
      return;
    }
    listEl.innerHTML = _histData.map((e, i) => {
      const icon      = e.mode === 'table' ? '⊞' : '≡';
      const count     = e.mode === 'table'
        ? (e.filled === e.total ? `${e.filled} cells` : `${e.filled}/${e.total} cells`)
        : `${e.filled} field${e.filled !== 1 ? 's' : ''}`;
      const host      = e.host || (() => { try { return new URL(e.url).hostname; } catch { return e.url; } })();
      const canRepeat = !!e.z;
      const previewHtml = e.preview
        ? `<div class="history-preview">${escHtml(e.preview)}</div>`
        : '';
      const metaHtml  = `<div class="history-meta">${escHtml(host)} · ${escHtml(count)}${canRepeat ? ' · <span class="history-replay">↩ re-use</span>' : ''}</div>`;
      return `
        <div class="history-item${canRepeat ? ' history-item--clickable' : ''}" data-idx="${i}" title="${canRepeat ? 'Click to copy data back to clipboard' : ''}">
          <span class="history-icon">${icon}</span>
          <div class="history-info">
            ${previewHtml}
            ${metaHtml}
          </div>
          <span class="history-time">${timeAgo(e.ts)}</span>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.history-item--clickable').forEach(el => {
      el.addEventListener('click', async () => {
        const entry = _histData[+el.dataset.idx];
        if (!entry?.z) return;
        const tsv = await decompressTSV(entry.z);
        if (!tsv) return;
        let copied = false;
        try {
          await navigator.clipboard.writeText(tsv);
          copied = true;
        } catch {
          // Fallback: send to content script on active tab to write clipboard there.
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            copied = await new Promise(resolve => {
              chrome.tabs.sendMessage(tab.id, { type: 'EPF_WRITE_CLIPBOARD', text: tsv }, r => {
                resolve(!chrome.runtime.lastError && r?.ok);
              });
            });
          }
        }
        if (!copied) return;
        el.classList.add('history-item--copied');
        const preview = el.querySelector('.history-preview');
        const orig    = preview?.innerHTML;
        if (preview) preview.innerHTML = '✓ Copied — click first field then Ctrl+V to fill';
        setTimeout(() => {
          el.classList.remove('history-item--copied');
          if (preview && orig !== undefined) preview.innerHTML = orig;
        }, 2500);
      });
    });
  }

  const stored = await new Promise(r => chrome.storage.local.get('epf_paste_history', r));
  renderHistory(stored.epf_paste_history);

  document.getElementById('btn-clear-history').addEventListener('click', () => {
    // Remove all EPF storage keys for a full clean wipe.
    chrome.storage.local.get(null, (all) => {
      const epfKeys = Object.keys(all).filter(k => k.startsWith('epf_'));
      if (epfKeys.length) chrome.storage.local.remove(epfKeys);
    });
    renderHistory([]);
  });

  // ── URL pattern helpers ───────────────────────────────────────────────────────
  function urlMatches(patterns, url) {
    return (patterns || []).some(p => {
      if (p === '*' || p === '<all_urls>') return true;
      try {
        return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url);
      } catch { return false; }
    });
  }

  // ── Page state: active / disabled ────────────────────────────────────────────
  const btnToggle = document.getElementById('btn-add-page');
  let _pattern = null;

  async function getPagePattern() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    try {
      const u = new URL(tab.url);
      if (!['http:', 'https:'].includes(u.protocol)) return null;
      return `${u.protocol}//${u.hostname}/*`;
    } catch { return null; }
  }

  async function loadPageState() {
    _pattern = await getPagePattern();

    const strip  = document.getElementById('status-strip');
    const dot    = document.getElementById('status-dot');
    const label  = document.getElementById('status-label');
    const sub    = document.getElementById('status-sub');
    const banner = document.getElementById('disabled-banner');

    if (!_pattern) {
      // Non-web page (chrome:// etc.)
      label.textContent = 'Not available here';
      sub.textContent   = 'Only works on web pages';
      dot.classList.add('off');
      label.classList.add('off');
      btnToggle.style.display = 'none';
      return;
    }

    const data     = await new Promise(r => chrome.storage.local.get('epf_config', r));
    const cfg      = data.epf_config || {};
    const patterns = cfg.urlPatterns || ['*'];
    const added    = patterns.includes(_pattern);
    const active   = urlMatches(patterns, _pattern.replace('/*', '/'));

    // Query field count from content script only when active.
    let fieldCount = null;
    if (active) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await new Promise(resolve => {
          chrome.tabs.sendMessage(tab.id, { type: 'EPF_GET_STATE' }, resp => {
            if (!chrome.runtime.lastError && resp) fieldCount = resp.fieldCount;
            resolve();
          });
        });
      }
    }

    if (active) {
      strip.classList.remove('inactive');
      dot.classList.remove('off');
      label.classList.remove('off');
      sub.classList.remove('off');
      label.textContent = 'Active on this page';
      sub.textContent   = fieldCount !== null ? `${fieldCount} fillable field${fieldCount !== 1 ? 's' : ''} detected` : 'Refresh page to scan fields';
      banner.classList.remove('show');
    } else {
      strip.classList.add('inactive');
      dot.classList.add('off');
      label.classList.add('off');
      sub.classList.add('off');
      label.textContent = 'Disabled on this page';
      sub.textContent   = 'Add this site to enable the addon';
      banner.classList.add('show');
    }

    // Strip toggle: show when active. "✕ Remove" if pinned, "+ Add this page" if active via wildcard.
    if (active) {
      if (added) {
        btnToggle.textContent = '✕ Remove';
        btnToggle.className   = 'btn-toggle-page remove';
      } else {
        btnToggle.textContent = '+ Add this page';
        btnToggle.className   = 'btn-toggle-page add';
      }
      btnToggle.style.display = '';
      btnToggle.disabled      = false;
    } else {
      btnToggle.style.display = 'none';
    }
  }

  async function togglePage() {
    if (!_pattern) return;
    const data    = await new Promise(r => chrome.storage.local.get('epf_config', r));
    const cfg     = data.epf_config || {};
    let current   = cfg.urlPatterns || ['*'];
    const isAdded = current.includes(_pattern);

    if (isAdded) {
      current = current.filter(p => p !== _pattern);
      if (!current.length) current = ['*'];
    } else {
      current = current.filter(p => p !== '*');
      current = [...current, _pattern];
    }

    cfg.urlPatterns = current;
    await new Promise(r => chrome.storage.local.set({ epf_config: cfg }, r));
    chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: cfg });
    await loadPageState();
  }

  btnToggle.addEventListener('click', togglePage);
  document.getElementById('btn-enable-page').addEventListener('click', togglePage);

  loadPageState();

  // ── Settings button ───────────────────────────────────────────────────────────
  document.getElementById('btn-settings').addEventListener('click', () => {
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
