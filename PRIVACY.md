# Privacy Policy — Excel Paste Filler

**Last updated: April 20, 2026**

---

## Overview

Excel Paste Filler is a Chrome browser extension that helps users paste Excel cell data into web form fields and provides an instant translation tooltip for selected text. This Privacy Policy explains what data the extension accesses, how it is used, and what is never collected.

---

## Data We Do NOT Collect

- We do **not** collect any personal information
- We do **not** track browsing history or visited URLs
- We do **not** transmit any data to our own servers
- We do **not** use analytics, advertising, or tracking technologies
- We do **not** sell, share, or transfer any user data to third parties

---

## Data Stored Locally on Your Device

All data is stored exclusively on your device using Chrome's built-in `chrome.storage.local` API. Nothing is sent to the developer.

| Data | Purpose | Location |
|------|---------|----------|
| Extension settings | Save your preferences (highlight toggle, language choices, tooltip position, opacity) | Your browser only |
| Translation cache | Store past translations for instant re-display (max 300 entries, auto-pruned) | Your browser only |
| Paste history | Remember your last 50 paste operations for display in the popup panel | Your browser only |

You can clear the translation cache and paste history at any time from the extension's Settings page.

---

## Google Translate API

When you highlight text on a web page and the translation feature is enabled, the selected text is sent **directly from your browser** to the Google Translate API (`translate.googleapis.com`) to retrieve a translation.

- This request is made by your browser directly to Google — it does **not** pass through any server owned or operated by the developer
- No other data (your identity, the page URL, your browsing history) is included in the request
- Google's own privacy policy applies to this API call: [https://policies.google.com/privacy](https://policies.google.com/privacy)
- You can disable the translation feature entirely in the extension Settings page

---

## Permissions Explained

| Permission | Why it is needed |
|-----------|-----------------|
| `storage` | Save settings, translation cache, and paste history locally on your device |
| `contextMenus` | Add a right-click option to copy HTML tables in Excel-compatible format |
| `clipboardWrite` | Write the copied table data to your clipboard for pasting into Excel |
| `tabs` | Broadcast a cache-clear signal to all open tabs when you click "Clear Cache" in Settings — no tab content or URLs are read |
| `translate.googleapis.com` | Send selected text to Google Translate when you use the translation feature |

---

## Children's Privacy

This extension does not knowingly collect any data from anyone, including children under the age of 13.

---

## Changes to This Policy

If this policy is updated, the "Last updated" date at the top of this page will be revised. Continued use of the extension after changes constitutes acceptance of the updated policy.

---

## Contact

If you have any questions about this privacy policy, please open an issue on the GitHub repository:

[https://github.com/wklam128/excel-paste-filler/issues](https://github.com/wklam128/excel-paste-filler/issues)
