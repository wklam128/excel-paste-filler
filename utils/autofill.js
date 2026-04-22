/**
 * utils/autofill.js
 *
 * Writes a value into any fillable field and dispatches the correct events
 * so that React / Vue / Angular / plain JS all register the change.
 *
 * Supports: input, textarea, select, [contenteditable]
 *
 * Exposed as: window.EFF_Autofill
 */

(function (root) {
  'use strict';

  /**
   * Write a string value into a field element.
   * @param {HTMLElement} el        – the target element
   * @param {FieldInfo}   fieldInfo – descriptor from EFF_FieldScanner
   * @param {string}      rawValue  – value to write
   * @returns {boolean} true on success
   */
  function writeValue(el, fieldInfo, rawValue) {
    const value = String(rawValue);
    const type  = fieldInfo ? fieldInfo.type : inferType(el);

    try {
      // ── contenteditable ─────────────────────────────────────────────────
      if (fieldInfo?.isContentEditable || el.isContentEditable) {
        // Focus first so the element registers the change in frameworks.
        el.focus();
        // Use execCommand for broadest framework compatibility.
        // Select all existing text first, then insert the new value.
        document.execCommand('selectAll', false, null);
        const inserted = document.execCommand('insertText', false, value);
        if (!inserted) {
          // execCommand blocked (e.g. in some sandboxed contexts) — set directly.
          el.innerText = value;
          fire(el, 'input');
          fire(el, 'change');
        }
        fire(el, 'blur');
        return true;
      }

      // ── checkbox ─────────────────────────────────────────────────────────
      if (type === 'checkbox') {
        const checked = ['true', '1', 'yes', 'on', 'checked'].includes(value.toLowerCase());
        if (el.checked !== checked) {
          el.checked = checked;
          fire(el, 'click');
          fire(el, 'change');
        }
        return true;
      }

      // ── radio ─────────────────────────────────────────────────────────────
      if (type === 'radio') {
        if (el.name) {
          const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
          group.forEach((radio) => {
            const match =
              radio.value.toLowerCase() === value.toLowerCase() ||
              (radio.labels?.[0]?.innerText?.trim().toLowerCase() === value.toLowerCase());
            if (match && !radio.checked) {
              radio.checked = true;
              fire(radio, 'change');
            }
          });
        }
        return true;
      }

      // ── select ────────────────────────────────────────────────────────────
      if (el.tagName.toLowerCase() === 'select') {
        const lv  = value.toLowerCase().trim();
        // Exact value match → exact text match → partial text match.
        const opt =
          Array.from(el.options).find((o) => o.value.toLowerCase() === lv) ||
          Array.from(el.options).find((o) => o.text.trim().toLowerCase() === lv) ||
          Array.from(el.options).find((o) => o.text.trim().toLowerCase().includes(lv));

        if (opt) {
          nativeSetter(el, opt.value);
          fire(el, 'change');
          fire(el, 'input');
          fire(el, 'blur');
          return true;
        }
        return false; // no matching option
      }

      // ── input / textarea ──────────────────────────────────────────────────
      nativeSetter(el, value);
      fire(el, 'focus');
      fire(el, 'input');
      fire(el, 'change');
      fire(el, 'blur');
      return true;

    } catch (err) {
      console.warn('[EPF] writeValue error:', err);
      return false;
    }
  }

  /**
   * Infer field type from the element when no FieldInfo is available.
   */
  function inferType(el) {
    if (el.isContentEditable) return 'contenteditable';
    return (el.getAttribute('type') || el.tagName).toLowerCase();
  }

  /**
   * Set .value through the native HTMLInputElement/HTMLTextAreaElement
   * property descriptor so React synthetic event system picks it up.
   */
  function nativeSetter(el, value) {
    let setter;
    if (el instanceof HTMLSelectElement) {
      setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    } else if (el instanceof HTMLTextAreaElement) {
      setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    } else {
      setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    }
    setter ? setter.call(el, value) : (el.value = value);
  }

  /** Dispatch a bubbling, cancelable event. */
  function fire(el, name) {
    el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
  }

  /**
   * Flash an outline on a field for visual feedback, then remove it after 1.8 s.
   * Cancels any previous pending restore on the same element.
   */
  function highlightElement(el, outlineStyle) {
    clearTimeout(el._epfHL);
    el.style.transition = 'outline 0.3s ease';
    el.style.outline    = outlineStyle;
    el._epfHL = setTimeout(() => {
      el.style.outline    = '';
      el.style.transition = '';
    }, 1800);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  root.EFF_Autofill = {
    writeValue,
    highlightElement,
  };

})(window);
