// content.js
(async function () {
  // ------------------------------------------------------------------
  // 1. INSTANT SYNCHRONOUS BARRIER (THE FLASH FIX)
  // Hide the page immediately BEFORE any network requests or DOM parsing
  // ------------------------------------------------------------------
  // Loading state: nothing is painted at all.
  const BARRIER_OPAQUE = 'html { visibility: hidden !important; opacity: 0 !important; background: #ffffff !important; }';

  // Prompt state: an 80px blur and freeze on body so it stays completely
  // unreadable even if overlay elements are tampered with. The warning host
  // sits on <html>, outside body, which keeps it sharp while the page behind it is not.
  const BARRIER_FROZEN = `
    html { overflow: hidden !important; }
    body {
      filter: blur(80px) saturate(0.2) !important;
      -webkit-filter: blur(80px) saturate(0.2) !important;
      overflow: hidden !important;
      pointer-events: none !important;
      user-select: none !important;
    }
  `;

  const securityBarrier = document.createElement('style');
  securityBarrier.id = 'blockx-security-barrier';
  securityBarrier.textContent = BARRIER_OPAQUE;
  if (document.documentElement) {
    document.documentElement.appendChild(securityBarrier);
  }

  let isTopFrame = true;
  try {
    isTopFrame = window.top === window.self;
  } catch {
    isTopFrame = false;
  }

  // ------------------------------------------------------------------
  // QUICK ACCESS SHORTCUT TO SETTINGS (Alt+S)
  // ------------------------------------------------------------------
  let shortcutEnabled = true;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ DASHBOARD_SHORTCUT_ENABLED: true }, (res) => {
      if (res && typeof res.DASHBOARD_SHORTCUT_ENABLED !== 'undefined') {
        shortcutEnabled = res.DASHBOARD_SHORTCUT_ENABLED;
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.DASHBOARD_SHORTCUT_ENABLED) {
        shortcutEnabled = changes.DASHBOARD_SHORTCUT_ENABLED.newValue !== false;
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!shortcutEnabled) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ action: 'openSettings' });
      } catch (err) {}
    }
  }, true);

  // ------------------------------------------------------------------
  // 2. CORE FLAGGED KEYWORDS & TOP-LEVEL STATE VARIABLES
  // Declared first to completely eliminate any TDZ (Temporal Dead Zone) risks
  // ------------------------------------------------------------------
  const CORE_FLAGGED_WORDS = Object.freeze([
    'porn', 'porno', 'pornography', 'pornhub',
    'sex', 'sexy', 'sexual', 'sexo', 'sexcam', 'sexdoll',
    'nude', 'nudes', 'nudity', 'naked', 'barenaked',
    'nsfw', 'xxx', 'xnxx', 'hentai', 'milf', 'lewd', 'erotic', 'erotica',
    'boobs', 'boob', 'tits', 'titties', 'titty', 'breasts',
    'cock', 'cocks', 'dick', 'pussy', 'vagina', 'penis', 'clit', 'clitoris',
    'ass', 'assmunch', 'butt', 'butthole', 'buttcheeks',
    'blowjob', 'handjob', 'footjob', 'cum', 'cumming', 'cumshot',
    'fuck', 'fucking', 'fuckin', 'masturbat', 'masturbation',
    'dildo', 'vibrator', 'bondage', 'bdsm', 'fetish',
    'orgasm', 'topless', 'upskirt', 'thong', 'lingerie'
  ]);

  let badwordsSet = new Set(CORE_FLAGGED_WORDS);
  let testRegex = createBoundedFilter(CORE_FLAGGED_WORDS);
  let filterRegex = null;
  let scanRegex = createBoundedFilter(CORE_FLAGGED_WORDS);
  let pageRegex = null;
  let cachedBadwords = null;

  function buildFilters(badwords = []) {
    const customKws = (CONFIG && CONFIG.KEYWORDS) ? CONFIG.KEYWORDS : [];
    const pageKws = (CONFIG && CONFIG.PAGE_KEYWORDS) ? CONFIG.PAGE_KEYWORDS : [];
    const allKeywords = customKws.concat(badwords || []).concat(CORE_FLAGGED_WORDS);

    filterRegex = createOptimizedFilter(allKeywords);
    scanRegex = createBoundedFilter(allKeywords);
    pageRegex = createBoundedFilter(pageKws);

    badwordsSet = new Set(allKeywords.map(k => String(k || '').trim().toLowerCase()).filter(k => k.length > 0));
    const validForTest = [...badwordsSet].sort((a, b) => b.length - a.length);
    testRegex = createBoundedFilter(validForTest);
  }

  async function prepareFilter() {
    if (cachedBadwords && cachedBadwords.length > 0) {
      buildFilters(cachedBadwords);
      return;
    }
    try {
      const r = await fetch(chrome.runtime.getURL('assets/data/badwords.json'));
      cachedBadwords = await r.json();
    } catch (e) {
      cachedBadwords = [];
    }
    buildFilters(cachedBadwords);
  }

  let tabUnlocked = false;
  let isBlocked = false;
  let scanPrompted = false;
  let scanAcknowledged = false;
  const acknowledgedKeywords = new Set();
  const pendingPromptKeywords = new Set();
  let scanThrottleId = null;
  let scanDeadline = 0;
  let scanUrl = window.location.href;
  let observer = null;
  let realtimeInputInterval = null;
  const mutedMedia = [];

  function raiseBarrier(css) {
    securityBarrier.textContent = css;
    if (document.documentElement && !document.documentElement.contains(securityBarrier)) {
      document.documentElement.appendChild(securityBarrier);
    }
  }

  function dropBarrier() {
    if (scanPrompted || isBlocked) return;
    try {
      if (securityBarrier) {
        securityBarrier.textContent = '';
        if (securityBarrier.parentNode) {
          securityBarrier.parentNode.removeChild(securityBarrier);
        }
      }
    } catch { }
    try {
      const extra = document.getElementById('blockx-security-barrier');
      if (extra) {
        extra.textContent = '';
        if (extra.parentNode) {
          extra.parentNode.removeChild(extra);
        }
      }
    } catch { }
    try {
      if (document.body) {
        document.body.style.removeProperty('filter');
        document.body.style.removeProperty('-webkit-filter');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('pointer-events');
        document.body.style.removeProperty('user-select');
      }
      if (document.documentElement) {
        document.documentElement.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('visibility');
        document.documentElement.style.removeProperty('opacity');
      }
    } catch { }
  }

  function isScanExcluded(customUrl) {
    if (!CONFIG || !Array.isArray(CONFIG.SCAN_EXCLUDED) || CONFIG.SCAN_EXCLUDED.length === 0) {
      return false;
    }
    try {
      const at = customUrl ? new URL(customUrl, window.location.href) : window.location;
      return matchesAnyScanExclusion(at.hostname, at.port, at.pathname, at.search, CONFIG.SCAN_EXCLUDED);
    } catch {
      const at = window.location;
      return matchesAnyScanExclusion(at.hostname, at.port, at.pathname, at.search, CONFIG.SCAN_EXCLUDED);
    }
  }

  function cancelRescan() {
    if (scanThrottleId) clearTimeout(scanThrottleId);
    scanThrottleId = null;
    scanDeadline = 0;
  }

  // ------------------------------------------------------------------
  // 3. OVERLAY RENDERING & MEDIA MANAGEMENT
  // Styles are encapsulated and loaded from src/prompt.css
  // ------------------------------------------------------------------
  function freezeMedia() {
    for (const el of document.querySelectorAll('video, audio')) {
      mutedMedia.push([el, el.muted]);
      el.muted = true;
      try { el.pause(); } catch { /* ignore */ }
    }
  }

  function thawMedia() {
    for (const [el, wasMuted] of mutedMedia) el.muted = wasMuted;
    mutedMedia.length = 0;
  }

  function resolveTheme() {
    const theme = (CONFIG && CONFIG.THEME) || 'system';
    if (theme === 'light' || theme === 'dark') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }

  function showScanPrompt(triggerKeywords) {
    if (!isTopFrame) return;
    if (isScanExcluded()) return;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;
    scanPrompted = true;

    pendingPromptKeywords.clear();
    if (triggerKeywords) {
      if (typeof triggerKeywords === 'string') {
        const clean = triggerKeywords.toLowerCase().trim();
        if (clean) pendingPromptKeywords.add(clean);
      } else if (triggerKeywords instanceof Set || Array.isArray(triggerKeywords)) {
        for (const k of triggerKeywords) {
          const clean = String(k || '').toLowerCase().trim();
          if (clean) pendingPromptKeywords.add(clean);
        }
      }
    }

    const existingHost = document.getElementById('blockx-scan-prompt');
    if (existingHost) existingHost.remove();

    const host = document.createElement('div');
    host.id = 'blockx-scan-prompt';
    host.setAttribute('data-theme', resolveTheme());
    host.setAttribute('data-color-theme', (CONFIG && CONFIG.COLOR_THEME) || 'blue');
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('visibility', 'visible', 'important');

    const root = host.attachShadow({ mode: 'closed' });

    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('src/prompt.css');

    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';

    const card = document.createElement('div');
    card.className = 'confirm-modal-card';

    const keepKeys = (event) => {
      if (event.composedPath().includes(host)) event.stopPropagation();
    };
    const KEY_EVENTS = ['keydown', 'keypress', 'keyup'];
    KEY_EVENTS.forEach(type => window.addEventListener(type, keepKeys, true));

    const reveal = () => {
      scanAcknowledged = true;
      scanPrompted = false;
      cancelRescan();
      for (const kw of pendingPromptKeywords) {
        acknowledgedKeywords.add(kw);
      }
      const query = extractSearchQuery(window.location.href);
      if (query) {
        for (const word of query.toLowerCase().split(/[^a-z0-9]+/i)) {
          if (word.length >= 2) acknowledgedKeywords.add(word);
        }
      }
      pendingPromptKeywords.clear();
      KEY_EVENTS.forEach(type => window.removeEventListener(type, keepKeys, true));
      if (host.parentNode) host.parentNode.removeChild(host);
      thawMedia();
      dropBarrier();
    };

    const isRetypeMode = CONFIG && CONFIG.BYPASS_MODE === 'retype';

    if (isRetypeMode) {
      const retypeWrap = document.createElement('div');
      retypeWrap.className = 'weakening-retype-wrap';

      const instruction = document.createElement('p');
      instruction.className = 'weakening-retype-instruction';
      instruction.textContent = 'Type the phrase below to confirm:';

      const phraseText = document.createElement('p');
      phraseText.className = 'weakening-retype-phrase';
      const requiredPhrase = ((CONFIG && CONFIG.UNLOCK_PHRASE) || 'I am choosing to break my own rule').trim();
      phraseText.textContent = requiredPhrase;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'weakening-retype-input';
      input.placeholder = 'Type the exact phrase above';
      input.spellcheck = false;
      input.autocomplete = 'off';

      const actions = document.createElement('div');
      actions.className = 'confirm-modal-actions';

      const unlockBtn = document.createElement('button');
      unlockBtn.className = 'btn btn-primary';
      unlockBtn.type = 'button';
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Unlock and show page';

      const leaveBtn = document.createElement('button');
      leaveBtn.className = 'btn btn-secondary';
      leaveBtn.type = 'button';
      leaveBtn.textContent = 'No, close this tab';
      leaveBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'closeTab' });
      });

      const collapse = (text) => (text || '').trim().replace(/\s+/g, ' ').toLowerCase();
      input.addEventListener('input', () => {
        unlockBtn.disabled = collapse(input.value) !== collapse(requiredPhrase);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !unlockBtn.disabled) {
          reveal();
        }
      });
      unlockBtn.addEventListener('click', reveal);

      retypeWrap.appendChild(instruction);
      retypeWrap.appendChild(phraseText);
      retypeWrap.appendChild(input);
      card.appendChild(retypeWrap);

      actions.appendChild(unlockBtn);
      actions.appendChild(leaveBtn);
      card.appendChild(actions);

      overlay.appendChild(card);
      root.appendChild(style);
      root.appendChild(overlay);

      document.documentElement.appendChild(host);
      raiseBarrier(BARRIER_FROZEN);
      freezeMedia();
      setTimeout(() => input.focus(), 50);
    } else {
      // 2-Step Confirmation for Warning Message Mode
      const step1 = document.createElement('div');
      step1.className = 'warning-step-1';

      const message = document.createElement('p');
      message.className = 'confirm-warning-text';
      message.dir = 'auto';
      message.textContent = ((CONFIG && CONFIG.WEAKENING_MESSAGE) || '').trim()
        || 'Remember why you set this protection up.';

      const actions1 = document.createElement('div');
      actions1.className = 'confirm-modal-actions';

      const unlockBtn1 = document.createElement('button');
      unlockBtn1.className = 'btn btn-primary';
      unlockBtn1.type = 'button';
      unlockBtn1.textContent = 'Unlock and show page';

      const leaveBtn1 = document.createElement('button');
      leaveBtn1.className = 'btn btn-secondary';
      leaveBtn1.type = 'button';
      leaveBtn1.textContent = 'No, close this tab';
      leaveBtn1.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'closeTab' });
      });

      actions1.appendChild(unlockBtn1);
      actions1.appendChild(leaveBtn1);
      step1.appendChild(message);
      step1.appendChild(actions1);

      // Step 2: Confirmation
      const step2 = document.createElement('div');
      step2.className = 'warning-step-2';
      step2.style.display = 'none';

      const confirmText = document.createElement('p');
      confirmText.className = 'confirm-warning-text';
      confirmText.dir = 'auto';
      confirmText.textContent = 'Are you sure you want to show this page?';

      const actions2 = document.createElement('div');
      actions2.className = 'confirm-modal-actions';

      const sureBtn = document.createElement('button');
      sureBtn.className = 'btn btn-primary';
      sureBtn.type = 'button';
      sureBtn.textContent = "Yes, I'm sure: show it";

      const backBtn = document.createElement('button');
      backBtn.className = 'btn btn-secondary';
      backBtn.type = 'button';
      backBtn.textContent = 'No, go back';

      unlockBtn1.addEventListener('click', () => {
        step1.style.display = 'none';
        step2.style.display = 'block';
        sureBtn.focus();
      });

      backBtn.addEventListener('click', () => {
        step2.style.display = 'none';
        step1.style.display = 'block';
        leaveBtn1.focus();
      });

      sureBtn.addEventListener('click', reveal);

      actions2.appendChild(sureBtn);
      actions2.appendChild(backBtn);
      step2.appendChild(confirmText);
      step2.appendChild(actions2);

      card.appendChild(step1);
      card.appendChild(step2);

      overlay.appendChild(card);
      root.appendChild(styleLink);
      root.appendChild(overlay);

      document.documentElement.appendChild(host);
      raiseBarrier(BARRIER_FROZEN);
      freezeMedia();
      leaveBtn1.focus();
    }
  }

  function dismissScanPrompt() {
    scanPrompted = false;
    scanAcknowledged = false;
    pendingPromptKeywords.clear();
    cancelRescan();
    const promptHost = document.getElementById('blockx-scan-prompt');
    if (promptHost) promptHost.remove();
    dropBarrier();
    try { thawMedia(); } catch { }
  }

  // ------------------------------------------------------------------
  // 4. REAL-TIME INSTANT KEYSTROKE & INPUT SCANNER (MILLISECOND 0)
  // Runs synchronously before any async storage delays
  // ------------------------------------------------------------------
  function checkTextForFlaggedKeywords(text) {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return null;
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();
    if (clean.length < 1) return null;

    // 1. Direct check for custom keywords with delimiter checking
    const customList = (CONFIG && CONFIG.KEYWORDS ? CONFIG.KEYWORDS : []).concat(CONFIG && CONFIG.PAGE_KEYWORDS ? CONFIG.PAGE_KEYWORDS : []);
    for (const kw of customList) {
      const lower = String(kw || '').toLowerCase().trim();
      if (lower && !acknowledgedKeywords.has(lower) && matchesUrlKeyword(clean, kw)) {
        return lower;
      }
    }

    // 2. Check compiled regex filters (scanRegex or testRegex)
    const activeRegex = scanRegex || testRegex;
    if (activeRegex) {
      activeRegex.lastIndex = 0;
      let match;
      while ((match = activeRegex.exec(clean)) !== null) {
        const word = match[0].toLowerCase();
        if (!acknowledgedKeywords.has(word)) {
          activeRegex.lastIndex = 0;
          return word;
        }
        if (activeRegex.lastIndex === match.index) activeRegex.lastIndex++;
      }
      activeRegex.lastIndex = 0;
    }

    // 3. Fallback set check
    if (badwordsSet && badwordsSet.size > 0) {
      const words = clean.toLowerCase().split(/[^a-z0-9]+/i);
      for (const w of words) {
        if (w.length >= 2 && badwordsSet.has(w) && !acknowledgedKeywords.has(w)) {
          return w;
        }
      }
    }
    return null;
  }

  function triggerInputBlocked(hit, target) {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
    if (!isTopFrame) return;
    if (isScanExcluded()) return;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;

    const lowerHit = String(hit || '').toLowerCase().trim();
    if (acknowledgedKeywords.has(lowerHit)) return;

    scanAcknowledged = false;
    scanPrompted = false;
    console.log(`[BlockX] Flagged keyword "${hit}" detected in input! Prompting immediately.`);
    if (target && target.blur) {
      try { target.blur(); } catch { }
    }
    raiseBarrier(BARRIER_FROZEN);
    try { freezeMedia(); } catch { }
    try {
      const allHits = new Set([lowerHit]);
      if (target) {
        const text = target.value || (target.isContentEditable ? (target.innerText || target.textContent || '') : '');
        if (text) {
          for (const kw of ((CONFIG && CONFIG.KEYWORDS) || [])) {
            const lkw = String(kw || '').toLowerCase().trim();
            if (lkw && matchesUrlKeyword(text, kw)) allHits.add(lkw);
          }
          const activeRegex = scanRegex || testRegex;
          if (activeRegex) {
            activeRegex.lastIndex = 0;
            let m;
            while ((m = activeRegex.exec(text)) !== null) {
              allHits.add(m[0].toLowerCase());
              if (activeRegex.lastIndex === m.index) activeRegex.lastIndex++;
            }
            activeRegex.lastIndex = 0;
          }
        }
      }
      showScanPrompt(allHits);
    } catch (e) {
      console.warn('[BlockX] Prompt failed; keeping page blurred.', e);
      raiseBarrier(BARRIER_FROZEN);
      try { freezeMedia(); } catch { }
    }
  }

  // Elements whose value was actually TYPED by the user, as opposed to a
  // wrapper/container the page happens to label "search" or "combobox".
  // Sites like Google wrap the entire search widget - box plus the live
  // suggestions dropdown - in one element carrying role="combobox" and/or
  // aria-label="Search". Reading that wrapper's innerText/textContent picks
  // up every suggestion currently rendered underneath it, not just what the
  // user typed, so a single flagged word appearing in the *suggestions* gets
  // treated as if the user typed it themselves - bypassing SCAN_SENSITIVITY
  // entirely. Only a real <input>/<textarea>/contenteditable element carries
  // literal typed text, so only those qualify here.
  const NON_TEXT_INPUT_TYPES = new Set([
    'button', 'submit', 'reset', 'checkbox', 'radio', 'range',
    'color', 'file', 'image', 'hidden'
  ]);

  function isGenuineTextInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return !NON_TEXT_INPUT_TYPES.has(type);
    }
    return !!el.isContentEditable;
  }

  function getTypedText(el) {
    if (!isGenuineTextInput(el)) return '';
    if (typeof el.value === 'string') return el.value;
    if (el.isContentEditable) return el.innerText || el.textContent || '';
    return '';
  }

  function checkAllInputsOnPage() {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return false;
    if (!isTopFrame) return false;
    if (isScanExcluded()) return false;
    if (scanAcknowledged) return false;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return false;
    const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    for (const el of inputs) {
      const text = getTypedText(el);
      if (text) {
        const hit = checkTextForFlaggedKeywords(text);
        if (hit && !acknowledgedKeywords.has(hit.toLowerCase())) {
          triggerInputBlocked(hit, el);
          return true;
        }
      }
    }
    return false;
  }

  function handleRealtimeInput(e) {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
    if (!isTopFrame) return;
    if (isScanExcluded()) return;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;
    const target = e.target;
    if (!target) return;

    let text = '';
    if (typeof target.value === 'string') {
      text = target.value;
    } else if (target.isContentEditable) {
      text = target.innerText || target.textContent || '';
    } else {
      const inputEl = target.closest && target.closest('input, textarea, [contenteditable="true"]');
      if (inputEl) {
        text = getTypedText(inputEl);
      } else if (document.activeElement && isGenuineTextInput(document.activeElement)) {
        text = getTypedText(document.activeElement);
      } else {
        return;
      }
    }

    const hit = checkTextForFlaggedKeywords(text);
    if (hit && !acknowledgedKeywords.has(hit.toLowerCase())) {
      triggerInputBlocked(hit, target);
    }
  }

  // Attach capture-phase input listeners immediately at script evaluation (millisecond 0)
  if (isTopFrame) {
    ['input', 'beforeinput', 'keyup', 'change', 'paste', 'focusin'].forEach(type => {
      window.addEventListener(type, handleRealtimeInput, true);
    });

    window.addEventListener('keydown', (e) => {
      if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
      if (!isTopFrame) return;
      if (isScanExcluded()) return;
      if (e.key === 'Enter') {
        const active = document.activeElement;
        const text = active ? (active.value || active.innerText || active.textContent || '') : '';
        const hit = checkTextForFlaggedKeywords(text);
        if (hit && !acknowledgedKeywords.has(hit.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          triggerInputBlocked(hit, active);
        }
      }
    }, true);

    window.addEventListener('submit', (e) => {
      if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
      if (!isTopFrame) return;
      if (isScanExcluded()) return;
      const form = e.target;
      if (form && form.querySelectorAll) {
        const inputs = form.querySelectorAll('input, textarea, [contenteditable]');
        for (const input of inputs) {
          const text = input.value || input.innerText || input.textContent || '';
          const hit = checkTextForFlaggedKeywords(text);
          if (hit && !acknowledgedKeywords.has(hit.toLowerCase())) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            triggerInputBlocked(hit, input);
            return;
          }
        }
      }
    }, true);

    window.addEventListener('click', (e) => {
      if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
      if (!isTopFrame) return;
      if (isScanExcluded()) return;
      const target = e.target;
      if (!target) return;
      const isSearchBtn = target.closest && target.closest('button, [role="button"], input[type="submit"], [aria-label*="search" i], [aria-label*="Search" i]');
      if (isSearchBtn) {
        if (checkAllInputsOnPage()) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
    }, true);

    // Active polling: scans the active element and all inputs every 80ms
    realtimeInputInterval = setInterval(() => {
      if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
      if (!isTopFrame) return;
      if (isScanExcluded()) return;
      if (scanAcknowledged) return;
      if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;
      if (document.activeElement) {
        const el = document.activeElement;
        if (isGenuineTextInput(el)) {
          const text = getTypedText(el);
          const hit = checkTextForFlaggedKeywords(text);
          if (hit && !acknowledgedKeywords.has(hit.toLowerCase())) {
            triggerInputBlocked(hit, el);
            return;
          }
        }
      }
    }, 80);
  }

  // --- 5. REELS & SHORTS DISTRACTION SUPPRESSION ---
  function applyReelsDistractionHiding() {
    if (!CONFIG || CONFIG.REELS_BLOCKER_ENABLED === false) return;
    const host = window.location.hostname.toLowerCase();
    const platforms = CONFIG.REELS_PLATFORMS || {};

    let css = '';
    if (host.includes('youtube.com') && platforms.youtube !== false) {
      css += `
        ytd-guide-entry-renderer:has(a[href="/shorts"]),
        ytd-mini-guide-entry-renderer[aria-label="Shorts"],
        ytd-mini-guide-entry-renderer[title="Shorts"],
        a[path="shorts"],
        ytd-rich-shelf-renderer[is-shorts],
        ytd-reel-shelf-renderer,
        ytd-item-section-renderer:has(ytd-reel-shelf-renderer),
        ytd-shelf-renderer:has(a[href*="/shorts/"]),
        ytd-rich-item-renderer:has(a[href*="/shorts/"]),
        ytd-video-renderer:has(a[href*="/shorts/"]),
        [title="Shorts"],
        [aria-label="Shorts"] {
          display: none !important;
        }
      `;
    }
    if (host.includes('instagram.com') && platforms.instagram !== false) {
      css += `
        a[href*="/reels/"],
        a[href="/reels"],
        a[href^="/reels/"],
        svg[aria-label="Reels"],
        a[role="link"][href*="/reel/"] {
          display: none !important;
        }
      `;
    }
    if (host.includes('facebook.com') && platforms.facebook !== false) {
      css += `
        a[href*="/reel/"],
        a[href*="/reels/"],
        div[aria-label*="Reels"],
        div[data-pagelet*="Reels"] {
          display: none !important;
        }
      `;
    }
    if (host.includes('reddit.com') && platforms.reddit !== false) {
      css += `
        a[href^="/watch"] {
          display: none !important;
        }
      `;
    }

    if (css.trim()) {
      const existing = document.getElementById('blockx-reels-distraction-hiding');
      if (existing) existing.remove();
      const styleEl = document.createElement('style');
      styleEl.id = 'blockx-reels-distraction-hiding';
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  }

  // ------------------------------------------------------------------
  // 6. ASYNCHRONOUS CONFIG & OMNI-WHITELIST
  // ------------------------------------------------------------------
  await loadConfig();
  buildFilters([]);
  prepareFilter();
  applyReelsDistractionHiding();
  if (CONFIG && CONFIG.SCANNING_ENABLED === false) {
    dropBarrier();
  }

  if (hasTempGrant(window.location.hostname, CONFIG.TEMP_GRANTS)) {
    try {
      const reply = await chrome.runtime.sendMessage({
        action: 'isTabUnlocked',
        host: window.location.hostname
      });
      tabUnlocked = !!(reply && reply.unlocked);
    } catch { /* service worker asleep or reloading */ }
  }

  function isSearchPage() {
    const at = window.location;
    if (extractSearchQuery(at.href)) return true;
    const host = at.hostname.toLowerCase();
    if (host.includes('google.') || host.includes('bing.com') || host.includes('duckduckgo.com') || host.includes('yahoo.com') || host.includes('yandex.')) {
      if (at.pathname.includes('/search') || at.pathname.includes('/images') || at.pathname.includes('/videos') || at.pathname.includes('/imgres')) {
        return true;
      }
    }
    return false;
  }

  function blockPage(url) {
    if (isBlocked) return;
    isBlocked = true;

    try { window.stop(); } catch { }

    if (realtimeInputInterval) {
      clearInterval(realtimeInputInterval);
      realtimeInputInterval = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    cancelRescan();

    let targetUrlToBlock = window.location.href;
    try {
      if (url) targetUrlToBlock = new URL(url, window.location.href).href;
    } catch { }

    const targetUrl = getBlockUrl(CONFIG.BLOCK_METHOD, targetUrlToBlock);

    if (window.location.href.startsWith('data:') || window.location.href.includes('chrome-extension://')) return;

    if (window.top === window.self) {
      chrome.runtime.sendMessage({ action: 'triggerBlock', url: targetUrlToBlock });
    }

    try {
      window.location.replace(targetUrl);
    } catch {
      window.location.href = targetUrl;
    }
  }

  function isWhitelisted(ignoreSearch = false, customUrl = null) {
    if (!CONFIG) return false;
    if (tabUnlocked) return true;
    if (!ignoreSearch && isSearchPage()) return false;
    if (!Array.isArray(CONFIG.ALLOWED_DOMAINS) || CONFIG.ALLOWED_DOMAINS.length === 0) return false;

    let targetUrl;
    try {
      targetUrl = customUrl ? new URL(customUrl, window.location.href) : window.location;
    } catch {
      targetUrl = window.location;
    }

    if (targetUrl.protocol === 'chrome-extension:' || targetUrl.protocol === 'chrome:') return false;

    const host = String(targetUrl.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!host) return false;

    const domainRules = [];
    for (const entry of CONFIG.ALLOWED_DOMAINS) {
      const rule = (entry && typeof entry === 'object') ? entry : parseScanExclusion(entry);
      if (!rule) continue;
      const hostMatches = (host === rule.host) ||
        (classifyHost(rule.host) === 'domain' && host.endsWith('.' + rule.host));
      if (hostMatches) {
        domainRules.push(rule);
      }
    }

    if (domainRules.length === 0) return false;

    const isAllowed = domainRules.some(rule =>
      scanExclusionMatches(targetUrl.hostname, targetUrl.port, targetUrl.pathname, targetUrl.search, rule)
    );

    if (isAllowed) {
      return true;
    }

    blockPage(targetUrl.href);
    return false;
  }

  // --- IMMEDIATE WHITELIST CHECK & ENFORCEMENT ---
  if (isWhitelisted()) {
    dropBarrier();
  }
  if (isBlocked) {
    return;
  }

  // --- 7. SPA MAIN WORLD NOTIFICATIONS & POPSTATE ---
  window.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'SHORTS_BLOCKED' || event.data.type === 'URL_CHANGED')) {
      let targetUrl = window.location.href;
      try {
        if (event.data.url) targetUrl = new URL(event.data.url, window.location.href).href;
      } catch { }
      if (CONFIG && CONFIG.SCANNING_ENABLED === false) {
        verifyPageSafety(targetUrl);
      } else if (isScanExcluded(targetUrl)) {
        dismissScanPrompt();
        verifyPageSafety(targetUrl);
      } else {
        checkAllInputsOnPage();
        verifyPageSafety(targetUrl);
      }
    }
  });

  window.addEventListener('popstate', () => {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) {
      verifyPageSafety(window.location.href);
    } else if (isScanExcluded(window.location.href)) {
      dismissScanPrompt();
      verifyPageSafety(window.location.href);
    } else {
      checkAllInputsOnPage();
      verifyPageSafety(window.location.href);
    }
  });
  document.addEventListener('yt-navigate-finish', () => { verifyPageSafety(); });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      loadConfig().then(() => prepareFilter()).then(() => {
        if (CONFIG && CONFIG.SCANNING_ENABLED === false) {
          dismissScanPrompt();
          dropBarrier();
        } else if (isScanExcluded()) {
          dismissScanPrompt();
        }
        verifyPageSafety();
      });
    }
  });

  function handleBlock(url) {
    blockPage(url || window.location.href);
  }

  function isExplicit(text) {
    if (!text || !filterRegex) return false;
    return filterRegex.test(text);
  }

  // ------------------------------------------------------------------
  // 8. ON-PAGE CONTENT SCAN
  // ------------------------------------------------------------------
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, CODE: 1, PRE: 1 };

  function scanPage() {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return null;
    if ((!scanRegex && !pageRegex) || !document.body) return null;

    const threshold = Math.max(1, parseInt(CONFIG.SCAN_SENSITIVITY, 10) || 2);
    const found = new Set();
    const pageFound = new Set();

    function recordMatches(text, regex, set) {
      if (!text || !regex) return false;
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const word = match[0].toLowerCase();
        if (!acknowledgedKeywords.has(word)) {
          set.add(word);
        }
        if (regex.lastIndex === match.index) regex.lastIndex++;
      }
      regex.lastIndex = 0;
      return set.size >= threshold;
    }

    const pageHit = (text) => recordMatches(text, pageRegex, pageFound);
    const mainHit = (text) => recordMatches(text, scanRegex, found);

    // 0. Search query inspection: Intent Rule (1 unacknowledged hit trips immediately)
    const query = extractSearchQuery(window.location.href);
    if (query) {
      const qHit = checkTextForFlaggedKeywords(query);
      if (qHit && !acknowledgedKeywords.has(qHit.toLowerCase())) {
        found.add(qHit.toLowerCase());
        return found;
      }
    }

    // 1. Metadata and Title
    if (document.title) {
      if (pageHit(document.title)) return pageFound;
      if (mainHit(document.title)) return found;
    }

    if (document.head) {
      for (const meta of document.head.querySelectorAll('meta[name="description"], meta[name="keywords"], meta[property^="og:"]')) {
        const content = meta.getAttribute('content');
        if (content) {
          if (pageHit(content)) return pageFound;
          if (mainHit(content)) return found;
        }
      }
    }

    // 2. Text pass: walks visible body text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.length < SCAN_MIN_TEXT_LENGTH) return NodeFilter.FILTER_REJECT;
        const parent = node.parentNode;
        if (parent && SKIP_TAGS[parent.nodeName]) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let visited = 0;
    let node;
    while ((node = walker.nextNode()) !== null) {
      if (++visited > SCAN_NODE_LIMIT) break;
      if (pageHit(node.nodeValue)) return pageFound;
      if (mainHit(node.nodeValue)) return found;
    }

    // 3. Element attributes pass: checks image alt text, descriptions, pins, cards, and links
    const elementsWithAttrs = document.body.querySelectorAll(
      'img[alt], img[title], img[data-pin-description], img[src], [aria-label], [title], [data-title], [data-alt], [data-test-id], a[href]'
    );
    let attrVisited = 0;
    const ATTR_LIMIT = 3500;
    for (const el of elementsWithAttrs) {
      if (++attrVisited > ATTR_LIMIT) break;

      if (el.tagName === 'IMG') {
        if (el.alt) {
          if (pageHit(el.alt)) return pageFound;
          if (mainHit(el.alt)) return found;
        }
        const imgDesc = el.getAttribute('data-pin-description');
        if (imgDesc) {
          if (pageHit(imgDesc)) return pageFound;
          if (mainHit(imgDesc)) return found;
        }
        const imgTitle = el.getAttribute('title');
        if (imgTitle) {
          if (pageHit(imgTitle)) return pageFound;
          if (mainHit(imgTitle)) return found;
        }
      } else if (el.tagName === 'A') {
        const href = el.getAttribute('href');
        if (href && href.length > 5 && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const decoded = decodeURIComponent(href);
            const aHit = matchesAnyUrlKeyword(decoded, CONFIG.KEYWORDS);
            if (aHit && !acknowledgedKeywords.has(aHit.toLowerCase())) {
              found.add(aHit.toLowerCase());
              if (found.size >= threshold) return found;
            }
          } catch {
            const aHit = matchesAnyUrlKeyword(href, CONFIG.KEYWORDS);
            if (aHit && !acknowledgedKeywords.has(aHit.toLowerCase())) {
              found.add(aHit.toLowerCase());
              if (found.size >= threshold) return found;
            }
          }
        }
      }

      const aria = el.getAttribute('aria-label');
      if (aria) {
        if (pageHit(aria)) return pageFound;
        if (mainHit(aria)) return found;
      }
      const title = el.getAttribute('title');
      if (title) {
        if (pageHit(title)) return pageFound;
        if (mainHit(title)) return found;
      }
      const dataTitle = el.getAttribute('data-title');
      if (dataTitle) {
        if (pageHit(dataTitle)) return pageFound;
        if (mainHit(dataTitle)) return found;
      }
      const dataAlt = el.getAttribute('data-alt');
      if (dataAlt) {
        if (pageHit(dataAlt)) return pageFound;
        if (mainHit(dataAlt)) return found;
      }
    }

    if (pageFound.size >= threshold) return pageFound;
    return (found.size >= threshold) ? found : null;
  }

  function runContentScan() {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return false;
    if (!isTopFrame || (scanPrompted && document.getElementById('blockx-scan-prompt'))) return false;
    if (isScanExcluded()) return false;
    if (scanAcknowledged) return false;

    if (checkAllInputsOnPage()) return true;

    const hits = scanPage();
    if (!hits) return false;

    console.log(`[BlockX] Content scan flagged ${hits.size} distinct terms.`);
    try {
      showScanPrompt(hits);
    } catch (e) {
      console.warn('[BlockX] Prompt failed; keeping page blurred.', e);
      raiseBarrier(BARRIER_FROZEN);
      freezeMedia();
    }
    return true;
  }

  function scheduleRescan() {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
    if (isScanExcluded()) return;
    if (scanAcknowledged) return;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;

    const now = Date.now();
    if (!scanDeadline) scanDeadline = now + SCAN_MAX_DEFER_MS;

    if (scanThrottleId) clearTimeout(scanThrottleId);
    const wait = Math.max(0, Math.min(SCAN_THROTTLE_MS, scanDeadline - now));

    scanThrottleId = setTimeout(() => {
      scanThrottleId = null;
      scanDeadline = 0;
      runContentScan();
    }, wait);
  }

  // ------------------------------------------------------------------
  // 9. DESTINATION BLOCK CHECKING & SAFETY VERIFICATION
  // ------------------------------------------------------------------
  function isBlockedDomain(hostname) {
    if (!hostname || !CONFIG.DOMAINS) return false;
    const lowerHost = hostname.toLowerCase();
    return CONFIG.DOMAINS.some(d => {
      const cleanDomain = d.trim().toLowerCase();
      return lowerHost === cleanDomain || lowerHost.endsWith('.' + cleanDomain);
    });
  }

  function isBlockedPage(url) {
    if (!url || !CONFIG.PAGE_URLS) return false;
    const lowerUrl = url.toLowerCase();
    return CONFIG.PAGE_URLS.some(p => {
      const cleanPattern = p.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
      const target = lowerUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
      return target.includes(cleanPattern);
    });
  }

  function isBlockedReelsPage(url) {
    if (!url) return false;
    const patterns = typeof getActiveReelsPatterns === 'function' ? getActiveReelsPatterns(CONFIG) : [];
    if (!patterns || patterns.length === 0) return false;
    let u;
    try {
      u = new URL(url, window.location.href);
    } catch {
      return false;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.toLowerCase();
    const full = host + path;

    return patterns.some(p => {
      const clean = p.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
      return full.includes(clean) || (clean.startsWith(host) && path.startsWith(clean.slice(host.length)));
    });
  }

  function isExactBlockedPage(url) {
    if (!url || !CONFIG.EXACT_PAGE_URLS) return false;
    try {
      const parsed = new URL(url);
      const targetExact = parsed.origin + parsed.pathname;
      return CONFIG.EXACT_PAGE_URLS.some(pattern => {
        let clean = pattern.trim().toLowerCase();
        clean = clean.replace(/^[a-z]+:\/\//, '');
        clean = clean.split('?')[0].split('#')[0];
        clean = clean.replace(/\/+$/, '');
        const targetClean = targetExact.replace(/^[a-z]+:\/\//, '').replace(/\/+$/, '');
        return targetClean === clean;
      });
    } catch { return false; }
  }

  function verifyPageSafety(customUrl) {
    const currentUrl = customUrl || window.location.href;
    let currentHost = window.location.hostname;
    try {
      if (customUrl) currentHost = new URL(customUrl, window.location.href).hostname;
    } catch { }

    if (isBlocked) return true;

    // Immediate Reels & Shorts check (takes precedence so reels feeds are blocked even if parent site is whitelisted)
    if (isBlockedReelsPage(currentUrl)) {
      if (observer) observer.disconnect();
      handleBlock(currentUrl);
      return true;
    }

    if (isWhitelisted(false, currentUrl)) {
      dropBarrier();
    }

    if (CONFIG && CONFIG.SCANNING_ENABLED === false) {
      cancelRescan();
      if (
        !isWhitelisted() && (
          isBlockedDomain(currentHost) ||
          isBlockedPage(currentUrl) ||
          isExactBlockedPage(currentUrl) ||
          isBlockedReelsPage(currentUrl) ||
          matchesAnyUrlKeyword(currentUrl, CONFIG.KEYWORDS)
        )
      ) {
        if (observer) observer.disconnect();
        handleBlock();
        return true;
      }
      dropBarrier();
      return false;
    }

    if (isScanExcluded(currentUrl)) {
      cancelRescan();
      if (
        !isWhitelisted() && (
          isBlockedDomain(currentHost) ||
          isBlockedPage(currentUrl) ||
          isExactBlockedPage(currentUrl) ||
          isBlockedReelsPage(currentUrl)
        )
      ) {
        if (observer) observer.disconnect();
        handleBlock();
        return true;
      }
      return false;
    }

    if (!isTopFrame) {
      if (
        !isWhitelisted() && (
          isBlockedDomain(currentHost) ||
          isBlockedPage(currentUrl) ||
          isExactBlockedPage(currentUrl) ||
          isBlockedReelsPage(currentUrl) ||
          matchesAnyUrlKeyword(currentUrl, CONFIG.KEYWORDS)
        )
      ) {
        if (observer) observer.disconnect();
        handleBlock();
        return true;
      }
      return false;
    }

    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return true;

    const routeChanged = currentUrl !== scanUrl;
    if (routeChanged) {
      scanUrl = currentUrl;
      scanAcknowledged = false;
      cancelRescan();
    }

    if (scanAcknowledged) {
      dropBarrier();
      return false;
    }

    if (checkAllInputsOnPage()) return true;

    const query = extractSearchQuery(currentUrl);
    if (query && checkTextForFlaggedKeywords(query)) {
      console.log(`[BlockX] Immediate search query flagged on URL: "${query}"`);
      return runContentScan();
    }

    if (
      !isWhitelisted() && (
        isBlockedDomain(currentHost) ||
        isBlockedPage(currentUrl) ||
        isExactBlockedPage(currentUrl) ||
        isBlockedReelsPage(currentUrl) ||
        (!isSearchPage() && matchesAnyUrlKeyword(currentUrl, CONFIG.KEYWORDS))
      )
    ) {
      if (observer) observer.disconnect();
      handleBlock();
      return true;
    }

    if (routeChanged) {
      scheduleRescan();
      return false;
    }

    return runContentScan();
  }

  // Check immediately upon site arrival (at document_start)
  verifyPageSafety();

  const cleanup = () => {
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;
    if (scanAcknowledged) {
      dropBarrier();
      return;
    }
    if (!verifyPageSafety()) {
      dropBarrier();
    }
  };

  observer = new MutationObserver(() => {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
    if (isScanExcluded()) return;
    if (scanAcknowledged) return;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;
    if (document.title) verifyPageSafety();
    checkAllInputsOnPage();
    scheduleRescan();
  });

  observer.observe(document.documentElement, { subtree: true, childList: true });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    cleanup();
  } else {
    window.addEventListener('DOMContentLoaded', cleanup);
  }
})();