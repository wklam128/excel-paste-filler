/**
 * utils/field-scanner.js
 *
 * Scans the live DOM for every fillable field and returns them
 * sorted in VISUAL order (top→bottom, left→right).
 *
 * Supports:
 *   - <input>, <textarea>, <select>
 *   - [contenteditable] elements (used by many grid/table UIs)
 *
 * Exposed as: window.EFF_FieldScanner
 */

(function (root) {
  'use strict';

  // CSS selectors for native form fields.
  const NATIVE_SELECTOR = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
  ].join(', ');

  // CSS selector for contenteditable elements (div, td, span, etc.).
  // Excludes the document body itself and elements that are read-only.
  const CE_SELECTOR = '[contenteditable="true"], [contenteditable=""]';

  // CSS selectors for custom dropdown wrappers (Ant Design, Element UI, etc.).
  const CUSTOM_DROP_SELECTOR = [
    '.ant-select',
    '.el-select',
    '.v-select',
    '.multiselect',
    '.select2-container',
    '.chosen-container',
    '[role="combobox"][aria-haspopup]',
  ].join(', ');

  // CSS selectors for custom date picker wrappers.
  const DATE_PICKER_SELECTOR = [
    '.ant-calendar-picker',
    '.ant-picker',
    '.el-date-editor',
    '.el-date-picker',
    '[data-datepicker]',
  ].join(', ');

  /**
   * Scan the document and return all fillable fields sorted visually
   * (top-to-bottom, left-to-right — critical for table columns).
   *
   * @returns {FieldInfo[]}
   */
  function scanFields() {
    const seen    = new Set();
    const results = [];

    // Collect native fields.
    document.querySelectorAll(NATIVE_SELECTOR).forEach((el) => {
      if (el.closest('#epf-root, #eff-root')) return; // skip our own injected UI
      if (!isVisible(el)) return;
      const key = uniqueKey(el);
      if (seen.has(key)) return;
      seen.add(key);
      results.push(buildFieldInfo(el));
    });

    // Collect contenteditable fields.
    document.querySelectorAll(CE_SELECTOR).forEach((el) => {
      if (el === document.body) return;
      if (el.closest('#epf-root, #eff-root')) return;
      if (!isVisible(el)) return;
      // Skip if a native input is already nested inside (avoid double-counting).
      if (el.querySelector('input, textarea, select')) return;
      const key = uniqueKey(el);
      if (seen.has(key)) return;
      seen.add(key);
      results.push(buildFieldInfo(el));
    });

    // Collect custom dropdown wrappers (Ant Design, Element UI, v-select, etc.).
    document.querySelectorAll(CUSTOM_DROP_SELECTOR).forEach((el) => {
      if (el.closest('#epf-root, #eff-root')) return;
      if (!isVisible(el)) return;
      if (el.parentElement?.closest(CUSTOM_DROP_SELECTOR)) return;
      const key = uniqueKey(el);
      if (seen.has(key)) return;
      seen.add(key);
      results.push(buildFieldInfo(el));
    });

    // Collect custom date picker wrappers.
    document.querySelectorAll(DATE_PICKER_SELECTOR).forEach((el) => {
      if (el.closest('#epf-root, #eff-root')) return;
      if (!isVisible(el)) return;
      if (el.parentElement?.closest(DATE_PICKER_SELECTOR)) return;
      const key = uniqueKey(el);
      if (seen.has(key)) return;
      seen.add(key);
      results.push(buildFieldInfo(el));
    });

    // Sort visually: top→bottom, then left→right within the same row.
    // A 10 px tolerance groups elements on the same visual row together.
    results.sort((a, b) => {
      const ra = a.element.getBoundingClientRect();
      const rb = b.element.getBoundingClientRect();
      const rowDiff = ra.top - rb.top;
      if (Math.abs(rowDiff) > 10) return rowDiff;   // different rows
      return ra.left - rb.left;                       // same row → left first
    });

    return results;
  }

  /**
   * Build a FieldInfo descriptor for one element.
   * @param {HTMLElement} el
   * @returns {FieldInfo}
   */
  function buildFieldInfo(el) {
    const tag             = el.tagName.toLowerCase();
    const isContentEdit   = el.isContentEditable && tag !== 'input' && tag !== 'textarea' && tag !== 'select';
    const isCustomDrop    = !isContentEdit && el.matches?.(CUSTOM_DROP_SELECTOR);
    const isDatePick      = !isContentEdit && !isCustomDrop && el.matches?.(DATE_PICKER_SELECTOR);
    const type            = isDatePick    ? 'date-picker'
                          : isCustomDrop  ? 'custom-dropdown'
                          : isContentEdit ? 'contenteditable'
                          : (el.getAttribute('type') || tag).toLowerCase();

    return {
      element:        el,
      tag,
      type,
      isContentEditable: isContentEdit,
      id:             el.id          || '',
      name:           el.name        || '',
      placeholder:    el.placeholder || el.getAttribute('data-placeholder') || '',
      ariaLabel:      el.getAttribute('aria-label') || '',
      labelText:      getLabelText(el),
      value:          isContentEdit ? el.innerText : (el.value || ''),
      options:        tag === 'select' ? getSelectOptions(el) : [],
    };
  }

  /**
   * Find the visible label text for a field.
   * Priority: <label for=>, wrapping <label>, aria-labelledby,
   *           aria-label, header cell (for table columns), preceding text.
   */
  function getLabelText(el) {
    // 1. Explicit <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.innerText.trim();
    }

    // 2. Ancestor <label>
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.innerText.replace(el.value || '', '').trim();

    // 3. aria-labelledby
    const lby = el.getAttribute('aria-labelledby');
    if (lby) {
      const ref = document.getElementById(lby);
      if (ref) return ref.innerText.trim();
    }

    // 4. aria-label
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();

    // 5. Table header cell: look for the <th> in the same column.
    const td = el.closest('td, th');
    if (td) {
      const row   = td.closest('tr');
      const table = td.closest('table');
      if (row && table) {
        const colIdx = Array.from(row.cells || []).indexOf(td);
        const thead  = table.querySelector('thead tr, tr:first-child');
        if (thead && colIdx >= 0) {
          const headerCell = (thead.cells || thead.querySelectorAll('th, td'))[colIdx];
          if (headerCell) return headerCell.innerText.trim();
        }
      }
    }

    // 6. Closest preceding sibling text.
    return getPrecedingText(el);
  }

  function getPrecedingText(el) {
    let node = el.previousSibling;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim().replace(/:$/, '');
        if (t.length > 1) return t;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const t = node.innerText && node.innerText.trim().replace(/:$/, '');
        if (t && t.length > 1 && t.length < 80) return t;
        break;
      }
      node = node.previousSibling;
    }
    return '';
  }

  function getSelectOptions(el) {
    return Array.from(el.options).map((o) => ({ value: o.value, text: o.text.trim() }));
  }

  /** True if the element is visible and has layout dimensions. */
  function isVisible(el) {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    // Must have area AND be at least partially within the viewport.
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0;
  }

  /** Stable deduplication key. */
  function uniqueKey(el) {
    const r = el.getBoundingClientRect();
    return `${el.tagName}|${el.id}|${el.name || ''}|${Math.round(r.top)}|${Math.round(r.left)}`;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  root.EFF_FieldScanner = {
    scanFields,
    buildFieldInfo,
    getLabelText,
  };

})(window);
