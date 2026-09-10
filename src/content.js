// content.js
(async function() {
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
  let activeTamperObserver = null;
  let activeTamperInterval = null;
  const mutedMedia = [];
  const tamperNotes = new Set();

  function raiseBarrier(css) {
    securityBarrier.textContent = css;
    if (document.documentElement && !document.documentElement.contains(securityBarrier)) {
      document.documentElement.appendChild(securityBarrier);
    }
  }

  function dropBarrier() {
    if (scanPrompted || isBlocked) return;
    if (securityBarrier.parentNode) securityBarrier.parentNode.removeChild(securityBarrier);
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
  // 3. PROMPT STYLES & OVERLAY RENDERING (AVAILABLE SYNCHRONOUSLY)
  // ------------------------------------------------------------------
  const PROMPT_STYLES = `
    :host { all: initial; }

    .wrap {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -webkit-backdrop-filter: blur(48px) saturate(1.8) brightness(0.7);
      backdrop-filter: blur(48px) saturate(1.8) brightness(0.7);
      background: rgba(8, 10, 15, 0.72);
      animation: blockx-fade 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .card {
      box-sizing: border-box;
      width: 100%;
      max-width: 460px;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
      padding: 28px;
      text-align: left;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #0f1117;
      color: #f8fafc;
      box-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05), 0 8px 28px -4px rgba(99, 102, 241, 0.12);
      animation: blockx-rise 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .prompt-badge {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    .prompt-badge svg { width: 22px; height: 22px; }

    .retype-badge {
      background: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .warning-badge {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .prompt-title {
      margin: 0 0 6px;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
      text-align: start;
    }

    .prompt-subtitle {
      margin: 0 0 18px;
      font-size: 13.5px;
      line-height: 1.5;
      color: #94a3b8;
      text-align: start;
    }

    .target-phrase-card, .retype-phrase {
      background: rgba(99, 102, 241, 0.06);
      border: 1px solid rgba(99, 102, 241, 0.22);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 14px;
      user-select: none;
    }

    .target-phrase-label {
      display: block;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #818cf8;
      margin-bottom: 4px;
    }

    .target-phrase-text {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13.5px;
      font-weight: 600;
      line-height: 1.5;
      color: #e0e7ff;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .retype-input {
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
      font-size: 13.5px;
      line-height: 1.5;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1.5px solid rgba(255, 255, 255, 0.12);
      background: #08090d;
      color: #ffffff;
      resize: none;
      display: block;
      margin-bottom: 14px;
      outline: none;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35);
      transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
    }
    .retype-input::placeholder { color: #64748b; }
    .retype-input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.22), inset 0 2px 4px rgba(0, 0, 0, 0.35);
    }

    .warning-callout {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }

    .warning-text {
      margin: 0;
      font-size: 14.5px;
      font-weight: 500;
      line-height: 1.6;
      color: #fef3c7;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      unicode-bidi: plaintext;
      text-align: start;
    }

    .view[hidden] { display: none !important; }

    button {
      display: block;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 18px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    button:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }

    .leave {
      background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);
      margin-bottom: 10px;
    }
    .leave:hover:not(:disabled) {
      filter: brightness(1.1);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.45);
    }

    .show {
      background: rgba(255, 255, 255, 0.04);
      color: #94a3b8;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .show:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
    }

    button:disabled {
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
      pointer-events: none;
    }

    :host([data-theme="light"]) .wrap {
      background: rgba(241, 245, 249, 0.75);
      -webkit-backdrop-filter: blur(48px) saturate(1.8) brightness(1.05);
      backdrop-filter: blur(48px) saturate(1.8) brightness(1.05);
    }
    :host([data-theme="light"]) .card {
      background: #ffffff;
      border-color: #e2e8f0;
      color: #0f172a;
      box-shadow: 0 24px 64px -12px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.04);
    }
    :host([data-theme="light"]) .prompt-title { color: #0f172a; }
    :host([data-theme="light"]) .prompt-subtitle { color: #64748b; }
    :host([data-theme="light"]) .target-phrase-card {
      background: #f5f3ff;
      border-color: #ddd6fe;
    }
    :host([data-theme="light"]) .target-phrase-label { color: #6d28d9; }
    :host([data-theme="light"]) .target-phrase-text { color: #4338ca; }
    :host([data-theme="light"]) .retype-input {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    :host([data-theme="light"]) .retype-input:focus {
      background: #ffffff;
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
    }
    :host([data-theme="light"]) .warning-callout {
      background: #fffbeb;
      border-color: #fde68a;
    }
    :host([data-theme="light"]) .warning-text { color: #92400e; }
    :host([data-theme="light"]) .show {
      background: #f1f5f9;
      color: #475569;
      border-color: #e2e8f0;
    }
    :host([data-theme="light"]) .show:hover {
      background: #e2e8f0;
      color: #0f172a;
      border-color: #cbd5e1;
    }
    :host([data-theme="light"]) button:disabled {
      background: #f1f5f9;
      color: #94a3b8;
      border-color: #e2e8f0;
    }

    @keyframes blockx-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes blockx-rise {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to { opacity: 1; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .wrap, .card { animation: none; }
    }
  `;

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

  function noteTamper(key, msg) {
    if (tamperNotes.has(key)) return;
    tamperNotes.add(key);
    console.warn(msg);
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
    if (activeTamperObserver) {
      activeTamperObserver.disconnect();
      activeTamperObserver = null;
    }
    if (activeTamperInterval) {
      clearInterval(activeTamperInterval);
      activeTamperInterval = null;
    }

    const host = document.createElement('div');
    host.id = 'blockx-scan-prompt';
    host.setAttribute('data-theme', resolveTheme());
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('visibility', 'visible', 'important');

    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PROMPT_STYLES;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const card = document.createElement('div');
    card.className = 'card';

    const view1 = document.createElement('div');
    view1.className = 'view';

    const badge1 = document.createElement('div');
    badge1.className = 'prompt-badge warning-badge';
    badge1.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    const heading1 = document.createElement('h2');
    heading1.className = 'prompt-title';
    heading1.textContent = 'Restricted Content Warning';

    const warningBox = document.createElement('div');
    warningBox.className = 'warning-callout';

    const message = document.createElement('p');
    message.className = 'warning-text';
    message.dir = 'auto';
    message.textContent = ((CONFIG && CONFIG.WEAKENING_MESSAGE) || '').trim()
      || 'This page looks explicit. Do you still want to open it?';

    warningBox.appendChild(message);

    view1.appendChild(badge1);
    view1.appendChild(heading1);
    view1.appendChild(warningBox);

    const view2 = document.createElement('div');
    view2.className = 'view';
    view2.hidden = true;

    const badge2 = document.createElement('div');
    badge2.className = 'prompt-badge warning-badge';
    badge2.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

    const heading2 = document.createElement('h2');
    heading2.className = 'prompt-title';
    heading2.textContent = 'Are you sure?';

    const hint = document.createElement('p');
    hint.className = 'prompt-subtitle';
    hint.textContent = 'This page will be unblurred and shown. Only continue if you truly mean to.';

    view2.appendChild(badge2);
    view2.appendChild(heading2);
    view2.appendChild(hint);

    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'leave';
    leaveBtn.type = 'button';
    leaveBtn.textContent = 'No, close this tab';
    leaveBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'closeTab' });
    });

    const showBtn = document.createElement('button');
    showBtn.className = 'show';
    showBtn.type = 'button';
    showBtn.textContent = 'Yes, show it';

    const keepKeys = (event) => {
      if (event.composedPath().includes(host)) event.stopPropagation();
    };
    const KEY_EVENTS = ['keydown', 'keypress', 'keyup'];
    KEY_EVENTS.forEach(type => window.addEventListener(type, keepKeys, true));

    let tamperObserver = null;
    let tamperInterval = null;

    function enforceOverlayIntegrity() {
      if (!scanPrompted || scanAcknowledged) return;

      if (!host.parentNode || !document.documentElement.contains(host)) {
        noteTamper('host', '[BlockX] Warning overlay removed: re-attaching.');
        document.documentElement.appendChild(host);
      }

      const style = window.getComputedStyle(host);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') {
        noteTamper('host-style', '[BlockX] Warning overlay hidden: restoring visibility.');
        host.style.setProperty('all', 'initial', 'important');
        host.style.setProperty('position', 'fixed', 'important');
        host.style.setProperty('inset', '0', 'important');
        host.style.setProperty('z-index', '2147483647', 'important');
        host.style.setProperty('visibility', 'visible', 'important');
        host.style.setProperty('display', 'block', 'important');
        host.style.setProperty('opacity', '1', 'important');
        host.style.setProperty('pointer-events', 'auto', 'important');
      }

      const hasBarrier = document.contains(securityBarrier);
      const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
      const blurred = document.body ? !!(bodyStyle && (bodyStyle.filter || bodyStyle.webkitFilter || '').includes('blur')) : true;
      if (!hasBarrier || !blurred) {
        noteTamper('barrier', '[BlockX] Security barrier removed or weakened: re-attaching.');
        raiseBarrier(BARRIER_FROZEN);
      }

      const HEAD_LEVEL = { STYLE: 1, LINK: 1, META: 1, SCRIPT: 1, TITLE: 1 };
      for (const node of [...document.documentElement.children]) {
        if (node === document.head || node === document.body) continue;
        if (node === securityBarrier || node === host) continue;
        if (HEAD_LEVEL[node.nodeName]) continue;
        noteTamper('stray', '[BlockX] Content moved outside <body>: moving back.');
        if (document.body) document.body.appendChild(node);
      }
    }

    const reveal = () => {
      scanAcknowledged = true;
      scanPrompted = false;
      for (const kw of pendingPromptKeywords) {
        acknowledgedKeywords.add(kw);
      }
      pendingPromptKeywords.clear();
      tamperNotes.clear();
      if (tamperObserver) { tamperObserver.disconnect(); tamperObserver = null; }
      if (tamperInterval) { clearInterval(tamperInterval); tamperInterval = null; }
      activeTamperObserver = null;
      activeTamperInterval = null;
      KEY_EVENTS.forEach(type => window.removeEventListener(type, keepKeys, true));
      if (host.parentNode) host.parentNode.removeChild(host);
      thawMedia();
      dropBarrier();
    };

    const sureBtn = document.createElement('button');
    sureBtn.className = 'leave';
    sureBtn.type = 'button';
    sureBtn.textContent = "Yes, I'm sure: show it";

    const backBtn = document.createElement('button');
    backBtn.className = 'show';
    backBtn.type = 'button';
    backBtn.textContent = 'No, go back';

    showBtn.addEventListener('click', () => {
      view1.hidden = true;
      view2.hidden = false;
      sureBtn.focus();
    });
    backBtn.addEventListener('click', () => {
      view2.hidden = true;
      view1.hidden = false;
      leaveBtn.focus();
    });
    sureBtn.addEventListener('click', reveal);

    const isRetypeMode = CONFIG && CONFIG.BYPASS_MODE === 'retype';

    if (isRetypeMode) {
      const viewRetype = document.createElement('div');
      viewRetype.className = 'view';

      const badge = document.createElement('div');
      badge.className = 'prompt-badge retype-badge';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="6" y1="12" x2="6" y2="12"/><line x1="10" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="14" y2="12"/><line x1="18" y1="12" x2="18" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>';

      const heading = document.createElement('h2');
      heading.className = 'prompt-title';
      heading.textContent = 'Verification Required';

      const hint = document.createElement('p');
      hint.className = 'prompt-subtitle';
      hint.textContent = 'This page was flagged by your protection filters. Retype the phrase below word-for-word to continue:';

      const phraseBox = document.createElement('div');
      phraseBox.className = 'target-phrase-card';
      const phraseTag = document.createElement('span');
      phraseTag.className = 'target-phrase-label';
      phraseTag.textContent = 'Required Unlock Phrase';
      const phraseText = document.createElement('div');
      phraseText.className = 'target-phrase-text';
      const requiredPhrase = ((CONFIG && CONFIG.UNLOCK_PHRASE) || 'I am choosing to break my own rule').trim();
      phraseText.textContent = requiredPhrase;
      phraseBox.appendChild(phraseTag);
      phraseBox.appendChild(phraseText);

      const input = document.createElement('textarea');
      input.className = 'retype-input';
      input.rows = 2;
      input.placeholder = 'Type the exact phrase above...';
      input.spellcheck = false;
      input.autocomplete = 'off';

      const unlockBtn = document.createElement('button');
      unlockBtn.className = 'leave';
      unlockBtn.type = 'button';
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Unlock and show page';

      const leaveBtn = document.createElement('button');
      leaveBtn.className = 'show';
      leaveBtn.type = 'button';
      leaveBtn.textContent = 'No, close this tab';
      leaveBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'closeTab' });
      });

      const collapse = (text) => (text || '').trim().replace(/\s+/g, ' ').toLowerCase();
      input.addEventListener('input', () => {
        unlockBtn.disabled = collapse(input.value) !== collapse(requiredPhrase);
      });
      unlockBtn.addEventListener('click', reveal);

      viewRetype.appendChild(badge);
      viewRetype.appendChild(heading);
      viewRetype.appendChild(hint);
      viewRetype.appendChild(phraseBox);
      viewRetype.appendChild(input);
      viewRetype.appendChild(unlockBtn);
      viewRetype.appendChild(leaveBtn);
      card.appendChild(viewRetype);

      wrap.appendChild(card);
      root.appendChild(style);
      root.appendChild(wrap);

      document.documentElement.appendChild(host);
      raiseBarrier(BARRIER_FROZEN);
      freezeMedia();
      setTimeout(() => input.focus(), 50);
    } else {
      view1.appendChild(leaveBtn);
      view1.appendChild(showBtn);
      view2.appendChild(sureBtn);
      view2.appendChild(backBtn);
      card.appendChild(view1);
      card.appendChild(view2);
      wrap.appendChild(card);
      root.appendChild(style);
      root.appendChild(wrap);

      document.documentElement.appendChild(host);
      raiseBarrier(BARRIER_FROZEN);
      freezeMedia();
      leaveBtn.focus();
    }

    setTimeout(() => {
      if (!scanPrompted || scanAcknowledged) return;

      tamperObserver = new MutationObserver(() => {
        enforceOverlayIntegrity();
      });

      tamperObserver.observe(document.documentElement, {
        childList: true,
        attributes: true,
        subtree: true,
        attributeFilter: ['style', 'class', 'hidden', 'id']
      });

      tamperInterval = setInterval(enforceOverlayIntegrity, 300);
      activeTamperObserver = tamperObserver;
      activeTamperInterval = tamperInterval;
    }, 100);
  }

  function dismissScanPrompt() {
    scanPrompted = false;
    scanAcknowledged = false;
    pendingPromptKeywords.clear();
    tamperNotes.clear();
    if (activeTamperObserver) {
      activeTamperObserver.disconnect();
      activeTamperObserver = null;
    }
    if (activeTamperInterval) {
      clearInterval(activeTamperInterval);
      activeTamperInterval = null;
    }
    cancelRescan();
    const promptHost = document.getElementById('blockx-scan-prompt');
    if (promptHost) promptHost.remove();
    dropBarrier();
    try { thawMedia(); } catch {}
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

    scanPrompted = false;
    console.log(`[BlockX] Flagged keyword "${hit}" detected in input! Prompting immediately.`);
    if (target && target.blur) {
      try { target.blur(); } catch {}
    }
    raiseBarrier(BARRIER_FROZEN);
    try { freezeMedia(); } catch {}
    try {
      showScanPrompt(lowerHit);
    } catch (e) {
      console.warn('[BlockX] Prompt failed; keeping page blurred.', e);
      raiseBarrier(BARRIER_FROZEN);
      try { freezeMedia(); } catch {}
    }
  }

  function checkAllInputsOnPage() {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return false;
    if (!isTopFrame) return false;
    if (isScanExcluded()) return false;
    if (scanPrompted && document.getElementById('blockx-scan-prompt')) return false;
    const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"], [aria-label*="search" i]');
    for (const el of inputs) {
      const text = el.value || (el.isContentEditable ? (el.innerText || el.textContent || '') : (el.innerText || el.textContent || ''));
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
      const inputEl = target.closest && target.closest('input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]');
      if (inputEl) {
        text = inputEl.value || inputEl.innerText || inputEl.textContent || '';
      } else if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
        text = document.activeElement.value || document.activeElement.innerText || document.activeElement.textContent || '';
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
      if (scanPrompted && document.getElementById('blockx-scan-prompt')) return;
      if (document.activeElement) {
        const el = document.activeElement;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'searchbox') {
          const text = el.value || el.innerText || el.textContent || '';
          const hit = checkTextForFlaggedKeywords(text);
          if (hit && !acknowledgedKeywords.has(hit.toLowerCase())) {
            triggerInputBlocked(hit, el);
            return;
          }
        }
      }
    }, 80);
  }

  // --- 5. YOUTUBE SHORTS CSS INJECTION ---
  if (window.location.hostname.includes('youtube.com')) {
    const shortsStyle = document.createElement('style');
    shortsStyle.textContent = `
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
    (document.head || document.documentElement).appendChild(shortsStyle);
  }

  // ------------------------------------------------------------------
  // 6. ASYNCHRONOUS CONFIG & OMNI-WHITELIST
  // ------------------------------------------------------------------
  await loadConfig();
  buildFilters([]);
  prepareFilter();
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

    try { window.stop(); } catch {}

    if (realtimeInputInterval) {
      clearInterval(realtimeInputInterval);
      realtimeInputInterval = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (activeTamperObserver) {
      activeTamperObserver.disconnect();
      activeTamperObserver = null;
    }
    if (activeTamperInterval) {
      clearInterval(activeTamperInterval);
      activeTamperInterval = null;
    }
    cancelRescan();

    let hostname = window.location.hostname;
    try {
      if (url) hostname = new URL(url, window.location.href).hostname;
    } catch {}

    const targetUrl = getBlockUrl(CONFIG.BLOCK_METHOD, hostname);

    if (window.location.href.includes('chrome-extension://')) return;

    if (window.top === window.self) {
      if (CONFIG.BLOCK_METHOD === 'blocked_page') {
        chrome.runtime.sendMessage({ action: 'triggerBlock' });
      }
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
      const targetUrl = event.data.url || window.location.href;
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
      const cleanPattern = p.trim().toLowerCase();
      return lowerUrl.includes(cleanPattern);
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
    } catch {}

    if (isWhitelisted(false, currentUrl)) {
      dropBarrier();
    }
    if (isBlocked) return true;

    if (CONFIG && CONFIG.SCANNING_ENABLED === false) {
      cancelRescan();
      if (
        !isWhitelisted() && (
          isBlockedDomain(currentHost) ||
          isBlockedPage(currentUrl) ||
          isExactBlockedPage(currentUrl) ||
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
          isExactBlockedPage(currentUrl)
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

    if (checkAllInputsOnPage()) return true;

    const routeChanged = currentUrl !== scanUrl;
    if (routeChanged) {
      scanUrl = currentUrl;
      cancelRescan();
    }

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
        matchesAnyUrlKeyword(currentUrl, CONFIG.KEYWORDS)
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
    if (!verifyPageSafety()) {
      dropBarrier();
    }
  };

  observer = new MutationObserver(() => {
    if (CONFIG && CONFIG.SCANNING_ENABLED === false) return;
    if (isScanExcluded()) return;
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
