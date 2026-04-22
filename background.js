/**
 * background.js  –  MV3 Service Worker
 *
 * Handles:
 *   - Config storage read / write
 *   - Context menu: "Copy Table to Clipboard" (right-click any table on any page)
 *   - Dynamic icon: grey when addon is inactive on the current tab
 */

'use strict';

// ── Icon management ───────────────────────────────────────────────────────────

const ICON_SIZES = [16, 32, 48, 128];

// Cache greyscale ImageData per size so we only compute once.
const _greyCache  = {};
const _colorCache = {};

async function loadImageData(url, size) {
  const resp   = await fetch(url);
  const blob   = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

async function getIconImageData(grey) {
  const cache = grey ? _greyCache : _colorCache;
  const result = {};
  for (const size of ICON_SIZES) {
    if (!cache[size]) {
      const url  = chrome.runtime.getURL(`icons/icon${size}.png`);
      const data = await loadImageData(url, size);
      if (grey) {
        // Desaturate: replace R,G,B with luminance, keep alpha.
        for (let i = 0; i < data.data.length; i += 4) {
          const lum = Math.round(data.data[i] * 0.299 + data.data[i+1] * 0.587 + data.data[i+2] * 0.114);
          data.data[i] = data.data[i+1] = data.data[i+2] = lum;
          data.data[i+3] = Math.round(data.data[i+3] * 0.55); // slightly faded
        }
      }
      cache[size] = data;
    }
    result[size] = cache[size];
  }
  return result;
}

async function updateIcon(tabId, active) {
  try {
    const imageData = await getIconImageData(!active);
    chrome.action.setIcon({ tabId, imageData });
  } catch {
    // OffscreenCanvas unavailable (e.g. first install before SW fully initialised) — skip silently.
  }
}

function urlMatches(patterns, url) {
  return (patterns || []).some(p => {
    if (p === '*' || p === '<all_urls>') return true;
    try {
      return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url);
    } catch { return false; }
  });
}

async function refreshIconForTab(tab) {
  if (!tab?.id || tab.id < 0) return;
  const url = tab.url || '';
  // Non-web pages always get grey (extension can't run there).
  if (!url.startsWith('http:') && !url.startsWith('https:')) {
    await updateIcon(tab.id, false);
    return;
  }
  const data     = await new Promise(r => chrome.storage.local.get('epf_config', r));
  const patterns = data.epf_config?.urlPatterns || ['*'];
  await updateIcon(tab.id, urlMatches(patterns, url));
}

// Update icon when user switches tabs.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, tab => refreshIconForTab(tab));
});

// Update icon when the tab navigates to a new URL.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') refreshIconForTab(tab);
});

// Update icon across all tabs when config (URL patterns) changes.
function refreshAllIcons() {
  chrome.tabs.query({}, tabs => tabs.forEach(tab => refreshIconForTab(tab)));
}

// ── Install ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ epf_config: getDefaultConfig() });
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       'epf_copy_table',
      title:    'Copy Table to Clipboard (\u2192 Excel)',
      contexts: ['all'],
    });
  });
});

// ── Context menu click ────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'epf_copy_table') return;
  if (!tab?.id) return;

  // Tell the content script to copy the table that was right-clicked.
  chrome.tabs.sendMessage(tab.id, { type: 'EPF_COPY_TABLE' });
});

// ── Message routing ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case 'GET_CONFIG':
      chrome.storage.local.get('epf_config', (data) => {
        sendResponse({ config: data.epf_config || getDefaultConfig() });
      });
      return true;

    case 'SAVE_CONFIG':
      chrome.storage.local.set({ epf_config: message.config }, () => {
        // Forward to all tabs so content scripts update immediately.
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'SAVE_CONFIG', config: message.config }, () => {
              void chrome.runtime.lastError;
            });
          });
        });
        refreshAllIcons();
        sendResponse({ ok: true });
      });
      return true;

    case 'CLEAR_XLAT_CACHE':
      chrome.storage.local.remove('epf_xlat_cache', () => {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_XLAT_CACHE' }, () => {
              void chrome.runtime.lastError; // suppress "no listener" errors
            });
          });
        });
        sendResponse({ ok: true });
      });
      return true;
  }
});

// ── Default config ────────────────────────────────────────────────────────────

function getDefaultConfig() {
  return {
    urlPatterns:        ['*'],
    showToast:          true,
    highlightFields:    true,
    skipEmptyCells:     false,
    copyEnabled:        true,
    copyWithFormatting: false,
    copyFmtStyles: { bg: true, color: true, font: true, align: true, size: false, border: false },
    translateEnabled:   false,
    translateLangs:      { en: false, id: true, vi: true, zh: false, ko: false, ja: false },
    translateLangsOrder: ['en', 'id', 'vi', 'zh', 'ko', 'ja'],
    translateAnchor:    { top: false, bottom: true, left: false, right: true },
    translateOpacity:   100,
    translateFontSize:  13,
  };
}
