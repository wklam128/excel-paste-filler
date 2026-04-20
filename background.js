/**
 * background.js  –  MV3 Service Worker
 *
 * Handles:
 *   - Config storage read / write
 *   - Context menu: "Copy Table to Clipboard" (right-click any table on any page)
 */

'use strict';

// ── Install ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ epf_config: getDefaultConfig() });
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
    urlPatterns:     ['*'],
    showToast:       true,
    highlightFields: true,
    skipEmptyCells:  false,
  };
}
