'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULT = {
  urlPatterns:      ['*'],
  showToast:        true,
  highlightFields:  true,
  skipEmptyCells:   false,
  sameTypeOnly:     false,
  translateEnabled: true,
  translateLangs:   { en: false, id: true, vi: true, zh: false },
  translateAnchor:  { top: false, bottom: false, left: false, right: false },
  translateOpacity: 100,
};

// ── Load ──────────────────────────────────────────────────────────────────────

async function load() {
  const data = await storageGet(['epf_config', 'epf_xlat_cache']);
  const cfg  = data.epf_config || DEFAULT;

  $('opt-highlight').checked  = cfg.highlightFields  ?? true;
  $('opt-toast').checked      = cfg.showToast        ?? true;
  $('opt-skip-empty').checked = cfg.skipEmptyCells   ?? false;
  $('opt-same-type').checked  = cfg.sameTypeOnly     ?? false;
  $('opt-translate').checked  = cfg.translateEnabled ?? true;

  const anchor = cfg.translateAnchor ?? DEFAULT.translateAnchor;
  $('opt-pos-top').checked    = anchor.top    ?? false;
  $('opt-pos-bottom').checked = anchor.bottom ?? false;
  $('opt-pos-left').checked   = anchor.left   ?? false;
  $('opt-pos-right').checked  = anchor.right  ?? false;
  updateAnchorPreview();

  const opacity = cfg.translateOpacity ?? 100;
  $('opt-tip-opacity').value           = opacity;
  $('opt-tip-opacity-val').textContent = opacity + '%';

  const langs = cfg.translateLangs ?? DEFAULT.translateLangs;
  $('opt-tlang-en').checked = langs.en ?? false;
  $('opt-tlang-id').checked = langs.id ?? true;
  $('opt-tlang-vi').checked = langs.vi ?? true;
  $('opt-tlang-zh').checked = langs.zh ?? false;

  $('opt-urls').value = (cfg.urlPatterns || ['*']).join('\n');

  updateCacheInfo(data.epf_xlat_cache);
  applyTranslateEnabled();
}

function updateCacheInfo(cacheObj) {
  const count = cacheObj ? Object.keys(cacheObj).length : 0;
  $('cache-info').textContent = count
    ? `${count} entr${count !== 1 ? 'ies' : 'y'} stored`
    : 'Cache is empty';
}

// ── Save ──────────────────────────────────────────────────────────────────────

$('btn-save').addEventListener('click', async () => {
  const patterns = $('opt-urls').value
    .split('\n').map(p => p.trim()).filter(Boolean);

  const cfg = {
    urlPatterns:      patterns.length ? patterns : ['*'],
    showToast:        $('opt-toast').checked,
    highlightFields:  $('opt-highlight').checked,
    skipEmptyCells:   $('opt-skip-empty').checked,
    sameTypeOnly:     $('opt-same-type').checked,
    translateEnabled: $('opt-translate').checked,
    translateAnchor: {
      top:    $('opt-pos-top').checked,
      bottom: $('opt-pos-bottom').checked,
      left:   $('opt-pos-left').checked,
      right:  $('opt-pos-right').checked,
    },
    translateOpacity: parseInt($('opt-tip-opacity').value, 10),
    translateLangs: {
      en: $('opt-tlang-en').checked,
      id: $('opt-tlang-id').checked,
      vi: $('opt-tlang-vi').checked,
      zh: $('opt-tlang-zh').checked,
    },
  };

  await storageSet({ epf_config: cfg });
  chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config: cfg });

  const msg = $('save-msg');
  msg.textContent = 'Saved!';
  msg.className   = 'save-msg ok';
  setTimeout(() => { msg.textContent = ''; }, 2500);
});

// ── Clear cache ───────────────────────────────────────────────────────────────

$('btn-clear-cache').addEventListener('click', async () => {
  await new Promise(r => chrome.runtime.sendMessage({ type: 'CLEAR_XLAT_CACHE' }, r));
  updateCacheInfo(null);

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

// ── Greyout: disable sub-options when translation is off ─────────────────────

function applyTranslateEnabled() {
  const enabled = $('opt-translate').checked;
  const sub     = $('translate-subopts');
  sub.classList.toggle('dimmed', !enabled);
  // Prevent interaction on all inputs/buttons/selects inside when dimmed.
  sub.querySelectorAll('input, button, select').forEach(el => {
    el.disabled = !enabled;
  });
}

$('opt-translate').addEventListener('change', () => {
  applyTranslateEnabled();
});

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
//
// Appears in the options window at the configured position so the user can see
// exactly where the tooltip will show up on real pages.

let _previewHideTimer = null;

const PREVIEW_SAMPLES = {
  en: { label: 'EN', text: 'This is a position preview' },
  id: { label: 'ID', text: 'Ini adalah pratinjau posisi' },
  vi: { label: 'VI', text: '\u0110\u00e2y l\u00e0 b\u1ea3n xem tr\u01b0\u1edbc v\u1ecb tr\u00ed' },
  zh: { label: 'ZH', text: '\u8fd9\u662f\u4f4d\u7f6e\u9884\u89c8' },
};

function getPreviewEl() {
  let el = document.getElementById('epf-pos-preview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'epf-pos-preview';
    document.body.appendChild(el);
  }

  // Rebuild body based on currently enabled languages.
  const enabledRows = ['en', 'id', 'vi', 'zh']
    .filter(l => $('opt-tlang-' + l)?.checked)
    .map(l => {
      const s = PREVIEW_SAMPLES[l];
      return `<div class="ppv-row"><span class="ppv-lang">${s.label}</span><span>${s.text}</span></div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="ppv-header">
      <span class="ppv-title">Translation Tooltip</span>
      <span class="ppv-badge">EN</span>
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

  // Apply opacity.
  el.style.opacity = isAuto ? '0' : opacity.toFixed(2);
  if (isAuto) return;

  // Reset all position props first.
  el.style.top = el.style.bottom = el.style.left = el.style.right = 'auto';

  // Vertical.
  const tx = [], ty = [];
  if (anchor.top && anchor.bottom) { el.style.top = '50%';         ty.push('translateY(-50%)'); }
  else if (anchor.top)             { el.style.top = MARGIN + 'px'; }
  else if (anchor.bottom)          { el.style.bottom = MARGIN + 'px'; }
  else                             { el.style.top = '50%';         ty.push('translateY(-50%)'); }

  // Horizontal.
  if (anchor.left && anchor.right) { el.style.left = '50%';         tx.push('translateX(-50%)'); }
  else if (anchor.left)            { el.style.left = MARGIN + 'px'; }
  else if (anchor.right)           { el.style.right = MARGIN + 'px'; }
  else                             { el.style.left = '50%';         tx.push('translateX(-50%)'); }

  el.style.transform = [...tx, ...ty].join(' ');

  // Trigger flash animation by removing then re-adding class.
  el.classList.remove('ppv-flash');
  void el.offsetWidth; // reflow
  el.classList.add('ppv-flash');

  // Auto-hide.
  clearTimeout(_previewHideTimer);
  _previewHideTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, durationMs);
}

// ── Opacity slider ────────────────────────────────────────────────────────────

let _opacityHideTimer = null;

$('opt-tip-opacity').addEventListener('input', () => {
  const val = $('opt-tip-opacity').value;
  $('opt-tip-opacity-val').textContent = val + '%';

  // Keep preview alive while sliding; hide 1.2s after last movement.
  showPreviewTooltip(99999);
  clearTimeout(_opacityHideTimer);
  _opacityHideTimer = setTimeout(() => {
    const el = document.getElementById('epf-pos-preview');
    if (el) el.style.opacity = '0';
  }, 1200);
});

load();
