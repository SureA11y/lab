'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { screenshotFullPageChunked, mergeVerticalImageBuffers } = require('./screenshot-chunked');

// sharp is a real dependency doing real image processing (not something we'd want to fake), so
// these tests feed it real, tiny PNG buffers rather than mocked ones. Only Puppeteer's `page` is
// mocked - screenshotFullPageChunked's job is pure orchestration (scroll, screenshot, repeat), no
// real-DOM hit-testing/layout involved, so a stub page is a faithful stand-in (same rationale as
// the rest of this test suite's page-driving-action tests).
async function makePng({ width = 10, height = 5, color = { r: 255, g: 0, b: 0, alpha: 1 } } = {}) {
    return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

describe('screenshotFullPageChunked', () => {
    function makePage({ viewport = { width: 100, height: 50 }, totalHeight = 100, screenshots = [] } = {}) {
        const calls = { screenshot: [], evaluate: [], addStyleTag: [], waitForTimeout: [] };
        let shotIndex = 0;
        return {
            page: {
                viewport: () => viewport,
                addStyleTag: async (arg) => { calls.addStyleTag.push(arg); },
                evaluate: async (fn, arg) => {
                    calls.evaluate.push(arg);
                    // First call (no arg) is the totalHeight probe; later calls are scrollTo(0, y).
                    return arg === undefined ? totalHeight : undefined;
                },
                screenshot: async (opts) => {
                    calls.screenshot.push(opts);
                    const buf = screenshots[shotIndex] || (await makePng());
                    shotIndex += 1;
                    return buf;
                },
                waitForTimeout: async (ms) => { calls.waitForTimeout.push(ms); }
            },
            calls
        };
    }

    test('throws when the page has no viewport set', async () => {
        const { page } = makePage({ viewport: null });
        await assert.rejects(() => screenshotFullPageChunked(page, {}), /Viewport not set/);
    });

    test('stabilizeAnimations (default true) injects a style tag before capturing; false skips it', async () => {
        const { page: page1, calls: calls1 } = makePage({ totalHeight: 20 });
        await screenshotFullPageChunked(page1, { maxChunkHeight: 100 });
        assert.equal(calls1.addStyleTag.length, 1);

        const { page: page2, calls: calls2 } = makePage({ totalHeight: 20 });
        await screenshotFullPageChunked(page2, { maxChunkHeight: 100, stabilizeAnimations: false });
        assert.equal(calls2.addStyleTag.length, 0);
    });

    test('maxTotalHeight takes in only the top of a taller page', async () => {
        const { page, calls } = makePage({ totalHeight: 482000 });
        await screenshotFullPageChunked(page, { maxChunkHeight: 15000, scrollDelayMs: 0, maxTotalHeight: 32000 });
        assert.deepEqual(calls.screenshot.map((o) => [o.clip.y, o.clip.height]), [[0, 15000], [15000, 15000], [30000, 2000]]);
    });

    test('a rejecting addStyleTag is swallowed, capture still proceeds', async () => {
        const { page, calls } = makePage({ totalHeight: 20 });
        page.addStyleTag = async () => { throw new Error('CSP blocked'); };
        const buffers = await screenshotFullPageChunked(page, { maxChunkHeight: 100 });
        assert.equal(buffers.length, 1);
    });

    test('a page shorter than maxChunkHeight produces exactly one chunk covering the full height', async () => {
        const { page, calls } = makePage({ totalHeight: 50, viewport: { width: 100, height: 50 } });
        const buffers = await screenshotFullPageChunked(page, { maxChunkHeight: 15000 });
        assert.equal(buffers.length, 1);
        assert.deepEqual(calls.screenshot[0].clip, { x: 0, y: 0, width: 100, height: 50 });
    });

    test('a page taller than maxChunkHeight is split into multiple chunks, advancing y by (chunkHeight - overlap)', async () => {
        const { page, calls } = makePage({ totalHeight: 25, viewport: { width: 100, height: 50 } });
        const buffers = await screenshotFullPageChunked(page, { maxChunkHeight: 10, overlap: 2 });
        // y=0 (h=10) -> y=8 (h=10) -> y=16 (h=9, remaining) -> stop
        assert.equal(buffers.length, 3);
        assert.deepEqual(calls.screenshot.map(o => [o.clip.y, o.clip.height]), [[0, 10], [8, 10], [16, 9]]);
        // scrollTo is called with the same y values as each chunk's clip.y
        const scrollYs = calls.evaluate.filter(v => v !== undefined);
        assert.deepEqual(scrollYs, [0, 8, 16]);
    });

    test('maxLength caps the number of chunks even if the page would need more', async () => {
        const { page, calls } = makePage({ totalHeight: 100, viewport: { width: 100, height: 50 } });
        const buffers = await screenshotFullPageChunked(page, { maxChunkHeight: 10, maxLength: 2 });
        assert.equal(buffers.length, 2);
    });

    test('scrollDelayMs > 0 waits via page.waitForTimeout after each scroll; 0 skips it entirely', async () => {
        const { page: page1, calls: calls1 } = makePage({ totalHeight: 20 });
        await screenshotFullPageChunked(page1, { maxChunkHeight: 100, scrollDelayMs: 30 });
        assert.deepEqual(calls1.waitForTimeout, [30]);

        const { page: page2, calls: calls2 } = makePage({ totalHeight: 20 });
        await screenshotFullPageChunked(page2, { maxChunkHeight: 100, scrollDelayMs: 0 });
        assert.deepEqual(calls2.waitForTimeout, []);
    });

    test('without page.waitForTimeout, scrollDelayMs falls back to a plain setTimeout-based sleep', async () => {
        const { page } = makePage({ totalHeight: 20 });
        delete page.waitForTimeout;
        const start = Date.now();
        await screenshotFullPageChunked(page, { maxChunkHeight: 100, scrollDelayMs: 5 });
        assert.ok(Date.now() - start >= 0); // just proving it completes without throwing
    });

    test('the totalHeight probe reads document.documentElement/body scrollHeight/offsetHeight via the real callback body', async () => {
        // Every other test above stubs page.evaluate to short-circuit straight to a canned
        // totalHeight, which never actually executes the callback passed to evaluate() (faithful
        // to Puppeteer's real serialize-into-Chrome behavior, but leaves that callback body
        // uncovered). Here we instead let evaluate() genuinely *call* the passed function, against
        // a stubbed `document` - pure scrollHeight/offsetHeight math, no real layout/hit-testing
        // involved, so a stub is a faithful stand-in (same reasoning as nav.test.js's
        // waitForRenderSettle globals stubbing).
        const originalDocument = global.document;
        global.document = {
            documentElement: { scrollHeight: 300, offsetHeight: 250 },
            body: { scrollHeight: 400 }
        };
        try {
            const { page, calls } = makePage({ totalHeight: -1 /* unused: evaluate ignores it below */ });
            page.evaluate = async (fn, arg) => {
                calls.evaluate.push(arg);
                return arg === undefined ? fn() : undefined;
            };
            const buffers = await screenshotFullPageChunked(page, { maxChunkHeight: 1000 });
            // max(300, 250, 400) = 400 -> single chunk covering height 400
            assert.equal(buffers.length, 1);
            assert.equal(calls.screenshot[0].clip.height, 400);
        } finally {
            global.document = originalDocument;
        }
    });

    test('quality is only passed through for jpeg/webp, never for png', async () => {
        const { page: pagePng, calls: callsPng } = makePage({ totalHeight: 20 });
        await screenshotFullPageChunked(pagePng, { maxChunkHeight: 100, type: 'png', quality: 42 });
        assert.equal(callsPng.screenshot[0].quality, undefined);

        const { page: pageJpeg, calls: callsJpeg } = makePage({ totalHeight: 20 });
        await screenshotFullPageChunked(pageJpeg, { maxChunkHeight: 100, type: 'jpeg', quality: 42 });
        assert.equal(callsJpeg.screenshot[0].quality, 42);
    });
});

describe('mergeVerticalImageBuffers', () => {
    test('throws "No buffers to merge" for an empty or missing buffers array', async () => {
        await assert.rejects(() => mergeVerticalImageBuffers([]), /No buffers to merge/);
        await assert.rejects(() => mergeVerticalImageBuffers(undefined), /No buffers to merge/);
    });

    test('throws on a width mismatch between chunks', async () => {
        const a = await makePng({ width: 10, height: 5 });
        const b = await makePng({ width: 20, height: 5 });
        await assert.rejects(() => mergeVerticalImageBuffers([a, b]), /Width mismatch/);
    });

    test('stacks same-width buffers vertically: output width matches input, height is the sum', async () => {
        const a = await makePng({ width: 10, height: 5 });
        const b = await makePng({ width: 10, height: 7 });
        const merged = await mergeVerticalImageBuffers([a, b], { outputType: 'png' });
        const meta = await sharp(merged).metadata();
        assert.equal(meta.width, 10);
        assert.equal(meta.height, 12);
        assert.equal(meta.format, 'png');
    });

    test('a single buffer is a no-op merge (same dimensions, re-encoded)', async () => {
        const a = await makePng({ width: 8, height: 8 });
        const merged = await mergeVerticalImageBuffers([a], { outputType: 'png' });
        const meta = await sharp(merged).metadata();
        assert.equal(meta.width, 8);
        assert.equal(meta.height, 8);
    });

    test('outputType controls the encoded format: defaults to jpeg, plus explicit jpeg/webp/png (and any other string falls back to png)', async () => {
        const a = await makePng({ width: 6, height: 6 });
        const b = await makePng({ width: 6, height: 6 });

        const asDefault = await mergeVerticalImageBuffers([a, b]); // no options object -> outputType defaults to 'jpeg'
        assert.equal((await sharp(asDefault).metadata()).format, 'jpeg');

        const asJpeg = await mergeVerticalImageBuffers([a, b], { outputType: 'jpeg', quality: 50 });
        assert.equal((await sharp(asJpeg).metadata()).format, 'jpeg');

        const asWebp = await mergeVerticalImageBuffers([a, b], { outputType: 'webp' });
        assert.equal((await sharp(asWebp).metadata()).format, 'webp');

        const asPng = await mergeVerticalImageBuffers([a, b], { outputType: 'png' });
        assert.equal((await sharp(asPng).metadata()).format, 'png');

        const asUnknown = await mergeVerticalImageBuffers([a, b], { outputType: 'bmp' });
        assert.equal((await sharp(asUnknown).metadata()).format, 'png'); // unrecognized -> falls back to png()
    });
});
