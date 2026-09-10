// help.js

const selected = new Set();
let currentOs = 'linux';
let currentBrowser = 'chrome';

// The page is served by the extension, so this is always the real id (no need
// to trust the one pinned in the manifest).
const EXTENSION_ID = chrome.runtime.id;

function init() {
    applyTheme();
    setupTabs();
    setupBackButton();
    renderOptions();
    setupBrowserDropdown();
    setupPickers();
    setupCopyButtons();
    render();
}

function applyTheme() {
    chrome.storage.local.get({ THEME: 'system' }, (items) => {
        document.body.setAttribute('data-user-theme', items.THEME || 'system');
    });
}

function setupTabs() {
    document.querySelectorAll('.help-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.help-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
            window.scrollTo({ top: 0 });
        });
    });
}

function setupBackButton() {
    document.getElementById('back-btn')?.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
}

function renderOptions() {
    const container = document.getElementById('option-list');
    if (!container) return;
    container.innerHTML = '';

    for (const option of HARDENING_OPTIONS) {
        const label = document.createElement('label');
        label.className = option.advanced ? 'option advanced' : 'option';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = option.id;
        input.addEventListener('change', () => {
            if (input.checked) selected.add(option.id);
            else selected.delete(option.id);
            render();
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

function setupBrowserDropdown() {
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
        legacySelect.value = currentBrowser;
        legacySelect.addEventListener('change', () => {
            setBrowser(legacySelect.value);
        });
    }

    if (!dropdown || !trigger || !menu || typeof BROWSER_TARGETS === 'undefined') return;

    menu.innerHTML = '';
    for (const [id, target] of Object.entries(BROWSER_TARGETS)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `dropdown-item${id === currentBrowser ? ' active' : ''}`;
        item.setAttribute('data-value', id);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', id === currentBrowser ? 'true' : 'false');

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

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'dropdown-item-check');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');

        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '20 6 9 17 4 12');
        svg.appendChild(polyline);

        item.appendChild(content);
        item.appendChild(svg);

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
        currentBrowser = id;
        if (valueInput) valueInput.value = id;
        if (legacySelect) legacySelect.value = id;
        if (labelEl) labelEl.textContent = BROWSER_TARGETS[id].label;

        menu.querySelectorAll('.dropdown-item').forEach(item => {
            const match = item.getAttribute('data-value') === id;
            item.classList.toggle('active', match);
            item.setAttribute('aria-selected', match ? 'true' : 'false');
        });

        render();
    }

    setBrowser(currentBrowser);

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

function setupPickers() {
    document.querySelectorAll('#os-picker .seg').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('#os-picker .seg').forEach(b => b.classList.remove('active'));
            button.classList.add('active');
            currentOs = button.dataset.os;
            render();
        });
    });

    document.getElementById('update-url')?.addEventListener('input', render);
}

function render() {
    const urlRow = document.getElementById('update-url-row');
    urlRow?.classList.toggle('hidden', !selected.has('forceinstall'));

    const target = BROWSER_TARGETS[currentBrowser];
    const updateUrl = document.getElementById('update-url')?.value.trim() || '';
    const policies = buildPolicies([...selected], EXTENSION_ID, updateUrl, target);

    const empty = document.getElementById('empty-note');
    const area = document.getElementById('command-area');
    const hasAny = Object.keys(policies).length > 0;

    const listCmd = document.getElementById('list-cmd');
    if (listCmd) listCmd.textContent = buildListCommand(currentOs, target);

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
    if (cmd) cmd.textContent = buildCommand(currentOs, policies, target);

    const revert = document.getElementById('revert-cmd');
    if (revert) revert.textContent = buildRevertCommand(currentOs, target);

    const steps = document.getElementById('run-steps');
    if (steps) {
        const notes = (typeof buildRunNotes === 'function' && target)
            ? buildRunNotes(currentOs, target)
            : (typeof RUN_NOTES !== 'undefined' && RUN_NOTES[currentOs]) || [];
        steps.innerHTML = '';
        for (const note of notes) {
            const li = document.createElement('li');
            li.textContent = note;
            steps.appendChild(li);
        }
    }
}

function setupCopyButtons() {
    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const source = document.getElementById(button.dataset.copy);
            if (!source) return;
            try {
                await navigator.clipboard.writeText(source.textContent);
                showToast('Copied to clipboard.');
            } catch {
                // Clipboard can be refused; selecting the text still lets them copy.
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

function showToast(message) {
    const toast = document.getElementById('toast');
    const text = document.getElementById('toast-text');
    if (!toast || !text) return;
    text.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

document.addEventListener('DOMContentLoaded', init);
