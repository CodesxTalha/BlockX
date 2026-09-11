let CONFIG = {
  // 'blocked_page', 'infinite_hang', 'data_uri'
  BLOCK_METHOD: 'blocked_page',

  // If true, shows the game specified in ACTIVE_GAME_INDEX instead of blocked.html
  SHOW_GAME_INSTANTLY: true,
  ACTIVE_GAME_INDEX: 0, 

  // Custom Redirect URL
  CUSTOM_REDIRECT_URL: '',

  // Custom Keywords (Overridden by badwords.json if loaded)
  KEYWORDS: [],

  // Page-only keywords: matched against page content only, never the URL.
  // A single hit shows the warning popup instead of blocking outright.
  PAGE_KEYWORDS: [],

  // Custom Domains (Overridden by domains.json if loaded)
  DOMAINS: [],

  // Specific Pages or Paths to block
  PAGE_URLS: [
    'reddit.com/r/nsfw',
    'reddit.com/r/porn',
    'twitter.com/search?q=porn',
    'google.com/search?q=porn',
    'bing.com/search?q=porn'
  ],

  // Specific Exact Pages to block (no child pages)
  EXACT_PAGE_URLS: [],

  // Allowed Domains (Whitelist to bypass all blocks)
  ALLOWED_DOMAINS: [],

  // Domains exempt from on-page content scanning
  SCAN_EXCLUDED: [],

  // Master toggle for on-page content and input scanning
  SCANNING_ENABLED: true,

  // Friction and bypass verification mode: 'warning' (two-step confirmation) or 'retype' (retype phrase)
  BYPASS_MODE: 'warning',

  // The one warning message. Shown by the on-page content warning and by
  // every confirmation that loosens protection in the dashboard.
  WEAKENING_MESSAGE: 'Stop. This weakens the protection you built. Remember why you set this up. Is this really what you want right now?',

  // How many DISTINCT flagged terms a page needs before the warning appears
  SCAN_SENSITIVITY: 2,

  // Phrase that must be retyped to earn a temporary pass to a blocked site
  UNLOCK_PHRASE: 'I am choosing to break my own rule',

  // Temporary passes earned through the popup
  TEMP_GRANTS: [],

  GAMES: [
    { name: "Tower Blocks", path: "assets/blocked-pages/tower-blocks.html" },
    { name: "Rubiks Cube", path: "assets/blocked-pages/rubiks-cube.html" },
  ],

  // Whether to fetch, cache, and display website favicons in destination lists
  SHOW_FAVICONS: false
};

// ------------------------------------------------------------------
// WEAKENING CHANGES
// ------------------------------------------------------------------
// A change that loosens protection is never applied silently: the dashboard
// shows the user's warning message and asks for an explicit yes or no first.
// There is no timer anywhere in that path.

// Taking an entry OFF one of these lists weakens protection.
const WEAKENING_REMOVAL_LISTS = [
  'CUSTOM_DOMAINS',
  'CUSTOM_KEYWORDS',
  'CUSTOM_PAGE_KEYWORDS',
  'CUSTOM_PAGES',
  'CUSTOM_EXACT_PAGES'
];

// Putting an entry ON one of these lists weakens protection.
const WEAKENING_ADDITION_LISTS = [
  'CUSTOM_ALLOWED_DOMAINS',
  'CUSTOM_SCAN_EXCLUDED'
];

// Settings keys an imported backup is allowed to write.
const IMPORTABLE_KEYS = [
  'BLOCK_METHOD',
  'CUSTOM_REDIRECT_URL',
  'CUSTOM_DOMAINS',
  'CUSTOM_KEYWORDS',
  'CUSTOM_PAGE_KEYWORDS',
  'CUSTOM_PAGES',
  'CUSTOM_EXACT_PAGES',
  'CUSTOM_ALLOWED_DOMAINS',
  'CUSTOM_SCAN_EXCLUDED',
  'SCAN_SENSITIVITY',
  'UNLOCK_PHRASE',
  'WEAKENING_MESSAGE',
  'ACTIVE_GAME_INDEX',
  'SECURITY_ENABLED',
  'PASSWORD',
  'THEME',
  'COLOR_THEME',
  'SCANNING_ENABLED',
  'BYPASS_MODE',
  'SHOW_FAVICONS'
];

// ------------------------------------------------------------------
// SHARED SETTINGS
// ------------------------------------------------------------------
// The same settings follow the user across profiles and machines through two
// independent stores, reconciled by revision (highest revision wins):
//
//   chrome.storage.sync   every profile signed into the same Google account.
//                         Always on, nothing to install.
//   the settings file     every profile on this machine regardless of account,
//                         reached through the native host in native/. Only
//                         active once that helper has been installed.
const NATIVE_HOST_NAME = 'com.blockx.settings';
const SETTINGS_FILE_VERSION = 1;

// Keys that make up a shared settings snapshot. Deliberately the same set an
// imported backup may write.
const SETTINGS_KEYS = IMPORTABLE_KEYS;

// Mixed into the file checksum. Not a secret and not meant to stop a
// determined edit: it exists so a casual hand-edit of the settings file is
// detected rather than silently trusted.
const SETTINGS_CHECKSUM_SALT = 'blockx-settings-v1';

/**
 * Stable stringify: object keys sorted at every level so the same settings
 * always produce the same checksum.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Narrows an arbitrary object to the known settings keys.
 */
function pickSettings(source) {
  if (!source || typeof source !== 'object') return null;
  const picked = {};
  for (const key of SETTINGS_KEYS) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

/**
 * True when `incoming` would loosen protection relative to `current`:
 * anything dropped from a blocklist, anything added to an exemption list,
 * a coarser scan threshold, or the dashboard lock being switched off.
 */
function weakensProtection(current, incoming) {
  const list = (source, key) => (Array.isArray(source?.[key]) ? source[key] : []);

  for (const key of WEAKENING_REMOVAL_LISTS) {
    const before = list(current, key);
    const after = new Set(list(incoming, key));
    if (incoming[key] !== undefined && before.some(item => !after.has(item))) return true;
  }

  for (const key of WEAKENING_ADDITION_LISTS) {
    const before = new Set(list(current, key));
    if (list(incoming, key).some(item => !before.has(item))) return true;
  }

  if (typeof incoming.SCAN_SENSITIVITY === 'number'
      && incoming.SCAN_SENSITIVITY > (current.SCAN_SENSITIVITY ?? 2)) return true;

  if (current.SECURITY_ENABLED && incoming.SECURITY_ENABLED === false) return true;
  if ((current.SCANNING_ENABLED ?? true) && incoming.SCANNING_ENABLED === false) return true;
  if (current.BYPASS_MODE === 'retype' && incoming.BYPASS_MODE === 'warning') return true;

  return false;
}

/**
 * Formats a millisecond duration as m:ss.
 */
function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Loads configuration from chrome.storage.local and merges it into CONFIG.
 */
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get({
      BLOCK_METHOD: 'blocked_page',
      CUSTOM_REDIRECT_URL: '',
      CUSTOM_KEYWORDS: [],
      CUSTOM_PAGE_KEYWORDS: [],
      CUSTOM_DOMAINS: [],
      CUSTOM_PAGES: [
        'reddit.com/r/nsfw',
        'reddit.com/r/porn',
        'twitter.com/search?q=porn',
        'google.com/search?q=porn',
        'bing.com/search?q=porn'
      ],
      CUSTOM_EXACT_PAGES: [],
      CUSTOM_ALLOWED_DOMAINS: [], // FIXED: Changed from ALLOWED_DOMAINS to CUSTOM_ALLOWED_DOMAINS
      CUSTOM_SCAN_EXCLUDED: [],
      SCAN_MESSAGE: '',
      SCAN_SENSITIVITY: 2,
      UNLOCK_PHRASE: CONFIG.UNLOCK_PHRASE,
      WEAKENING_MESSAGE: '',
      TEMP_GRANTS: [],
      THEME: 'system',
      COLOR_THEME: 'blue',
      ACTIVE_GAME_INDEX: -1,
      SCANNING_ENABLED: true,
      BYPASS_MODE: 'warning',
      SHOW_FAVICONS: false
    }, (items) => {
      CONFIG.BLOCK_METHOD = items.BLOCK_METHOD;
      CONFIG.CUSTOM_REDIRECT_URL = items.CUSTOM_REDIRECT_URL;
      CONFIG.KEYWORDS = items.CUSTOM_KEYWORDS;
      CONFIG.PAGE_KEYWORDS = items.CUSTOM_PAGE_KEYWORDS;
      CONFIG.DOMAINS = items.CUSTOM_DOMAINS;
      CONFIG.PAGE_URLS = items.CUSTOM_PAGES;
      CONFIG.EXACT_PAGE_URLS = items.CUSTOM_EXACT_PAGES;
      CONFIG.ALLOWED_DOMAINS = items.CUSTOM_ALLOWED_DOMAINS;
      CONFIG.SCAN_EXCLUDED = items.CUSTOM_SCAN_EXCLUDED;
      // The old per-scan message was folded into the one warning message.
      CONFIG.WEAKENING_MESSAGE = items.WEAKENING_MESSAGE || items.SCAN_MESSAGE || CONFIG.WEAKENING_MESSAGE;
      CONFIG.SCAN_SENSITIVITY = items.SCAN_SENSITIVITY;
      CONFIG.UNLOCK_PHRASE = items.UNLOCK_PHRASE;
      CONFIG.TEMP_GRANTS = items.TEMP_GRANTS;
      CONFIG.THEME = items.THEME;
      CONFIG.COLOR_THEME = items.COLOR_THEME || 'blue';
      CONFIG.ACTIVE_GAME_INDEX = items.ACTIVE_GAME_INDEX;
      CONFIG.SCANNING_ENABLED = items.SCANNING_ENABLED !== false;
      CONFIG.BYPASS_MODE = items.BYPASS_MODE || 'warning';
      CONFIG.SHOW_FAVICONS = items.SHOW_FAVICONS === true;
      resolve(CONFIG);
    });
  });
}

/**
 * Escapes regex special characters.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a single optimized RegExp from an array of keywords.
 * Big O: O(N) where N is text length during search, instead of O(N*K).
 * Uses word boundaries to avoid false positives (e.g. "ass" in "assistant", "anal" in "analysis").
 */
function createOptimizedFilter(keywords) {
  if (!keywords || keywords.length === 0) return null;
  const validKeywords = [...new Set(
    keywords
      .map(kw => String(kw || '').trim().toLowerCase())
      .filter(kw => kw.length > 0)
  )].sort((a, b) => b.length - a.length);
  
  if (validKeywords.length === 0) return null;
  
  const patterns = validKeywords.map(kw => {
    const parts = kw.split(/\s+/).map(escapeRegExp);
    return parts.join('\\s+');
  });
  return new RegExp(`(?<=^|[^a-zA-Z0-9])(?:${patterns.join('|')})(?=$|[^a-zA-Z0-9])`, 'i');
}

// ------------------------------------------------------------------
// HOST ENTRIES
// ------------------------------------------------------------------
// Allow-list entries are not always registrable domains. A development setup
// needs localhost, a LAN address, a container name or a loopback literal, with
// or without a port.

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function classifyHost(hostname) {
  if (!hostname) return null;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return 'ipv6';
  if (IPV4_PATTERN.test(hostname)) return 'ipv4';
  const labels = hostname.split('.');
  if (!labels.every(label => HOST_LABEL_PATTERN.test(label))) return null;
  // A single label is a bare host such as localhost or a container name.
  return labels.length > 1 ? 'domain' : 'host';
}

/**
 * Parses anything a user might paste (with or without a scheme, path or port)
 * into { host, port, kind, value }, or null when it is not a host at all.
 */
function normaliseHostEntry(raw) {
  if (typeof raw !== 'string') return null;

  let text = raw.trim().toLowerCase();
  if (!text) return null;

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');       // scheme
  text = text.split('/')[0].split('?')[0].split('#')[0];    // path, query, hash
  text = text.replace(/^[^@]*@/, '');                       // credentials
  if (!text) return null;

  // A bare IPv6 literal has to be bracketed before the URL parser will take it.
  if (!text.startsWith('[') && (text.match(/:/g) || []).length > 1) text = `[${text}]`;

  let parsed;
  try {
    parsed = new URL('http://' + text);
  } catch {
    return null;
  }

  let host = parsed.hostname;
  if (!host) return null;
  if (host.startsWith('www.')) host = host.slice(4);

  const kind = classifyHost(host);
  if (!kind) return null;

  const port = parsed.port || '';
  return { host, port, kind, value: port ? `${host}:${port}` : host };
}

/**
 * Does a location match a stored entry?
 *
 * Only real multi-label domains extend to their subdomains. Bare hosts and
 * literal addresses match exactly. Otherwise an entry of "com" would whitelist
 * every .com site, and "0.1" would match 127.0.0.1. An entry without a port
 * matches any port; one with a port matches only that port.
 */
function hostMatchesEntry(hostname, port, entry) {
  const parsed = (entry && typeof entry === 'object') ? entry : normaliseHostEntry(entry);
  if (!parsed) return false;

  if (parsed.port && String(port || '') !== parsed.port) return false;

  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (host === parsed.host) return true;

  return parsed.kind === 'domain' && host.endsWith('.' + parsed.host);
}

function matchesAnyHostEntry(hostname, port, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  return entries.some(entry => hostMatchesEntry(hostname, port, entry));
}

// ------------------------------------------------------------------
// SCAN EXCLUSIONS
// ------------------------------------------------------------------
// An exclusion can name a whole site, one branch of it, or a single page.
// The three are told apart by what is written:
//
//   example.com                a whole site, subdomains included
//   example.com/docs/*         that section and everything under it
//   example.com/docs/intro     that one page only
//
// A section or page pins the host exactly. Only a whole-site rule reaches
// subdomains, because an exclusion weakens protection and should not spread
// further than it looks like it does.

const SCAN_EXCLUSION_LABELS = {
  site: 'Whole site',
  section: 'With children',
  page: 'Single page'
};

function parseScanExclusion(raw) {
  if (typeof raw !== 'string') return null;

  let text = raw.trim().toLowerCase();
  if (!text) return null;

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // scheme
  text = text.replace(/^[^@/]*@/, '');                  // credentials
  text = text.replace(/^\*\.?/, '');                   // leading wildcard e.g. *.example.com
  text = text.split('#')[0];                            // fragment
  if (!text) return null;

  // An exclusion has to name a host. Without this a bare path slips through:
  // the URL parser tolerates the extra slashes in "http:///just/a/path" and
  // reads "just" as the hostname.
  if (/^[/?]/.test(text)) return null;

  const wildcard = /\/\*$|(?:^|[^*])\*$/.test(text);
  if (wildcard) text = text.replace(/\/?\*+$/, '');
  if (!text) return null;

  let parsed;
  try {
    parsed = new URL('http://' + text);
  } catch {
    return null;
  }

  const host = normaliseHostEntry(parsed.host);
  if (!host) return null;

  const path = (parsed.pathname || '/').replace(/\/+$/, '');
  const query = parsed.search || '';

  if (!path && !query) {
    return { kind: 'site', host: host.host, port: host.port, path: '/', query: '', value: host.value };
  }

  const kind = wildcard ? 'section' : 'page';
  return {
    kind,
    host: host.host,
    port: host.port,
    path: path || '/',
    query,
    value: `${host.value}${path}${query}${wildcard ? '/*' : ''}`
  };
}

function scanExclusionMatches(hostname, port, pathname, search, entry) {
  const rule = (entry && typeof entry === 'object') ? entry : parseScanExclusion(entry);
  if (!rule) return false;

  if (rule.port && String(port || '') !== rule.port) return false;

  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;

  const hostMatches = (host === rule.host) ||
    (classifyHost(rule.host) === 'domain' && host.endsWith('.' + rule.host));
  if (!hostMatches) return false;

  if (rule.kind === 'site') return true;

  const rawPath = (String(pathname || '/')).replace(/\/+$/, '') || '/';
  let decodedPath = rawPath;
  try { decodedPath = decodeURIComponent(rawPath); } catch {}
  let rulePath = rule.path;
  let decodedRulePath = rule.path;
  try { decodedRulePath = decodeURIComponent(rule.path); } catch {}

  if (rule.kind === 'section') {
    const rawPrefix = rulePath.replace(/\/$/, '') + '/';
    const decodedPrefix = decodedRulePath.replace(/\/$/, '') + '/';
    return rawPath === rulePath ||
           decodedPath === decodedRulePath ||
           rawPath.startsWith(rawPrefix) ||
           decodedPath.startsWith(decodedPrefix);
  }

  if (rawPath !== rulePath && decodedPath !== decodedRulePath) return false;
  return !rule.query || String(search || '') === rule.query;
}

function matchesAnyScanExclusion(hostname, port, pathname, search, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  return entries.some(e => scanExclusionMatches(hostname, port, pathname, search, e));
}

// ------------------------------------------------------------------
// TEMPORARY PASSES
// ------------------------------------------------------------------
// Earned by retyping the unlock phrase in the popup. Deliberately short:
// long enough to do the thing you meant to do, not long enough to settle in.
const TEMP_GRANT_MS = 5 * 60 * 1000;
const TEMP_GRANT_ALARM = 'blockx-grant-expiry';

function activeGrants(grants) {
  if (!Array.isArray(grants)) return [];
  const now = Date.now();
  return grants.filter(g => g && typeof g.host === 'string' && g.expiresAt > now);
}

/**
 * A pass covers one host in one tab, and only until that tab has actually
 * loaded the page once. Reloading, or opening the same site anywhere else,
 * gets nothing: the timer is an upper bound on a single visit, not a window
 * during which the site is open.
 */
function hasTempGrant(hostname, grants, tabId) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;

  return activeGrants(grants).some(g => {
    if (typeof tabId === 'number' && g.tabId !== tabId) return false;
    if (g.consumed) return false;
    const granted = g.host.toLowerCase().replace(/^www\./, '');
    return host === granted || host.endsWith('.' + granted);
  });
}

/**
 * Whether a tab is currently sitting on the page a pass was spent on. Used by
 * the content script, which must not re-block the page the pass just opened.
 */
function isGrantedTab(hostname, grants, tabId) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host || typeof tabId !== 'number') return false;

  return activeGrants(grants).some(g => {
    if (g.tabId !== tabId) return false;
    const granted = g.host.toLowerCase().replace(/^www\./, '');
    return host === granted || host.endsWith('.' + granted);
  });
}

// ------------------------------------------------------------------
// SEARCH QUERIES
// ------------------------------------------------------------------
// A blocklist entry like "google.com/search?q=porn" only matches when the
// query happens to be the first parameter and is exactly that word. Real
// searches put the terms anywhere, url-encode them, and mix them with other
// words, so the query is pulled out and checked on its own.
const SEARCH_QUERY_PARAMS = {
  'google.': ['q', 'as_q', 'oq', 'query'],
  'bing.com': ['q', 'pq'],
  'duckduckgo.com': ['q'],
  'search.yahoo.': ['p'],
  'yandex.': ['text'],
  'search.brave.com': ['q'],
  'ecosia.org': ['q'],
  'startpage.com': ['q', 'query'],
  'searx': ['q'],
  'mojeek.com': ['q'],
  'youtube.com': ['search_query', 'q'],
  'reddit.com': ['q'],
  'x.com': ['q'],
  'twitter.com': ['q'],
  'pinterest.': ['q'],
  'tumblr.com': ['q'],
  'vimeo.com': ['q'],
  'dailymotion.com': ['search']
};

/**
 * Returns the human-readable search terms for a URL, or '' when it is not a
 * recognised search. Separators become spaces so word boundaries still apply.
 */
function extractSearchQuery(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return '';
  }

  const host = parsed.hostname.toLowerCase();
  const params = [];
  for (const [needle, keys] of Object.entries(SEARCH_QUERY_PARAMS)) {
    if (host.includes(needle)) params.push(...keys);
  }
  // Unknown host: still worth checking the usual suspects on any /search path.
  if (params.length === 0 && /(^|\/)(search|results|find)(\/|$)/.test(parsed.pathname)) {
    params.push('q', 'query', 'search', 'p', 'term', 'keyword');
  }
  if (params.length === 0) return '';

  const found = [];
  for (const key of new Set(params)) {
    const value = parsed.searchParams.get(key);
    if (value) found.push(value);
  }

  // Also check common search query param names if none found yet
  if (found.length === 0) {
    const commonParams = ['q', 'query', 'search_query', 'searchTerm', 'keyword', 'term', 'text', 'k', 'w', 'p', 's'];
    for (const key of commonParams) {
      const value = parsed.searchParams.get(key);
      if (value) found.push(value);
    }
  }

  // Some sites carry the terms in the path, e.g. /search/free+porn or /tag/nsfw
  // Only use path match if query parameters did not already supply the terms
  if (found.length === 0) {
    const pathMatch = parsed.pathname.match(/\/(?:search|results|tag|tags|q)\/(?!pins|boards|videos|my_pins|all|top|images)([^/]+)/i);
    if (pathMatch) {
      try { found.push(decodeURIComponent(pathMatch[1])); } catch { found.push(pathMatch[1]); }
    }
  }

  return found.join(' ').replace(/[+_\-.]+/g, ' ').trim();
}

// ------------------------------------------------------------------
// CONTENT SCAN FILTER
// ------------------------------------------------------------------
// Page scanning needs word boundaries. A bare substring alternation matches
// "anal" inside "analysis", "butt" inside "button" and "rape" inside "grape",
// which would flag ordinary pages constantly.
function createBoundedFilter(keywords) {
  if (!keywords || keywords.length === 0) return null;

  const valid = [...new Set(
    keywords
      .map(kw => String(kw || '').trim().toLowerCase())
      .filter(kw => kw.length > 0)
  )].sort((a, b) => b.length - a.length);

  if (valid.length === 0) return null;

  const patterns = valid.map(kw => {
    const parts = kw.split(/\s+/).map(escapeRegExp);
    return parts.join('\\s+');
  });

  return new RegExp(`(?<=^|[^a-zA-Z0-9])(?:${patterns.join('|')})(?=$|[^a-zA-Z0-9])`, 'gi');
}

/**
 * Checks whether a URL or text string contains a keyword bounded by URL delimiters
 * (e.g. &, +, =, ?, /, -, _, ., %20, spaces, or start/end of string).
 * Prevents false positives where a keyword is a substring of an unrelated
 * word in a URL (e.g. "tit" inside "competitions" or "montitrar").
 */
function matchesUrlKeyword(urlStr, keyword) {
  if (!urlStr || !keyword) return false;
  const kw = String(keyword).trim().toLowerCase();
  if (!kw) return false;

  const parts = kw.split(/\s+/).map(escapeRegExp);
  const kwPattern = parts.join('(?:\\s|\\+|%20|[-_])+');
  const regex = new RegExp('(?:^|[^a-z0-9]|%20)' + kwPattern + '(?=$|[^a-z0-9]|%20)', 'i');

  const lowerUrl = String(urlStr).toLowerCase();
  if (regex.test(lowerUrl)) return true;

  try {
    const decoded = decodeURIComponent(lowerUrl);
    if (regex.test(decoded)) return true;
  } catch {}

  return false;
}

function matchesAnyUrlKeyword(urlStr, keywords) {
  if (!urlStr || !Array.isArray(keywords) || keywords.length === 0) return null;
  for (const kw of keywords) {
    if (matchesUrlKeyword(urlStr, kw)) return kw;
  }
  return null;
}

// Work budget for a single scan pass. Bounds the cost on huge documents.
const SCAN_NODE_LIMIT = 6000;
const SCAN_MIN_TEXT_LENGTH = 3;

// Ultra-fast throttle: judges documents almost instantly (like Everything 1.5)
const SCAN_THROTTLE_MS = 60;

// Maximum deferral cap so streaming / constantly mutating pages are still checked promptly
const SCAN_MAX_DEFER_MS = 250;

function getGameOrBlockPath(cfg = CONFIG) {
  const c = cfg || (typeof CONFIG !== 'undefined' ? CONFIG : null);
  if (c && c.SHOW_GAME_INSTANTLY && Array.isArray(c.GAMES) && c.GAMES.length > 0) {
    let index = c.ACTIVE_GAME_INDEX;
    if (index === -1 || index === undefined || !c.GAMES[index]) {
      index = Math.floor(Math.random() * c.GAMES.length);
    }
    return c.GAMES[index].path;
  }
  return 'assets/blocked-pages/blocked.html';
}

function getGameOrBlockUrl(cfg = CONFIG) {
  return chrome.runtime.getURL(getGameOrBlockPath(cfg));
}

const BLOCK_STRATEGIES = {
  infinite_hang: {
    requiresRegex: false,
    getRedirectUrl: () => 'http://1.1.1.1:81',
    getDNRAction: () => ({ type: 'redirect', redirect: { url: 'http://1.1.1.1:81' } })
  },
  data_uri: {
    requiresRegex: true,
    getRedirectUrl: (urlOrHost) => {
      const target = (urlOrHost || '').trim();
      if (!target) return 'data:Blocked';
      if (target.startsWith('data:')) return target;
      if (/^https?:\/\//i.test(target)) return 'data:' + target;
      return 'data:https://' + target;
    },
    getDNRAction: () => ({ type: 'redirect', redirect: { regexSubstitution: 'data:\\0' } })
  },
  custom_url: {
    requiresRegex: false,
    getRedirectUrl: (urlOrHost, cfg = CONFIG) => {
      const c = cfg || (typeof CONFIG !== 'undefined' ? CONFIG : null);
      let custom = c ? c.CUSTOM_REDIRECT_URL : '';
      if (custom && custom.trim() !== '') {
        if (!/^https?:\/\//i.test(custom)) custom = 'http://' + custom;
        return custom;
      }
      return getGameOrBlockUrl(c);
    },
    getDNRAction: (cfg = CONFIG) => {
      const c = cfg || (typeof CONFIG !== 'undefined' ? CONFIG : null);
      let custom = c ? c.CUSTOM_REDIRECT_URL : '';
      if (custom && custom.trim() !== '') {
        if (!/^https?:\/\//i.test(custom)) custom = 'http://' + custom;
        return { type: 'redirect', redirect: { url: custom } };
      }
      return { type: 'redirect', redirect: { extensionPath: '/' + getGameOrBlockPath(c) } };
    }
  },
  blocked_page: {
    requiresRegex: false,
    getRedirectUrl: (urlOrHost, cfg = CONFIG) => getGameOrBlockUrl(cfg),
    getDNRAction: (cfg = CONFIG) => ({ type: 'redirect', redirect: { extensionPath: '/' + getGameOrBlockPath(cfg) } })
  }
};

function getBlockUrl(method, urlOrHost, extensionUrl) {
  const strategy = BLOCK_STRATEGIES[method] || BLOCK_STRATEGIES.blocked_page;
  return strategy.getRedirectUrl(urlOrHost, CONFIG) || extensionUrl || getGameOrBlockUrl(CONFIG);
}

if (typeof globalThis !== 'undefined') {
  globalThis.BLOCK_STRATEGIES = BLOCK_STRATEGIES;
  globalThis.getGameOrBlockPath = getGameOrBlockPath;
  globalThis.getGameOrBlockUrl = getGameOrBlockUrl;
  globalThis.getBlockUrl = getBlockUrl;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG,
    BLOCK_STRATEGIES,
    getGameOrBlockPath,
    getGameOrBlockUrl,
    getBlockUrl
  };
}