/**
 * content.js  –  Excel Paste Filler
 *
 * Copy a block of cells from Excel (Ctrl+C) → click the top-left cell
 * on the page → Ctrl+V.
 *
 * Each Excel row maps to the corresponding table row.
 * Each Excel column maps to the corresponding table column.
 *
 *   Excel                 Page table
 *   A1  B1  C1    →   row 1 : col1  col2  col3
 *   A2  B2  C2    →   row 2 : col1  col2  col3
 *   A3  B3  C3    →   row 3 : col1  col2  col3
 */

(function () {
  'use strict';

  if (window.__EPF_LOADED__) return;
  window.__EPF_LOADED__ = true;

  // ── Config ───────────────────────────────────────────────────────────────

  let config = {
    urlPatterns:     ['*'],
    showToast:       true,
    highlightFields: true,
    skipEmptyCells:  false,
  };

  // Track the element the user last right-clicked.
  // The context menu click arrives via a background message after the native
  // menu closes, so we must store the target now (during the contextmenu event).
  let _rightClickTarget = null;
  document.addEventListener('contextmenu', e => { _rightClickTarget = e.target; }, true);

  loadConfig().then(cfg => {
    config = cfg;
    if (urlMatches(config.urlPatterns, location.href)) attach();
  });

  // ── Attach listeners ─────────────────────────────────────────────────────

  function attach() {
    document.addEventListener('paste',   onPaste,   true);
    document.addEventListener('keydown', onKeydown, true);

    new MutationObserver(mutations => {
      for (const m of mutations)
        for (const node of m.addedNodes)
          if (node.nodeType === 1) attachDirectTo(node);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function onPaste(e) {
    if (!isFillable(e.target)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    const grid = parseTSV(text);
    if (!grid.length || (grid.length === 1 && grid[0].length <= 1)) return; // single cell → browser
    e.preventDefault();
    e.stopPropagation();
    fillFrom(e.target, grid);
  }

  let _keyguard = false;
  function onKeydown(e) {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v')) return;
    if (!isFillable(e.target)) return;
    const target = e.target;
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      const grid = parseTSV(text);
      if (!grid.length || (grid.length === 1 && grid[0].length <= 1)) return;
      _keyguard = true;
      fillFrom(target, grid);
      setTimeout(() => { _keyguard = false; }, 80);
    }).catch(() => {});
  }

  function onFieldPaste(e) {
    if (_keyguard) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    const grid = parseTSV(text);
    if (!grid.length || (grid.length === 1 && grid[0].length <= 1)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    fillFrom(e.target, grid);
  }

  function attachDirectTo(root) {
    const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([disabled]),'
              + 'textarea:not([disabled]),select:not([disabled]),'
              + '[contenteditable="true"],[contenteditable=""]';
    const els = [];
    if (root.matches?.(sel)) els.push(root);
    root.querySelectorAll?.(sel).forEach(el => els.push(el));
    els.forEach(el => {
      if (el.__epfAttached) return;
      el.__epfAttached = true;
      el.addEventListener('paste', onFieldPaste, true);
    });
  }

  // ── Core dispatcher ───────────────────────────────────────────────────────

  function fillFrom(startEl, grid) {
    const td = startEl.closest('td, th');
    if (td) {
      fillTable(startEl, td, grid);   // async, handles rows + columns
    } else {
      fillScanned(startEl, grid);     // flat fill for regular forms
    }
  }

  // ── Table fill (async, rows × columns) ───────────────────────────────────

  async function fillTable(startEl, startTd, grid) {
    const startRow = startTd.closest('tr');
    if (!startRow) { fillScanned(startEl, grid); return; }

    // All sibling <tr> elements in the same container (tbody / table).
    const container = startRow.parentElement;
    const allRows   = Array.from(container.querySelectorAll(':scope > tr'));
    const rowStart  = allRows.indexOf(startRow);
    if (rowStart === -1) { fillScanned(startEl, grid); return; }

    // Column offset: which cell inside the row are we starting from.
    const startCells = Array.from(startRow.querySelectorAll('td, th'));
    const colStart   = startCells.indexOf(startTd);
    if (colStart === -1) { fillScanned(startEl, grid); return; }

    let totalFilled = 0;
    let totalCells  = 0;

    // Iterate Excel rows.
    for (let r = 0; r < grid.length; r++) {
      const tableRow = allRows[rowStart + r];
      if (!tableRow) break;                             // ran out of table rows

      const rowCells  = Array.from(tableRow.querySelectorAll('td, th'));
      const excelCols = grid[r];

      // Iterate Excel columns for this row.
      for (let c = 0; c < excelCols.length; c++) {
        const val  = excelCols[c];
        if (config.skipEmptyCells && val.trim() === '') continue;

        const cell = rowCells[colStart + c];
        if (!cell) continue;

        totalCells++;

        // Activate the cell so the page renders its <input>.
        activateCell(cell);

        // Wait (up to 300 ms) for a writable element to appear.
        const el = await waitForWritable(cell, 300);
        if (!el) continue;

        if (config.highlightFields) EFF_Autofill.highlightElement(el, '2px solid #f59e0b');

        const ok = writeIntoField(el, val);
        if (ok) {
          if (config.highlightFields) EFF_Autofill.highlightElement(el, '2px solid #22c55e');
          totalFilled++;
        }

        // Yield one tick so the framework can commit the change
        // before we activate the next cell.
        await tick();
      }
    }

    if (config.showToast) {
      const rows = grid.length;
      const cols = grid[0]?.length || 0;
      showToast(
        totalFilled === totalCells
          ? `Filled ${rows} row${rows !== 1 ? 's' : ''} \u00d7 ${cols} column${cols !== 1 ? 's' : ''}`
          : `Filled ${totalFilled} of ${totalCells} cells`,
        totalFilled < totalCells ? 'warn' : 'ok'
      );
    }
    recordHistory(totalFilled, totalCells, 'table');
  }

  // ── Cell activation ───────────────────────────────────────────────────────

  function activateCell(cell) {
    ['mousedown','mouseup','click'].forEach(name =>
      cell.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }))
    );
    cell.focus?.();
    const inner = cell.querySelector(
      'input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled]),[contenteditable]'
    );
    if (inner) {
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      inner.focus();
    }
  }

  // ── Wait for writable element ─────────────────────────────────────────────

  function waitForWritable(cell, timeoutMs) {
    const inputSel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([disabled]),'
                   + 'textarea:not([disabled]),select:not([disabled])';

    return new Promise(resolve => {
      // Already there?
      const immediate = findVisible(cell, inputSel) || (cell.isContentEditable ? cell : null);
      if (immediate) return resolve(immediate);

      let done = false;
      function finish(el) {
        if (done) return; done = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timer);
        resolve(el);
      }

      const observer = new MutationObserver(() => {
        const el = findVisible(cell, inputSel);
        if (el) finish(el);
      });
      observer.observe(cell, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['contenteditable','type','disabled'] });

      const poll  = setInterval(() => {
        const el = findVisible(cell, inputSel) || (cell.isContentEditable ? cell : null);
        if (el) finish(el);
      }, 30);

      const timer = setTimeout(() => finish(cell.isContentEditable ? cell : null), timeoutMs);
    });
  }

  // ── Write value ───────────────────────────────────────────────────────────

  function writeIntoField(el, rawValue) {
    const value = String(rawValue);
    const tag   = el.tagName.toLowerCase();
    const type  = (el.getAttribute('type') || '').toLowerCase();

    try {
      if (tag === 'select') {
        const lv  = value.toLowerCase().trim();
        const opt = Array.from(el.options).find(o => o.value.toLowerCase() === lv)
                 || Array.from(el.options).find(o => o.text.trim().toLowerCase() === lv)
                 || Array.from(el.options).find(o => o.text.trim().toLowerCase().includes(lv));
        if (!opt) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter ? setter.call(el, opt.value) : (el.value = opt.value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        return true;
      }

      if (type === 'checkbox') {
        const checked = ['true','1','yes','on','checked'].includes(value.toLowerCase());
        if (el.checked !== checked) {
          el.checked = checked;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }

      if (type === 'radio') {
        document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`).forEach(r => {
          if (r.value.toLowerCase() === value.toLowerCase() && !r.checked) {
            r.checked = true;
            r.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        return true;
      }

      if (el.isContentEditable) {
        el.focus();
        document.execCommand('selectAll', false, null);
        const ok = document.execCommand('insertText', false, value);
        if (!ok) { el.innerText = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur',   { bubbles: true }));
        return true;
      }

      // input / textarea — use execCommand so React/Vue synthetic events fire.
      el.focus();
      el.select?.();
      const inserted = document.execCommand('insertText', false, value);
      if (inserted) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur',   { bubbles: true }));
        return true;
      }
      // execCommand not available — fallback to native setter.
      const proto  = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur',   { bubbles: true }));
      return true;

    } catch (err) {
      console.warn('[EPF] writeIntoField error:', err);
      return false;
    }
  }

  // ── Scanned fill (flat, for non-table forms) ──────────────────────────────

  function fillScanned(startEl, grid) {
    // Flatten the 2D grid into one ordered list for regular form fields.
    const values = grid.flat();
    const fields = EFF_FieldScanner.scanFields();
    if (!fields.length) {
      if (config.showToast) showToast('No fillable fields found.', 'warn');
      return;
    }

    let startIdx = fields.findIndex(f => f.element === startEl);
    if (startIdx === -1) startIdx = fields.findIndex(f => f.element.contains(startEl) || startEl.contains(f.element));
    if (startIdx === -1) startIdx = 0;

    let filled = 0, pointer = startIdx;
    values.forEach(val => {
      if (config.skipEmptyCells && val.trim() === '') return;
      if (pointer >= fields.length) return;
      const fi = fields[pointer++];
      if (!document.contains(fi.element)) return;
      if (config.highlightFields) EFF_Autofill.highlightElement(fi.element, '2px solid #f59e0b');
      if (writeIntoField(fi.element, val)) {
        if (config.highlightFields) EFF_Autofill.highlightElement(fi.element, '2px solid #22c55e');
        filled++;
      }
    });

    if (config.showToast) showToast(`Filled ${filled} field${filled !== 1 ? 's' : ''}`, 'ok');
    recordHistory(filled, values.length, 'form');
  }

  // ── TSV parser → 2D array ─────────────────────────────────────────────────

  /**
   * Parse Excel clipboard text into a 2D array  [ [row1col1, row1col2, ...], [row2col1, ...], ... ]
   *
   * Excel copies:
   *   Single row    →  "A\tB\tC\r\n"
   *   Single column →  "A\r\nB\r\nC\r\n"
   *   Rectangle     →  "A\tB\r\nC\tD\r\n"
   *
   * Trailing empty cells per row are stripped (Excel always adds a trailing tab).
   */
  function parseTSV(text) {
    const grid = [];
    for (const line of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
      if (!line) continue;
      const cells = line.split('\t');
      // Strip trailing empty cells (Excel artifact).
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length) grid.push(cells);
    }
    return grid;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function findVisible(root, selector) {
    for (const el of root.querySelectorAll(selector))
      if (isVisible(el)) return el;
    return null;
  }

  function tick() { return new Promise(r => setTimeout(r, 0)); }

  function isFillable(el) {
    if (!el) return false;
    if (el.isContentEditable && el !== document.body) return true;
    const tag  = el.tagName?.toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') return !['hidden','submit','button','reset','image'].includes(type) && !el.disabled;
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function urlMatches(patterns, url) {
    return (patterns || []).some(p => {
      if (p === '*' || p === '<all_urls>') return true;
      try { return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*') + '$').test(url); }
      catch { return false; }
    });
  }

  // ── Paste History ─────────────────────────────────────────────────────────

  function recordHistory(filled, total, mode) {
    const entry = {
      ts:     Date.now(),
      url:    location.href,
      host:   location.hostname || location.href,
      title:  document.title   || location.hostname,
      filled,
      total,
      mode,
    };
    chrome.storage.local.get('epf_paste_history', (data) => {
      const hist = data.epf_paste_history || [];
      hist.unshift(entry);
      if (hist.length > 50) hist.length = 50;
      chrome.storage.local.set({ epf_paste_history: hist });
    });
  }

  function loadConfig() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, resp => {
          if (chrome.runtime.lastError) return resolve(config);
          resolve(resp?.config || config);
        });
      } catch { resolve(config); }
    });
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'ok') {
    document.getElementById('epf-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'epf-toast';
    Object.assign(t.style, {
      position:'fixed', bottom:'22px', left:'50%', transform:'translateX(-50%)',
      zIndex:'2147483647', padding:'8px 20px', borderRadius:'8px',
      font:'600 13px/1.4 system-ui,sans-serif', color:'#fff',
      background: type === 'warn' ? '#d97706' : '#1d6f42',
      boxShadow:'0 4px 18px rgba(0,0,0,0.25)', pointerEvents:'none',
      whiteSpace:'nowrap', opacity:'0', transition:'opacity 0.18s ease',
    });
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => { t.style.opacity = '1'; }));
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, 2500);
  }

  chrome.runtime.onMessage.addListener((msg, _s, respond) => {
    if (msg.type === 'EPF_GET_STATE') {
      respond({ fieldCount: EFF_FieldScanner.scanFields().length });
    }

    if (msg.type === 'EPF_COPY_TABLE') {
      copyTableAtTarget(_rightClickTarget);
    }

    return true;
  });

  // ── Copy Table to Clipboard ─────────────────────────────────────────────

  /**
   * Find the nearest <table> ancestor of `target` and copy it to the
   * clipboard as TSV so it can be pasted directly into Excel.
   *
   * Also copies text/html so apps that understand HTML tables get richer data.
   */
  async function copyTableAtTarget(target) {
    if (!target) {
      showToast('Right-click inside a table first.', 'warn');
      return;
    }

    const table = target.closest('table');
    if (!table) {
      showToast('No table found at right-click location.', 'warn');
      return;
    }

    // Header rows that live outside the <table> element (split header/body pattern).
    const headerRows  = findDetachedHeaderRows(table);
    const headerGrid  = headerRows.length ? buildGridFromRows(headerRows) : [];

    // Collect body rows — scrolls through virtual containers automatically.
    const rowData  = await collectAllRowData(table);
    const bodyGrid = buildGridFromData(rowData);

    const fullGrid = [...headerGrid, ...bodyGrid];

    const tsv  = gridToTSV(fullGrid);
    const html = tableToHTML(table, headerRows);

    // Flash a green highlight over the table so the user can see what was captured.
    flashTableHighlight(table);

    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/plain': new Blob([tsv],  { type: 'text/plain' }),
        'text/html':  new Blob([html], { type: 'text/html'  }),
      });
      navigator.clipboard.write([item])
        .then(() => toastCopySuccess(fullGrid))
        .catch(() => fallbackCopy(tsv, fullGrid));
    } else {
      fallbackCopy(tsv, fullGrid);
    }
  }

  /**
   * Collect row data from the table, handling both static tables (all rows in
   * DOM at once) and virtual/scrollable tables (rows added/removed as you scroll).
   *
   * Returns an array of row snapshots, each snapshot being an array of
   * { text, colspan, rowspan } cell descriptors.
   */
  async function collectAllRowData(table) {
    const scroller = findScrollContainer(table);
    const canScroll = scroller && scroller.scrollHeight > scroller.clientHeight + 5;

    const seen     = new Set();  // dedup by row text key
    const allRows  = [];         // array of cell-descriptor arrays

    const snapshotCurrentRows = () => {
      Array.from(table.querySelectorAll('tr'))
        .filter(tr => tr.closest('table') === table)
        .forEach(tr => {
          // Build a stable key from the raw text content of all cells.
          const key = Array.from(tr.cells).map(c => c.textContent.trim()).join('\x00');
          if (!key || seen.has(key)) return;
          seen.add(key);
          // Capture cell data IMMEDIATELY while the row is still in the DOM.
          allRows.push(
            Array.from(tr.cells).map(cell => ({
              text:    getCellText(cell),
              colspan: Math.max(1, parseInt(cell.getAttribute('colspan')) || 1),
              rowspan: Math.max(1, parseInt(cell.getAttribute('rowspan')) || 1),
            }))
          );
        });
    };

    if (!canScroll) {
      snapshotCurrentRows();
      return allRows;
    }

    // ── Virtual / scrollable table ─────────────────────────────────────────
    const savedTop = scroller.scrollTop;
    scroller.scrollTop = 0;
    // Two rAF ticks give the framework time to render the first batch.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    snapshotCurrentRows();

    const step = Math.max(scroller.clientHeight * 0.8, 80);
    let   prev = -1;

    while (scroller.scrollTop !== prev) {
      prev = scroller.scrollTop;
      scroller.scrollTop += step;
      // 150 ms is enough for most virtual renderers (React, Vue, plain JS).
      await new Promise(r => setTimeout(r, 150));
      snapshotCurrentRows();
    }

    // Restore the original scroll position.
    scroller.scrollTop = savedTop;
    return allRows;
  }

  /**
   * Find the nearest scrollable ancestor of a table that actually has
   * overflow content (scrollHeight > clientHeight).
   */
  function findScrollContainer(table) {
    let node = table.parentElement;
    while (node && node !== document.body) {
      const s = window.getComputedStyle(node);
      if (/auto|scroll/.test(s.overflow + s.overflowY)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Build a 2D grid from pre-captured row data (array of cell-descriptor arrays).
   * Handles colspan / rowspan exactly like buildGrid.
   */
  function buildGridFromData(rowData) {
    const grid = [];
    rowData.forEach((cells, rIdx) => {
      if (!grid[rIdx]) grid[rIdx] = [];
      let cIdx = 0;
      cells.forEach(({ text, colspan, rowspan }) => {
        while (grid[rIdx][cIdx] !== undefined) cIdx++;
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            if (!grid[rIdx + dr]) grid[rIdx + dr] = [];
            grid[rIdx + dr][cIdx + dc] = (dr === 0 && dc === 0) ? text : '';
          }
        }
        cIdx += colspan;
      });
    });
    const maxCols = Math.max(0, ...grid.map(r => r.length));
    return grid.map(row => {
      const out = [];
      for (let i = 0; i < maxCols; i++) out.push(row[i] ?? '');
      return out;
    });
  }

  /** execCommand fallback (copies plain text only). */
  function fallbackCopy(tsv, fullGrid) {
    const ta = document.createElement('textarea');
    Object.assign(ta.style, { position: 'fixed', top: '-9999px', opacity: '0' });
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toastCopySuccess(fullGrid);
    } catch {
      showToast('Could not copy \u2014 try clicking inside the table first.', 'warn');
    } finally {
      document.body.removeChild(ta);
    }
  }

  function toastCopySuccess(fullGrid) {
    const rows = fullGrid.length;
    const cols = fullGrid[0]?.length || 0;
    showToast(`Table copied \u2014 ${rows} row${rows !== 1 ? 's' : ''} \u00d7 ${cols} col${cols !== 1 ? 's' : ''} \u2192 paste into Excel`, 'ok');
  }

  /**
   * Flash a green selection highlight over the table so the user can clearly
   * see which table was captured before the context menu disappears.
   */
  function flashTableHighlight(table) {
    // Create a positioned overlay div that sits on top of the table.
    const rect = table.getBoundingClientRect();
    const hl = document.createElement('div');
    hl.id = 'epf-table-highlight';
    Object.assign(hl.style, {
      position:      'fixed',
      top:           rect.top  + 'px',
      left:          rect.left + 'px',
      width:         rect.width  + 'px',
      height:        rect.height + 'px',
      background:    'rgba(29, 111, 66, 0.12)',
      border:        '2px solid #1d6f42',
      borderRadius:  '4px',
      pointerEvents: 'none',
      zIndex:        '2147483646',
      transition:    'opacity 0.6s ease',
      opacity:       '1',
      boxSizing:     'border-box',
    });
    document.body.appendChild(hl);
    // Fade out after 1.2 s, then remove.
    setTimeout(() => { hl.style.opacity = '0'; }, 1200);
    setTimeout(() => { hl.remove(); }, 1850);
  }

  // ── tableToTSV ────────────────────────────────────────────────────────────

  /**
   * Convert an HTML table to Excel-compatible TSV, correctly handling
   * colspan and rowspan by expanding spanned cells into their full grid.
   *
   * @param {HTMLTableElement} table
   * @returns {string}  Tab-separated rows joined by \r\n
   */
  /** Convert a pre-built 2D grid to Excel-compatible TSV. */
  function gridToTSV(grid) {
    return grid
      .map(row => row.map(cell => sanitiseCell(cell)).join('\t'))
      .join('\r\n');
  }

  /**
   * Produce a clean HTML <table> string (for apps that accept text/html).
   */
  function tableToHTML(table, headerRows = []) {
    const clone = table.cloneNode(true);
    clone.querySelectorAll('script, style').forEach(el => el.remove());
    clone.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes)
        .filter(a => a.name.startsWith('on'))
        .forEach(a => el.removeAttribute(a.name));
    });

    // Prepend detached header rows as a <thead> inside the cloned table.
    if (headerRows.length) {
      const thead = document.createElement('thead');
      headerRows.forEach(tr => {
        const row = document.createElement('tr');
        Array.from(tr.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"]')).forEach(cell => {
          const th = document.createElement('th');
          th.textContent = cell.innerText.trim();
          row.appendChild(th);
        });
        thead.appendChild(row);
      });
      clone.insertBefore(thead, clone.firstChild);
    }

    return `<html><body>${clone.outerHTML}</body></html>`;
  }

  /**
   * Build a grid from an arbitrary array of <tr> elements
   * (used for detached header rows found outside the <table>).
   */
  function buildGridFromRows(rows) {
    const seen = new Set();
    const unique = rows.filter(r => !seen.has(r) && seen.add(r));
    const grid = [];
    unique.forEach((tr, rIdx) => {
      if (!grid[rIdx]) grid[rIdx] = [];
      let cIdx = 0;
      const cells = tr.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"]');
      Array.from(cells).forEach(cell => {
        while (grid[rIdx][cIdx] !== undefined) cIdx++;
        const colspan = Math.max(1, parseInt(cell.getAttribute('colspan')) || 1);
        const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan')) || 1);
        const text = getCellText(cell);
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            if (!grid[rIdx + dr]) grid[rIdx + dr] = [];
            grid[rIdx + dr][cIdx + dc] = (dr === 0 && dc === 0) ? text : '';
          }
        }
        cIdx += colspan;
      });
    });
    const maxCols = Math.max(0, ...grid.map(r => r.length));
    return grid.map(row => {
      const out = [];
      for (let i = 0; i < maxCols; i++) out.push(row[i] ?? '');
      return out;
    });
  }

  /**
   * Look for a header rendered outside the <table> element — common in
   * virtualised/framework grids (AG Grid, Tabulator, Handsontable, etc.).
   * Walks up to the nearest scroll container or wrapper div and checks
   * preceding siblings for <tr>/<thead> elements or ARIA header rows.
   */
  function findDetachedHeaderRows(table) {
    // Walk up at most 4 levels looking for a wrapper that has a sibling header.
    let node = table;
    for (let i = 0; i < 4; i++) {
      const parent = node.parentElement;
      if (!parent) break;
      // Check all preceding siblings of `node` inside `parent`.
      let sib = node.previousElementSibling;
      while (sib) {
        const trs = sib.querySelectorAll('tr, [role="row"]');
        if (trs.length) {
          // Filter to rows that contain th / columnheader cells.
          const headerRows = Array.from(trs).filter(tr =>
            tr.querySelector('th, [role="columnheader"]')
          );
          if (headerRows.length) return headerRows;
        }
        sib = sib.previousElementSibling;
      }
      node = parent;
    }
    return [];
  }


  /**
   * Get a cell's visible text without including text from nested <table> elements.
   *
   * We read innerText from the LIVE element (so CSS, pseudo-elements, and
   * framework-rendered content are all respected).  Nested tables are temporarily
   * set to visibility:hidden — innerText skips hidden elements per spec — then
   * restored.  For detached/cloned nodes we fall back to textContent.
   */
  function getCellText(cell) {
    const nested = Array.from(cell.querySelectorAll('table'));

    if (!document.contains(cell)) {
      // Detached node (e.g. from a clone): innerText is unreliable, use textContent.
      nested.forEach(t => t.remove());
      return (cell.textContent || '').replace(/\s+/g, ' ').trim();
    }

    if (!nested.length) return cell.innerText.trim();

    // Temporarily hide nested tables so innerText excludes their text.
    // visibility:hidden keeps layout intact and is excluded from innerText.
    const saved = nested.map(t => [t, t.style.visibility]);
    nested.forEach(t => { t.style.visibility = 'hidden'; });
    const text = cell.innerText.trim();
    saved.forEach(([t, v]) => { t.style.visibility = v; });
    return text;
  }

  /**
   * Clean a cell value for TSV:
   *   - Replace tabs and newlines with spaces (they would break TSV structure)
   *   - Collapse multiple whitespace runs
   */
  function sanitiseCell(text) {
    return String(text ?? '')
      .replace(/\t/g,  ' ')
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

})();

// ── Selection Translation Tooltip ─────────────────────────────────────────────

(function () {
  'use strict';

  const GTRANSLATE = 'https://translate.googleapis.com/translate_a/single';
  const MIN_CHARS = 2;
  const MAX_CHARS = 1500;
  const CACHE_KEY = 'epf_xlat_cache';
  const CACHE_MAX = 300;

  // API codes and display labels for each target language.
  const LANG_META = {
    en: { api: 'en',    label: 'EN' },
    id: { api: 'id',    label: 'ID' },
    vi: { api: 'vi',    label: 'VI' },
    zh: { api: 'zh-CN', label: 'ZH' },
  };

  let _enabled = true;
  let _langs   = { en: false, id: true, vi: true, zh: false };
  let _anchor  = { top: false, bottom: false, left: false, right: false };
  let _opacity = 100;
  let _tip      = null;
  let _activeId = 0;

  // In-memory cache: `${srcCode}||${text}` → { id?, vi?, zh? }
  const _mem = new Map();

  // ── Init ──────────────────────────────────────────────────────────────────────

  chrome.storage.local.get(['epf_config', CACHE_KEY], (data) => {
    const cfg = data.epf_config || {};
    _enabled = cfg.translateEnabled ?? true;
    _langs   = cfg.translateLangs   ?? { en: false, id: true, vi: true, zh: false };
    _anchor  = cfg.translateAnchor  ?? { top: false, bottom: false, left: false, right: false };
    _opacity = cfg.translateOpacity ?? 100;

    const saved = data[CACHE_KEY] || {};
    for (const [k, v] of Object.entries(saved)) _mem.set(k, v);

    if (_enabled) attachListeners();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SAVE_CONFIG') {
      const wasEnabled = _enabled;
      _enabled = msg.config?.translateEnabled ?? true;
      _langs   = msg.config?.translateLangs   ?? _langs;
      _anchor  = msg.config?.translateAnchor  ?? _anchor;
      _opacity = msg.config?.translateOpacity ?? _opacity;
      if (!_enabled) hideTip();
      else if (!wasEnabled) attachListeners();
      return;
    }
    if (msg.type === 'CLEAR_XLAT_CACHE') {
      _mem.clear();
    }
  });

  // ── Listeners ─────────────────────────────────────────────────────────────────

  let _listenersAttached = false;
  function attachListeners() {
    if (_listenersAttached) return;
    _listenersAttached = true;
    document.addEventListener('mouseup',   onMouseUp);
    document.addEventListener('keydown',   e => { if (e.key === 'Escape') hideTip(); });
    document.addEventListener('mousedown', e => { if (_tip && !_tip.contains(e.target)) hideTip(); });
  }

  function onMouseUp(e) {
    if (!_enabled) return;
    if (_tip && _tip.contains(e.target)) return;
    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < MIN_CHARS || text.length > MAX_CHARS) { hideTip(); return; }
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) return;
      showTip(text, range.getBoundingClientRect());
    }, 20);
  }

  // ── Tooltip lifecycle ─────────────────────────────────────────────────────────

  async function showTip(text, selRect) {
    hideTip();

    const reqId   = ++_activeId;
    const srcCode = detectLang(text);
    const srcKey  = srcCode === 'zh-CN' ? 'zh' : srcCode === 'vi' ? 'vi' : srcCode === 'id' ? 'id' : 'en';
    const cKey    = srcCode + '||' + text;

    const targets = Object.keys(LANG_META).filter(l => _langs[l] && l !== srcKey);
    if (!targets.length) return;

    const tip = buildTip(srcCode);
    tip.style.opacity = (_opacity / 100).toFixed(2);
    _tip = tip;
    document.body.appendChild(tip);
    positionTip(tip, selRect, _anchor);
    requestAnimationFrame(() => requestAnimationFrame(() => tip.classList.add('epf-tip-visible')));

    const cached  = { ...(_mem.get(cKey) || {}) };
    const missing = targets.filter(l => cached[l] == null);

    // Build sources map: 'cache' for hits, 'loading' for missing
    const sources = {};
    targets.forEach(l => { sources[l] = cached[l] != null ? 'cache' : 'loading'; });

    // Render immediately — cached hits show text, missing show spinners
    renderRows(tip, targets, cached, sources, text, srcCode, cKey);

    if (!missing.length) return;

    const settled = await Promise.allSettled(
      missing.map(l => fetchTranslation(text, srcCode, LANG_META[l].api))
    );
    if (_activeId !== reqId) return;

    const newlyFetched = {};
    missing.forEach((l, i) => {
      if (settled[i].status === 'fulfilled') {
        cached[l] = settled[i].value;
        newlyFetched[l] = settled[i].value;
        sources[l] = 'fresh';
      } else {
        sources[l] = 'failed';
      }
    });

    // Update only the rows that changed
    missing.forEach(l => {
      const row = tip.querySelector(`.epf-tip-row[data-lang="${l}"]`);
      if (row) updateRow(row, l, sources[l], cached[l], text, srcCode, cKey, tip);
    });

    if (Object.keys(newlyFetched).length) {
      const toCache = {};
      targets.forEach(l => { if (cached[l] != null) toCache[l] = cached[l]; });
      writeCache(cKey, toCache);
    }
  }

  function hideTip() {
    _activeId++;
    if (!_tip) return;
    _tip.remove();
    _tip = null;
  }

  // ── Cache ─────────────────────────────────────────────────────────────────────

  function writeCache(key, value) {
    _mem.set(key, value);
    chrome.storage.local.get(CACHE_KEY, (data) => {
      const store = data[CACHE_KEY] || {};
      store[key] = value;
      const keys = Object.keys(store);
      if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach(k => delete store[k]);
      chrome.storage.local.set({ [CACHE_KEY]: store });
    });
  }

  // ── Positioning ───────────────────────────────────────────────────────────────

  function positionTip(tip, rect, anchor) {
    const MARGIN = 16;
    const TIP_W  = 260;
    const hasV   = anchor.top  || anchor.bottom;
    const hasH   = anchor.left || anchor.right;

    if (!hasV && !hasH) {
      // ── Auto mode: absolute, arrow follows selection ───────────────────────
      const ARROW_H = 7;
      const scrollX = window.scrollX, scrollY = window.scrollY;
      const vpW     = document.documentElement.clientWidth;
      const vpH     = document.documentElement.clientHeight;

      let left = rect.left + scrollX + rect.width / 2 - TIP_W / 2;
      left = Math.max(MARGIN + scrollX, Math.min(left, scrollX + vpW - TIP_W - MARGIN));

      const above = rect.top >= 80 || rect.top >= vpH - rect.bottom;
      let top;
      if (above) {
        top = rect.top + scrollY - ARROW_H - 8;
        tip.style.transform = 'translateY(-100%)';
        tip.classList.remove('epf-tip-below');
      } else {
        top = rect.bottom + scrollY + ARROW_H + 8;
        tip.classList.add('epf-tip-below');
      }
      tip.style.left = left + 'px';
      tip.style.top  = top  + 'px';
      return;
    }

    // ── Fixed anchor mode: position:fixed, no arrow ───────────────────────────
    tip.style.position = 'fixed';
    tip.classList.add('epf-tip-fixed');
    tip.style.top = tip.style.bottom = tip.style.left = tip.style.right = 'auto';

    const tx = [], ty = [];

    // Vertical axis
    if (anchor.top && anchor.bottom) {
      tip.style.top = '50%';             // TOP + BOTTOM → vertical center
      ty.push('translateY(-50%)');
    } else if (anchor.top) {
      tip.style.top = MARGIN + 'px';
    } else if (anchor.bottom) {
      tip.style.bottom = MARGIN + 'px';
    } else {
      tip.style.top = '50%';             // only H set → center vertically
      ty.push('translateY(-50%)');
    }

    // Horizontal axis
    if (anchor.left && anchor.right) {
      tip.style.left = '50%';            // LEFT + RIGHT → horizontal center
      tx.push('translateX(-50%)');
    } else if (anchor.left) {
      tip.style.left = MARGIN + 'px';
    } else if (anchor.right) {
      tip.style.right = MARGIN + 'px';
    } else {
      tip.style.left = '50%';            // only V set → center horizontally
      tx.push('translateX(-50%)');
    }

    tip.style.transform = [...tx, ...ty].join(' ');
  }

  // ── DOM ───────────────────────────────────────────────────────────────────────

  function buildTip(srcCode) {
    const tip = document.createElement('div');
    tip.id = 'epf-translate-tip';
    const srcLabel = srcCode === 'zh-CN' ? '\u4e2d\u6587'
                   : srcCode === 'vi'    ? 'Ti\u1ebfng Vi\u1ec7t'
                   : srcCode === 'id'    ? 'Indonesia'
                   : 'English';
    tip.innerHTML = `
      <div class="epf-tip-header">
        <span class="epf-tip-title">Translate</span>
        <span class="epf-tip-source-lang">${srcLabel}</span>
        <button class="epf-tip-close" title="Close">&times;</button>
      </div>
      <div class="epf-tip-body">
        <div class="epf-tip-loading">
          <div class="epf-tip-spinner"></div>
          <span>Translating\u2026</span>
        </div>
      </div>`;
    tip.querySelector('.epf-tip-close').addEventListener('click', hideTip);
    return tip;
  }

  function renderRows(tip, targets, results, sources, text, srcCode, cKey) {
    const body = tip.querySelector('.epf-tip-body');
    body.innerHTML = '';
    targets.forEach(l => {
      const row = document.createElement('div');
      row.className = 'epf-tip-row';
      row.dataset.lang = l;
      body.appendChild(row);
      updateRow(row, l, sources[l], results[l], text, srcCode, cKey, tip);
    });
  }

  function updateRow(row, l, source, value, text, srcCode, cKey, tip) {
    row.innerHTML = '';
    const badge = document.createElement('span');
    badge.className = 'epf-tip-lang-badge';
    badge.textContent = LANG_META[l].label;
    row.appendChild(badge);

    if (source === 'loading') {
      const spinner = document.createElement('div');
      spinner.className = 'epf-tip-spinner';
      row.appendChild(spinner);
    } else if (source === 'cache' || source === 'fresh') {
      const txt = document.createElement('span');
      txt.className = 'epf-tip-text';
      txt.textContent = value;
      row.appendChild(txt);
      if (source === 'cache') {
        const icon = document.createElement('span');
        icon.className = 'epf-tip-cache-icon';
        icon.title = 'Cached';
        icon.textContent = '\u26a1';
        row.appendChild(icon);
      }
    } else {
      // failed
      const msg = document.createElement('span');
      msg.className = 'epf-tip-fail-msg';
      msg.textContent = 'Failed';
      row.appendChild(msg);
      const btn = document.createElement('button');
      btn.className = 'epf-tip-retry';
      btn.title = 'Retry';
      btn.textContent = '\u21ba';
      btn.addEventListener('click', () => retryLang(row, l, text, srcCode, cKey, tip));
      row.appendChild(btn);
    }
  }

  function retryLang(row, l, text, srcCode, cKey, tip) {
    updateRow(row, l, 'loading', null, text, srcCode, cKey, tip);
    fetchTranslation(text, srcCode, LANG_META[l].api).then(result => {
      if (!tip.isConnected) return;
      updateRow(row, l, 'fresh', result, text, srcCode, cKey, tip);
      // Merge into cache
      const existing = _mem.get(cKey) || {};
      existing[l] = result;
      writeCache(cKey, existing);
    }).catch(() => {
      if (!tip.isConnected) return;
      updateRow(row, l, 'failed', null, text, srcCode, cKey, tip);
    });
  }

  // ── API ───────────────────────────────────────────────────────────────────────

  const API_CHAR_LIMIT = 300;

  async function fetchTranslation(text, from, to) {
    let query = text;
    if (query.length > API_CHAR_LIMIT) {
      query = query.slice(0, API_CHAR_LIMIT);
      const lastBreak = Math.max(query.lastIndexOf(' '), query.lastIndexOf('\n'));
      if (lastBreak > API_CHAR_LIMIT * 0.6) query = query.slice(0, lastBreak);
      query = query.trimEnd() + '\u2026';
    }

    const url  = `${GTRANSLATE}?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(query)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();

    // Response structure: [[[translatedChunk, originalChunk], ...], ...]
    const out = json?.[0]?.map(chunk => chunk?.[0] ?? '').join('') ?? '';
    if (!out || out.toLowerCase().trim() === query.toLowerCase().trim()) throw new Error('no translation');
    return out;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function detectLang(text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text)) return 'zh-CN';
    // Vietnamese-specific characters (tonal diacritics + đ)
    if (/[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(text)) return 'vi';
    // Indonesian common function words (plain Latin, no unique chars)
    if (/\b(yang|dan|di|ke|dari|untuk|dengan|adalah|ini|itu|tidak|ada|pada)\b/i.test(text)) return 'id';
    return 'en';
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();

