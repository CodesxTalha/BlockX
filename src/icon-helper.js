// icon-helper.js
// Handles dynamic rendering and synchronization of the BlockX application icon
// and tab favicons matching the active theme color palette.

const THEME_ICON_COLORS = {
  blue: '#1500CD',
  pine: '#059669',
  slate: '#0284C7',
  monochrome: '#334155'
};

const ICON_SVG_PATH = 'M168.976 87.6586L87.6587 168.976M168.976 87.6586C146.521 65.2035 110.114 65.2035 87.6587 87.6586C65.2036 110.114 65.2036 146.521 87.6587 168.976M168.976 87.6586C191.431 110.114 191.431 146.521 168.976 168.976C146.521 191.431 110.114 191.431 87.6587 168.976';

function renderIconImageData(hexColor, size) {
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(size, size)
    : (typeof document !== 'undefined' ? document.createElement('canvas') : null);

  if (!canvas) return null;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.scale(size / 256, size / 256);

  // Background squircle
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, 256, 256, 70);
  } else {
    ctx.rect(0, 0, 256, 256);
  }
  ctx.fillStyle = hexColor;
  ctx.fill();

  // White emblem path
  if (typeof Path2D !== 'undefined') {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(ICON_SVG_PATH));
  }

  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}

function updateDynamicActionIcon(themeName) {
  if (typeof chrome === 'undefined' || !chrome.action || !chrome.action.setIcon) return;
  try {
    const hex = THEME_ICON_COLORS[themeName] || THEME_ICON_COLORS.blue;
    const sizes = [16, 32, 48, 128];
    const imageData = {};
    for (const s of sizes) {
      const imgData = renderIconImageData(hex, s);
      if (imgData) imageData[s] = imgData;
    }
    if (Object.keys(imageData).length > 0) {
      chrome.action.setIcon({ imageData }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          // Ignore context teardown errors
        }
      });
    }
  } catch (e) {
    console.warn('[BlockX] Failed to set dynamic action icon:', e);
  }
}

// Pre-computed, zero-allocation SVG data URIs for tab favicons
const THEME_FAVICON_DATA_URIS = {};
for (const [theme, hex] of Object.entries(THEME_ICON_COLORS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none"><rect width="256" height="256" rx="70" fill="${hex}"/><path fill="none" d="${ICON_SVG_PATH}" stroke="white" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  THEME_FAVICON_DATA_URIS[theme] = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function updatePageFavicon(themeName) {
  if (typeof document === 'undefined') return;
  const dataUri = THEME_FAVICON_DATA_URIS[themeName] || THEME_FAVICON_DATA_URIS.blue;
  let link = document.querySelector('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  if (link.href !== dataUri) {
    link.href = dataUri;
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.THEME_ICON_COLORS = THEME_ICON_COLORS;
  globalThis.THEME_FAVICON_DATA_URIS = THEME_FAVICON_DATA_URIS;
  globalThis.updateDynamicActionIcon = updateDynamicActionIcon;
  globalThis.renderIconImageData = renderIconImageData;
  globalThis.updatePageFavicon = updatePageFavicon;
}
