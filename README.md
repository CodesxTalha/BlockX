<div align="center">

<img src="assets/icons/icon.svg" width="72" height="72" alt="BlockX Logo">

# BlockX

**A content blocker built for the moment you want to turn it off.**

Anything can block a website. What makes BlockX different is that the ways out are slow, deliberate, and follow you across every profile on your machine.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-1900FF?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chromium](https://img.shields.io/badge/Chrome%20·%20Brave%20·%20Edge%20·%20Vivaldi-supported-1900FF?style=flat-square)](#quick-install)
[![No dependencies](https://img.shields.io/badge/dependencies-none-1900FF?style=flat-square)](#architecture)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-1900FF?style=flat-square)](LICENSE)

<br><br>

<img src="assets/screenshots/dashboard.png" width="820" alt="BlockX Dashboard in Light Mode">

</div>

---

## Why BlockX

Most blockers fail because disabling them takes one click at the exact moment you have the least willpower. BlockX is built around deliberate psychological friction:

| The Escape Route | What BlockX Does Instead |
|---|---|
| Delete a site from the blocklist | Triggers an unskippable **12-minute cooldown timer** |
| Search for explicit keywords | Intercepts the search query before results load |
| Visit an unlisted explicit page | Scans page text instantly and locks it behind a heavy blur |
| Attempt to bypass a blocked page | Requires typing an exact reflection phrase word-for-word |
| Open a fresh profile or Incognito | Generates native browser policies that refuse access |
| Inspect element or edit in DevTools | All blocking authority runs in the service worker, not the DOM |

---

## Key Features

- **Multi-Layer Enforcement**: Network-level Declarative Net Request rules, navigation checks, SPA route hooks, and in-page scanning.
- **Real-Time Page Scanner**: Reads unlisted pages before you see them. Word-boundary filtering prevents false alarms so words like `button`, `cocktail`, or `analysis` never trip the scanner.
- **On-Page Content Warning**: Blocks explicit pages with a frosted background blur and presents your custom reflection prompt.
- **Single-Visit Passes**: Type your chosen unlock phrase to earn a single visit in one tab. Refreshing or reopening re-locks the page.
- **Calming Color Themes**: Scientifically selected color palettes (Electric Blue, Boreal Pine, Nordic Slate, Monochrome Slate) with dynamic theme-matched favicons and icons.
- **Cross-Profile Sync**: Rules synchronize automatically across Google accounts and all local browser profiles on the machine.

<br>

<div align="center">
<img src="assets/screenshots/warning.png" width="700" alt="BlockX on-page warning modal in Light Mode">
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

BlockX runs directly in the browser with **zero dependencies and no build step**:

```
src/
  background.js       Core service worker: network rules, block decisions, cooldown timers
  content.js          Anti-flash barrier, real-time input scanner, on-page warning modal
  inject.js           SPA navigation hook for dynamic single-page applications
  config.js           Shared filter lists, search engine definitions, and defaults
  icon-helper.js      Dynamic SVG icon generator and zero-overhead favicon updater
  settings-sync.js    Reconciles local storage, Google sync, and local settings file
  options/            Management dashboard and theme controls
  popup/              Clean toolbar dropdown with quick block and add actions
  help/               Setup guide and Chromium browser lockdown generator
native/
  blockx_host.py      Native host for shared settings across profiles
  install.py          One-click installer for native messaging
```

---

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (see [LICENSE](LICENSE)). Free for personal, noncommercial use.
