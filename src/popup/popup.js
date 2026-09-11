// popup.js

let currentTab = null;
let currentContext = { type: 'domain', value: '' };
let unlockContext = null;

async function init() {
    await loadConfig();

    if (CONFIG.COLOR_THEME && typeof updateDynamicActionIcon === 'function') {
        updateDynamicActionIcon(CONFIG.COLOR_THEME);
    }
    if (CONFIG.COLOR_THEME && typeof updatePageFavicon === 'function') {
        updatePageFavicon(CONFIG.COLOR_THEME);
    }

    chrome.storage.local.get({
        THEME: 'system',
        COLOR_THEME: 'blue'
    }, (items) => {
        applyTheme(items.THEME || 'system');
        applyColorTheme(items.COLOR_THEME || 'blue');
    });

    if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes.THEME) {
                    applyTheme(changes.THEME.newValue || 'system');
                }
                if (changes.COLOR_THEME) {
                    applyColorTheme(changes.COLOR_THEME.newValue || 'blue');
                }
            }
        });
    }

    await detectContext();
    setupListeners();
    await setupUnlock();
}

function applyTheme(theme) {
    document.body.setAttribute('data-user-theme', theme || 'system');
}

function applyColorTheme(colorTheme) {
    const validThemes = ['blue', 'pine', 'slate', 'monochrome'];
    const chosen = validThemes.includes(colorTheme) ? colorTheme : 'blue';
    document.body.setAttribute('data-color-theme', chosen);

    if (typeof updateDynamicActionIcon === 'function') {
        updateDynamicActionIcon(chosen);
    }
    if (typeof updatePageFavicon === 'function') {
        updatePageFavicon(chosen);
    }
}

// ------------------------------------------------------------------
// ONE-TIME VISIT
// ------------------------------------------------------------------

function sendMessage(payload) {
    return new Promise((resolve) => chrome.runtime.sendMessage(payload, resolve));
}

async function setupUnlock() {
    if (!currentTab) return;

    const context = await sendMessage({
        action: 'getUnlockContext',
        tabId: currentTab.id,
        url: currentTab.url || ''
    });
    if (!context) return;

    if (context.active) {
        showActivePass(context.active);
        return;
    }
    if (context.refusedHost) {
        showRefused(context.refusedHost);
        return;
    }
    if (!context.target) return;
    if (context.bypassMode === 'retype' && !(context.phrase || '').trim()) return;

    showUnlockPanel(context, context.target);
}

function showUnlockPanel(context, target) {
    const panel = document.getElementById('unlock-panel');
    const hostEl = document.getElementById('unlock-host');
    const note = document.getElementById('unlock-note');
    if (!panel) return;

    panel.classList.remove('hidden');
    document.getElementById('context-action')?.classList.add('hidden');
    document.getElementById('toggle-quick-add')?.classList.add('hidden');
    document.getElementById('quick-add-panel')?.classList.add('hidden');

    if (hostEl) hostEl.textContent = target.host;
    if (note) {
        note.textContent = `One visit to ${target.host} in this tab. Reloading or opening it again blocks it.`;
    }

    const isWarningMode = (context.bypassMode || 'warning') === 'warning';
    const retypeView = document.getElementById('unlock-retype-view');
    const warningView = document.getElementById('unlock-warning-view');

    if (isWarningMode) {
        if (retypeView) retypeView.classList.add('hidden');
        if (warningView) warningView.classList.remove('hidden');

        const warningText = document.getElementById('unlock-warning-text');
        if (warningText) {
            warningText.textContent = (context.warningMessage || '').trim()
                || 'Stop. This page was blocked by your rules. Are you sure you want to proceed?';
        }

        const step1 = document.getElementById('unlock-warning-step1');
        const step2 = document.getElementById('unlock-warning-step2');
        const warnBtn = document.getElementById('unlock-warning-btn');
        const confirmYes = document.getElementById('unlock-confirm-yes');
        const confirmNo = document.getElementById('unlock-confirm-no');

        if (step1) step1.classList.remove('hidden');
        if (step2) step2.classList.add('hidden');

        warnBtn?.addEventListener('click', () => {
            step1?.classList.add('hidden');
            step2?.classList.remove('hidden');
        });

        confirmNo?.addEventListener('click', () => {
            window.close();
        });

        confirmYes?.addEventListener('click', async () => {
            confirmYes.disabled = true;
            const response = await sendMessage({
                action: 'grantTempPass',
                host: target.host,
                tabId: currentTab.id
            });
            if (response && response.ok) {
                if (target.url) chrome.tabs.update(currentTab.id, { url: target.url });
                window.close();
            } else {
                confirmYes.disabled = false;
            }
        });
    } else {
        if (warningView) warningView.classList.add('hidden');
        if (retypeView) retypeView.classList.remove('hidden');

        const phraseEl = document.getElementById('unlock-phrase');
        const input = document.getElementById('unlock-input');
        const button = document.getElementById('unlock-btn');
        const errorEl = document.getElementById('unlock-error');
        if (!input || !button) return;

        const phrase = (context.phrase || '').trim();
        if (phraseEl) phraseEl.textContent = phrase;

        const collapse = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

        input.addEventListener('input', () => {
            errorEl?.classList.add('hidden');
            button.disabled = collapse(input.value) !== collapse(phrase);
        });

        button.addEventListener('click', async () => {
            button.disabled = true;
            const response = await sendMessage({
                action: 'grantTempPass',
                host: target.host,
                tabId: currentTab.id,
                typed: input.value
            });

            if (!response || !response.ok) {
                errorEl?.classList.remove('hidden');
                button.disabled = false;
                return;
            }

            if (target.url) chrome.tabs.update(currentTab.id, { url: target.url });
            window.close();
        });

        input.focus();
    }
}

function showRefused(host) {
    const panel = document.getElementById('refused-panel');
    const hostEl = document.getElementById('refused-host');
    if (!panel) return;

    panel.classList.remove('hidden');
    document.getElementById('context-action')?.classList.add('hidden');
    document.getElementById('toggle-quick-add')?.classList.add('hidden');
    if (hostEl) hostEl.textContent = host;
}

function showActivePass(grant) {
    const panel = document.getElementById('pass-panel');
    const detail = document.getElementById('pass-detail');
    const endBtn = document.getElementById('pass-end-btn');
    if (!panel) return;

    panel.classList.remove('hidden');

    const render = () => {
        const left = grant.expiresAt - Date.now();
        if (left <= 0) {
            panel.classList.add('hidden');
            return;
        }
        if (detail) detail.textContent = `${grant.host} (${formatCountdown(left)} remaining)`;
    };
    render();
    setInterval(render, 1000);

    if (endBtn) {
        endBtn.addEventListener('click', async () => {
            await sendMessage({ action: 'revokeTempPass', host: grant.host });
            panel.classList.add('hidden');
            if (currentTab) chrome.tabs.reload(currentTab.id);
            window.close();
        });
    }
}

/**
 * Detects if we should block a domain or a search keyword
 */
async function detectContext() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    if (!currentTab || !currentTab.url) return;

    let url;
    try {
        url = new URL(currentTab.url);
    } catch (e) {
        return;
    }

    const domain = url.hostname;
    const protocol = url.protocol;

    // 1. Check for system pages (chrome://, about:, edge://, etc.)
    const systemProtocols = ['chrome:', 'about:', 'edge:', 'brave:', 'view-source:', 'chrome-extension:'];
    if (systemProtocols.includes(protocol) || domain === 'chrome.google.com') {
        document.getElementById('context-action')?.classList.add('hidden');
        const displayName = document.getElementById('display-name');
        if (displayName) displayName.textContent = "System Protected Page";
        return;
    }

    // 2. Detect Google Search Keyword
    if (domain.includes('google.com') && url.pathname.includes('/search')) {
        const params = new URLSearchParams(url.search);
        const query = params.get('q');
        if (query) {
            currentContext = { type: 'keyword', value: query };
            const displayName = document.getElementById('display-name');
            const contextType = document.getElementById('context-type');
            const blockTypeLabel = document.getElementById('block-type-label');
            if (displayName) displayName.textContent = `"${query}"`;
            if (contextType) contextType.textContent = 'Search Keyword';
            if (blockTypeLabel) blockTypeLabel.textContent = 'Keyword';
            return;
        }
    }

    // 3. Default: Domain (strip leading www.)
    const cleanDomain = domain.replace(/^www\./i, '');
    currentContext = { type: 'domain', value: cleanDomain };
    const displayName = document.getElementById('display-name');
    const contextType = document.getElementById('context-type');
    const blockTypeLabel = document.getElementById('block-type-label');
    if (displayName) displayName.textContent = cleanDomain;
    if (contextType) contextType.textContent = 'Domain';
    if (blockTypeLabel) blockTypeLabel.textContent = 'Site';
}

function setupListeners() {
    // Open Settings
    const settingsBtn = document.getElementById('open-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }

    // Block Context Button
    const blockBtn = document.getElementById('block-btn');
    if (blockBtn) {
        blockBtn.addEventListener('click', async () => {
            const { type, value } = currentContext;
            if (!value) return;

            chrome.storage.local.get({
                CUSTOM_DOMAINS: [],
                CUSTOM_KEYWORDS: []
            }, (items) => {
                if (type === 'domain') {
                    if (!items.CUSTOM_DOMAINS.includes(value)) {
                        items.CUSTOM_DOMAINS.push(value);
                    }
                } else {
                    if (!items.CUSTOM_KEYWORDS.includes(value)) {
                        items.CUSTOM_KEYWORDS.push(value);
                    }
                }

                items.SETTINGS_REVISION = Date.now();
                chrome.storage.local.set(items, () => {
                    try { chrome.runtime.sendMessage({ action: 'publishSettings', revision: items.SETTINGS_REVISION }); } catch (e) {}
                    if (type === 'domain' && currentTab) {
                        const targetUrl = getBlockUrl(CONFIG.BLOCK_METHOD, value);
                        chrome.tabs.update(currentTab.id, { url: targetUrl });
                    } else if (currentTab) {
                        chrome.tabs.reload(currentTab.id);
                    }
                    window.close();
                });
            });
        });
    }

    // Quick Add Logic
    const saveBtn = document.getElementById('quick-save-btn');
    const quickInput = document.getElementById('quick-input');
    if (saveBtn) saveBtn.addEventListener('click', saveQuickAdd);
    if (quickInput) {
        quickInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') saveQuickAdd();
        });
    }
}

function saveQuickAdd() {
    const input = document.getElementById('quick-input');
    const saveBtn = document.getElementById('quick-save-btn');
    if (!input) return;
    let rawVal = input.value.trim().toLowerCase();
    if (!rawVal) return;

    // Detection: if it contains a dot and doesn't have spaces, it's likely a domain
    const isDomain = rawVal.includes('.') && !rawVal.includes(' ');
    const storageKey = isDomain ? 'CUSTOM_DOMAINS' : 'CUSTOM_KEYWORDS';

    if (isDomain) {
        let cleanVal = rawVal;
        let urlToParse = cleanVal;
        if (!/^https?:\/\//i.test(cleanVal)) {
            urlToParse = 'http://' + cleanVal;
        }
        try {
            const parsed = new URL(urlToParse);
            cleanVal = parsed.hostname;
        } catch (e) {
            cleanVal = cleanVal.split('/')[0];
        }

        cleanVal = cleanVal.replace(/^www\./i, '');

        const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9-]{2,})+$/;
        if (!domainPattern.test(cleanVal)) {
            input.value = '';
            input.placeholder = "Invalid domain format!";
            setTimeout(() => {
                input.placeholder = "Block domain or keyword...";
            }, 1800);
            return;
        }
        rawVal = cleanVal;
    }

    chrome.storage.local.get({
        CUSTOM_DOMAINS: [],
        CUSTOM_KEYWORDS: []
    }, (items) => {
        if (!items[storageKey].includes(rawVal)) {
            items[storageKey].push(rawVal);
            items.SETTINGS_REVISION = Date.now();
            chrome.storage.local.set(items, () => {
                try { chrome.runtime.sendMessage({ action: 'publishSettings', revision: items.SETTINGS_REVISION }); } catch (e) {}
                input.value = '';
                input.placeholder = "Added to blocklist!";
                if (saveBtn) {
                    saveBtn.textContent = "Added!";
                    setTimeout(() => {
                        saveBtn.textContent = "Add";
                    }, 1400);
                }
                setTimeout(() => {
                    input.placeholder = "Block domain or keyword...";
                }, 1400);
            });
        } else {
            input.value = '';
            input.placeholder = "Already on blocklist!";
            setTimeout(() => {
                input.placeholder = "Block domain or keyword...";
            }, 1800);
        }
    });
}

document.addEventListener('DOMContentLoaded', init);
