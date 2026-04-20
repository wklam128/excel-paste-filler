# Changelog

## [2.1.1] — 2026-04-20

### Added

#### Select-to-Translate Tooltip
- Highlight any text on a web page to instantly see translations in a floating tooltip
- Auto-detects source language: **English**, **Chinese (Simplified)**, **Vietnamese**, **Indonesian**
- Detected source language shown in the tooltip header badge
- Tooltip follows the text selection or can be pinned to a fixed screen position

#### Four Target Languages
- **EN** — English
- **ID** — Bahasa Indonesia
- **VI** — Tiếng Việt
- **ZH** — 中文 · Chinese Simplified
- Each language toggled independently in Settings; source language is automatically excluded from targets

#### Per-Language Status in Tooltip
- ⚡ icon on each row when the translation came from local cache (instant)
- ↺ retry button on each row when that specific language failed — retries independently without affecting others
- Spinner shown per row while fetching

#### Tooltip Position Controls
- 4-direction anchor grid (TOP / BOTTOM / LEFT / RIGHT) — opposite edges cancel to center
- Live animated dot preview in Settings updates as you click
- Flash preview of the tooltip at the configured position when changing anchor or opacity
- **Auto mode** (no edges selected): tooltip follows the text selection with a directional arrow

#### Tooltip Opacity
- Slider from 20% to 100% with live preview while dragging

#### Translation Cache
- Translations stored locally in `chrome.storage.local` (max 300 entries, auto-pruned)
- In-memory L1 cache for instant repeat translations within the same page
- Cache entry count displayed in Settings with a Clear Cache button

#### Paste History Log
- Popup panel shows last 10 paste operations
- Each entry shows: site hostname, fields filled, mode (table / form), time elapsed
- Clear button to wipe history

#### Translation Provider Badge
- Popup panel shows the active translation provider (Google Translate)

### Changed
- **Translation backend switched to Google Translate** — no API key, no daily quota, suitable for global public Chrome Web Store distribution
- Translation sub-options in Settings grey out automatically when the translation toggle is off

### Fixed
- One language failing no longer cancels translations for the remaining languages (`Promise.allSettled`)
- Long text selections no longer fail — smart truncation at word/sentence boundary with ellipsis
- Source language correctly excluded from translation targets at all times
- Tooltip dismissed correctly on outside click or `Escape` key

---

## [2.0.0] — Initial release

- Copy cells from Excel → paste into any form field with `Ctrl+V`
- Adjacent fields auto-fill in sequence (table mode and form scan mode)
- Highlight filled fields with green outline flash
- Confirmation toast after paste
- Skip empty cells option
- Same field type only option
- URL pattern filter to restrict which pages the extension activates on
