// options.js

const sections = {
    general: { title: "General Settings", subtitle: "Configure your core protection parameters." },
    lists: { title: "Blocked Destinations", subtitle: "Block entire websites, sections with child pages, or specific exact pages." },
    whitelist: { title: "Whitelist", subtitle: "Destinations that bypass every rule." },
    keywords: { title: "Blocked Keywords", subtitle: "Block URLs, search queries, and keystrokes matching specific terms." },
    scanning: { title: "Content Scanning", subtitle: "Catch explicit pages on unlisted sites using on-page text inspection." },
    reels: { title: "Reels & Shorts Blocker", subtitle: "Block short-form video feeds and all their child pages across social platforms." },
    settings: { title: "Settings", subtitle: "Manage cross-device sync, configuration backups, and dashboard security." },
    help: { title: "Help & Setup", subtitle: "Setting up shared settings, and locking the browser down so this cannot be walked around." }
};
sections.pages = sections.lists;
sections.friction = sections.general;
sections.security = sections.settings;

const LIST_BINDINGS = [
    { inputId: 'allowed-domain-input', btnId: 'add-allowed-domain-btn', listId: 'allowed-domain-list', stateKey: 'CUSTOM_ALLOWED_DOMAINS' },
    { inputId: 'scan-excluded-input', btnId: 'add-scan-excluded-btn', listId: 'scan-excluded-list', stateKey: 'CUSTOM_SCAN_EXCLUDED' }
];

let stagedImport = null;
let stagedWeakening = null;
let faviconMemoryCache = {};
let latestRevision = 0;

let state = {
    BLOCK_METHOD: 'blocked_page',
    CUSTOM_REDIRECT_URL: '',
    CUSTOM_DOMAINS: [],
    CUSTOM_KEYWORDS: [],
    CUSTOM_PAGE_KEYWORDS: [],
    CUSTOM_PAGES: [],
    CUSTOM_EXACT_PAGES: [],
    CUSTOM_ALLOWED_DOMAINS: [],
    CUSTOM_SCAN_EXCLUDED: [],
    SCAN_SENSITIVITY: 2,
    SCANNING_ENABLED: true,
    UNLOCK_PHRASE: '',
    WEAKENING_MESSAGE: '',
    ACTIVE_GAME_INDEX: -1,
    SECURITY_ENABLED: false,
    PASSWORD: '',
    THEME: 'system', // 'light', 'dark', 'system'
    COLOR_THEME: 'blue', // 'blue', 'pine', 'slate', 'monochrome'
    BYPASS_MODE: 'warning',
    SHOW_FAVICONS: false,
    REELS_BLOCKER_ENABLED: true,
    REELS_PLATFORMS: {
        instagram: true,
        youtube: true,
        facebook: true,
        tiktok: true
    }
};

async function init() {
    await loadConfig();
    await restore_options();
    
    // 0. Apply Theme & Color Theme
    applyTheme(state.THEME);
    setupThemeSelector();
    applyColorTheme(state.COLOR_THEME || 'blue');
    setupColorThemeSelector();

    // 1. Initial lock state
    if (state.SECURITY_ENABLED) {
        document.body.classList.add('is-locked');
    }

    // 2. Setup Gateway & Listeners
    handleSecurityGateway();
    setupNavigation();
    setupEnforcementCards();
    setupSecurityLogic();
    
    // 3. Populate dynamic elements
    populateGames();
    setupBlockedManager();
    setupKeywordManager();
    setupAllowedScopeDropdown();
    setupScanExcludedScopeDropdown();
    LIST_BINDINGS.forEach(b => setupListManager(b.inputId, b.btnId, b.listId, b.stateKey));

    const customUrlInput = document.getElementById('custom-redirect-input');
    const customUrlBtn = document.getElementById('save-custom-url-btn');
    if (customUrlBtn && customUrlInput) {
        const saveCustomUrl = () => {
            let val = customUrlInput.value.trim();
            if (val && !/^https?:\/\//i.test(val));
            state.CUSTOM_REDIRECT_URL = val;
            saveState();
            if (val) showToast('Custom URL saved.');
        };

        customUrlBtn.addEventListener('click', saveCustomUrl);
        customUrlInput.addEventListener('blur', saveCustomUrl);
        customUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') saveCustomUrl();
        });
    }

    // 4. Settings UI
    setupBypassModePicker();
    setupFaviconToggle();
    setupShortcutSetting();
    setupScanSettings();
    setupReelsManager();
    setupWeakeningSettings();
    setupImportOath();
    setupSyncStatus();
    renderAllLists();
    watchExternalChanges();

    // 5. Prevention: Tamper-proof the gateway and UI modals
    monitorUiTampering();

    // 6. Setup Import/Export Listeners
    setupBackupListeners();
    setupWeakeningModal();
    setupHelpSection();
}

// ------------------------------------------------------------------
// LISTS
// ------------------------------------------------------------------

function renderAllLists() {
    renderList('domain-list', 'CUSTOM_DOMAINS');
    renderList('keyword-list', 'CUSTOM_KEYWORDS');
    renderList('allowed-domain-list', 'CUSTOM_ALLOWED_DOMAINS');
    renderList('scan-excluded-list', 'CUSTOM_SCAN_EXCLUDED');
}

function setupScanSettings() {
    const phraseInput = document.getElementById('unlock-phrase');
    const phraseBtn = document.getElementById('save-unlock-phrase-btn');
    if (phraseInput) {
        phraseInput.value = state.UNLOCK_PHRASE || '';

        const savePhrase = () => {
            const value = phraseInput.value.trim();
            if (!value) {
                showToast('The phrase cannot be empty.');
                phraseInput.value = state.UNLOCK_PHRASE || '';
                return;
            }
            if (value === (state.UNLOCK_PHRASE || '')) return;
            state.UNLOCK_PHRASE = value;
            saveState();
        };

        phraseInput.addEventListener('blur', savePhrase);
        if (phraseBtn) {
            phraseBtn.addEventListener('click', () => {
                savePhrase();
                showToast('Unlock phrase saved.');
            });
        }
    }

    const sensitivity = String(state.SCAN_SENSITIVITY || 2);
    const selected = document.querySelector(`input[name="scanSensitivity"][value="${sensitivity}"]`);
    if (selected) selected.checked = true;

    document.querySelectorAll('input[name="scanSensitivity"]').forEach(input => {
        input.addEventListener('change', () => {
            state.SCAN_SENSITIVITY = parseInt(input.value, 10);
            saveState();
        });
    });

    const scanToggle = document.getElementById('content-scanning-toggle');
    if (scanToggle) {
        scanToggle.checked = state.SCANNING_ENABLED !== false;
        updateScanningSectionDimming(state.SCANNING_ENABLED !== false);

        scanToggle.addEventListener('change', () => {
            if (scanToggle.checked) {
                state.SCANNING_ENABLED = true;
                updateScanningSectionDimming(true);
                saveState();
                showToast('Content scanning enabled.');
            } else {
                scanToggle.checked = true;
                promptWeakeningWarning({ type: 'toggle_scan' });
            }
        });
    }
}

function updateScanningSectionDimming(enabled) {
    const sec = document.getElementById('section-scanning');
    if (sec) {
        sec.classList.toggle('is-dimmed', !enabled);
    }
}

// ------------------------------------------------------------------
// REELS & SHORTS BLOCKER MANAGER
// ------------------------------------------------------------------

function updateReelsUI() {
    const headerToggle = document.getElementById('reels-header-toggle');
    const reelsSection = document.getElementById('section-reels');
    const platformToggles = document.querySelectorAll('.platform-toggle');

    const isMasterEnabled = state.REELS_BLOCKER_ENABLED !== false;
    if (headerToggle) headerToggle.checked = isMasterEnabled;
    if (reelsSection) reelsSection.classList.toggle('is-dimmed', !isMasterEnabled);

    const platforms = state.REELS_PLATFORMS || {};
    platformToggles.forEach(toggle => {
        const platform = toggle.getAttribute('data-platform');
        const isPlatformEnabled = platforms[platform] !== false;
        toggle.checked = isPlatformEnabled;
    });
}

function setupReelsManager() {
    const headerToggle = document.getElementById('reels-header-toggle');
    const platformToggles = document.querySelectorAll('.platform-toggle');

    updateReelsUI();

    if (headerToggle) {
        headerToggle.addEventListener('change', () => {
            state.REELS_BLOCKER_ENABLED = headerToggle.checked;
            updateReelsUI();
            saveState();
            showToast(headerToggle.checked ? 'Reels & Shorts Blocker enabled.' : 'Reels & Shorts Blocker paused.');
        });
    }

    platformToggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            const platform = toggle.getAttribute('data-platform');
            if (!state.REELS_PLATFORMS) state.REELS_PLATFORMS = {};
            state.REELS_PLATFORMS[platform] = toggle.checked;

            saveState();
            const name = toggle.closest('.reels-row')?.querySelector('.reels-platform-name')?.textContent || platform;
            showToast(`${name} ${toggle.checked ? 'enabled' : 'disabled'}.`);
        });
    });
}

// ------------------------------------------------------------------
// SHARED SETTINGS STATUS
// ------------------------------------------------------------------

function setupSyncStatus() {
    const refreshBtn = document.getElementById('sync-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'reconcileSettings' }, () => {
                renderSyncStatus();
                showToast('Settings checked across all stores.');
            });
        });
    }
    renderSyncStatus();
}

function renderSyncStatus() {
    chrome.runtime.sendMessage({ action: 'getSyncStatus' }, (response) => {
        const status = response && response.status;
        if (!status) return;

        const accountDot = document.getElementById('sync-account-dot');
        if (accountDot) accountDot.className = 'sync-dot on';

        const fileDot = document.getElementById('sync-file-dot');
        const fileDesc = document.getElementById('sync-file-desc');
        if (fileDot && fileDesc) {
            if (status.file.available) {
                fileDot.className = 'sync-dot on';
                fileDesc.textContent = status.file.path || 'Active on this machine.';
            } else {
                fileDot.className = 'sync-dot off';
                fileDesc.textContent = 'Not set up. Run native/install.py once to share settings '
                    + 'with every profile on this machine, including ones on other accounts.';
            }
        }

        const revision = document.getElementById('sync-revision');
        if (revision) {
            revision.textContent = status.revision
                ? `Last change ${new Date(status.revision).toLocaleString()}`
                : 'No changes recorded yet';
        }
    });
}

// ------------------------------------------------------------------
// WARNING-MESSAGE FRICTION
// ------------------------------------------------------------------
// A change that loosens protection is never applied silently: the user's
// own message pops up and the change applies the moment it is confirmed.
// No timer and nothing to retype anywhere in that path.

const LIST_LABELS = {
    CUSTOM_DOMAINS: 'Blocked Destinations',
    CUSTOM_KEYWORDS: 'Keywords',
    CUSTOM_PAGE_KEYWORDS: 'Page-Only Keywords',
    CUSTOM_PAGES: 'Blocked Destinations',
    CUSTOM_EXACT_PAGES: 'Blocked Destinations',
    CUSTOM_ALLOWED_DOMAINS: 'Whitelist',
    CUSTOM_SCAN_EXCLUDED: 'Scan Exclusions'
};

function describeWeakeningAction(staged) {
    if (staged.type === 'switch_mode') {
        const modeLabel = staged.targetMode === 'retype' ? 'Retype Phrase' : 'Warning Message';
        return `You are switching your verification mode to ${modeLabel}.`;
    }
    if (staged.type === 'toggle_scan') {
        return 'You are turning off live content scanning. Explicit pages on unlisted sites will no longer be detected or blocked.';
    }
    if (staged.op === 'remove') {
        const label = LIST_LABELS[staged.stateKey] || staged.stateKey;
        return `You are removing "${staged.value}" from ${label}. This weakens your protection.`;
    }
    if (staged.stateKey === 'CUSTOM_ALLOWED_DOMAINS') {
        return `You are adding "${staged.value}" to the whitelist. It will bypass every blocking rule, but will still be scanned by the live scanner.`;
    }
    return `You are exempting "${staged.value}" from content scanning.`;
}

function getConfirmButtonLabel(staged) {
    if (!staged) return 'Yes, apply change';
    if (staged.type === 'switch_mode') {
        const target = staged.targetMode === 'retype' ? 'Retype Phrase' : 'Warning Message';
        return `Yes, switch to ${target}`;
    }
    if (staged.type === 'toggle_scan') {
        return 'Yes, turn off scanning';
    }
    if (staged.op === 'remove') {
        return 'Yes, remove item';
    }
    if (staged.stateKey === 'CUSTOM_ALLOWED_DOMAINS') {
        return 'Yes, add to whitelist';
    }
    if (staged.stateKey === 'CUSTOM_SCAN_EXCLUDED') {
        return 'Yes, exempt from scanning';
    }
    return 'Yes, apply change';
}

function promptWeakeningWarning(staged) {
    stagedWeakening = staged;

    const modal = document.getElementById('weakening-modal');
    const textEl = document.getElementById('weakening-warning-text');
    const retypeWrap = document.getElementById('weakening-retype-wrap');
    const retypePhraseEl = document.getElementById('weakening-retype-phrase');
    const retypeInput = document.getElementById('weakening-retype-input');
    const proceedBtn = document.getElementById('weakening-proceed-btn');

    if (!modal) {
        applyWeakeningChange(staged);
        stagedWeakening = null;
        return;
    }

    if (proceedBtn) {
        proceedBtn.textContent = getConfirmButtonLabel(staged);
    }

    const isRetypeMode = state.BYPASS_MODE === 'retype';
    if (isRetypeMode) {
        if (textEl) textEl.classList.add('hidden');
        if (retypeWrap) {
            retypeWrap.classList.remove('hidden');
            const requiredPhrase = (state.UNLOCK_PHRASE || CONFIG.UNLOCK_PHRASE || 'I am choosing to break my own rule').trim();
            if (retypePhraseEl) retypePhraseEl.textContent = requiredPhrase;
            if (retypeInput && proceedBtn) {
                retypeInput.value = '';
                proceedBtn.disabled = true;
                const normalize = (text) => (text || '').trim().replace(/\s+/g, ' ').toLowerCase();
                retypeInput.oninput = () => {
                    proceedBtn.disabled = normalize(retypeInput.value) !== normalize(requiredPhrase);
                };
                retypeInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!proceedBtn.disabled) {
                            proceedBtn.click();
                        }
                    }
                };
                setTimeout(() => retypeInput.focus(), 50);
            }
        }
    } else {
        if (textEl) {
            textEl.classList.remove('hidden');
            const message = (state.WEAKENING_MESSAGE || CONFIG.WEAKENING_MESSAGE || '').trim()
                || 'Remember why you set this protection up.';
            textEl.textContent = message;
        }
        if (retypeWrap) retypeWrap.classList.add('hidden');
        if (proceedBtn) proceedBtn.disabled = false;
    }

    modal.classList.remove('hidden');
}

function hideWeakeningModal() {
    const modal = document.getElementById('weakening-modal');
    if (modal) modal.classList.add('hidden');

    const textEl = document.getElementById('weakening-warning-text');
    if (textEl) textEl.classList.remove('hidden');

    const retypeWrap = document.getElementById('weakening-retype-wrap');
    if (retypeWrap) retypeWrap.classList.add('hidden');

    const retypeInput = document.getElementById('weakening-retype-input');
    if (retypeInput) {
        retypeInput.value = '';
        retypeInput.oninput = null;
        retypeInput.onkeydown = null;
    }
    const proceedBtn = document.getElementById('weakening-proceed-btn');
    if (proceedBtn) {
        proceedBtn.disabled = false;
        proceedBtn.textContent = 'Yes, apply change';
    }

    if (stagedWeakening && stagedWeakening.type === 'toggle_scan') {
        const toggle = document.getElementById('content-scanning-toggle');
        if (toggle) toggle.checked = true;
    }
    stagedWeakening = null;
}

function applyWeakeningChange(staged) {
    if (staged.type === 'switch_mode') {
        state.BYPASS_MODE = staged.targetMode;
        saveState();
        updateBypassModeUI();
        const modeLabel = staged.targetMode === 'retype' ? 'Retype Phrase' : 'Warning Message';
        showToast(`Verification mode switched to ${modeLabel}.`);
        return;
    }
    if (staged.type === 'toggle_scan') {
        state.SCANNING_ENABLED = false;
        const toggle = document.getElementById('content-scanning-toggle');
        if (toggle) toggle.checked = false;
        updateScanningSectionDimming(false);
        saveState();
        showToast('Content scanning disabled.');
        return;
    }
    const { listId, stateKey, value, op } = staged;
    if (op === 'add') {
        if (state[stateKey].includes(value)) return;
        state[stateKey].push(value);
        const host = getItemHost(stateKey, value);
        if (host) expandedGroups.add(`${listId}-${host}`);
    } else {
        const index = state[stateKey].indexOf(value);
        if (index === -1) return;
        state[stateKey].splice(index, 1);
    }
    renderList(listId, stateKey);
    saveState();
}

function setupWeakeningModal() {
    const proceedBtn = document.getElementById('weakening-proceed-btn');
    const goBackBtn = document.getElementById('weakening-goback-btn');
    const modal = document.getElementById('weakening-modal');

    if (proceedBtn) {
        proceedBtn.addEventListener('click', () => {
            if (!stagedWeakening) return hideWeakeningModal();
            const staged = stagedWeakening;
            hideWeakeningModal();
            applyWeakeningChange(staged);
            showToast('Change applied.');
        });
    }

    if (goBackBtn) {
        goBackBtn.addEventListener('click', () => {
            hideWeakeningModal();
            showToast('Nothing changed: protection stays as it was.');
        });
    }

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideWeakeningModal();
                showToast('Nothing changed: protection stays as it was.');
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            hideWeakeningModal();
            showToast('Nothing changed: protection stays as it was.');
        }
    });
}

function setupWeakeningSettings() {
    const messageInput = document.getElementById('weakening-message');
    const saveBtn = document.getElementById('save-weakening-message-btn');
    if (messageInput) {
        messageInput.value = state.WEAKENING_MESSAGE || '';

        const saveMessage = () => {
            const value = messageInput.value.trim();
            if (value === (state.WEAKENING_MESSAGE || '')) return;
            state.WEAKENING_MESSAGE = value;
            saveState();
        };

        messageInput.addEventListener('blur', saveMessage);
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                saveMessage();
                showToast('Warning message saved.');
            });
        }
    }
}

function updateBypassModeUI() {
    const currentMode = state.BYPASS_MODE || 'warning';

    // Update radio cards
    document.querySelectorAll('input[name="bypassMode"]').forEach(radio => {
        radio.checked = radio.value === currentMode;
    });

    // Toggle corresponding input group visibility: ONLY the active mode's input is shown
    const warningGroup = document.getElementById('group-warning-message');
    if (warningGroup) {
        warningGroup.style.display = currentMode === 'warning' ? 'block' : 'none';
    }

    const retypeGroup = document.getElementById('group-unlock-phrase');
    if (retypeGroup) {
        retypeGroup.style.display = currentMode === 'retype' ? 'block' : 'none';
    }
}

function setupBypassModePicker() {
    updateBypassModeUI();
    document.querySelectorAll('input[name="bypassMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const targetMode = radio.value;
            const currentMode = state.BYPASS_MODE || 'warning';
            if (targetMode === currentMode) return;

            // Revert radio button state visually while modal prompt is pending
            radio.checked = false;
            const activeRadio = document.querySelector(`input[name="bypassMode"][value="${currentMode}"]`);
            if (activeRadio) activeRadio.checked = true;

            promptWeakeningWarning({
                type: 'switch_mode',
                targetMode
            });
        });
    });
}

/**
 * Changes to storage land from the sync reconciliation too, so mirror any
 * change back into the dashboard.
 */
function watchExternalChanges() {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        let dirty = false;

        const monitoredKeys = [
            'CUSTOM_DOMAINS', 'CUSTOM_PAGES', 'CUSTOM_EXACT_PAGES',
            ...LIST_BINDINGS.map(b => b.stateKey)
        ];
        monitoredKeys.forEach((stateKey) => {
            if (changes[stateKey]) {
                state[stateKey] = changes[stateKey].newValue || [];
                dirty = true;
            }
        });

        if (changes.BYPASS_MODE) {
            state.BYPASS_MODE = changes.BYPASS_MODE.newValue || 'warning';
            updateBypassModeUI();
        }

        if (changes.SHOW_FAVICONS) {
            state.SHOW_FAVICONS = changes.SHOW_FAVICONS.newValue === true;
            const faviconToggle = document.getElementById('show-favicons-toggle');
            if (faviconToggle) faviconToggle.checked = state.SHOW_FAVICONS;
            dirty = true;
        }

        if (changes.FAVICON_CACHE) {
            const newCache = changes.FAVICON_CACHE.newValue || {};
            faviconMemoryCache = Object.assign(faviconMemoryCache, newCache);
            updateFaviconsInPlace(newCache);
        }

        if (changes.SETTINGS_REVISION && typeof changes.SETTINGS_REVISION.newValue === 'number') {
            latestRevision = Math.max(latestRevision, changes.SETTINGS_REVISION.newValue);
        }

        if (dirty) renderAllLists();
    });
}

/**
 * Ensures the security gateway and the weakening warning modal cannot be
 * deleted, hidden, or bypassed via DevTools.
 */
function monitorUiTampering() {
    const checkIntegrity = () => {
        // 1. Security Gateway Lock Integrity
        if (state.SECURITY_ENABLED) {
            const gateway = document.getElementById('security-gateway');
            const isLocked = document.body.classList.contains('is-locked');

            if (!window._dashUnlocked && state.PASSWORD) {
                if (!isLocked) {
                    document.body.classList.add('is-locked');
                }
                if (!gateway || !document.body.contains(gateway)) {
                    window.location.reload();
                    return;
                }
                const style = window.getComputedStyle(gateway);
                if (gateway.classList.contains('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') {
                    window.location.reload();
                    return;
                }
            }
        }

        // 2. Weakening Warning Modal Tamper Protection
        if (stagedWeakening) {
            const weakeningModal = document.getElementById('weakening-modal');
            if (!weakeningModal || !document.body.contains(weakeningModal)) {
                stagedWeakening = null;
                return;
            }
            const style = window.getComputedStyle(weakeningModal);
            if (weakeningModal.classList.contains('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                stagedWeakening = null;
            }
        }
    };

    const observer = new MutationObserver(() => {
        checkIntegrity();
    });

    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            attributes: true,
            subtree: true,
            attributeFilter: ['class', 'style', 'hidden', 'type']
        });
    }

    // Continuous heartbeat ticker to prevent DevTools breakpoint/pause bypasses
    setInterval(checkIntegrity, 400);
}

function handleSecurityGateway() {
    const gateway = document.getElementById('security-gateway');
    const title = document.getElementById('gateway-title');
    const desc = document.getElementById('gateway-desc');
    const unlockBtn = document.getElementById('gateway-unlock-btn');
    const passInput = document.getElementById('gateway-password');
    const errorMsg = document.getElementById('gateway-error');

    if (!gateway) return;

    if (!state.SECURITY_ENABLED) {
        gateway.classList.add('hidden');
        document.body.classList.remove('is-locked');
        return;
    }

    if (!state.PASSWORD) {
        if (title) title.textContent = "Setup Security";
        if (desc) desc.textContent = "Please set an initial password for your dashboard.";
        if (unlockBtn) unlockBtn.textContent = "Set & Unlock";
    }

    gateway.classList.remove('hidden');

    const attemptUnlock = () => {
        const input = passInput ? passInput.value : '';
        if (!state.PASSWORD) {
            if (input.length < 1) return;
            state.PASSWORD = input;
            saveState();
            unlock();
        } else if (input === state.PASSWORD) {
            unlock();
        } else {
            if (errorMsg) errorMsg.classList.remove('hidden');
        }
    };

    const unlock = () => {
        window._dashUnlocked = true;
        gateway.classList.add('hidden');
        document.body.classList.remove('is-locked');
        if (errorMsg) errorMsg.classList.add('hidden');
    };

    if (unlockBtn) unlockBtn.addEventListener('click', attemptUnlock);
    if (passInput) {
        passInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptUnlock();
        });
    }
}

function setupSecurityLogic() {
    const toggle = document.getElementById('security-toggle');
    const setupBox = document.getElementById('password-management');
    const updateBtn = document.getElementById('set-password-btn');
    const newPassInput = document.getElementById('new-password');

    if (toggle) {
        toggle.checked = state.SECURITY_ENABLED;
        toggle.addEventListener('change', () => {
            state.SECURITY_ENABLED = toggle.checked;
            if (setupBox) {
                if (state.SECURITY_ENABLED) {
                    setupBox.classList.remove('hidden');
                } else {
                    setupBox.classList.add('hidden');
                }
            }
            saveState();
        });
    }

    if (state.SECURITY_ENABLED && setupBox) setupBox.classList.remove('hidden');

    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            const pass = newPassInput ? newPassInput.value : '';
            if (pass) {
                state.PASSWORD = pass;
                saveState();
                showToast('Password updated successfully.');
                if (newPassInput) newPassInput.value = '';
            }
        });
    }
}

function applyTheme(theme) {
    state.THEME = theme;
    document.body.setAttribute('data-user-theme', theme);
    
    // Update button active state
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
    });
}

function setupThemeSelector() {
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            applyTheme(theme);
            saveState();
        });
    });
}

function applyColorTheme(colorTheme) {
    const validThemes = ['blue', 'pine', 'slate', 'monochrome'];
    const chosen = validThemes.includes(colorTheme) ? colorTheme : 'blue';
    state.COLOR_THEME = chosen;
    document.body.setAttribute('data-color-theme', chosen);
    
    // Sync matching radio input
    const radio = document.querySelector(`input[name="colorTheme"][value="${chosen}"]`);
    if (radio) {
        radio.checked = true;
    }

    if (typeof updateDynamicActionIcon === 'function') {
        updateDynamicActionIcon(chosen);
    }
    if (typeof updatePageFavicon === 'function') {
        updatePageFavicon(chosen);
    }
}

function getColorThemeLabel(value) {
    switch (value) {
        case 'pine': return 'Boreal Pine';
        case 'slate': return 'Nordic Slate';
        case 'monochrome': return 'Monochrome Slate';
        case 'blue':
        default: return 'Electric Blue';
    }
}

function setupColorThemeSelector() {
    document.querySelectorAll('input[name="colorTheme"]').forEach(input => {
        input.addEventListener('change', () => {
            if (input.checked) {
                applyColorTheme(input.value);
                saveState();
                showToast(`Theme color switched to ${getColorThemeLabel(input.value)}.`);
            }
        });
    });
}

function setupFaviconToggle() {
    const toggle = document.getElementById('show-favicons-toggle');
    if (!toggle) return;
    toggle.checked = state.SHOW_FAVICONS === true;

    toggle.addEventListener('change', () => {
        state.SHOW_FAVICONS = toggle.checked;
        saveState();
        renderAllLists();
        showToast(state.SHOW_FAVICONS ? 'Website favicons enabled.' : 'Website favicons disabled.');
    });
}

function setupShortcutSetting() {
    const toggle = document.getElementById('dashboard-shortcut-toggle');
    if (!toggle) return;

    chrome.storage.local.get({ DASHBOARD_SHORTCUT_ENABLED: true }, (res) => {
        toggle.checked = res.DASHBOARD_SHORTCUT_ENABLED !== false;
    });

    toggle.addEventListener('change', () => {
        const enabled = toggle.checked;
        chrome.storage.local.set({ DASHBOARD_SHORTCUT_ENABLED: enabled }, () => {
            showToast(enabled ? 'Dashboard shortcut (Alt+S) enabled' : 'Dashboard shortcut disabled');
        });
    });

    window.addEventListener('keydown', (e) => {
        if (toggle.checked && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            window.open(location.href, '_blank');
        }
    });
}

function saveState() {
    const activeGameRadio = document.querySelector('input[name="activeGame"]:checked');
    state.ACTIVE_GAME_INDEX = activeGameRadio ? parseInt(activeGameRadio.value) : -1;

    latestRevision = Math.max(Date.now(), (typeof latestRevision === 'number' ? latestRevision : 0) + 1);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
            BLOCK_METHOD: state.BLOCK_METHOD,
            CUSTOM_REDIRECT_URL: state.CUSTOM_REDIRECT_URL,
            CUSTOM_DOMAINS: state.CUSTOM_DOMAINS,
            CUSTOM_KEYWORDS: state.CUSTOM_KEYWORDS,
            CUSTOM_PAGE_KEYWORDS: state.CUSTOM_PAGE_KEYWORDS,
            CUSTOM_PAGES: state.CUSTOM_PAGES,
            CUSTOM_EXACT_PAGES: state.CUSTOM_EXACT_PAGES,
            CUSTOM_ALLOWED_DOMAINS: state.CUSTOM_ALLOWED_DOMAINS,
            CUSTOM_SCAN_EXCLUDED: state.CUSTOM_SCAN_EXCLUDED,
            SCAN_SENSITIVITY: state.SCAN_SENSITIVITY,
            SCANNING_ENABLED: state.SCANNING_ENABLED,
            UNLOCK_PHRASE: state.UNLOCK_PHRASE,
            WEAKENING_MESSAGE: state.WEAKENING_MESSAGE,
            ACTIVE_GAME_INDEX: state.ACTIVE_GAME_INDEX,
            SECURITY_ENABLED: state.SECURITY_ENABLED,
            PASSWORD: state.PASSWORD,
            THEME: state.THEME,
            COLOR_THEME: state.COLOR_THEME || 'blue',
            BYPASS_MODE: state.BYPASS_MODE || 'warning',
            SHOW_FAVICONS: state.SHOW_FAVICONS === true,
            REELS_BLOCKER_ENABLED: state.REELS_BLOCKER_ENABLED !== false,
            REELS_PLATFORMS: state.REELS_PLATFORMS,
            SETTINGS_REVISION: latestRevision
        }, () => {
            if (!chrome.runtime.lastError) {
                showToast('Settings auto-saved.');
            }
        });
    }

    try {
        chrome.runtime.sendMessage({ action: 'publishSettings', revision: latestRevision }, () => {
            if (chrome.runtime.lastError) {
                // Ignore transient channel closes during background worker sleep or restarts
            }
        });
    } catch (e) {
        console.warn('[BlockX] Could not publish settings to background:', e);
    }
}

function setupNavigation() {
    // Attach to all nav links that declare a data-section.
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            const sectionId = link.getAttribute('data-section');
            if (!sections[sectionId]) return;
            e.preventDefault();

            document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            const titleEl = document.getElementById('page-title');
            const subEl = document.getElementById('page-subtitle');
            if (titleEl) titleEl.textContent = sections[sectionId].title;
            if (subEl) subEl.textContent = sections[sectionId].subtitle;

            document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
            const targetSec = document.getElementById(`section-${sectionId}`);
            if (targetSec) targetSec.classList.add('active');

            const scanToggleContainer = document.getElementById('scanning-header-toggle-container');
            if (scanToggleContainer) {
                scanToggleContainer.style.display = (sectionId === 'scanning') ? 'flex' : 'none';
            }

            const reelsToggleContainer = document.getElementById('reels-header-toggle-container');
            if (reelsToggleContainer) {
                reelsToggleContainer.style.display = (sectionId === 'reels') ? 'flex' : 'none';
            }
        });
    });

    if (window.location.hash) {
        const hashSection = window.location.hash.replace('#', '');
        const targetNav = document.querySelector(`.nav-link[data-section="${hashSection}"]`);
        if (targetNav) targetNav.click();
    }

    const initialSection = document.querySelector('.settings-section.active');
    const scanToggleContainer = document.getElementById('scanning-header-toggle-container');
    if (scanToggleContainer && initialSection) {
        scanToggleContainer.style.display = (initialSection.id === 'section-scanning') ? 'flex' : 'none';
    }
    const reelsToggleContainer = document.getElementById('reels-header-toggle-container');
    if (reelsToggleContainer && initialSection) {
        reelsToggleContainer.style.display = (initialSection.id === 'section-reels') ? 'flex' : 'none';
    }
}

function updateHubVisibility(method) {
    const gameSection = document.getElementById('game-selection');
    const urlSection = document.getElementById('custom-url-selection');
    if (gameSection) {
        if (method === 'blocked_page') gameSection.classList.remove('hidden');
        else gameSection.classList.add('hidden');
    }
    if (urlSection) {
        if (method === 'custom_url') urlSection.classList.remove('hidden');
        else urlSection.classList.add('hidden');
    }
}

function setupEnforcementCards() {
    const inputs = document.querySelectorAll('input[name="blockMethod"]');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            state.BLOCK_METHOD = input.value;
            updateHubVisibility(input.value);
            saveState();
        });
    });
}

function setupBlockedManager() {
    const input = document.getElementById('domain-input');
    const btn = document.getElementById('add-domain-btn');
    const dropdown = document.getElementById('blocked-scope-dropdown');
    const trigger = document.getElementById('blocked-scope-trigger');
    const labelEl = document.getElementById('blocked-scope-label');
    const menu = document.getElementById('blocked-scope-menu');
    const scopeVal = document.getElementById('blocked-scope-value');
    const listId = 'domain-list';

    if (!input || !btn) return;

    let userChanged = false;

    const setScope = (val, fromUser = true) => {
        if (scopeVal) scopeVal.value = val;
        if (fromUser) {
            userChanged = (val !== 'auto');
            try { chrome.storage.local.set({ BLOCKED_SCOPE_PREF: val }); } catch (e) {}
        }
        if (menu) {
            menu.querySelectorAll('.dropdown-item').forEach(item => {
                const match = item.getAttribute('data-value') === val;
                item.classList.toggle('active', match);
                item.setAttribute('aria-selected', match ? 'true' : 'false');
                if (match && labelEl) {
                    const title = item.querySelector('.dropdown-item-title');
                    labelEl.textContent = title ? title.textContent : item.textContent.trim();
                }
            });
        }
    };

    try {
        chrome.storage.local.get(['BLOCKED_SCOPE_PREF'], (res) => {
            if (res && res.BLOCKED_SCOPE_PREF) {
                setScope(res.BLOCKED_SCOPE_PREF, true);
            }
        });
    } catch (e) {}

    if (dropdown && trigger && menu) {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown.is-open').forEach(d => {
                if (d !== dropdown) d.classList.remove('is-open');
            });
            const isOpen = dropdown.classList.toggle('is-open');
            trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        menu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = item.getAttribute('data-value');
                setScope(val, true);
                dropdown.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
                input.focus();
            });
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dropdown.classList.contains('is-open')) {
                dropdown.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
        });
    }

    input.addEventListener('input', () => {
        const val = input.value.trim();
        if (userChanged) return;
        if (/\/\*|\*$/.test(val)) {
            setScope('children', false);
        } else if (scopeVal && scopeVal.value === 'children' && !val.includes('*')) {
            setScope('domain', false);
        }
    });

    const addBlocked = () => {
        const rawInput = input.value.trim();
        if (!rawInput) return;

        let scope = scopeVal ? scopeVal.value : 'domain';
        if (scope === 'auto') {
            if (/\/\*|\*$/.test(rawInput)) {
                scope = 'children';
            } else {
                let testUrl = rawInput;
                if (!/^https?:\/\//i.test(testUrl)) testUrl = 'http://' + testUrl;
                try {
                    const parsed = new URL(testUrl);
                    if ((parsed.pathname === '/' || !parsed.pathname) && !parsed.search) {
                        scope = 'domain';
                    } else {
                        scope = 'exact';
                    }
                } catch {
                    scope = 'domain';
                }
            }
        }

        if (scope === 'domain') {
            let cleanVal = rawInput;
            let urlToParse = cleanVal;
            if (!/^https?:\/\//i.test(cleanVal)) urlToParse = 'http://' + cleanVal;
            try {
                const parsed = new URL(urlToParse);
                cleanVal = parsed.hostname;
            } catch {
                cleanVal = cleanVal.split('/')[0].split('?')[0].split('#')[0];
            }
            cleanVal = cleanVal.replace(/^www\./i, '').toLowerCase();

            const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9-]{2,})+$/;
            if (!domainPattern.test(cleanVal)) {
                showToast("Invalid domain format! Must be e.g. facebook.com");
                return;
            }

            if (state.CUSTOM_ALLOWED_DOMAINS && state.CUSTOM_ALLOWED_DOMAINS.includes(cleanVal)) {
                showToast("This domain is in your whitelist. Remove it there first.");
                return;
            }

            if (state.CUSTOM_DOMAINS.includes(cleanVal)) {
                showToast("Domain is already in your blocklist.");
                return;
            }

            state.CUSTOM_DOMAINS.push(cleanVal);
            expandedGroups.add(`${listId}-${cleanVal}`);
            input.value = '';
            renderList(listId, 'CUSTOM_DOMAINS');
            saveState();
            showToast(`Blocked domain: ${cleanVal}`);
            return;
        }

        if (scope === 'children') {
            let cleanVal = rawInput.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
            cleanVal = cleanVal.replace(/\/?\*+$/, '').replace(/\/+$/, '');
            if (!cleanVal) return;

            if (!cleanVal.includes('/')) {
                if (state.CUSTOM_DOMAINS.includes(cleanVal)) {
                    showToast("Domain is already in your blocklist.");
                    return;
                }
                state.CUSTOM_DOMAINS.push(cleanVal);
                expandedGroups.add(`${listId}-${cleanVal}`);
                input.value = '';
                renderList(listId, 'CUSTOM_DOMAINS');
                saveState();
                showToast(`Blocked domain: ${cleanVal}`);
                return;
            }

            if (state.CUSTOM_PAGES.includes(cleanVal)) {
                showToast("Path is already in your blocklist.");
                return;
            }

            state.CUSTOM_PAGES.push(cleanVal);
            const host = getItemHost('CUSTOM_PAGES', cleanVal);
            if (host) expandedGroups.add(`${listId}-${host}`);
            input.value = '';
            renderList(listId, 'CUSTOM_PAGES');
            saveState();
            showToast(`Blocked with child pages: ${cleanVal}/*`);
            return;
        }

        if (scope === 'exact') {
            let cleanVal = rawInput.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
            if (cleanVal.endsWith('/') && !cleanVal.includes('?')) {
                cleanVal = cleanVal.slice(0, -1);
            }
            if (!cleanVal) return;

            if (state.CUSTOM_EXACT_PAGES.includes(cleanVal)) {
                showToast("Exact page is already in your blocklist.");
                return;
            }

            state.CUSTOM_EXACT_PAGES.push(cleanVal);
            const host = getItemHost('CUSTOM_EXACT_PAGES', cleanVal);
            if (host) expandedGroups.add(`${listId}-${host}`);
            input.value = '';
            renderList(listId, 'CUSTOM_EXACT_PAGES');
            saveState();
            showToast(`Blocked exact page: ${cleanVal}`);
            return;
        }
    };

    btn.addEventListener('click', addBlocked);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addBlocked();
    });
}

function setupKeywordManager() {
    const input = document.getElementById('keyword-input');
    const btn = document.getElementById('add-keyword-btn');
    const dropdown = document.getElementById('keyword-scope-dropdown');
    const trigger = document.getElementById('keyword-scope-trigger');
    const labelEl = document.getElementById('keyword-scope-label');
    const menu = document.getElementById('keyword-scope-menu');
    const scopeVal = document.getElementById('keyword-scope-value');

    if (!input || !btn) return;

    if (dropdown && trigger && menu && scopeVal) {
        const setScope = (val, savePref = true) => {
            scopeVal.value = val;
            if (savePref) {
                try { chrome.storage.local.set({ KEYWORD_SCOPE_PREF: val }); } catch (e) {}
            }
            menu.querySelectorAll('.dropdown-item').forEach(item => {
                const match = item.getAttribute('data-value') === val;
                item.classList.toggle('active', match);
                item.setAttribute('aria-selected', match ? 'true' : 'false');
                if (match && labelEl) {
                    const title = item.querySelector('.dropdown-item-title');
                    labelEl.textContent = title ? title.textContent : item.textContent.trim();
                }
            });
        };

        try {
            chrome.storage.local.get(['KEYWORD_SCOPE_PREF'], (res) => {
                if (res && res.KEYWORD_SCOPE_PREF) {
                    setScope(res.KEYWORD_SCOPE_PREF, false);
                }
            });
        } catch (e) {}

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown.is-open').forEach(d => {
                if (d !== dropdown) d.classList.remove('is-open');
            });
            const isOpen = dropdown.classList.toggle('is-open');
            trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        menu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                setScope(item.getAttribute('data-value'), true);
                dropdown.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
                input.focus();
            });
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dropdown.classList.contains('is-open')) {
                dropdown.classList.remove('is-open');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
        });
    }

    const addKeyword = () => {
        let val = input.value.trim().toLowerCase();
        if (!val) return;

        const scope = scopeVal ? scopeVal.value : 'both';
        const targetKey = scope === 'page' ? 'CUSTOM_PAGE_KEYWORDS' : 'CUSTOM_KEYWORDS';

        if (state[targetKey] && state[targetKey].includes(val)) {
            showToast('Keyword is already in your list.');
            return;
        }

        if (!state[targetKey]) {
            state[targetKey] = [];
        }

        state[targetKey].push(val);
        input.value = '';
        renderList('keyword-list', targetKey);
        saveState();

        const typeLabel = scope === 'page' ? 'Page only' : 'URL & Page';
        showToast(`Added keyword (${typeLabel}): ${val}`);
    };

    btn.addEventListener('click', addKeyword);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addKeyword();
    });
}

function setupAllowedScopeDropdown() {
    const dropdown = document.getElementById('allowed-scope-dropdown');
    const trigger = document.getElementById('allowed-scope-trigger');
    const labelEl = document.getElementById('allowed-scope-label');
    const menu = document.getElementById('allowed-scope-menu');
    const scopeVal = document.getElementById('allowed-scope-value');
    const input = document.getElementById('allowed-domain-input');

    if (!dropdown || !trigger || !menu || !scopeVal) return;

    let userChanged = false;

    const setScope = (val, fromUser = true) => {
        scopeVal.value = val;
        if (fromUser) {
            userChanged = (val !== 'auto');
            try { chrome.storage.local.set({ ALLOWED_SCOPE_PREF: val }); } catch (e) {}
        }
        menu.querySelectorAll('.dropdown-item').forEach(item => {
            const match = item.getAttribute('data-value') === val;
            item.classList.toggle('active', match);
            item.setAttribute('aria-selected', match ? 'true' : 'false');
            if (match && labelEl) {
                const title = item.querySelector('.dropdown-item-title');
                labelEl.textContent = title ? title.textContent : item.textContent.trim();
            }
        });
    };

    try {
        chrome.storage.local.get(['ALLOWED_SCOPE_PREF'], (res) => {
            if (res && res.ALLOWED_SCOPE_PREF) {
                setScope(res.ALLOWED_SCOPE_PREF, true);
            }
        });
    } catch (e) {}

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown.is-open').forEach(d => {
            if (d !== dropdown) d.classList.remove('is-open');
        });
        const isOpen = dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            setScope(item.getAttribute('data-value'), true);
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            if (input) input.focus();
        });
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dropdown.classList.contains('is-open')) {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
        }
    });

    if (input) {
        input.addEventListener('input', () => {
            const val = input.value.trim();
            if (userChanged) return;
            if (/\/\*|\*$/.test(val)) {
                setScope('children', false);
            } else if (scopeVal.value === 'children' && !val.includes('*')) {
                setScope('domain', false);
            }
        });
    }
}

function setupScanExcludedScopeDropdown() {
    const dropdown = document.getElementById('scan-excluded-scope-dropdown');
    const trigger = document.getElementById('scan-excluded-scope-trigger');
    const labelEl = document.getElementById('scan-excluded-scope-label');
    const menu = document.getElementById('scan-excluded-scope-menu');
    const scopeVal = document.getElementById('scan-excluded-scope-value');
    const input = document.getElementById('scan-excluded-input');

    if (!dropdown || !trigger || !menu || !scopeVal) return;

    let userChanged = false;

    const setScope = (val, fromUser = true) => {
        scopeVal.value = val;
        if (fromUser) {
            userChanged = (val !== 'auto');
            try { chrome.storage.local.set({ SCAN_EXCLUDED_SCOPE_PREF: val }); } catch (e) {}
        }
        menu.querySelectorAll('.dropdown-item').forEach(item => {
            const match = item.getAttribute('data-value') === val;
            item.classList.toggle('active', match);
            item.setAttribute('aria-selected', match ? 'true' : 'false');
            if (match && labelEl) {
                const title = item.querySelector('.dropdown-item-title');
                labelEl.textContent = title ? title.textContent : item.textContent.trim();
            }
        });
    };

    try {
        chrome.storage.local.get(['SCAN_EXCLUDED_SCOPE_PREF'], (res) => {
            if (res && res.SCAN_EXCLUDED_SCOPE_PREF) {
                setScope(res.SCAN_EXCLUDED_SCOPE_PREF, true);
            }
        });
    } catch (e) {}

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown.is-open').forEach(d => {
            if (d !== dropdown) d.classList.remove('is-open');
        });
        const isOpen = dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            setScope(item.getAttribute('data-value'), true);
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            if (input) input.focus();
        });
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dropdown.classList.contains('is-open')) {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
        }
    });

    if (input) {
        input.addEventListener('input', () => {
            const val = input.value.trim();
            if (userChanged) return;
            if (/\/\*|\*$/.test(val)) {
                setScope('children', false);
            } else if (scopeVal.value === 'children' && !val.includes('*')) {
                setScope('domain', false);
            }
        });
    }
}

function setupListManager(inputId, btnId, listId, stateKey) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input || !btn) return;

    const addItem = () => {
        let val = input.value.trim().toLowerCase();
        if (!val) return;

        // A scan exclusion may be a whole site, one section of it, or a single
        // page, so it is parsed rather than validated as a bare domain.
        if (stateKey === 'CUSTOM_SCAN_EXCLUDED') {
            const scopeEl = document.getElementById('scan-excluded-scope-value');
            let scope = scopeEl ? scopeEl.value : 'domain';
            if (scope === 'auto') {
                if (/\/\*|\*$/.test(val)) scope = 'children';
                else if (val.includes('/')) scope = 'exact';
                else scope = 'domain';
            }
            if (scope === 'domain') {
                let clean = val.replace(/^[a-z]+:\/\//i, '');
                val = clean.split('/')[0].split('?')[0].split('#')[0];
            } else if (scope === 'children') {
                let clean = val.replace(/^[a-z]+:\/\//i, '');
                clean = clean.replace(/\/?\*+$/, '').replace(/\/+$/, '');
                val = clean + '/*';
            } else if (scope === 'exact') {
                let clean = val.replace(/^[a-z]+:\/\//i, '');
                val = clean.replace(/\/?\*+$/, '');
            }

            const rule = parseScanExclusion(val);
            if (!rule) {
                showToast('Not a valid site, section or page.');
                return;
            }
            val = rule.value;
        }

        // The whitelist accepts any host you can actually navigate to, not just
        // registrable domains: localhost, a LAN address, a container name, an
        // IPv6 literal, each with an optional port.
        if (stateKey === 'CUSTOM_ALLOWED_DOMAINS') {
            const scopeEl = document.getElementById('allowed-scope-value');
            let scope = scopeEl ? scopeEl.value : 'domain';
            if (scope === 'auto') {
                if (/\/\*|\*$/.test(val)) scope = 'children';
                else if (val.includes('/')) scope = 'exact';
                else scope = 'domain';
            }
            if (scope === 'domain') {
                let clean = val.replace(/^[a-z]+:\/\//i, '');
                val = clean.split('/')[0].split('?')[0].split('#')[0];
            } else if (scope === 'children') {
                let clean = val.replace(/^[a-z]+:\/\//i, '');
                clean = clean.replace(/\/?\*+$/, '').replace(/\/+$/, '');
                val = clean + '/*';
            } else if (scope === 'exact') {
                let clean = val.replace(/^[a-z]+:\/\//i, '');
                val = clean.replace(/\/?\*+$/, '');
            }

            const rule = parseScanExclusion(val);
            if (!rule) {
                showToast('Not a valid site, section or page.');
                return;
            }
            val = rule.value;
        }

        // Domain Sanitization & Strict Validation
        if (stateKey === 'CUSTOM_DOMAINS') {
            let cleanVal = val;
            
            // Add a temporary protocol if not present to let the URL parser handle it reliably
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
            
            // Strip leading 'www.' if present (e.g., www.facebook.com -> facebook.com)
            cleanVal = cleanVal.replace(/^www\./i, '');

            // Strict domain check: must have a TLD extension and no spaces/special keywords
            const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9-]{2,})+$/;
            if (!domainPattern.test(cleanVal)) {
                showToast("Invalid domain format! Must be e.g. facebook.com (not a keyword).");
                return;
            }
            val = cleanVal;
        }

        // Page Sanitization & Validation
        if (stateKey === 'CUSTOM_PAGES' || stateKey === 'CUSTOM_EXACT_PAGES') {
            let cleanVal = val;
            
            // Add a temporary protocol if not present to let the URL parser handle it reliably
            let urlToParse = cleanVal;
            if (!/^https?:\/\//i.test(cleanVal)) {
                urlToParse = 'http://' + cleanVal;
            }
            
            try {
                const parsed = new URL(urlToParse);
                const host = parsed.hostname.replace(/^www\./i, '');
                const pathAndQuery = parsed.pathname + parsed.search;
                
                // Reject if it is a plain domain (must have path or query components!)
                if ((pathAndQuery === '/' || pathAndQuery === '') && parsed.search === '') {
                    showToast("Must be a page link, not a plain domain (e.g. site.com/page)!");
                    return;
                }
                
                cleanVal = host + pathAndQuery;
                // Strip trailing slash if present to normalize
                if (cleanVal.endsWith('/')) {
                    cleanVal = cleanVal.slice(0, -1);
                }
            } catch (e) {
                showToast("Invalid page URL format!");
                return;
            }
            val = cleanVal;
        }
        
        const finalizeAdd = (finalVal) => {
            if (!finalVal) return;
            if (state[stateKey].includes(finalVal)) return;

            // Adding here weakens protection, so the user reads their own
            // warning message first; the change applies the moment they say yes.
            if (WEAKENING_ADDITION_LISTS.includes(stateKey)) {
                input.value = '';
                promptWeakeningWarning({ listId, stateKey, value: finalVal, op: 'add' });
                return;
            }

            state[stateKey].push(finalVal);
            const host = getItemHost(stateKey, finalVal);
            if (host) expandedGroups.add(`${listId}-${host}`);
            renderList(listId, stateKey);
            input.value = '';
            saveState();
        };

        // Exempting a blocked site from scanning makes no sense and reads like
        // a loophole, so it is refused the same way the whitelist is.
        if (stateKey === 'CUSTOM_SCAN_EXCLUDED') {
            const rule = parseScanExclusion(val);
            const host = rule ? rule.host : val;

            if (matchesAnyHostEntry(host, rule && rule.port, state.CUSTOM_DOMAINS)) {
                showToast('That site is on your restricted list. It is already blocked.');
                return;
            }
            chrome.runtime.sendMessage({ action: 'isMasterBlocked', domain: host }, (response) => {
                if (response && response.blocked) {
                    showToast('That site is blocked by the built-in list.');
                } else {
                    finalizeAdd(val);
                }
            });
            return;
        }

        if (stateKey === 'CUSTOM_ALLOWED_DOMAINS') {
            const rule = parseScanExclusion(val);
            const host = rule ? rule.host : val;
            if (matchesAnyHostEntry(host, rule && rule.port, state.CUSTOM_DOMAINS)) {
                showToast("Cannot whitelist a domain that is in your custom blocklist.");
                return;
            }
            // The master list is keyed by hostname, so ask about the host alone.
            chrome.runtime.sendMessage({ action: 'isMasterBlocked', domain: host }, (response) => {
                if (response && response.blocked) {
                    showToast("Cannot whitelist globally restricted sites.");
                } else {
                    finalizeAdd(val);
                }
            });
            return;
        }

        if (stateKey === 'CUSTOM_DOMAINS') {
            if (state.CUSTOM_ALLOWED_DOMAINS && state.CUSTOM_ALLOWED_DOMAINS.includes(val)) {
                showToast("This domain is in your whitelist. Remove it there first.");
                return;
            }
        }

        finalizeAdd(val);
    };

    btn.addEventListener('click', addItem);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addItem();
    });
}

const expandedGroups = new Set();

function getItemHost(stateKey, item) {
    if (typeof item !== 'string') return null;
    if (stateKey === 'CUSTOM_ALLOWED_DOMAINS' || stateKey === 'CUSTOM_SCAN_EXCLUDED') {
        const rule = parseScanExclusion(item);
        return rule ? rule.host : null;
    }
    if (stateKey === 'CUSTOM_DOMAINS') {
        return normaliseHostEntry(item)?.host || item.toLowerCase().replace(/^www\./, '');
    }
    if (stateKey === 'CUSTOM_PAGES' || stateKey === 'CUSTOM_EXACT_PAGES') {
        try {
            const raw = item.replace(/^[a-z]+:\/\//i, '');
            const hostPart = raw.split('/')[0].split('?')[0].split('#')[0];
            return normaliseHostEntry(hostPart)?.host || hostPart.toLowerCase().replace(/^www\./, '');
        } catch {
            return null;
        }
    }
    return null;
}

const GLOBE_SVG_DATA_URL = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

function createFaviconElement(host) {
    if (!host) return null;
    const cleanHost = String(host).toLowerCase().replace(/^www\./, '').trim();

    // If this website is known to have no icon, skip it
    if (faviconMemoryCache[cleanHost] === 'none') {
        return null;
    }

    const img = document.createElement('img');
    img.className = 'tag-favicon';
    img.dataset.host = cleanHost;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 16;
    img.height = 16;

    if (faviconMemoryCache[cleanHost]) {
        img.src = faviconMemoryCache[cleanHost];
        return img;
    }

    img.classList.add('is-loading');
    img.src = GLOBE_SVG_DATA_URL;

    chrome.runtime.sendMessage({ action: 'getFavicon', host: cleanHost }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success) {
            if (response.dataUrl === 'none') {
                faviconMemoryCache[cleanHost] = 'none';
                if (img.isConnected) img.remove();
            } else if (response.dataUrl) {
                faviconMemoryCache[cleanHost] = response.dataUrl;
                if (img.isConnected) {
                    img.src = response.dataUrl;
                    img.classList.remove('is-loading');
                }
            }
        } else if (response && response.reason === 'offline') {
            img.classList.remove('is-loading');
        }
    });

    img.onerror = () => {
        img.src = GLOBE_SVG_DATA_URL;
        img.classList.remove('is-loading');
    };

    return img;
}

function updateFaviconsInPlace(cache) {
    if (!cache) return;
    document.querySelectorAll('img.tag-favicon[data-host]').forEach((img) => {
        const host = img.dataset.host;
        if (!host || !cache[host]) return;

        if (cache[host] === 'none') {
            img.remove();
        } else if (img.src !== cache[host]) {
            img.src = cache[host];
            img.classList.remove('is-loading');
        }
    });
}

function renderList(listId, stateKey) {
    const container = document.getElementById(listId);
    if (!container) return;
    container.innerHTML = '';

    let itemsWithMeta = [];
    if (listId === 'domain-list') {
        (state.CUSTOM_DOMAINS || []).forEach(item => {
            itemsWithMeta.push({ item, stateKey: 'CUSTOM_DOMAINS', host: getItemHost('CUSTOM_DOMAINS', item) });
        });
        (state.CUSTOM_PAGES || []).forEach(item => {
            itemsWithMeta.push({ item, stateKey: 'CUSTOM_PAGES', host: getItemHost('CUSTOM_PAGES', item) });
        });
        (state.CUSTOM_EXACT_PAGES || []).forEach(item => {
            itemsWithMeta.push({ item, stateKey: 'CUSTOM_EXACT_PAGES', host: getItemHost('CUSTOM_EXACT_PAGES', item) });
        });
    } else if (listId === 'keyword-list') {
        (state.CUSTOM_KEYWORDS || []).forEach(item => {
            itemsWithMeta.push({ item, stateKey: 'CUSTOM_KEYWORDS', host: null });
        });
        (state.CUSTOM_PAGE_KEYWORDS || []).forEach(item => {
            itemsWithMeta.push({ item, stateKey: 'CUSTOM_PAGE_KEYWORDS', host: null });
        });
    } else {
        const items = state[stateKey] || [];
        itemsWithMeta = items.map(item => ({ item, stateKey, host: getItemHost(stateKey, item) }));
    }

    // Group items by host
    const hostGroups = new Map();
    itemsWithMeta.forEach((entry) => {
        const host = entry.host;
        if (host) {
            if (!hostGroups.has(host)) hostGroups.set(host, []);
            hostGroups.get(host).push(entry);
        }
    });

    const renderedHosts = new Set();

    itemsWithMeta.forEach((entry) => {
        const host = entry.host;
        if (host && hostGroups.get(host).length > 1) {
            if (!renderedHosts.has(host)) {
                renderedHosts.add(host);
                container.appendChild(buildGroup(listId, host, hostGroups.get(host)));
            }
        } else if (!host || !renderedHosts.has(host)) {
            container.appendChild(buildRow(listId, entry.stateKey, entry.item));
        }
    });
}

function cloneTemplate(id) {
    const tmpl = document.getElementById(id);
    if (!tmpl || !tmpl.content || !tmpl.content.firstElementChild) return null;
    return tmpl.content.firstElementChild.cloneNode(true);
}

function createChevronSvg() {
    return cloneTemplate('template-chevron-icon');
}

function buildGroup(listId, host, groupItems) {
    const groupWrapper = document.createElement('div');
    groupWrapper.className = 'tag-card-group';
    const groupKey = `${listId}-${host}`;

    if (expandedGroups.has(groupKey)) {
        groupWrapper.classList.add('is-expanded');
    }

    // The main card: exactly the same tag-item card as all other items
    const card = document.createElement('div');
    card.className = 'tag-item tag-item-expandable';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', expandedGroups.has(groupKey) ? 'true' : 'false');

    if (state.SHOW_FAVICONS && host) {
        const iconEl = createFaviconElement(host);
        if (iconEl) card.appendChild(iconEl);
    }

    const label = document.createElement('span');
    label.className = 'tag-label';
    label.textContent = host;
    card.appendChild(label);

    const countBadge = document.createElement('span');
    countBadge.className = 'tag-kind tag-group-count';
    countBadge.textContent = `${groupItems.length} ${groupItems.length === 1 ? 'rule' : 'rules'}`;
    card.appendChild(countBadge);

    const arrow = document.createElement('span');
    arrow.className = 'tag-expand-arrow';
    arrow.appendChild(createChevronSvg());
    card.appendChild(arrow);

    const toggle = (e) => {
        if (e.target.closest && e.target.closest('.tag-delete')) return;
        const isOpen = groupWrapper.classList.toggle('is-expanded');
        card.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) {
            expandedGroups.add(groupKey);
        } else {
            expandedGroups.delete(groupKey);
        }
    };

    card.addEventListener('click', toggle);
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(e);
        }
    });

    // The bottom-side container holding all pages for this domain
    const subContainer = document.createElement('div');
    subContainer.className = 'tag-sub-items';

    groupItems.forEach((entry) => {
        const row = buildRow(listId, entry.stateKey, entry.item);
        row.classList.add('tag-sub-item');
        subContainer.appendChild(row);
    });

    groupWrapper.appendChild(card);
    groupWrapper.appendChild(subContainer);
    return groupWrapper;
}

function buildRow(listId, stateKey, item) {
    const el = document.createElement('div');
    el.className = 'tag-item';

    if (state.SHOW_FAVICONS) {
        const host = getItemHost(stateKey, item);
        if (host) {
            const iconEl = createFaviconElement(host);
            if (iconEl) el.appendChild(iconEl);
        }
    }

    const span = document.createElement('span');
    span.className = 'tag-label';
    span.textContent = item;
    el.appendChild(span);

    const kind = describeEntry(stateKey, item);
    if (kind) {
        const badge = document.createElement('span');
        badge.className = 'tag-kind';
        badge.textContent = kind;
        el.appendChild(badge);
    }

    el.appendChild(buildDeleteButton(listId, stateKey, item));
    return el;
}

/**
 * Short label saying how broadly an entry reaches, so a whole-site exclusion
 * cannot be mistaken for a single page at a glance.
 */
function describeEntry(stateKey, item) {
    if (stateKey === 'CUSTOM_DOMAINS') return 'Whole site';
    if (stateKey === 'CUSTOM_PAGES') return 'With children';
    if (stateKey === 'CUSTOM_EXACT_PAGES') return 'Exact page';
    if (stateKey === 'CUSTOM_KEYWORDS') return 'URL & Page';
    if (stateKey === 'CUSTOM_PAGE_KEYWORDS') return 'Page only';
    if (stateKey === 'CUSTOM_ALLOWED_DOMAINS') {
        const rule = parseScanExclusion(item);
        if (!rule) return null;
        if (rule.kind === 'site') return 'Whole site';
        if (rule.kind === 'section') return 'With children';
        if (rule.kind === 'page') return 'Exact page';
        return null;
    }
    if (stateKey === 'CUSTOM_SCAN_EXCLUDED') {
        const rule = parseScanExclusion(item);
        return rule ? SCAN_EXCLUSION_LABELS[rule.kind] : null;
    }
    return null;
}

function buildDeleteButton(listId, stateKey, item) {
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'tag-delete';
    deleteBtn.title = 'Remove';

    const icon = cloneTemplate('template-delete-icon');
    if (icon) deleteBtn.appendChild(icon);

    deleteBtn.addEventListener('click', () => {
        // Removing from a blocklist weakens protection: warning message and
        // an explicit yes/no first. Anything else applies at once.
        if (WEAKENING_REMOVAL_LISTS.includes(stateKey)) {
            promptWeakeningWarning({ listId, stateKey, value: item, op: 'remove' });
            return;
        }
        const index = state[stateKey].indexOf(item);
        if (index === -1) return;
        state[stateKey].splice(index, 1);
        renderList(listId, stateKey);
        saveState();
    });
    return deleteBtn;
}

function populateGames() {
    const gameList = document.getElementById('game-list');
    if (!gameList) return;
    gameList.innerHTML = '';

    const randomRadio = document.querySelector('input[name="activeGame"][value="-1"]');
    if (randomRadio) {
        randomRadio.addEventListener('change', saveState);
    }

    CONFIG.GAMES.forEach((game, index) => {
        const label = document.createElement('label');
        label.className = 'hub-item';
        
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'activeGame';
        input.value = index;
        input.className = 'sr-only';
        if (state.ACTIVE_GAME_INDEX === index) input.checked = true;
        input.addEventListener('change', saveState);

        const box = document.createElement('div');
        box.className = 'hub-item-box';
        
        const svg = cloneTemplate('template-game-icon');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = game.name;
        
        if (svg) box.appendChild(svg);
        box.appendChild(nameSpan);
        
        label.appendChild(input);
        label.appendChild(box);
        
        gameList.appendChild(label);
    });
}


async function restore_options() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            resolve();
            return;
        }
        chrome.storage.local.get({
            BLOCK_METHOD: 'blocked_page',
            CUSTOM_REDIRECT_URL: '',
            CUSTOM_DOMAINS: [],
            CUSTOM_KEYWORDS: [],
            CUSTOM_PAGE_KEYWORDS: [],
            CUSTOM_PAGES: [],
            CUSTOM_EXACT_PAGES: [],
            CUSTOM_ALLOWED_DOMAINS: [],
            CUSTOM_SCAN_EXCLUDED: [],
            SCAN_SENSITIVITY: 2,
            SCANNING_ENABLED: true,
            UNLOCK_PHRASE: CONFIG.UNLOCK_PHRASE,
            WEAKENING_MESSAGE: CONFIG.WEAKENING_MESSAGE,
            ACTIVE_GAME_INDEX: -1,
            SECURITY_ENABLED: false,
            PASSWORD: '',
            THEME: 'system',
            COLOR_THEME: 'blue',
            BYPASS_MODE: 'warning',
            SHOW_FAVICONS: false,
            REELS_BLOCKER_ENABLED: true,
            REELS_PLATFORMS: {
                instagram: true,
                youtube: true,
                facebook: true,
                tiktok: true
            },
            FAVICON_CACHE: {},
            SETTINGS_REVISION: 0
        }, (items) => {
            state = items;
            if (typeof items.SETTINGS_REVISION === 'number') {
                latestRevision = items.SETTINGS_REVISION;
            }
            state.SCANNING_ENABLED = items.SCANNING_ENABLED !== false;
            state.BYPASS_MODE = items.BYPASS_MODE || 'warning';
            state.SHOW_FAVICONS = items.SHOW_FAVICONS === true;
            state.REELS_BLOCKER_ENABLED = items.REELS_BLOCKER_ENABLED !== false;
            state.REELS_PLATFORMS = items.REELS_PLATFORMS || {
                instagram: true,
                youtube: true,
                facebook: true,
                tiktok: true
            };
            faviconMemoryCache = items.FAVICON_CACHE || {};
            applyTheme(state.THEME); // Re-apply theme after load
            applyColorTheme(state.COLOR_THEME || 'blue');
            updateBypassModeUI();

            const faviconToggle = document.getElementById('show-favicons-toggle');
            if (faviconToggle) faviconToggle.checked = state.SHOW_FAVICONS;

            const scanToggle = document.getElementById('content-scanning-toggle');
            if (scanToggle) scanToggle.checked = state.SCANNING_ENABLED;
            updateScanningSectionDimming(state.SCANNING_ENABLED);

            if (typeof updateReelsUI === 'function') {
                updateReelsUI();
            }

            const customUrlInput = document.getElementById('custom-redirect-input');
            if (customUrlInput) customUrlInput.value = state.CUSTOM_REDIRECT_URL || '';

            const methodInput = document.querySelector(`input[name="blockMethod"][value="${state.BLOCK_METHOD}"]`);
            if (methodInput) {
                methodInput.checked = true;
                updateHubVisibility(state.BLOCK_METHOD);
            }

            const gameRadio = document.querySelector(`input[name="activeGame"][value="${state.ACTIVE_GAME_INDEX}"]`);
            if (gameRadio) gameRadio.checked = true;

            resolve();
        });
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastText = document.getElementById('toast-text');
    if (!toast || !toastText) return;
    toastText.textContent = msg;
    toast.classList.add('show');
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

function setupBackupListeners() {
    const exportBtn = document.getElementById("export-btn");
    const importFile = document.getElementById("import-file");

    if (exportBtn) {
        exportBtn.addEventListener("click", exportSettings);
    }
    if (importFile) {
        importFile.addEventListener("change", handleImport);
    }
}

function exportSettings() {
    chrome.storage.local.get([
        "BLOCK_METHOD",
        "CUSTOM_DOMAINS",
        "CUSTOM_KEYWORDS",
        "CUSTOM_PAGE_KEYWORDS",
        "CUSTOM_PAGES",
        "CUSTOM_EXACT_PAGES",
        "CUSTOM_ALLOWED_DOMAINS",
        "CUSTOM_SCAN_EXCLUDED",
        "SCAN_SENSITIVITY",
        "SCANNING_ENABLED",
        "UNLOCK_PHRASE",
        "WEAKENING_MESSAGE",
        "ACTIVE_GAME_INDEX",
        "SECURITY_ENABLED",
        "PASSWORD",
        "THEME",
        "BYPASS_MODE"
    ], (items) => {
        const backupData = {
            version: "1.0",
            timestamp: new Date().toISOString(),
            settings: items
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement("a");
        a.href = url;
        a.download = `elite_shield_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast("Settings exported successfully!");
    });
}

function handleImport(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        // Let the same file be picked again after a cancel.
        input.value = '';
        try {
            const data = JSON.parse(e.target.result);
            if (!data || !data.settings) {
                showToast("Invalid backup file format!");
                return;
            }

            const imported = data.settings;
            stagedImport = {
                BLOCK_METHOD: imported.BLOCK_METHOD || "blocked_page",
                CUSTOM_DOMAINS: Array.isArray(imported.CUSTOM_DOMAINS) ? imported.CUSTOM_DOMAINS : [],
                CUSTOM_KEYWORDS: Array.isArray(imported.CUSTOM_KEYWORDS) ? imported.CUSTOM_KEYWORDS : [],
                CUSTOM_PAGE_KEYWORDS: Array.isArray(imported.CUSTOM_PAGE_KEYWORDS) ? imported.CUSTOM_PAGE_KEYWORDS : [],
                CUSTOM_PAGES: Array.isArray(imported.CUSTOM_PAGES) ? imported.CUSTOM_PAGES : [],
                CUSTOM_EXACT_PAGES: Array.isArray(imported.CUSTOM_EXACT_PAGES) ? imported.CUSTOM_EXACT_PAGES : [],
                CUSTOM_ALLOWED_DOMAINS: Array.isArray(imported.CUSTOM_ALLOWED_DOMAINS) ? imported.CUSTOM_ALLOWED_DOMAINS : [],
                CUSTOM_SCAN_EXCLUDED: Array.isArray(imported.CUSTOM_SCAN_EXCLUDED) ? imported.CUSTOM_SCAN_EXCLUDED : [],
                SCAN_SENSITIVITY: typeof imported.SCAN_SENSITIVITY === 'number' ? imported.SCAN_SENSITIVITY : 2,
                SCANNING_ENABLED: imported.SCANNING_ENABLED !== false,
                UNLOCK_PHRASE: (typeof imported.UNLOCK_PHRASE === 'string' && imported.UNLOCK_PHRASE.trim()) ? imported.UNLOCK_PHRASE : CONFIG.UNLOCK_PHRASE,
                // Old backups stored the message under SCAN_MESSAGE.
                WEAKENING_MESSAGE: typeof imported.WEAKENING_MESSAGE === 'string'
                    ? imported.WEAKENING_MESSAGE
                    : (typeof imported.SCAN_MESSAGE === 'string' ? imported.SCAN_MESSAGE : CONFIG.WEAKENING_MESSAGE),
                ACTIVE_GAME_INDEX: typeof imported.ACTIVE_GAME_INDEX === 'number' ? imported.ACTIVE_GAME_INDEX : -1,
                SECURITY_ENABLED: !!imported.SECURITY_ENABLED,
                PASSWORD: imported.PASSWORD || "",
                THEME: imported.THEME || "system"
            };

            // An imported file can rewrite every list at once, so it never lands
            // without passing the intention check first.
            showImportOath();
        } catch (err) {
            showToast("Failed to parse backup file!");
            console.error("Import error:", err);
        }
    };
    reader.readAsText(file);
}

// ------------------------------------------------------------------
// IMPORT INTENTION CHECK
// ------------------------------------------------------------------

function showImportOath() {
    const overlay = document.getElementById('import-oath');
    const textEl = document.getElementById('import-warning-text');
    if (textEl) {
        const inputEl = document.getElementById('weakening-message');
        const currentDraft = inputEl ? inputEl.value.trim() : '';
        const message = currentDraft
            || (state.WEAKENING_MESSAGE || CONFIG.WEAKENING_MESSAGE || '').trim()
            || 'Remember why you set this protection up.';
        textEl.textContent = message;
    }
    if (overlay) overlay.classList.remove('hidden');
}

function hideImportOath() {
    const overlay = document.getElementById('import-oath');
    if (overlay) overlay.classList.add('hidden');
    stagedImport = null;
    const importInput = document.getElementById('import-file');
    if (importInput) importInput.value = '';
}

function setupImportOath() {
    const yesBtn = document.getElementById('oath-yes');
    const noBtn = document.getElementById('oath-no');
    const overlay = document.getElementById('import-oath');

    if (yesBtn) {
        yesBtn.addEventListener('click', () => {
            if (!stagedImport) return hideImportOath();
            chrome.runtime.sendMessage({ action: 'applyImportNow', settings: stagedImport }, () => {
                hideImportOath();
                showToast('Settings imported. Reloading…');
                setTimeout(() => window.location.reload(), 1200);
            });
        });
    }

    if (noBtn) {
        noBtn.addEventListener('click', () => {
            hideImportOath();
            showToast('Import cancelled: your current settings stay.');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hideImportOath();
                showToast('Import cancelled: your current settings stay.');
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
            hideImportOath();
            showToast('Import cancelled: your current settings stay.');
        }
    });
}

// ------------------------------------------------------------------
// HELP & SETUP (SHARED SETTINGS & HARDENING)
// ------------------------------------------------------------------

let helpSelected = new Set();
let helpCurrentOs = 'linux';
let helpCurrentBrowser = 'chrome';

function setupHelpSection() {
    setupHelpTabs();
    renderHelpOptions();
    setupHelpBrowserDropdown();
    setupHelpPickers();
    setupHelpCopyButtons();
    renderHelpCommands();
}

function setupHelpTabs() {
    const tabs = document.querySelectorAll('.help-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.help-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(`tab-${tab.dataset.tab}`);
            if (target) target.classList.add('active');
            const main = document.querySelector('.app-main');
            if (main) main.scrollTop = 0;
        });
    });
}

function renderHelpOptions() {
    const container = document.getElementById('option-list');
    if (!container || typeof HARDENING_OPTIONS === 'undefined') return;
    container.innerHTML = '';

    for (const option of HARDENING_OPTIONS) {
        const label = document.createElement('label');
        label.className = option.advanced ? 'option advanced' : 'option';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = option.id;
        input.addEventListener('change', () => {
            if (input.checked) helpSelected.add(option.id);
            else helpSelected.delete(option.id);
            renderHelpCommands();
        });

        const box = document.createElement('div');
        box.className = 'option-body';

        const title = document.createElement('span');
        title.className = 'option-title';
        title.textContent = option.label;
        if (option.advanced) {
            const tag = document.createElement('span');
            tag.className = 'option-tag';
            tag.textContent = 'needs hosting';
            title.appendChild(tag);
        }

        const detail = document.createElement('span');
        detail.className = 'option-detail';
        detail.textContent = option.detail;

        box.appendChild(title);
        box.appendChild(detail);
        label.appendChild(input);
        label.appendChild(box);
        container.appendChild(label);
    }
}

function setupHelpBrowserDropdown() {
    const dropdown = document.getElementById('browser-target-dropdown');
    const trigger = document.getElementById('browser-target-trigger');
    const labelEl = document.getElementById('browser-target-label');
    const menu = document.getElementById('browser-target-menu');
    const valueInput = document.getElementById('browser-target-value');
    const legacySelect = document.getElementById('browser-picker');

    if (legacySelect && typeof BROWSER_TARGETS !== 'undefined') {
        legacySelect.innerHTML = '';
        for (const [id, target] of Object.entries(BROWSER_TARGETS)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = target.label;
            legacySelect.appendChild(option);
        }
        legacySelect.value = helpCurrentBrowser;
        legacySelect.addEventListener('change', () => {
            setBrowser(legacySelect.value);
        });
    }

    if (!dropdown || !trigger || !menu || typeof BROWSER_TARGETS === 'undefined') return;

    menu.innerHTML = '';
    for (const [id, target] of Object.entries(BROWSER_TARGETS)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `dropdown-item${id === helpCurrentBrowser ? ' active' : ''}`;
        item.setAttribute('data-value', id);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', id === helpCurrentBrowser ? 'true' : 'false');

        const content = document.createElement('div');
        content.className = 'dropdown-item-content';

        const title = document.createElement('span');
        title.className = 'dropdown-item-title';
        title.textContent = target.label;

        const desc = document.createElement('span');
        desc.className = 'dropdown-item-desc';
        desc.textContent = target.desc || '';

        content.appendChild(title);
        content.appendChild(desc);

        const svg = cloneTemplate('template-check-icon');

        item.appendChild(content);
        if (svg) item.appendChild(svg);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            setBrowser(id);
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        });

        menu.appendChild(item);
    }

    function setBrowser(id) {
        if (!BROWSER_TARGETS[id]) return;
        helpCurrentBrowser = id;
        if (valueInput) valueInput.value = id;
        if (legacySelect) legacySelect.value = id;
        if (labelEl) labelEl.textContent = BROWSER_TARGETS[id].label;

        menu.querySelectorAll('.dropdown-item').forEach(item => {
            const match = item.getAttribute('data-value') === id;
            item.classList.toggle('active', match);
            item.setAttribute('aria-selected', match ? 'true' : 'false');
        });

        renderHelpCommands();
    }

    setBrowser(helpCurrentBrowser);

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown.is-open').forEach(d => {
            if (d !== dropdown) d.classList.remove('is-open');
        });
        const isOpen = dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dropdown.classList.contains('is-open')) {
            dropdown.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        }
    });
}

function setupHelpPickers() {
    document.querySelectorAll('#os-picker .seg').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('#os-picker .seg').forEach(b => b.classList.remove('active'));
            button.classList.add('active');
            helpCurrentOs = button.dataset.os;
            renderHelpCommands();
        });
    });

    document.getElementById('update-url')?.addEventListener('input', renderHelpCommands);
}

function renderHelpCommands() {
    if (typeof BROWSER_TARGETS === 'undefined') return;

    const urlRow = document.getElementById('update-url-row');
    urlRow?.classList.toggle('hidden', !helpSelected.has('forceinstall'));

    const target = BROWSER_TARGETS[helpCurrentBrowser];
    const updateUrl = document.getElementById('update-url')?.value.trim() || '';
    const extensionId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : '';
    const policies = (typeof buildPolicies === 'function') ? buildPolicies([...helpSelected], extensionId, updateUrl, target) : {};

    const empty = document.getElementById('empty-note');
    const area = document.getElementById('command-area');
    const hasAny = Object.keys(policies).length > 0;

    const listCmd = document.getElementById('list-cmd');
    if (listCmd && typeof buildListCommand === 'function' && target) {
        listCmd.textContent = buildListCommand(helpCurrentOs, target);
    }

    const policyUrlNote = document.getElementById('policy-url-note');
    if (policyUrlNote && target) {
        policyUrlNote.textContent = target.policyUrl || 'chrome://policy';
    }

    const flatpakCmd = document.getElementById('flatpak-cmd');
    if (flatpakCmd && target) {
        flatpakCmd.textContent = `flatpak kill ${target.flatpakId || 'com.google.Chrome'}`;
    }

    empty?.classList.toggle('hidden', hasAny);
    area?.classList.toggle('hidden', !hasAny);
    if (!hasAny) return;

    const cmd = document.getElementById('generated-cmd');
    if (cmd && typeof buildCommand === 'function' && target) {
        cmd.textContent = buildCommand(helpCurrentOs, policies, target);
    }

    const revert = document.getElementById('revert-cmd');
    if (revert && typeof buildRevertCommand === 'function' && target) {
        revert.textContent = buildRevertCommand(helpCurrentOs, target);
    }

    const steps = document.getElementById('run-steps');
    if (steps) {
        const notes = (typeof buildRunNotes === 'function' && target)
            ? buildRunNotes(helpCurrentOs, target)
            : (typeof RUN_NOTES !== 'undefined' && RUN_NOTES[helpCurrentOs]) || [];
        steps.innerHTML = '';
        for (const note of notes) {
            const li = document.createElement('li');
            li.textContent = note;
            steps.appendChild(li);
        }
    }
}

function setupHelpCopyButtons() {
    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const source = document.getElementById(button.dataset.copy);
            if (!source) return;
            try {
                await navigator.clipboard.writeText(source.textContent);
                showToast('Copied to clipboard.');
            } catch {
                const range = document.createRange();
                range.selectNodeContents(source);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                showToast('Selected: press Ctrl+C to copy.');
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
