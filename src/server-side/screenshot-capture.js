'use strict';

/**
 * Centralized screenshot capture helper.
 *
 * Goal: one place to decide HOW screenshots are captured (CDP vs chunked),
 * and one place to decide how they are STORED/EXPOSED (buffer, dataUrl/base64, file-backed).
 *
 * Design:
 *  - Always returns a stable "artifact" object shape.
 *  - Mixed-mode is supported (e.g., keep buffer AND save file AND produce dataUrl).
 *  - File IO is opt-in and performed via injected callbacks so this module stays reusable.
 */

let screenshotChunked = null;
try {
  // In the real repo this should be located next to screenshot-chunked.js (server-side).
  screenshotChunked = require('./screenshot-chunked.js');
} catch {
  // Optional: allow consumers/tests to inject their own chunked capture functions later.
  screenshotChunked = null;
}

function bufferLikeToBase64(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('base64');
  if (ArrayBuffer.isView && ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  }
  return null;
}

async function captureFullPagePuppeteer(page, { type = 'png', quality = 80 } = {}) {
  // Puppeteer expects 'jpeg' not 'jpg'
  const normalizedType = (type === 'jpg') ? 'jpeg' : type;

  const buf = await page.screenshot({
    type: normalizedType,
    quality: (normalizedType === 'jpeg' || normalizedType === 'webp') ? quality : undefined,
    fullPage: true
  });

  return {
    buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf),
    strategy: 'puppeteer'
  };
}

// The most a full-page capture takes in. Chrome rasterizes the whole clip at
// once: a page laid out hundreds of thousands of pixels tall or wide (a huge
// unbroken text) never finished, and a clip past JPEG's 65,535 pixels came
// back empty. Past these, the capture keeps the page's top left.
const MAX_CAPTURE_WIDTH = 8192;
const MAX_CAPTURE_HEIGHT = 32000;
const MAX_CAPTURE_PIXELS = 64000000;

/** The clip a full-page capture takes: the page's size, within the limits above. */
function fullPageClipSize(contentWidth, contentHeight, viewportWidth) {
  const width = Math.min(Math.max(contentWidth, viewportWidth), MAX_CAPTURE_WIDTH);
  const height = Math.max(1, Math.min(contentHeight, MAX_CAPTURE_HEIGHT, Math.floor(MAX_CAPTURE_PIXELS / width)));
  return { width, height, clipped: width < Math.max(contentWidth, viewportWidth) || height < contentHeight };
}

async function captureFullPageCDP(page, { type = 'jpeg', quality = 80 } = {}) {
  const client = await page.target().createCDPSession();
  try {
    await client.send('Page.enable');

    // Layout metrics for full-page capture
    const metrics = await client.send('Page.getLayoutMetrics');
    const contentWidth = Math.max(1, Math.ceil(metrics?.contentSize?.width || 0));
    const contentHeight = Math.max(1, Math.ceil(metrics?.contentSize?.height || 0));
    const viewportWidth = Math.max(
      1,
      Math.ceil(
        metrics?.layoutViewport?.clientWidth ||
        metrics?.visualViewport?.clientWidth ||
        contentWidth
      )
    );
    // Keep screenshot width at least the current viewport width so
    // narrow document content does not look like a mobile capture.
    // Keep screenshot height constrained to actual page content to avoid
    // extra empty area when the viewport is intentionally taller.
    const { width, height, clipped } = fullPageClipSize(contentWidth, contentHeight, viewportWidth);

    const baseOptions = {
      format: type,
      quality: type === 'jpeg' ? quality : undefined,
      captureBeyondViewport: true
    };

    let res;
    try {
      res = await client.send('Page.captureScreenshot', {
        ...baseOptions,
        clip: { x: 0, y: 0, width, height, scale: 1 }
      });
    } catch {
      // Prefer chunked fallback to keep capture width anchored to current viewport.
      try {
        const fallbackType = type === 'jpeg' ? 'png' : type;
        const chunked = await captureFullPageChunked(page, {
          type: fallbackType,
          maxChunkHeight: 12000,
          overlap: 0,
          outputType: fallbackType
        });
        return {
          buffer: chunked.buffer,
          width,
          height,
          strategy: 'cdp-chunked-fallback'
        };
      } catch {
        // Final fallback: Puppeteer full-page capture is viewport-anchored and
        // avoids CDP content-size edge cases that can look like mobile layout.
        const pup = await captureFullPagePuppeteer(page, {
          type: type === 'jpg' ? 'jpeg' : type,
          quality
        });
        return {
          buffer: pup.buffer,
          width,
          height,
          strategy: 'cdp-puppeteer-fallback'
        };
      }
    }

    // NOTE: res.data is base64
    return {
      buffer: Buffer.from(res.data, 'base64'),
      width,
      height,
      clipped,
      strategy: 'cdp'
    };
  } finally {
    try { await client.detach(); } catch {}
  }
}

async function captureFullPageChunked(page, {
  type = 'png',
  maxChunkHeight = 15000,
  overlap = 0,
  outputType = null
} = {}) {
  if (!screenshotChunked || typeof screenshotChunked.screenshotFullPageChunked !== 'function') {
    throw new Error('chunked screenshot capture is unavailable (missing ./screenshot-chunked.js)');
  }
  const { screenshotFullPageChunked, mergeVerticalImageBuffers } = screenshotChunked;

  // Within the same height as a single capture: a 482,000 px page took
  // 33 chunks and three minutes, and the image they made was too large to
  // write.
  const buffers = await screenshotFullPageChunked(page, { type, maxChunkHeight, overlap, maxTotalHeight: MAX_CAPTURE_HEIGHT });
  const buffer = await mergeVerticalImageBuffers(buffers, { outputType: outputType || type });

  return {
    buffer,
    strategy: 'chunked'
  };
}

/**
 * Capture a screenshot and return a normalized artifact object.
 *
 * This does NOT decide storage mode yet (file vs inline).
 * For now it always returns { buffer: Buffer, ...meta } to preserve existing behavior.
 */
async function captureScreenshotArtifact(page, {
  strategy = 'auto',   // 'auto' | 'puppeteer' | 'cdp' | 'chunked'
  type = 'png',        // 'png' | 'jpeg' | 'webp' (subject to underlying capture)
  quality = 80,        // jpeg/webp
  maxChunkHeight = 15000,
  overlap = 0,
  stabilizeAnimations = false, // reserved, consumers can stabilize outside today

  // Output modes (mixed allowed)
  output = null, // { buffer?: boolean, base64?: boolean, dataUrl?: boolean, file?: boolean }

  // Optional file writer (opt-in)
  // Signature: async ({ buffer, type, mimeType, bytes, suggestedName, meta }) => ({ filePath, publicUrl })
  saveFile = null,
  suggestedName = null,
  meta = null,
} = {}) {
  if (!page) throw new Error('captureScreenshotArtifact: page is required');

  // Try to gather viewport ratio metadata consistently
  let viewportRatio = null;
  let viewportWidth = null;
  let viewportHeight = null;
  try {
    const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    viewportWidth = (typeof vp.width === 'number') ? vp.width : null;
    viewportHeight = (typeof vp.height === 'number') ? vp.height : null;
    if (viewportWidth && viewportHeight) viewportRatio = viewportWidth / viewportHeight;
  } catch {}

  // Auto strategy: prefer the simplest built-in capture.
  // Keep 'chunked' as an explicit opt-in for extreme pages.
  let chosen = strategy;
  if (chosen === 'auto') {
    chosen = 'puppeteer';
  }

  let captured;
  if (chosen === 'puppeteer') {
    captured = await captureFullPagePuppeteer(page, { type, quality });
  } else if (chosen === 'cdp') {
    captured = await captureFullPageCDP(page, { type, quality });
  } else if (chosen === 'chunked') {
    captured = await captureFullPageChunked(page, { type, maxChunkHeight, overlap });
  } else {
    throw new Error(`captureScreenshotArtifact: unsupported strategy: ${String(strategy)}`);
  }

  const buffer = captured && captured.buffer ? captured.buffer : null;
  const bytes = buffer ? Buffer.byteLength(buffer) : 0;

  const mimeType =
    type === 'jpeg' ? 'image/jpeg'
      : type === 'png' ? 'image/png'
        : type === 'webp' ? 'image/webp'
          : null;

  const outCfg = (output && typeof output === 'object') ? output : {};
  const wantBuffer = outCfg.buffer !== false; // default true
  const wantBase64 = outCfg.base64 === true;
  const wantDataUrl = outCfg.dataUrl === true;
  const wantFile = outCfg.file === true;

  const base64 = (wantBase64 && buffer) ? buffer.toString('base64') : null;
  const dataUrl = (wantDataUrl && buffer && mimeType)
    ? `data:${mimeType};base64,${buffer.toString('base64')}`
    : null;

  let filePath = null;
  let publicUrl = null;
  if (wantFile) {
    if (typeof saveFile !== 'function') {
      throw new Error('captureScreenshotArtifact: output.file=true requires saveFile callback');
    }
    if (!buffer) {
      throw new Error('captureScreenshotArtifact: cannot save file without captured buffer');
    }
    const saved = await saveFile({
      buffer,
      type,
      mimeType,
      bytes,
      suggestedName: (typeof suggestedName === 'string' && suggestedName.trim()) ? suggestedName.trim() : null,
      meta: (meta && typeof meta === 'object') ? meta : null,
    });
    if (saved && typeof saved === 'object') {
      if (typeof saved.filePath === 'string' && saved.filePath) filePath = saved.filePath;
      if (typeof saved.publicUrl === 'string' && saved.publicUrl) publicUrl = saved.publicUrl;
    }
  }

  const sources = [];
  if (wantBuffer && buffer) sources.push('buffer');
  if (base64) sources.push('base64');
  if (dataUrl) sources.push('dataUrl');
  if (filePath || publicUrl) sources.push('file');

  return {
    // Representations (nullable)
    buffer: wantBuffer ? buffer : null,
    base64,
    dataUrl,
    filePath,
    publicUrl,

    // Meta
    bytes,
    type,
    mimeType,
    viewportRatio,
    viewportWidth,
    viewportHeight,
    strategy: captured.strategy || chosen,
    // Only the page's top left was taken: it was larger than a capture takes in.
    clipped: captured.clipped === true,
    sources,
  };
}

module.exports = {
  captureScreenshotArtifact,
  bufferLikeToBase64,
  fullPageClipSize,
  MAX_CAPTURE_WIDTH,
  MAX_CAPTURE_HEIGHT,
};
