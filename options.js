'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULT = {
  urlPatterns:        ['*'],
  showToast:          true,
  highlightFields:    true,
  skipEmptyCells:     false,
  sameTypeOnly:       false,
  copyEnabled:        true,
  copyWithFormatting: false,
  copyFmtStyles: { bg: true, color: true, font: true, align: true, size: false, border: false },
  translateEnabled:   false,
  translateLangs:      { en: false, id: true, vi: true, zh: false, ko: false, ja: false },
  translateLangsOrder: ['en', 'id', 'vi', 'zh', 'ko', 'ja'],
  translateAnchor:     { top: false, bottom: true, left: false, right: true },
  translateOpacity:    100,
  translateFontSize:   13,
};

// ── Toast notification (top-centre) ───────────────────────────────────────────

let _toastTimer = null;

function showToast(message, detail = '') {
  const el = $('opts-toast');
  el.innerHTML = `<span class="opts-toast-icon">✓</span>${message}${detail ? `<span class="opts-toast-detail">— ${detail}</span>` : ''}`;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// Map each input id → human-readable toast message function.
const TOAST_MSG = {
  'opt-highlight':    (el) => `Highlight filled fields ${el.checked ? 'on' : 'off'}`,
  'opt-toast':        (el) => `Confirmation toast ${el.checked ? 'on' : 'off'}`,
  'opt-skip-empty':   (el) => `Skip empty cells ${el.checked ? 'on' : 'off'}`,
  'opt-same-type':    (el) => `Same field type only ${el.checked ? 'on' : 'off'}`,
  'opt-copy-enabled': (el) => el.checked ? 'Copy Table to Clipboard enabled' : 'Copy Table to Clipboard disabled',
  'opt-copy-format':  (el) => `Copy with source formatting ${el.checked ? 'enabled' : 'disabled'}`,
  'opt-fmt-bg':       (el) => `Background colour ${el.checked ? 'included' : 'excluded'}`,
  'opt-fmt-color':    (el) => `Text colour ${el.checked ? 'included' : 'excluded'}`,
  'opt-fmt-font':     (el) => `Bold & italic ${el.checked ? 'included' : 'excluded'}`,
  'opt-fmt-align':    (el) => `Text alignment ${el.checked ? 'included' : 'excluded'}`,
  'opt-fmt-size':     (el) => `Font size ${el.checked ? 'included' : 'excluded'}`,
  'opt-fmt-border':   (el) => `Borders ${el.checked ? 'included' : 'excluded'}`,
  'opt-translate':    (el) => `Translation tooltip ${el.checked ? 'enabled' : 'disabled'}`,
  'opt-tlang-en':     (el) => `English ${el.checked ? 'added' : 'removed'}`,
  'opt-tlang-id':     (el) => `Bahasa Indonesia ${el.checked ? 'added' : 'removed'}`,
  'opt-tlang-vi':     (el) => `Tiếng Việt ${el.checked ? 'added' : 'removed'}`,
  'opt-tlang-zh':     (el) => `中文 Chinese ${el.checked ? 'added' : 'removed'}`,
  'opt-tlang-ko':     (el) => `한국어 Korean ${el.checked ? 'added' : 'removed'}`,
  'opt-tlang-ja':     (el) => `日本語 Japanese ${el.checked ? 'added' : 'removed'}`,
  'opt-pos-top':      ()   => 'Tooltip position updated',
  'opt-pos-bottom':   ()   => 'Tooltip position updated',
  'opt-pos-left':     ()   => 'Tooltip position updated',
  'opt-pos-right':    ()   => 'Tooltip position updated',
  'opt-tip-opacity':  (el) => `Tooltip opacity ${el.value}%`,
};

// ── Load ──────────────────────────────────────────────────────────────────────

async function load() {
  const data = await storageGet(['epf_config', 'epf_xlat_cache']);
  const cfg  = data.epf_config || DEFAULT;

  $('opt-highlight').checked    = cfg.highlightFields    ?? true;
  $('opt-toast').checked        = cfg.showToast          ?? true;
  $('opt-skip-empty').checked   = cfg.skipEmptyCells     ?? false;
  $('opt-same-type').checked    = cfg.sameTypeOnly       ?? false;
  $('opt-copy-enabled').checked = cfg.copyEnabled        ?? true;
  $('opt-copy-format').checked  = cfg.copyWithFormatting ?? false;

  const fmts = cfg.copyFmtStyles ?? DEFAULT.copyFmtStyles;
  $('opt-fmt-bg').checked     = fmts.bg     ?? true;
  $('opt-fmt-color').checked  = fmts.color  ?? true;
  $('opt-fmt-font').checked   = fmts.font   ?? true;
  $('opt-fmt-align').checked  = fmts.align  ?? true;
  $('opt-fmt-size').checked   = fmts.size   ?? false;
  $('opt-fmt-border').checked = fmts.border ?? false;

  $('opt-translate').checked = cfg.translateEnabled ?? false;

  const anchor = cfg.translateAnchor ?? DEFAULT.translateAnchor;
  $('opt-pos-top').checked    = anchor.top    ?? false;
  $('opt-pos-bottom').checked = anchor.bottom ?? true;
  $('opt-pos-left').checked   = anchor.left   ?? false;
  $('opt-pos-right').checked  = anchor.right  ?? true;
  updateAnchorPreview();

  const opacity = cfg.translateOpacity ?? 100;
  $('opt-tip-opacity').value           = opacity;
  $('opt-tip-opacity-val').textContent = opacity + '%';

  const fontSize = cfg.translateFontSize ?? 13;
  $('opt-tip-fontsize').value           = fontSize;
  $('opt-tip-fontsize-val').textContent = fontSize + 'px';

  const langs = cfg.translateLangs ?? DEFAULT.translateLangs;
  $('opt-tlang-en').checked = langs.en ?? false;
  $('opt-tlang-id').checked = langs.id ?? true;
  $('opt-tlang-vi').checked = langs.vi ?? true;
  $('opt-tlang-zh').checked = langs.zh ?? false;
  $('opt-tlang-ko').checked = langs.ko ?? false;
  $('opt-tlang-ja').checked = langs.ja ?? false;

  const order = cfg.translateLangsOrder ?? DEFAULT_LANG_ORDER;
  applyLangOrder(order);
  updateLangSeq();
  initLangDrag();

  $('opt-urls').value = (cfg.urlPatterns || ['*']).join('\n');

  updateCacheInfo(data.epf_xlat_cache);
  applyCopyEnabled();
  applyCopyFormatEnabled();
  applyTranslateEnabled();
}

function updateCacheInfo(cacheObj) {
  const count = cacheObj ? Object.keys(cacheObj).length : 0;
  $('cache-info').textContent = count
    ? `${count} entr${count !== 1 ? 'ies' : 'y'} stored`
    : 'Cache is empty';
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

let _saveTimer = null;

function buildConfig() {
  const patterns = $('opt-urls').value
    .split('\n').map(p => p.trim()).filter(Boolean);
  return {
    urlPatterns:        patterns.length ? patterns : ['*'],
    showToast:          $('opt-toast').checked,
    highlightFields:    $('opt-highlight').checked,
    skipEmptyCells:     $('opt-skip-empty').checked,
    sameTypeOnly:       $('opt-same-type').checked,
    copyEnabled:        $('opt-copy-enabled').checked,
    copyWithFormatting: $('opt-copy-format').checked,
    copyFmtStyles: {
      bg:     $('opt-fmt-bg').checked,
      color:  $('opt-fmt-color').checked,
      font:   $('opt-fmt-font').checked,
      align:  $('opt-fmt-align').checked,
      size:   $('opt-fmt-size').checked,
      border: $('opt-fmt-border').checked,
    },
    translateEnabled: $('opt-translate').checked,
    translateAnchor: {
      top:    $('opt-pos-top').checked,
      bottom: $('opt-pos-bottom').checked,
      left:   $('opt-pos-left').checked,
      right:  $('opt-pos-right').checked,
    },
    translateOpacity:  parseInt($('opt-tip-opacity').value, 10),
    translateFontSize: parseInt($('opt-tip-fontsize').value, 10),
    translateLangs: {
      en: $('opt-tlang-en').checked,
      id: $('opt-tlang-id').checked,
      vi: $('opt-tlang-vi').checked,
      zh: $('opt-tlang-zh').checked,
      ko: $('opt-tlang-ko').checked,
      ja: $('opt-tlang-ja').checked,
    },
    translateLangsOrder: getLangOrder(),
  };
}

async function saveConfig(sourceEl) {
  const cfg = buildConfig();
  await storageSet({ epf_config: cfg });
  chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: cfg });

  if (sourceEl) {
    const msgFn = TOAST_MSG[sourceEl.id];
    if (msgFn) showToast(msgFn(sourceEl));
  }
}

// Attach auto-save to every checkbox and range input.
document.querySelectorAll('input[type="checkbox"], input[type="range"]').forEach(el => {
  el.addEventListener('change', () => saveConfig(el));
});

// Debounce URL textarea.
$('opt-urls').addEventListener('input', () => {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveConfig(null);
    showToast('URL patterns saved');
  }, 800);
});

// ── Reset to defaults ─────────────────────────────────────────────────────────

$('btn-reset-defaults').addEventListener('click', async () => {
  if (!confirm('Reset all settings to factory defaults? This cannot be undone.')) return;
  const cfg = {
    urlPatterns:         ['*'],
    showToast:           true,
    highlightFields:     true,
    skipEmptyCells:      false,
    copyEnabled:         true,
    copyWithFormatting:  false,
    copyFmtStyles:       { bg: true, color: true, font: true, align: true, size: false, border: false },
    translateEnabled:    false,
    translateLangs:      { en: false, id: true, vi: true, zh: false, ko: false, ja: false },
    translateLangsOrder: ['en', 'id', 'vi', 'zh', 'ko', 'ja'],
    translateAnchor:     { top: false, bottom: true, left: false, right: true },
    translateOpacity:    100,
    translateFontSize:   13,
  };
  await storageSet({ epf_config: cfg });
  chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: cfg });
  await load();
  showToast('Settings reset to defaults');
});

// ── Clear cache ───────────────────────────────────────────────────────────────

$('btn-clear-cache').addEventListener('click', async () => {
  await new Promise(r => chrome.runtime.sendMessage({ type: 'CLEAR_XLAT_CACHE' }, r));
  updateCacheInfo(null);
  showToast('Translation cache cleared');

  const btn = $('btn-clear-cache');
  const orig = btn.textContent;
  btn.textContent = 'Cleared!';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
function storageSet(items) {
  return new Promise(r => chrome.storage.local.set(items, r));
}

// ── Copy Table card: enable toggle → auto collapse/expand ─────────────────────

function applyCopyEnabled() {
  const enabled = $('opt-copy-enabled').checked;
  $('copy-table-badge').textContent = enabled ? 'Enabled' : 'Disabled';
  $('copy-table-badge').classList.toggle('enabled', enabled);
  $('copy-table-card').classList.toggle('collapsed', !enabled);
  $('copy-table-content').querySelectorAll('input, button, select').forEach(el => {
    el.disabled = !enabled;
  });
}

$('opt-copy-enabled').addEventListener('change', applyCopyEnabled);

// ── Selection Translate card: enable toggle → auto collapse/expand ────────────

function applyTranslateEnabled() {
  const enabled = $('opt-translate').checked;
  $('translate-badge').textContent = enabled ? 'Enabled' : 'Disabled';
  $('translate-badge').classList.toggle('enabled', enabled);
  $('translate-card').classList.toggle('collapsed', !enabled);
  $('translate-subopts').querySelectorAll('input, button, select').forEach(el => {
    el.disabled = !enabled;
  });
}

$('opt-translate').addEventListener('change', applyTranslateEnabled);

// ── Greyout: copy formatting sub-options ─────────────────────────────────────

function applyCopyFormatEnabled() {
  const enabled = $('opt-copy-format').checked;
  const sub     = $('copy-format-subopts');
  sub.classList.toggle('collapsed', !enabled);
  sub.querySelectorAll('input, button, select').forEach(el => {
    el.disabled = !enabled;
  });
}

$('opt-copy-format').addEventListener('change', applyCopyFormatEnabled);

// ── Anchor preview dot + description ─────────────────────────────────────────

function getAnchor() {
  return {
    top:    $('opt-pos-top').checked,
    bottom: $('opt-pos-bottom').checked,
    left:   $('opt-pos-left').checked,
    right:  $('opt-pos-right').checked,
  };
}

function describeAnchor(a) {
  const hasV = a.top  || a.bottom;
  const hasH = a.left || a.right;
  if (!hasV && !hasH) return 'Auto (near selection)';
  const vLabel = a.top && a.bottom ? 'Center' : a.top ? 'Top' : a.bottom ? 'Bottom' : 'Center';
  const hLabel = a.left && a.right ? 'Center' : a.left ? 'Left' : a.right ? 'Right' : 'Center';
  if (vLabel === 'Center' && hLabel === 'Center') return 'Screen center';
  if (vLabel === 'Center') return hLabel + ' center';
  if (hLabel === 'Center') return vLabel + ' center';
  return vLabel + ' ' + hLabel.toLowerCase();
}

function updateAnchorPreview() {
  const a = getAnchor();
  $('anchor-desc').textContent = describeAnchor(a);

  const hasV = a.top || a.bottom;
  const hasH = a.left || a.right;
  const vPct = a.top && a.bottom ? 50 : a.top ? 8 : a.bottom ? 92 : 50;
  const hPct = a.left && a.right ? 50 : a.left ? 8 : a.right ? 92 : 50;
  moveDot(hPct, vPct, hasV || hasH);
}

function moveDot(xPct, yPct, active) {
  let inner = $('anchor-dot').querySelector('.anchor-dot-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'anchor-dot-inner';
    $('anchor-dot').appendChild(inner);
  }
  inner.style.left = xPct + '%';
  inner.style.top  = yPct + '%';
  inner.style.background = active ? 'var(--green)' : 'var(--gray-400)';
}

['opt-pos-top', 'opt-pos-bottom', 'opt-pos-left', 'opt-pos-right'].forEach(id => {
  $(id).addEventListener('change', () => {
    updateAnchorPreview();
    showPreviewTooltip(1600);
  });
});

// ── Flash preview tooltip ─────────────────────────────────────────────────────

let _previewHideTimer = null;

const PREVIEW_SAMPLES = {
  en: { label: 'EN', text: 'This is a translation preview' },
  id: { label: 'ID', text: 'Ini adalah pratinjau terjemahan' },
  vi: { label: 'VI', text: 'Đây là bản xem trước bản dịch' },
  zh: { label: 'ZH', text: '这是翻译预览' },
  ko: { label: 'KO', text: '이것은 번역 미리보기입니다' },
  ja: { label: 'JA', text: 'これは翻訳プレビューです' },
};

function getPreviewEl() {
  let el = document.getElementById('epf-pos-preview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'epf-pos-preview';
    document.body.appendChild(el);
  }

  const orderedLangs = getLangOrder();
  const enabledRows  = orderedLangs
    .filter(l => $('opt-tlang-' + l)?.checked && PREVIEW_SAMPLES[l])
    .map(l => {
      const s = PREVIEW_SAMPLES[l];
      return `<div class="ppv-row"><span class="ppv-lang">${s.label}</span><span>${s.text}</span></div>`;
    })
    .join('');

  const fontSize = parseInt($('opt-tip-fontsize').value, 10) || 13;

  el.style.fontSize = fontSize + 'px';
  el.innerHTML = `
    <div class="ppv-header">
      <span class="ppv-title">Translation Tooltip</span>
      <span class="ppv-badge">Preview</span>
    </div>
    <div class="ppv-body">${enabledRows || '<span style="color:#9ca3af;font-size:11px">No languages selected</span>'}</div>`;

  return el;
}

function showPreviewTooltip(durationMs) {
  const anchor  = getAnchor();
  const opacity = parseInt($('opt-tip-opacity').value, 10) / 100;
  const MARGIN  = 20;

  const hasV = anchor.top  || anchor.bottom;
  const hasH = anchor.left || anchor.right;
  const isAuto = !hasV && !hasH;

  const el = getPreviewEl();

  el.style.setProperty('--tip-bg-alpha', opacity.toFixed(2));
  el.style.opacity = isAuto ? '0' : '1';
  if (isAuto) return;

  el.style.top = el.style.bottom = el.style.left = el.style.right = 'auto';

  const tx = [], ty = [];
  if (anchor.top && anchor.bottom) { el.style.top = '50%';         ty.push('translateY(-50%)'); }
  else if (anchor.top)             { el.style.top = MARGIN + 'px'; }
  else if (anchor.bottom)          { el.style.bottom = MARGIN + 'px'; }
  else                             { el.style.top = '50%';         ty.push('translateY(-50%)'); }

  if (anchor.left && anchor.right) { el.style.left = '50%';         tx.push('translateX(-50%)'); }
  else if (anchor.left)            { el.style.left = MARGIN + 'px'; }
  else if (anchor.right)           { el.style.right = MARGIN + 'px'; }
  else                             { el.style.left = '50%';         tx.push('translateX(-50%)'); }

  el.style.transform = [...tx, ...ty].join(' ');

  el.classList.remove('ppv-flash');
  void el.offsetWidth;
  el.classList.add('ppv-flash');

  clearTimeout(_previewHideTimer);
  _previewHideTimer = setTimeout(() => { el.style.opacity = '0'; }, durationMs);
}

// ── Opacity slider ────────────────────────────────────────────────────────────

let _opacityHideTimer = null;

$('opt-tip-opacity').addEventListener('input', () => {
  const val = $('opt-tip-opacity').value;
  $('opt-tip-opacity-val').textContent = val + '%';

  showPreviewTooltip(99999);
  clearTimeout(_opacityHideTimer);
  _opacityHideTimer = setTimeout(() => {
    const el = document.getElementById('epf-pos-preview');
    if (el) el.style.opacity = '0';
  }, 1200);
});

// ── Font size slider ──────────────────────────────────────────────────────────

let _fontSizeHideTimer = null;
$('opt-tip-fontsize').addEventListener('input', () => {
  const val = $('opt-tip-fontsize').value;
  $('opt-tip-fontsize-val').textContent = val + 'px';
  showPreviewTooltip(99999);
  clearTimeout(_fontSizeHideTimer);
  _fontSizeHideTimer = setTimeout(() => {
    const el = document.getElementById('epf-pos-preview');
    if (el) el.style.opacity = '0';
  }, 1200);
});

// ── Version + release date ────────────────────────────────────────────────────

const RELEASE_DATE  = '22 April 2026';
const AUTHOR_NAME   = 'Jeff Lam';
const AUTHOR_EMAIL  = 'wklam128@gmail.com';

(function injectVersion() {
  const { version } = chrome.runtime.getManifest();
  const vBlock = $('header-version-block');
  if (vBlock) {
    vBlock.innerHTML =
      `<div style="font:700 13px var(--font)">v${version}</div>` +
      `<div style="font:11px var(--font);opacity:0.7">${RELEASE_DATE}</div>` +
      `<div style="font:11px var(--font);opacity:0.7">${AUTHOR_NAME}</div>`;
  }
  const wv = $('welcome-version');
  if (wv) wv.textContent = `v${version}`;
  const wr = $('welcome-release');
  if (wr) wr.textContent = `Released ${RELEASE_DATE}`;
  const wa = $('welcome-author');
  if (wa) wa.innerHTML = `By ${AUTHOR_NAME} · <a href="mailto:${AUTHOR_EMAIL}" style="color:#16a34a">${AUTHOR_EMAIL}</a>`;
})();

// ── Welcome banner (first install) ───────────────────────────────────────────

chrome.storage.local.get('epf_welcomed', (data) => {
  if (!data.epf_welcomed) {
    const banner = $('welcome-banner');
    if (banner) banner.style.display = 'flex';
  }
});

$('btn-welcome-close').addEventListener('click', () => {
  $('welcome-banner').style.display = 'none';
  chrome.storage.local.set({ epf_welcomed: true });
});

// ── Language card drag-to-reorder ─────────────────────────────────────────────

const DEFAULT_LANG_ORDER = ['en', 'id', 'vi', 'zh', 'ko', 'ja'];

function updateLangSeq() {
  const cards = [...document.querySelectorAll('#lang-cards .lang-card')];
  let seq = 1;
  cards.forEach(card => {
    const seqEl = card.querySelector('.lang-seq');
    const checked = card.querySelector('input[type="checkbox"]').checked;
    if (seqEl) seqEl.textContent = checked ? seq++ : '';
  });
}

function getLangOrder() {
  const grid = document.querySelector('.lang-cards');
  return [...grid.querySelectorAll('.lang-card')].map(c => c.dataset.lang);
}

function applyLangOrder(order) {
  const grid  = document.querySelector('.lang-cards');
  const cards = Object.fromEntries(
    [...grid.querySelectorAll('.lang-card')].map(c => [c.dataset.lang, c])
  );
  order.forEach(code => { if (cards[code]) grid.appendChild(cards[code]); });
}

function initLangDrag() {
  const grid = document.querySelector('.lang-cards');
  if (grid.dataset.dragReady) return;
  grid.dataset.dragReady = '1';

  // Update seq numbers and flash preview whenever a language checkbox is toggled.
  grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      updateLangSeq();
      showPreviewTooltip(1600);
    });
  });

  let dragSrc = null;

  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.lang-card');
    if (!card) return;
    dragSrc = card;
    card.classList.add('lang-card--dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  grid.addEventListener('dragend', e => {
    const card = e.target.closest('.lang-card');
    if (card) card.classList.remove('lang-card--dragging');
    grid.querySelectorAll('.lang-card--over').forEach(c => c.classList.remove('lang-card--over'));
    dragSrc = null;
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.lang-card');
    if (!card || card === dragSrc) return;
    grid.querySelectorAll('.lang-card--over').forEach(c => c.classList.remove('lang-card--over'));
    card.classList.add('lang-card--over');
  });

  grid.addEventListener('dragleave', e => {
    const card = e.target.closest('.lang-card');
    if (card) card.classList.remove('lang-card--over');
  });

  grid.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.lang-card');
    if (!target || !dragSrc || target === dragSrc) return;
    target.classList.remove('lang-card--over');
    const rect = target.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    grid.insertBefore(dragSrc, after ? target.nextSibling : target);
    updateLangSeq();
    showPreviewTooltip(1600);
    saveConfig(null);
  });
}

load();
