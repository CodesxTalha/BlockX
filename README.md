<div align="center">

<img src="assets/icons/icon.svg" width="76" height="76" alt="BlockX Logo">

# BlockX v2

**A powerful, distraction-free content blocker built for discipline.**

[![Version](https://img.shields.io/badge/version-2.0-1900FF?style=flat-square)](#)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1900FF?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chromium](https://img.shields.io/badge/Chrome%20·%20Brave%20·%20Edge%20·%20Vivaldi-supported-1900FF?style=flat-square)](#quick-install)
[![No dependencies](https://img.shields.io/badge/dependencies-none-1900FF?style=flat-square)](#architecture)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-1900FF?style=flat-square)](LICENSE)

<br><br>

<img src="assets/screenshots/dashboard.png" width="820" alt="BlockX v2 Dashboard">

</div>

---

## What Is New in v2

BlockX v2 is a complete overhaul focused on clarity, flexibility, and robust enforcement:

### 1. Modernized UI & Experience
- Clean, polished interface across the dashboard, extension toolbar popup, and on-page modals.
- Full support for both Light Mode and Dark Mode.
- Minimalist toolbar dropdown for instant site blocking and quick-add actions without unnecessary clutter.

### 2. Dual Bypass Modes
Switch between two distinct verification modes depending on how much friction you need:
- **Warning Message**: A two-step confirmation prompt displaying your custom reflection warning before granting access.
- **Retype Phrase**: Demands typing your custom unlock phrase verbatim before any temporary pass is granted.

### 3. Merged Blacklist & Pages Management
- Combined the old domain blacklist and page rules into a single unified **Blocked Sites** view.
- Easily add entire domains, specific sections with child pages (`/*`), or exact URLs from one simple interface.

### 4. Granular Whitelist Control
- Whitelist a single specific page while automatically keeping the rest of the site blocked.
- For example, allow a specific educational page or profile while restricting the rest of the platform.

<br>

<div align="center">
<img src="assets/screenshots/whitelist.png" width="820" alt="BlockX v2 Whitelist Granular Controls">
</div>

<br>

### 5. Scoped Keyword Management
- Clean, dedicated interface for adding custom keywords.
- Choose the exact scope for each keyword: check both URL and page content, or check page content only.

### 6. Robust Content Scanning Core
- Redesigned scanning engine that reads unlisted pages in real time with high accuracy and reduced false positives.
- Immediate capture-phase interception on search inputs and form submissions.
- Option to toggle content scanning on or off directly from the header.

<br>

<div align="center">
<img src="assets/screenshots/warning.png" width="700" alt="BlockX v2 On-Page Warning Modal">
</div>

<br>

### 7. Unified Help & Setup
- Merged setup documentation and browser lockdown controls into one cohesive view.
- Generate one-line Chromium policies for Incognito disabling, guest mode restriction, and extension page protection.

### 8. Dedicated Settings & Theme Engine
- Select scientifically grounded theme palettes: **Electric Blue**, **Boreal Pine**, **Nordic Slate**, and **Monochrome Slate**.
- Zero-overhead dynamic tab favicons and extension icons that react to your chosen theme.
- Built-in configuration backup, JSON export/import, and dashboard password protection.

<br>

<div align="center">
<img src="assets/screenshots/themes.png" width="820" alt="BlockX v2 Settings and Theme Color Palettes">
</div>

---

## Quick Install

1. Download or clone this repository.
2. Open `chrome://extensions` in any Chromium browser (Chrome, Brave, Edge).
3. Enable **Developer mode** using the toggle in the top right.
4. Click **Load unpacked** and select the BlockX directory.

The dashboard opens automatically upon installation.

---

## Architecture

BlockX runs directly in the browser with **zero external dependencies and no build step**:

```
src/
  background.js       Background service worker: network rules, blocking decisions, state
  content.js          Anti-flash barrier, real-time input scanner, on-page warning modal
  inject.js           SPA navigation hook for dynamic single-page applications
  config.js           Shared filter lists, search engine definitions, and defaults
  icon-helper.js      Dynamic SVG icon generator and zero-overhead favicon switcher
  settings-sync.js    Reconciliation engine for local storage, Google sync, and local file
  options/            Full management dashboard (General, Blocked Sites, Whitelist, Keywords, Scanning, Settings)
  popup/              Clean toolbar dropdown with quick block and add actions
  help/               Setup guide and Chromium browser lockdown generator
native/
  blockx_host.py      Native host for shared settings across profiles
  install.py          One-click installer for native messaging
```

---

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (see [LICENSE](LICENSE)). Free for personal, noncommercial use.
