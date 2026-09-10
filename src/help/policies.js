// policies.js
// ------------------------------------------------------------------
// Chrome reads enterprise policy from a location only an administrator can
// write. That is the whole point: once these are in place, the browser itself
// enforces them and the signed-in user cannot switch them back off.
//
// Everything here is a documented Chromium policy. Nothing is a trick, and
// each entry says plainly what it does and what it costs.

const HARDENING_OPTIONS = [
  {
    id: 'incognito',
    label: 'Turn off Incognito mode',
    detail: 'Removes the menu entry and the Ctrl+Shift+N shortcut. Incognito windows cannot be opened at all.',
    policies: { IncognitoModeAvailability: 1 }
  },
  {
    id: 'guest',
    label: 'Turn off Guest mode',
    detail: 'A guest window is a fresh profile with no extensions, so it bypasses everything.',
    policies: { BrowserGuestModeEnabled: false }
  },
  {
    id: 'profiles',
    label: 'Prevent adding new profiles',
    detail: 'A new profile is another way to get a browser without the extension in it.',
    policies: { BrowserAddPersonEnabled: false }
  },
  {
    id: 'safesearch',
    label: 'Force Google SafeSearch',
    detail: 'Enforced by the browser on every Google search, above anything the page or the extension does.',
    policies: { ForceGoogleSafeSearch: true }
  },
  {
    id: 'youtube',
    label: 'Force YouTube Restricted Mode',
    detail: 'Strict restricted mode, which cannot be turned off from YouTube settings.',
    policies: { ForceYouTubeRestrict: 2 }
  },
  {
    id: 'extensionspage',
    label: 'Block the extensions page',
    detail: 'Without reaching extension settings there is no way to switch BlockX off or delete it. '
          + 'This is what actually makes the extension stick for a locally loaded copy.',
    extend(policies, extensionId, updateUrl, target) {
      if (target?.isGecko) {
        policies.BlockAboutAddons = true;
        policies.BlockAboutConfig = true;
        policies.BlockAboutProfiles = true;
        return;
      }
      const scheme = target?.scheme || 'chrome';
      const urls = [
        `${scheme}://extensions`,
        `${scheme}://extensions/*`
      ];
      if (scheme !== 'chrome') {
        urls.push('chrome://extensions', 'chrome://extensions/*');
      }
      policies.URLBlocklist = [...new Set([...(policies.URLBlocklist || []), ...urls])];
    }
  },
  {
    id: 'devtools',
    label: 'Turn off Developer Tools',
    detail: 'Stops the page inspector being used to pull the extension\'s overlay off a page.',
    policies: { DeveloperToolsAvailability: 2 }
  },
  {
    id: 'otherextensions',
    label: 'Block installing other extensions',
    detail: 'Nothing new can be installed, so no proxy or unblocker extension can be added later. '
          + 'BlockX itself stays allowed.',
    policies: { ExtensionInstallBlocklist: ['*'] },
    needsExtensionId: true,
    extend(policies, extensionId) {
      policies.ExtensionInstallAllowlist = [extensionId];
    }
  },
  {
    id: 'pin',
    label: 'Pin BlockX to the toolbar',
    detail: 'Keeps the icon visible so the one-time visit prompt is always one click away.',
    needsExtensionId: true,
    extend(policies, extensionId) {
      policies.ExtensionSettings = policies.ExtensionSettings || {};
      policies.ExtensionSettings[extensionId] = {
        ...(policies.ExtensionSettings[extensionId] || {}),
        toolbar_pin: 'force_pinned'
      };
    }
  },
  {
    id: 'forceinstall',
    label: 'Force-install BlockX so it cannot be removed',
    detail: 'The strongest option, but it only works for an extension served from a web address (the Chrome Web Store or your own update manifest). '
          + 'It cannot force-install the unpacked '
          + 'folder you loaded by hand.',
    advanced: true,
    needsExtensionId: true,
    extend(policies, extensionId, updateUrl) {
      policies.ExtensionSettings = policies.ExtensionSettings || {};
      policies.ExtensionSettings[extensionId] = {
        ...(policies.ExtensionSettings[extensionId] || {}),
        installation_mode: 'force_installed',
        update_url: updateUrl || 'https://clients2.google.com/service/update2/crx'
      };
    }
  }
];

// Where each browser reads managed policy from, per platform.
const BROWSER_TARGETS = {
  chrome: {
    label: 'Google Chrome',
    scheme: 'chrome',
    policyUrl: 'chrome://policy',
    extensionsUrl: 'chrome://extensions',
    desc: 'Standard Chromium engine',
    linuxDir: '/etc/opt/chrome/policies/managed',
    legacyLinuxDir: '/etc/opt/chrome/policy/managed',
    macDomain: 'com.google.Chrome',
    winKey: 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome',
    flatpakId: 'com.google.Chrome'
  },
  brave: {
    label: 'Brave',
    scheme: 'brave',
    policyUrl: 'brave://policy',
    extensionsUrl: 'brave://extensions',
    desc: 'Privacy-focused Chromium browser',
    linuxDir: '/etc/brave/policies/managed',
    macDomain: 'com.brave.Browser',
    winKey: 'HKLM:\\SOFTWARE\\Policies\\BraveSoftware\\Brave',
    flatpakId: 'com.brave.Browser'
  },
  edge: {
    label: 'Microsoft Edge',
    scheme: 'edge',
    policyUrl: 'edge://policy',
    extensionsUrl: 'edge://extensions',
    desc: 'Microsoft Enterprise browser',
    linuxDir: '/etc/opt/edge/policies/managed',
    macDomain: 'com.microsoft.Edge',
    winKey: 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge',
    flatpakId: 'com.microsoft.Edge'
  },
  chromium: {
    label: 'Chromium',
    scheme: 'chromium',
    policyUrl: 'chrome://policy',
    extensionsUrl: 'chrome://extensions',
    desc: 'Open-source Chromium base',
    linuxDir: '/etc/chromium/policies/managed',
    macDomain: 'org.chromium.Chromium',
    winKey: 'HKLM:\\SOFTWARE\\Policies\\Chromium',
    flatpakId: 'org.chromium.Chromium'
  },
  vivaldi: {
    label: 'Vivaldi',
    scheme: 'vivaldi',
    policyUrl: 'vivaldi://policy',
    extensionsUrl: 'vivaldi://extensions',
    desc: 'Customizable power-user browser',
    linuxDir: '/etc/vivaldi/policies/managed',
    macDomain: 'com.vivaldi.Vivaldi',
    winKey: 'HKLM:\\SOFTWARE\\Policies\\Vivaldi',
    flatpakId: 'com.vivaldi.Vivaldi'
  },
  firefox: {
    label: 'Mozilla Firefox',
    scheme: 'about',
    isGecko: true,
    policyUrl: 'about:policies',
    extensionsUrl: 'about:addons',
    desc: 'Gecko engine browser',
    linuxDir: '/etc/firefox/policies',
    macDomain: 'org.mozilla.firefox',
    winKey: 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox',
    flatpakId: 'org.mozilla.firefox'
  }
};

const POLICY_FILE_NAME = 'blockx.json';

/**
 * Merges the selected options into one policy object.
 */
function buildPolicies(selectedIds, extensionId, updateUrl, target) {
  const policies = {};

  if (target?.isGecko) {
    for (const id of selectedIds) {
      if (id === 'incognito') policies.DisablePrivateBrowsing = true;
      if (id === 'guest' || id === 'profiles') policies.BlockAboutProfiles = true;
      if (id === 'devtools') policies.DisableDeveloperTools = true;
      if (id === 'extensionspage') {
        policies.BlockAboutAddons = true;
        policies.BlockAboutConfig = true;
        policies.BlockAboutProfiles = true;
      }
      if (id === 'otherextensions') {
        policies.ExtensionSettings = policies.ExtensionSettings || {};
        policies.ExtensionSettings['*'] = { installation_mode: 'blocked' };
        policies.ExtensionSettings['blockx@local'] = { installation_mode: 'allowed' };
      }
      if (id === 'pin') {
        policies.ExtensionSettings = policies.ExtensionSettings || {};
        policies.ExtensionSettings['blockx@local'] = {
          ...(policies.ExtensionSettings['blockx@local'] || {}),
          default_area: 'navbar'
        };
      }
      if (id === 'forceinstall') {
        policies.ExtensionSettings = policies.ExtensionSettings || {};
        policies.ExtensionSettings['blockx@local'] = {
          ...(policies.ExtensionSettings['blockx@local'] || {}),
          installation_mode: 'force_installed',
          update_url: updateUrl || 'https://addons.mozilla.org/update.xml'
        };
      }
    }
    return policies;
  }

  for (const option of HARDENING_OPTIONS) {
    if (!selectedIds.includes(option.id)) continue;

    for (const [key, value] of Object.entries(option.policies || {})) {
      if (Array.isArray(value) && Array.isArray(policies[key])) {
        policies[key] = [...new Set([...policies[key], ...value])];
      } else {
        policies[key] = value;
      }
    }
    if (typeof option.extend === 'function') option.extend(policies, extensionId, updateUrl, target);
  }

  return policies;
}

function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

// ------------------------------------------------------------------
// COMMAND BUILDERS
// ------------------------------------------------------------------

function linuxCommand(policies, target) {
  const json = target?.isGecko
    ? JSON.stringify({ policies: policies }, null, 2)
    : JSON.stringify(policies);
  const fileName = target?.isGecko ? 'policies.json' : POLICY_FILE_NAME;
  const path = `${target.linuxDir}/${fileName}`;
  const cleanup = target.legacyLinuxDir
    ? ` && sudo rm -f ${target.legacyLinuxDir}/${POLICY_FILE_NAME}`
    : '';

  return `sudo mkdir -p ${target.linuxDir} && printf '%s' ${shellQuote(json)}`
    + ` | sudo tee ${path} > /dev/null${cleanup}`
    + ` && echo "Applied. Now quit ${target.label} completely and start it again."`;
}

function macCommand(policies, target) {
  if (target?.isGecko) {
    const json = JSON.stringify({ policies: policies }, null, 2);
    const dir = '/Library/Application Support/Mozilla/policies';
    return `sudo mkdir -p "${dir}" && printf '%s' ${shellQuote(json)}`
      + ` | sudo tee "${dir}/policies.json" > /dev/null`
      + ` && echo "Applied. Now quit ${target.label} completely and start it again."`;
  }
  const json = JSON.stringify(policies);
  const plist = `/Library/Managed Preferences/${target.macDomain}.plist`;
  return `sudo mkdir -p "/Library/Managed Preferences" && printf '%s' ${shellQuote(json)}`
    + ` | plutil -convert xml1 -o - - | sudo tee ${shellQuote(plist)} > /dev/null`
    + ` && sudo killall cfprefsd`
    + ` && echo "Applied. Now quit ${target.label} completely and start it again."`;
}

/**
 * Windows policy engine: Chromium and Firefox read from HKLM:\SOFTWARE\Policies.
 */
function windowsCommand(policies, target) {
  const lines = [`New-Item -Path '${target.winKey}' -Force | Out-Null`];

  for (const [key, value] of Object.entries(policies)) {
    if (Array.isArray(value)) {
      const sub = `${target.winKey}\\${key}`;
      lines.push(`New-Item -Path '${sub}' -Force | Out-Null`);
      value.forEach((item, index) => {
        lines.push(`New-ItemProperty -Path '${sub}' -Name '${index + 1}' -Value '${item}' -PropertyType String -Force | Out-Null`);
      });
    } else if (value !== null && typeof value === 'object') {
      const json = JSON.stringify(value).replace(/'/g, "''");
      lines.push(`New-ItemProperty -Path '${target.winKey}' -Name '${key}' -Value '${json}' -PropertyType String -Force | Out-Null`);
    } else {
      const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : value;
      lines.push(`New-ItemProperty -Path '${target.winKey}' -Name '${key}' -Value ${numeric} -PropertyType DWord -Force | Out-Null`);
    }
  }

  lines.push(`Write-Host 'BlockX policy applied. Restart ${target.label}.'`);
  return lines.join('\n');
}

function buildCommand(os, policies, target) {
  if (Object.keys(policies).length === 0) return '';
  if (os === 'linux') return linuxCommand(policies, target);
  if (os === 'macos') return macCommand(policies, target);
  return windowsCommand(policies, target);
}

function buildRevertCommand(os, target) {
  if (os === 'linux') {
    if (target?.isGecko) {
      return `sudo rm -f ${target.linuxDir}/policies.json`;
    }
    const paths = [`${target.linuxDir}/${POLICY_FILE_NAME}`];
    if (target.legacyLinuxDir) paths.push(`${target.legacyLinuxDir}/${POLICY_FILE_NAME}`);
    return `sudo rm -f ${paths.join(' ')}`;
  }
  if (os === 'macos') {
    if (target?.isGecko) {
      return `sudo rm -f "/Library/Application Support/Mozilla/policies/policies.json"`;
    }
    return `sudo rm -f ${shellQuote(`/Library/Managed Preferences/${target.macDomain}.plist`)} && sudo killall cfprefsd`;
  }
  return `Remove-Item -Path '${target.winKey}' -Recurse -Force`;
}

/**
 * Shows what else is already in the policy directory.
 */
function buildListCommand(os, target) {
  if (os === 'linux') {
    if (target?.isGecko) {
      return `cat ${target.linuxDir}/policies.json 2>/dev/null || echo "No policy file found."`;
    }
    return `ls -la ${target.linuxDir}/ && head -n -0 ${target.linuxDir}/*.json`;
  }
  if (os === 'macos') {
    if (target?.isGecko) {
      return `cat "/Library/Application Support/Mozilla/policies/policies.json" 2>/dev/null || echo "No policy file found."`;
    }
    return `ls -la "/Library/Managed Preferences/"`;
  }
  return `Get-ChildItem -Path '${target.winKey}' -Recurse | Format-List`;
}

function buildRunNotes(os, target) {
  const policyPage = target?.policyUrl || 'chrome://policy';
  const label = target?.label || 'the browser';

  if (os === 'linux') {
    return [
      'Open a terminal.',
      'Paste the line and press Enter.',
      'Enter your password when sudo asks: this writes to system policy directories.',
      `Quit ${label} completely and start it again. Closing every window is not always enough; if it still does not show up, end the remaining process and relaunch.`,
      'On a Flatpak browser, quitting properly matters more than usual (see the note below).',
      `Open ${policyPage}. The entries should be listed with Source: Platform/Enterprise. If the page is empty, the browser was never restarted.`
    ];
  }
  if (os === 'macos') {
    return [
      'Open Terminal.',
      'Paste the line and press Enter.',
      'Enter your password when sudo asks.',
      `Quit ${label} completely (Cmd+Q) and start it again.`,
      `Check ${policyPage}: the entries should be listed as Source: Platform/Enterprise.`
    ];
  }
  return [
    'Press Start, type PowerShell, right-click it and choose Run as administrator.',
    'Paste the whole block and press Enter.',
    `Close every ${label} window and start the browser again.`,
    `Check ${policyPage}: the entries should be listed as Source: Platform/Enterprise.`
  ];
}

const RUN_NOTES = {
  linux: buildRunNotes('linux', BROWSER_TARGETS.chrome),
  macos: buildRunNotes('macos', BROWSER_TARGETS.chrome),
  windows: buildRunNotes('windows', BROWSER_TARGETS.chrome)
};

