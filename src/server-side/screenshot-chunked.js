'use strict';

const sharp = require('sharp');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
}

async function wait(page, ms) {
    // Puppeteer newer versions
    if (page && typeof page.waitForTimeout === 'function') {
        return page.waitForTimeout(ms);
    }
    // Universal fallback
    return sleep(ms);
}

/**
 * Capture a very tall page in vertical chunks.
 * Returns an array of Buffers (each one is an image).
 */
async function screenshotFullPageChunked(page, {
    type = 'png',
    quality = 80,
    maxChunkHeight = 15000,
    overlap = 0,
    scrollDelayMs = 80,
    stabilizeAnimations = true,
    maxLength = 0,
    // The most of the page's height taken in; 0 for all of it.
    maxTotalHeight = 0
} = {}) {
    const viewport = page.viewport();
    if (!viewport) throw new Error('Viewport not set. Call page.setViewport first.');

    if (stabilizeAnimations) {
        await page.addStyleTag({
            content: `
        * { scroll-behavior: auto !important; }
        * { transition: none !important; animation: none !important; }
      `
        }).catch(() => {});
    }

    const pageHeight = await page.evaluate(() => {
        const de = document.documentElement;
        const b = document.body;
        return Math.max(de.scrollHeight, de.offsetHeight, b ? b.scrollHeight : 0);
    });
    const totalHeight = maxTotalHeight > 0 ? Math.min(pageHeight, maxTotalHeight) : pageHeight;

    const buffers = [];
    let y = 0;

    while (y < totalHeight && (!maxLength || buffers.length < maxLength)) {
        const remaining = totalHeight - y;
        const h = Math.min(maxChunkHeight, remaining);

        await page.evaluate(yy => window.scrollTo(0, yy), y);
        if (scrollDelayMs) await wait(page, scrollDelayMs);

        const buf = await page.screenshot({
            type,
            quality: (type === 'jpeg' || type === 'webp') ? quality : undefined,
            clip: { x: 0, y, width: viewport.width, height: h }
        });

        buffers.push(buf);

        if (h === remaining) break;
        y += (h - overlap);
    }

    return buffers;
}

/**
 * Merge vertical image buffers into one image buffer.
 * Best results if input buffers are PNG (recommended).
 */
async function mergeVerticalImageBuffers(buffers, {
    outputType = 'jpeg',   // 'png' | 'jpeg' | 'webp'
    quality = 80           // for jpeg/webp
} = {}) {
    if (!buffers?.length) throw new Error('No buffers to merge');

    const metas = await Promise.all(buffers.map(b => sharp(b).metadata()));
    const width = metas[0]?.width;
    if (!width) throw new Error('Could not read image width');

    for (const m of metas) {
        if (m.width !== width) throw new Error(`Width mismatch: expected ${width}, got ${m.width}`);
        if (!m.height) throw new Error('Could not read image height');
    }

    const totalHeight = metas.reduce((sum, m) => sum + m.height, 0);

    let top = 0;
    const composites = buffers.map((buf, i) => {
        const entry = { input: buf, left: 0, top };
        top += metas[i].height;
        return entry;
    });

    let out = sharp({
        create: {
            width,
            height: totalHeight,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    }).composite(composites);

    if (outputType === 'jpeg') return out.jpeg({ quality }).toBuffer();
    if (outputType === 'webp') return out.webp({ quality }).toBuffer();
    return out.png().toBuffer();
}

module.exports = {
    screenshotFullPageChunked,
    mergeVerticalImageBuffers
};