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
    urlPatterns:        ['*'],
    showToast:          true,
    highlightFields:    true,
    skipEmptyCells:     false,
    copyEnabled:        true,
    copyWithFormatting: false,
    copyFmtStyles: { bg: true, color: true, font: true, align: true, size: false, border: false },
  };

  // Track the element the user last right-clicked.
  // The context menu click arrives via a background message after the native
  // menu closes, so we must store the target now (during the contextmenu event).
  let _rightClickTarget = null;
  document.addEventListener('contextmenu', e => { _rightClickTarget = e.target; }, true);

  let _pageActive = false;
  let _lastTSV    = null;   // raw TSV from the most recent paste, for history
  // Expose for other IIFEs in this file (e.g. translation section).
  window.__EPF_PAGE_ACTIVE__ = false;

  loadConfig().then(cfg => {
    config = cfg;
    _pageActive = urlMatches(config.urlPatterns, location.href);
    window.__EPF_PAGE_ACTIVE__ = _pageActive;
    if (_pageActive) attach();
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
    _lastTSV = text;
    const grid = parseTSV(text);
    if (!grid.length) return;
    const singleCell = grid.length === 1 && grid[0].length <= 1;
    if (singleCell && !isCustomDropdown(e.target) && !isDatePicker(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (singleCell && isDatePicker(e.target)) {
      writeDatePicker(e.target, grid[0][0]);
      return;
    }
    if (singleCell && isCustomDropdown(e.target)) {
      writeCustomDropdown(e.target, grid[0][0]);
      return;
    }
    fillFrom(e.target, grid);
  }

  let _keyguard = false;
  function onKeydown(e) {
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v')) return;
    if (!isFillable(e.target)) return;
    const target = e.target;
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      _lastTSV = text;
      const grid = parseTSV(text);
      if (!grid.length) return;
      const singleCell = grid.length === 1 && grid[0].length <= 1;
      if (singleCell && !isCustomDropdown(target) && !isDatePicker(target)) return;
      _keyguard = true;
      if (singleCell && isDatePicker(target)) {
        writeDatePicker(target, grid[0][0]);
      } else if (singleCell && isCustomDropdown(target)) {
        writeCustomDropdown(target, grid[0][0]);
      } else {
        fillFrom(target, grid);
      }
      setTimeout(() => { _keyguard = false; }, 80);
    }).catch(() => {});
  }

  function onFieldPaste(e) {
    if (_keyguard) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    _lastTSV = text;
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
    let lastFilledEl = null;

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

        const ok = await writeIntoField(el, val);
        if (ok) {
          if (config.highlightFields) EFF_Autofill.highlightElement(el, '2px solid #22c55e');
          totalFilled++;
          lastFilledEl = el;
        }

        // Yield one tick so the framework can commit the change
        // before we activate the next cell.
        await tick();
      }
    }

    if (lastFilledEl) lastFilledEl.blur();

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
    recordHistory(totalFilled, totalCells, 'table', _lastTSV);
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
    const customDropSel = '[role="combobox"],[aria-haspopup="listbox"],'
                        + '.el-select,.ant-select,.v-select,.multiselect,'
                        + '.select2-container,.chosen-container';
    const datePickerSel = '.ant-calendar-picker,.ant-picker,.el-date-editor,.el-date-picker,[data-datepicker]';

    const findEl = () => {
      const visible = findVisible(cell, inputSel);
      if (visible) return visible;
      if (cell.isContentEditable) return cell;
      // Date picker wrappers
      if (cell.matches?.(datePickerSel) && isVisible(cell)) return cell;
      const dp = cell.querySelector(datePickerSel);
      if (dp && isVisible(dp)) return dp;
      // Custom dropdown wrappers
      if (cell.matches?.(customDropSel) && isVisible(cell)) return cell;
      const drop = cell.querySelector(customDropSel);
      if (drop && isVisible(drop)) return drop;
      return null;
    };

    return new Promise(resolve => {
      const immediate = findEl();
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
        const el = findEl();
        if (el) finish(el);
      });
      observer.observe(cell, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['contenteditable','type','disabled','role','aria-haspopup'] });

      const poll  = setInterval(() => { const el = findEl(); if (el) finish(el); }, 30);

      const timer = setTimeout(() => finish(findEl()), timeoutMs);
    });
  }

  // ── Custom dropdown helpers ───────────────────────────────────────────────

  function isCustomDropdown(el) {
    return !!(el.closest(
      '[role="combobox"], [aria-haspopup="listbox"], ' +
      '.el-select, .ant-select, .v-select, .multiselect, ' +
      '.select2-container, .chosen-container'
    ));
  }

  function waitForOptionsChange(prevTexts, timeoutMs) {
    const sel = '[role="option"], .ant-select-dropdown-menu-item, .ant-select-item-option, ' +
                '.el-select-dropdown__item, .v-select__option, .multiselect__option, ' +
                '.select2-results__option, .chosen-results li';
    return new Promise(resolve => {
      const changed = () => {
        const opts = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        return opts.length && opts.some(o => !prevTexts.has(o.textContent.trim()));
      };
      if (changed()) return resolve();
      let done = false;
      function finish() { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); resolve(); }
      const observer = new MutationObserver(() => { if (changed()) finish(); });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      const timer = setTimeout(finish, timeoutMs);
    });
  }

  function waitForOptions(timeoutMs) {
    const sel = '[role="option"], ' +
                '.ant-select-dropdown-menu-item, ' +   // Ant Design v3
                '.ant-select-item-option, ' +           // Ant Design v4/v5
                '.el-select-dropdown__item, ' +
                '.v-select__option, .multiselect__option, ' +
                '.select2-results__option, .chosen-results li';
    return new Promise(resolve => {
      const check = () => {
        const opts = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        return opts.length ? opts : null;
      };
      const immediate = check();
      if (immediate) return resolve(immediate);

      let done = false;
      function finish(result) {
        if (done) return; done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(result);
      }
      const observer = new MutationObserver(() => { const o = check(); if (o) finish(o); });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => finish([]), timeoutMs);
    });
  }

  async function writeCustomDropdown(el, value) {
    const lv = value.toLowerCase().trim();

    // Blank value → clear the field without opening the dropdown.
    if (lv === '') {
      // Try the Ant Design / custom clear button first.
      const clearBtn = el.querySelector(
        '.ant-select-selection__clear, .el-select__close, .multiselect__clear, ' +
        '[title="Clear"], [aria-label="clear"]'
      );
      if (clearBtn && isVisible(clearBtn)) {
        clearBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        clearBtn.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
        clearBtn.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
        return true;
      }
      // Fallback: if there's a search input, clear its value and fire events so
      // the framework resets the selection.
      const inp = el.querySelector('input');
      if (inp) {
        inp.focus();
        inp.select();
        document.execCommand('insertText', false, '');
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    // Ensure the dropdown is open.
    let options = await waitForOptions(80);
    if (!options.length) {
      const wrapper = el.closest(
        '[role="combobox"], [aria-haspopup="listbox"], ' +
        '.ant-select-selection, .el-select, .ant-select, ' +
        '.v-select, .multiselect, .select2-container, .chosen-container'
      ) || el;
      ['mousedown','mouseup','click'].forEach(name =>
        wrapper.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }))
      );
      el.focus?.();
      options = await waitForOptions(1500);
      if (!options.length) return false;
    }

    // Find the search input (the element itself, or a child input).
    const searchInput = (el.tagName.toLowerCase() === 'input' ? el : null)
                     || el.querySelector('input.ant-select-search__field, input[class*="search"]');

    const notDisabled = '.ant-select-dropdown-menu-item-disabled, .ant-select-item-option-disabled';
    const bestMatch = (opts) => {
      const t = opts.filter(o => !o.matches?.(notDisabled));
      return t.find(o => o.textContent.trim().toLowerCase() === lv)
          || t.find(o => o.textContent.trim().toLowerCase().includes(lv))
          || t.find(o => lv.includes(o.textContent.trim().toLowerCase()))
          || null;
    };

    // Check if the answer is already in the current list.
    let opt = bestMatch(options);

    if (!opt && searchInput) {
      // Type via execCommand so React's synthetic event system picks it up.
      searchInput.focus();
      searchInput.select();
      document.execCommand('insertText', false, value);

      // Wait for the option list to change, then pick the best match.
      const prevTexts = new Set(options.map(o => o.textContent.trim()));
      await waitForOptionsChange(prevTexts, 2000);
      options = await waitForOptions(200);
      opt = bestMatch(options);
      if (!opt && lv !== '') {
        const remaining = options.filter(o => !o.matches?.(notDisabled));
        if (remaining.length === 1) opt = remaining[0];
      }
    }

    if (!opt) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return false;
    }

    opt.scrollIntoView({ block: 'nearest' });
    await tick();
    ['mouseenter','mouseover','mousedown','mouseup','click'].forEach(name =>
      opt.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }))
    );
    // Give the framework time to close the dropdown before the next cell opens.
    await new Promise(r => setTimeout(r, 120));
    return true;
  }

  // ── Date helpers ──────────────────────────────────────────────────────────

  function parseDate(str) {
    const s = str.trim();
    // YYYY-MM-DD
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { year: +m[1], month: +m[2], day: +m[3] };
    // DD/MM/YYYY
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return { year: +m[3], month: +m[2], day: +m[1] };
    return null;
  }

  function toISODate(parsed) {
    const { year, month, day } = parsed;
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function isDatePicker(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (el.tagName.toLowerCase() === 'input' && type === 'date') return true;
    return !!(el.closest(
      '.ant-calendar-picker, .ant-picker, ' +
      '.el-date-editor, .el-date-picker, ' +
      '.datepicker, [data-datepicker]'
    ));
  }

  function formatDateForPicker(parsed, placeholder) {
    const ph = (placeholder || '').toUpperCase();
    const { year, month, day } = parsed;
    const dd   = String(day).padStart(2, '0');
    const mm   = String(month).padStart(2, '0');
    // Detect format from placeholder (e.g. "DD/MM/YYYY", "YYYY-MM-DD")
    if (/^D/.test(ph)) return `${dd}/${mm}/${year}`;       // DD/MM/YYYY
    if (/^MM\/DD/.test(ph)) return `${mm}/${dd}/${year}`;  // MM/DD/YYYY
    return `${year}-${mm}-${dd}`;                           // default: YYYY-MM-DD
  }

  async function writeDatePicker(el, value) {
    if (!value.trim()) return true;

    const parsed = parseDate(value);
    if (!parsed) return false;

    // Yield to let the browser finish the current paste/keydown event before
    // we dispatch synthetic mouse events to open the calendar.
    await new Promise(r => setTimeout(r, 50));

    // Native <input type="date">
    const tag  = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && type === 'date') {
      const iso    = toISODate(parsed);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(el, iso) : (el.value = iso);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // Custom date picker — find the clickable trigger inside the wrapper.
    const wrapper = el.closest(
      '.ant-calendar-picker, .ant-picker, .el-date-editor, .el-date-picker, [data-datepicker]'
    ) || el;

    // Step 1: click the wrapper itself to open the calendar popup.
    // Ant Design v3 attaches the open handler on the outer .ant-calendar-picker,
    // not on the inner input/span — so we click the wrapper, then the icon as fallback.
    ['mousedown','mouseup','click'].forEach(name =>
      wrapper.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }))
    );
    // Also click the calendar icon in case the wrapper click isn't enough.
    const icon = wrapper.querySelector('.ant-calendar-picker-icon, .ant-picker-suffix');
    if (icon) {
      ['mousedown','mouseup','click'].forEach(name =>
        icon.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }))
      );
    }
    wrapper.focus?.();

    // Step 2: wait for the calendar panel to appear in the DOM (up to 1.5 s).
    const calPanel = await waitForElement(
      '.ant-calendar, ' +
      '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden), ' +
      '.el-date-picker__popper, .el-picker-panel',
      1500
    );
    if (!calPanel) return false;

    // Step 3: navigate to the correct month/year, then click the date cell.
    const ok = await clickCalendarDate(calPanel, parsed);

    // Step 4: close calendar if still open.
    if (document.contains(calPanel)) {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 80));
    }

    return ok;
  }

  // Full month names for building Ant Design v3 cell titles ("April 17, 2026").
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const MONTH_SHORT = ['jan','feb','mar','apr','may','jun',
                       'jul','aug','sep','oct','nov','dec'];

  async function clickCalendarDate(panel, { year, month, day }) {
    const iso      = toISODate({ year, month, day });
    // Ant Design v3 uses "April 17, 2026"; v4/v5 uses "2026-04-17".
    const titleV3  = `${MONTH_NAMES[month - 1]} ${day}, ${year}`;

    for (let attempts = 0; attempts < 24; attempts++) {
      const cell = panel.querySelector(
        `[title="${titleV3}"], [title="${iso}"], [data-date="${iso}"]`
      );
      if (cell) {
        // Click the inner date div if present (Ant Design v3 uses <div class="ant-calendar-date">).
        const inner = cell.querySelector('.ant-calendar-date, .ant-picker-cell-inner') || cell;
        ['mousedown','mouseup','click'].forEach(name =>
          inner.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }))
        );
        return true;
      }

      const shownYear  = readCalendarYear(panel);
      const shownMonth = readCalendarMonth(panel);
      if (shownYear === null || shownMonth === null) break;

      const diff = (year * 12 + month - 1) - (shownYear * 12 + shownMonth - 1);
      if (diff === 0) break; // correct month shown but cell not found

      const btnSel = diff > 0
        ? '.ant-calendar-next-month-btn, .ant-picker-next-btn, .el-date-picker__next-btn'
        : '.ant-calendar-prev-month-btn, .ant-picker-prev-btn, .el-date-picker__prev-btn';
      const btn = panel.querySelector(btnSel);
      if (!btn) break;
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 150));
    }
    return false;
  }

  function readCalendarYear(panel) {
    const el = panel.querySelector('.ant-calendar-year-select, .ant-picker-year-btn');
    if (!el) return null;
    const m = el.textContent.match(/\d{4}/);
    return m ? +m[0] : null;
  }

  function readCalendarMonth(panel) {
    const el = panel.querySelector('.ant-calendar-month-select, .ant-picker-month-btn');
    if (!el) return null;
    const text = el.textContent.toLowerCase().trim();
    // Match abbreviated month name e.g. "Apr"
    const idx = MONTH_SHORT.findIndex(m => text.startsWith(m));
    if (idx !== -1) return idx + 1;
    // Numeric month fallback
    const m = text.match(/\b(\d{1,2})\b/);
    return m ? +m[1] : null;
  }

  // ── Write value ───────────────────────────────────────────────────────────

  async function writeIntoField(el, rawValue) {
    const value = String(rawValue);
    const tag   = el.tagName.toLowerCase();
    const type  = (el.getAttribute('type') || '').toLowerCase();

    // Date picker (native or custom framework).
    if (isDatePicker(el)) {
      return writeDatePicker(el, value);
    }

    // Custom dropdown (Vue/React/Ant Design etc.) — must click option in the list.
    if (isCustomDropdown(el)) {
      return writeCustomDropdown(el, value);
    }

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

  async function fillScanned(startEl, grid) {
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

    let filled = 0, pointer = startIdx, lastFilledEl = null;
    for (const val of values) {
      if (config.skipEmptyCells && val.trim() === '') continue;
      if (pointer >= fields.length) break;
      const fi = fields[pointer++];
      if (!document.contains(fi.element)) continue;
      const ok = await writeIntoField(fi.element, val);
      if (ok) {
        if (config.highlightFields) EFF_Autofill.highlightElement(fi.element, '2px solid #22c55e');
        filled++;
        lastFilledEl = fi.element;
      }
      await tick();
    }

    if (lastFilledEl) lastFilledEl.blur();

    if (config.showToast) showToast(`Filled ${filled} field${filled !== 1 ? 's' : ''}`, 'ok');
    recordHistory(filled, values.length, 'form', _lastTSV);
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

  function waitForElement(selector, timeoutMs) {
    return new Promise(resolve => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      let done = false;
      function finish(el) {
        if (done) return; done = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) finish(el);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  function isFillable(el) {
    if (!el) return false;
    if (el.isContentEditable && el !== document.body) return true;
    const tag  = el.tagName?.toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') return !['hidden','submit','button','reset','image'].includes(type) && !el.disabled;
    // Custom dropdown wrappers (Element UI, Ant Design, v-select, etc.)
    if (isCustomDropdown(el)) return true;
    // Date picker wrappers
    if (isDatePicker(el)) return true;
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

  async function compressTSV(text) {
    try {
      const enc    = new TextEncoder().encode(text);
      const cs     = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(enc);
      writer.close();
      const chunks = [];
      const reader = cs.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out   = new Uint8Array(total);
      let   off   = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return btoa(String.fromCharCode(...out));
    } catch { return null; }
  }

  function buildPreview(rawTSV) {
    if (!rawTSV) return '';
    const firstRow = rawTSV.split('\n')[0] || '';
    const cells    = firstRow.split('\t').map(c => c.trim()).filter(Boolean);
    const preview  = cells.slice(0, 4).join(' · ');
    return preview.length > 60 ? preview.slice(0, 58) + '…' : preview;
  }

  async function recordHistory(filled, total, mode, rawTSV) {
    const compressed = rawTSV ? await compressTSV(rawTSV) : null;
    const entry = {
      ts:      Date.now(),
      url:     location.href,
      host:    location.hostname || location.href,
      title:   document.title   || location.hostname,
      filled,
      total,
      mode,
      preview: buildPreview(rawTSV),
      ...(compressed ? { z: compressed } : {}),
    };
    chrome.storage.local.get('epf_paste_history', (data) => {
      const hist = data.epf_paste_history || [];
      hist.unshift(entry);
      if (hist.length > 10) hist.length = 10;
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
    if (msg.type === 'EPF_WRITE_CLIPBOARD') {
      navigator.clipboard.writeText(msg.text)
        .then(() => respond({ ok: true }))
        .catch(() => respond({ ok: false }));
      return true;
    }

    if (msg.type === 'EPF_COPY_TABLE') {
      if (!_pageActive) {
        showToast('Addon is disabled on this page. Add it in the extension popup.', 'warn');
        return true;
      }
      copyTableAtTarget(_rightClickTarget);
    }

    // Update in-memory config so copyWithFormatting etc. take effect without refresh.
    if (msg.type === 'SAVE_CONFIG' && msg.config) {
      config = { ...config, ...msg.config };
    }

    return true;
  });

  // ── VXE-table copy ───────────────────────────────────────────────────────

  /**
   * VXE-table splits fixed columns into a separate DOM panel. Each cell carries
   * data-colid and each row carries data-rowid, so we can merge all panels by
   * those keys instead of relying on positional DOM order.
   */
  // Extract text from a VXE cell using textContent (not innerText) so
  // display:none elements (fixed--hidden panels) are still readable.
  function vxeCellText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Decorative children to strip before reading header label text:
  // sort arrows, filter triggers, resize handles, icons, SVGs.
  const HEADER_STRIP_SEL = [
    'svg',
    'button',
    '[aria-hidden="true"]',
    '[class*="sorter"]',
    '[class*="sort-icon"]',
    '[class*="filter"]',
    '[class*="resize"]',
    '[class*="drag"]',
    '[class*="caret"]',
    '[class*="arrow"]',
    'i[class*="icon"]',
    'span[class*="icon"]',
  ].join(',');

  /**
   * Extract the visible label from a header cell, stripping sort/filter icons
   * and other decorative children that would otherwise pollute the text.
   */
  function getHeaderText(cell) {
    // Try framework-specific label containers first (Ant Design, Element UI, VXE).
    const labelEl = cell.querySelector(
      '.ant-table-column-title, .el-table__cell-text, .vxe-cell--title, .column-title'
    );
    if (labelEl) return (labelEl.textContent || '').replace(/\s+/g, ' ').trim();

    // General fallback: clone, strip decorative elements, read textContent.
    const clone = cell.cloneNode(true);
    clone.querySelectorAll(HEADER_STRIP_SEL).forEach(el => el.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function buildVxeGrid(vxeContainer) {
    // 1. Build ordered column list from headers (deduplicated by data-colid).
    //    Prefer non-empty header text — the fixed-left panel has visible th
    //    elements while the main panel marks them fixed--hidden (display:none),
    //    so innerText returns '' for the main panel headers.
    const colOrder = [];
    const colIndex = new Map(); // colid → index in colOrder

    vxeContainer.querySelectorAll('thead th[data-colid]').forEach(th => {
      const colid = th.getAttribute('data-colid');
      if (!colid) return;
      const text = getHeaderText(th);
      if (!colIndex.has(colid)) {
        colIndex.set(colid, colOrder.length);
        colOrder.push({ colid, header: text });
      } else if (text && !colOrder[colIndex.get(colid)].header) {
        // Update with non-empty text from a later panel (e.g. fixed-left header).
        colOrder[colIndex.get(colid)].header = text;
      }
    });
    if (!colOrder.length) return [];

    // 2. Collect cell values from every body panel keyed by rowid → colid.
    //    Non-empty value wins so fixed-left real data overwrites main-panel
    //    empty placeholders.
    const rowOrder = [];
    const rowMap   = new Map();

    vxeContainer.querySelectorAll('tbody tr[data-rowid]').forEach(tr => {
      const rowid = tr.getAttribute('data-rowid');
      if (!rowMap.has(rowid)) {
        rowMap.set(rowid, {});
        rowOrder.push(rowid);
      }
      const cellMap = rowMap.get(rowid);
      tr.querySelectorAll('td[data-colid]').forEach(td => {
        const colid = td.getAttribute('data-colid');
        const text  = vxeCellText(td);
        if (text) cellMap[colid] = text;
      });
    });

    if (!rowOrder.length) return [];

    // 3. Build grid: header row + data rows.
    const header   = colOrder.map(c => c.header);
    const dataRows = rowOrder.map(rowid => {
      const cellMap = rowMap.get(rowid);
      return colOrder.map(c => cellMap[c.colid] ?? '');
    });

    return [header, ...dataRows];
  }

  /**
   * Build the HTML clipboard string for a VXE grid.
   * When copyWithFormatting is on, reads computed styles from the live DOM
   * cells and applies them inline so colours survive the paste into Excel/Word.
   */
  function buildVxeGridHTML(vxeContainer, fullGrid) {
    if (!config.copyWithFormatting) {
      return `<html><body><table>${
        fullGrid.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
      }</table></body></html>`;
    }

    // Map rowid → colid → computed style string.
    const styleGrid = new Map(); // rowid → Map<colid, styleStr>
    const headerStyles = new Map(); // colid → styleStr

    vxeContainer.querySelectorAll('thead th[data-colid]').forEach(th => {
      const colid = th.getAttribute('data-colid');
      if (!colid || headerStyles.has(colid)) return;
      const s = cellStyleStr(th);
      if (s) headerStyles.set(colid, s);
    });

    vxeContainer.querySelectorAll('tbody tr[data-rowid]').forEach(tr => {
      const rowid = tr.getAttribute('data-rowid');
      if (!styleGrid.has(rowid)) styleGrid.set(rowid, new Map());
      const map = styleGrid.get(rowid);
      tr.querySelectorAll('td[data-colid]').forEach(td => {
        const colid = td.getAttribute('data-colid');
        if (!map.has(colid)) {
          const s = cellStyleStr(td);
          if (s) map.set(colid, s);
        }
      });
    });

    // Rebuild colOrder from fullGrid header row (index = position in fullGrid).
    // We need colids in the same order. Re-derive from vxeContainer.
    const colOrder = [];
    const seen = new Set();
    vxeContainer.querySelectorAll('thead th[data-colid]').forEach(th => {
      const colid = th.getAttribute('data-colid');
      if (colid && !seen.has(colid)) { seen.add(colid); colOrder.push(colid); }
    });

    const rowOrder = [];
    const rowSeen = new Set();
    vxeContainer.querySelectorAll('tbody tr[data-rowid]').forEach(tr => {
      const rowid = tr.getAttribute('data-rowid');
      if (rowid && !rowSeen.has(rowid)) { rowSeen.add(rowid); rowOrder.push(rowid); }
    });

    const headerRow = fullGrid[0]
      .map((text, ci) => {
        const colid = colOrder[ci];
        const s = colid ? (headerStyles.get(colid) || '') : '';
        const styleAttr = s ? ` style="${s}"` : '';
        return `<th${styleAttr}>${escapeHtml(text)}</th>`;
      })
      .join('');

    const bodyRows = fullGrid.slice(1).map((row, ri) => {
      const rowid = rowOrder[ri];
      const rowStyleMap = rowid ? (styleGrid.get(rowid) || new Map()) : new Map();
      const cells = row.map((text, ci) => {
        const colid = colOrder[ci];
        const s = colid ? (rowStyleMap.get(colid) || '') : '';
        const styleAttr = s ? ` style="${s}"` : '';
        return `<td${styleAttr}>${escapeHtml(text)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `<html><body><table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
  }

  function cellStyleStr(el) {
    const cs  = window.getComputedStyle(el);
    const fmt = config.copyFmtStyles || {};
    const parts = [];

    if (fmt.bg) {
      let v = cs.getPropertyValue('background-color');
      if (isTransparent(v)) v = resolveBackground(el.parentElement) || v;
      if (!isTransparent(v)) parts.push(`background-color:${v}`);
    }

    if (fmt.color) {
      const v = cs.getPropertyValue('color');
      parts.push(`color:${v}`);
    }

    if (fmt.font) {
      const fw = cs.getPropertyValue('font-weight');
      const fi = cs.getPropertyValue('font-style');
      // Only carry bold if weight is visually bold (≥600). Weights 400–500 look
      // normal on screen; passing them through makes Excel render cells as bold.
      const fwNum = parseInt(fw, 10);
      if (!isNaN(fwNum) && fwNum >= 600) parts.push(`font-weight:${fw}`);
      else if (fw === 'bold') parts.push(`font-weight:bold`);
      if (fi === 'italic' || fi === 'oblique') parts.push(`font-style:${fi}`);
    }

    if (fmt.align) {
      const v = cs.getPropertyValue('text-align');
      if (v !== 'start' && v !== 'left') parts.push(`text-align:${v}`);
    }

    if (fmt.size) {
      const v = cs.getPropertyValue('font-size');
      parts.push(`font-size:${v}`);
    }

    if (fmt.border) {
      ['border-top', 'border-right', 'border-bottom', 'border-left'].forEach(side => {
        const w = cs.getPropertyValue(`${side}-width`);
        const s = cs.getPropertyValue(`${side}-style`);
        const c = cs.getPropertyValue(`${side}-color`);
        if (w && w !== '0px' && s && s !== 'none') parts.push(`${side}:${w} ${s} ${c}`);
      });
    }

    return parts.join(';');
  }

  function isTransparent(v) {
    return !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)';
  }

  /** Walk up DOM ancestors to find the first non-transparent background-color. */
  function resolveBackground(el) {
    while (el && el !== document.body) {
      const v = window.getComputedStyle(el).getPropertyValue('background-color');
      if (!isTransparent(v)) return v;
      el = el.parentElement;
    }
    return null;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Copy Table to Clipboard ─────────────────────────────────────────────

  /**
   * Find the nearest <table> ancestor of `target` and copy it to the
   * clipboard as TSV so it can be pasted directly into Excel.
   *
   * Also copies text/html so apps that understand HTML tables get richer data.
   */
  async function copyTableAtTarget(target) {
    if (!config.copyEnabled) {
      showToast('Copy Table is disabled in Settings.', 'warn');
      return;
    }
    if (!target) {
      showToast('Right-click inside a table first.', 'warn');
      return;
    }

    // ── VXE-table: fixed left columns live in a separate DOM panel ────────────
    const vxeContainer = target.closest('.vxe-table');
    if (vxeContainer) {
      const fullGrid = buildVxeGrid(vxeContainer);
      if (!fullGrid.length) { showToast('No data found in table.', 'warn'); return; }
      const tsv  = gridToTSV(fullGrid);
      const html = buildVxeGridHTML(vxeContainer, fullGrid);
      flashTableHighlight(vxeContainer);
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
              text:    cell.tagName === 'TH' ? getHeaderText(cell) : getCellText(cell),
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
    // Capture computed styles before cloning (clone loses live style data).
    const styleMap = new Map();
    if (config.copyWithFormatting) {
      table.querySelectorAll('td, th').forEach(cell => {
        const s = cellStyleStr(cell);
        if (s) styleMap.set(cell, s);
      });
    }

    const clone = table.cloneNode(true);
    clone.querySelectorAll('script, style').forEach(el => el.remove());
    clone.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes)
        .filter(a => a.name.startsWith('on'))
        .forEach(a => el.removeAttribute(a.name));
    });

    // Apply captured styles to cloned cells.
    if (config.copyWithFormatting && styleMap.size) {
      const origCells = Array.from(table.querySelectorAll('td, th'));
      const cloneCells = Array.from(clone.querySelectorAll('td, th'));
      origCells.forEach((orig, i) => {
        const s = styleMap.get(orig);
        if (s && cloneCells[i]) cloneCells[i].setAttribute('style', s);
      });
    }

    // Prepend detached header rows as a <thead> inside the cloned table.
    if (headerRows.length) {
      const thead = document.createElement('thead');
      headerRows.forEach(tr => {
        const row = document.createElement('tr');
        Array.from(tr.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"]')).forEach(cell => {
          const th = document.createElement('th');
          th.textContent = getHeaderText(cell);
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
        const isHeader = cell.tagName === 'TH' || cell.getAttribute('role') === 'columnheader';
        const text = isHeader ? getHeaderText(cell) : getCellText(cell);
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
  const MIN_CHARS  = 3;
  const MAX_CHARS  = 1500;
  // Short common words not worth translating (English UI noise).
  const SKIP_WORDS = new Set(['the','and','for','are','but','not','you','all','can','had',
    'her','was','one','our','out','day','get','has','him','his','how','its','may',
    'new','now','own','say','she','too','use','who','yes','yet','no','ok','id']);

  function shouldSkip(text) {
    if (text.length < MIN_CHARS) return true;
    // Single word with no spaces: skip if it's in the noise list.
    if (!/\s/.test(text) && SKIP_WORDS.has(text.toLowerCase())) return true;
    // Pure numbers / punctuation only.
    if (/^[\d\s.,!?;:()\-–—"']+$/.test(text)) return true;
    return false;
  }
  const CACHE_KEY = 'epf_xlat_cache';
  const CACHE_MAX = 300;

  // API codes, display labels, and BCP-47 speech codes for each target language.
  const LANG_META = {
    en: { api: 'en',    label: 'EN', speech: 'en-US', flag: 'en' },
    id: { api: 'id',    label: 'ID', speech: 'id-ID', flag: 'id' },
    vi: { api: 'vi',    label: 'VI', speech: 'vi-VN', flag: 'vi' },
    zh: { api: 'zh-CN', label: 'ZH', speech: 'zh-CN', flag: 'zh' },
    ko: { api: 'ko',    label: 'KO', speech: 'ko-KR', flag: 'ko' },
    ja: { api: 'ja',    label: 'JA', speech: 'ja-JP', flag: 'ja' },
  };

  // ── Speech synthesis ──────────────────────────────────────────────────────────

  // Cache which speech langs are available (populated on first use).
  let _voiceMap = null;

  function getVoiceMap() {
    if (_voiceMap) return _voiceMap;
    _voiceMap = {};
    const voices = speechSynthesis.getVoices();
    for (const v of voices) {
      const tag = v.lang.toLowerCase();
      for (const [key, meta] of Object.entries(LANG_META)) {
        if (!_voiceMap[key] && tag.startsWith(meta.speech.toLowerCase().slice(0, 2))) {
          _voiceMap[key] = v;
        }
      }
    }
    return _voiceMap;
  }

  // Voices may load async — rebuild map when they arrive.
  speechSynthesis.addEventListener('voiceschanged', () => { _voiceMap = null; });

  function speakText(text, langKey, btn) {
    const isSpeaking = typeof speechSynthesis.speaking === 'boolean' && speechSynthesis.speaking;
    if (isSpeaking) {
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
      if (btn.dataset.speaking === '1') {
        btn.dataset.speaking = '';
        btn.classList.remove('epf-speak-active');
        return;
      }
      document.querySelectorAll('.epf-speak-active').forEach(b => {
        b.dataset.speaking = '';
        b.classList.remove('epf-speak-active');
      });
    }

    const voiceMap = getVoiceMap();
    const voice    = voiceMap[langKey] || null;
    if (!voice && langKey !== 'en') return; // no voice available, skip silently

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang  = LANG_META[langKey].speech;
    if (voice) utt.voice = voice;
    utt.rate  = 0.95;

    btn.dataset.speaking = '1';
    btn.classList.add('epf-speak-active');

    utt.onend = utt.onerror = () => {
      btn.dataset.speaking = '';
      btn.classList.remove('epf-speak-active');
    };

    speechSynthesis.speak(utt);
  }

  function hasSpeechSupport(langKey) {
    if (!('speechSynthesis' in window)) return false;
    const voices = speechSynthesis.getVoices();
    // Voices not loaded yet — show button optimistically, hide on error.
    if (!voices.length) return true;
    return !!getVoiceMap()[langKey];
  }

  let _enabled    = true;
  let _langs      = { en: false, id: true, vi: true, zh: false, ko: false, ja: false };
  let _langsOrder = ['en', 'id', 'vi', 'zh', 'ko', 'ja'];
  let _anchor     = { top: false, bottom: false, left: false, right: false };
  let _fontSize   = 13;
  let _opacity = 100;
  let _tip      = null;
  let _activeId = 0;

  // In-memory cache: `${srcCode}||${text}` → { id?, vi?, zh? }
  const _mem = new Map();

  // ── Init ──────────────────────────────────────────────────────────────────────

  function isPageActive() {
    return window.__EPF_PAGE_ACTIVE__ === true;
  }

  chrome.storage.local.get(['epf_config', CACHE_KEY], (data) => {
    const cfg = data.epf_config || {};
    _enabled    = cfg.translateEnabled    ?? false;
    _langs      = cfg.translateLangs      ?? { en: false, id: true, vi: true, zh: false, ko: false, ja: false };
    _langsOrder = cfg.translateLangsOrder ?? ['en', 'id', 'vi', 'zh', 'ko', 'ja'];
    _anchor     = cfg.translateAnchor     ?? { top: false, bottom: true, left: false, right: true };
    _fontSize   = cfg.translateFontSize   ?? 13;
    _opacity = cfg.translateOpacity ?? 100;

    const saved = data[CACHE_KEY] || {};
    for (const [k, v] of Object.entries(saved)) _mem.set(k, v);

    // isPageActive() may still be false due to race with main IIFE's loadConfig.
    // Compute page-active directly from config patterns as the source of truth.
    const patterns = cfg.urlPatterns || ['*'];
    const pageIsActive = patterns.some(p => {
      if (p === '*' || p === '<all_urls>') return true;
      try { return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(location.href); }
      catch { return false; }
    });
    if (_enabled && pageIsActive) attachListeners();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SAVE_CONFIG') {
      const wasEnabled = _enabled;
      _enabled    = msg.config?.translateEnabled    ?? false;
      _langs      = msg.config?.translateLangs      ?? _langs;
      _langsOrder = msg.config?.translateLangsOrder ?? _langsOrder;
      _anchor     = msg.config?.translateAnchor     ?? _anchor;
      _opacity    = msg.config?.translateOpacity    ?? _opacity;
      _fontSize   = msg.config?.translateFontSize   ?? _fontSize;
      if (!_enabled || !isPageActive()) hideTip();
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
    if (!_enabled || !isPageActive()) return;
    if (_tip && _tip.contains(e.target)) return;
    setTimeout(() => {
      const sel  = window.getSelection();
      let text   = sel?.toString().trim();
      if (!text || shouldSkip(text) || text.length > MAX_CHARS) { hideTip(); return; }
      const range = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) return;

      // If selection looks like a partial word (no spaces, letters/digits only),
      // expand to full word boundaries so "omp" from "Company" becomes "Company".
      if (!/\s/.test(text) && /^[\w'-]+$/.test(text)) {
        const node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
          const full  = node.textContent;
          let   start = range.startOffset;
          let   end   = range.endOffset;
          const isWordChar = c => /[\w'-]/.test(c);
          while (start > 0 && isWordChar(full[start - 1])) start--;
          while (end < full.length && isWordChar(full[end])) end++;
          const expanded = full.slice(start, end).trim();
          if (expanded.length >= MIN_CHARS && expanded.length <= MAX_CHARS) text = expanded;
        }
      }

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

    const targets = _langsOrder.filter(l => LANG_META[l] && _langs[l] && l !== srcKey);
    if (!targets.length) return;

    const tip = buildTip(srcCode);
    tip.style.setProperty('--tip-bg-alpha', (_opacity / 100).toFixed(2));
    tip.style.fontSize = _fontSize + 'px';
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
    const flagImg = document.createElement('img');
    flagImg.src = chrome.runtime.getURL(`icons/flags/${LANG_META[l].flag}.svg`);
    flagImg.className = 'epf-tip-flag';
    flagImg.alt = LANG_META[l].label;
    badge.appendChild(flagImg);
    badge.appendChild(document.createTextNode(LANG_META[l].label));
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
      // Speaker button — only when speech synthesis is available for this language.
      if (hasSpeechSupport(l)) {
        const btn = document.createElement('button');
        btn.className = 'epf-speak-btn';
        btn.title = 'Read aloud';
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd"/></svg>';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          speakText(value, l, btn);
        });
        row.appendChild(btn);
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

