# Excel Paste Filler

A Chrome extension that lets you copy cells from Excel and paste them into any web form — adjacent fields auto-fill in sequence. Also includes a **Select-to-Translate** tooltip for instant multilingual translation.

---

## Features

### Paste Fill
- Copy cells from Excel → click the first form field → press `Ctrl+V`
- Adjacent fields fill automatically in order (table mode & form scan mode)
- Green highlight flash on each filled field
- Confirmation toast after paste
- Skip empty cells option
- Same field type only option
- URL pattern filter to restrict which pages the extension activates on

### Select-to-Translate Tooltip
- Highlight any text on a web page to instantly see translations in a floating tooltip
- **Auto-detects** source language: English, Chinese (Simplified), Vietnamese, Indonesian
- **4 target languages:** English (EN), Bahasa Indonesia (ID), Tiếng Việt (VI), 中文 (ZH)
- Each language toggled individually in Settings
- ⚡ Cache indicator per language row — instant re-display for repeated selections
- ↺ Retry button per language row when a translation fails
- Powered by **Google Translate** — no API key, no daily quota

### Tooltip Position & Opacity
- Pin tooltip to any screen edge: Top / Bottom / Left / Right
- Opposite edges cancel out to center
- Auto mode follows the text selection with a directional arrow
- Opacity slider (20%–100%) with live preview in Settings

### Paste History
- Popup panel shows your last 10 paste operations
- Shows: site, fields filled, mode, time elapsed

---

## Installation

### From Chrome Web Store
Search for **Excel Paste Filler** on the Chrome Web Store and click **Add to Chrome**.

### Manual (Developer Mode)
1. Download or clone this repository
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `EFS_ADDON` folder
6. The extension icon appears in your toolbar

---

## How to Use

**Paste Fill:**
1. Select cells in Excel → `Ctrl+C`
2. Click the **first field** you want to fill on the web page
3. Press `Ctrl+V` — fields fill automatically

**Select to Translate:**
1. Highlight any text on any web page
2. Translation tooltip appears instantly
3. Press `Escape` or click outside to dismiss

---

## Settings

Click the extension icon → **Settings & Options** to configure:
- Enable/disable highlight flash and toast notification
- Skip empty cells / same field type only
- Enable/disable translation tooltip
- Choose target languages (EN / ID / VI / ZH)
- Set tooltip anchor position and opacity
- Manage translation cache
- Set URL patterns to restrict active pages

---

## Privacy

- **No data is collected or sent to any external server** by this extension
- Translation requests are sent directly from your browser to Google Translate
- Paste history and translation cache are stored locally in your browser only
- No account or login required

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for full release notes.

| Version | Date       | Highlights                          |
|---------|------------|-------------------------------------|
| 2.1.1   | 2026-04-20 | Select-to-translate tooltip, Google Translate, paste history |
| 2.0.0   | —          | Initial release — Excel paste fill  |

---

## License

MIT License — free to use, modify, and distribute.
