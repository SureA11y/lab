'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { captureScreenshotArtifact, bufferLikeToBase64, fullPageClipSize, MAX_CAPTURE_WIDTH, MAX_CAPTURE_HEIGHT } = require('./screenshot-capture');
// Same live singleton screenshot-capture.js already required internally (Node's module cache
// guarantees this), so monkey-patching it here reaches the internal captureFullPageChunked() call.
const screenshotChunked = require('./screenshot-chunked');

async function makePng({ width = 4, height = 4 } = {}) {
    return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer();
}

describe('bufferLikeToBase64', () => {
    test('encodes a Buffer', () => {
        assert.equal(bufferLikeToBase64(Buffer.from('hi')), Buffer.from('hi').toString('base64'));
    });

    test('encodes an ArrayBuffer', () => {
        const ab = new TextEncoder().encode('hi').buffer;
        assert.equal(bufferLikeToBase64(ab), Buffer.from(ab).toString('base64'));
    });

    test('encodes a typed-array view, respecting byteOffset/byteLength (not the whole underlying buffer)', () => {
        const underlying = new Uint8Array([1, 2, 3, 4, 5]).buffer;
        const view = new Uint8Array(underlying, 1, 2); // bytes [2, 3] only
        assert.equal(bufferLikeToBase64(view), Buffer.from([2, 3]).toString('base64'));
    });

    test('returns null for falsy or unsupported values', () => {
        assert.equal(bufferLikeToBase64(null), null);
        assert.equal(bufferLikeToBase64(undefined), null);
        assert.equal(bufferLikeToBase64(0), null);
        assert.equal(bufferLikeToBase64(''), null);
        assert.equal(bufferLikeToBase64('a string'), null);
        assert.equal(bufferLikeToBase64({ not: 'buffer-like' }), null);
    });
});

describe('captureScreenshotArtifact', () => {
    function makeBasePage(overrides = {}) {
        return {
            evaluate: async () => ({ width: 1280, height: 800 }),
            screenshot: async () => makePng(),
            ...overrides
        };
    }

    test('throws when page is missing', async () => {
        await assert.rejects(() => captureScreenshotArtifact(null), /page is required/);
    });

    test('throws for an unsupported strategy', async () => {
        const page = makeBasePage();
        await assert.rejects(
            () => captureScreenshotArtifact(page, { strategy: 'not-a-real-strategy' }),
            /unsupported strategy/
        );
    });

    test('strategy "auto" resolves to the puppeteer capture path', async () => {
        const page = makeBasePage();
        const out = await captureScreenshotArtifact(page, { strategy: 'auto' });
        assert.equal(out.strategy, 'puppeteer');
        assert.ok(Buffer.isBuffer(out.buffer));
    });

    test('viewportRatio/viewportWidth/viewportHeight are read from page.evaluate()', async () => {
        const page = makeBasePage({ evaluate: async () => ({ width: 400, height: 200 }) });
        const out = await captureScreenshotArtifact(page);
        assert.equal(out.viewportWidth, 400);
        assert.equal(out.viewportHeight, 200);
        assert.equal(out.viewportRatio, 2);
    });

    test('a page.evaluate() rejection is swallowed: viewport fields stay null, capture still succeeds', async () => {
        const page = makeBasePage({ evaluate: async () => { throw new Error('detached'); } });
        const out = await captureScreenshotArtifact(page);
        assert.equal(out.viewportWidth, null);
        assert.equal(out.viewportHeight, null);
        assert.equal(out.viewportRatio, null);
        assert.ok(Buffer.isBuffer(out.buffer));
    });

    test('non-numeric viewport width/height from page.evaluate() fall back to null (no ratio computed)', async () => {
        const page = makeBasePage({ evaluate: async () => ({ width: 'nope', height: 200 }) });
        const out = await captureScreenshotArtifact(page);
        assert.equal(out.viewportWidth, null);
        assert.equal(out.viewportHeight, 200);
        assert.equal(out.viewportRatio, null);
    });

    describe('strategy: puppeteer', () => {
        test('"jpg" is normalized to "jpeg", and quality is only sent for jpeg/webp', async () => {
            let seenOpts = null;
            const page = makeBasePage({ screenshot: async (opts) => { seenOpts = opts; return makePng(); } });
            await captureScreenshotArtifact(page, { strategy: 'puppeteer', type: 'jpg', quality: 55 });
            assert.equal(seenOpts.type, 'jpeg');
            assert.equal(seenOpts.quality, 55);

            let seenOptsPng = null;
            const pagePng = makeBasePage({ screenshot: async (opts) => { seenOptsPng = opts; return makePng(); } });
            await captureScreenshotArtifact(pagePng, { strategy: 'puppeteer', type: 'png', quality: 55 });
            assert.equal(seenOptsPng.quality, undefined);
        });

        test('always captures fullPage:true', async () => {
            let seenOpts = null;
            const page = makeBasePage({ screenshot: async (opts) => { seenOpts = opts; return makePng(); } });
            await captureScreenshotArtifact(page, { strategy: 'puppeteer' });
            assert.equal(seenOpts.fullPage, true);
        });
    });

    describe('strategy: cdp', () => {
        function makeCdpPage({ contentSize = { width: 300, height: 900 }, layoutViewport = { clientWidth: 320 }, captureImpl = null } = {}) {
            const sent = [];
            let detachCalls = 0;
            const client = {
                send: async (method, params) => {
                    sent.push([method, params]);
                    if (method === 'Page.getLayoutMetrics') return { contentSize, layoutViewport };
                    if (method === 'Page.captureScreenshot') {
                        if (captureImpl) return captureImpl(params);
                        const buf = await makePng();
                        return { data: buf.toString('base64') };
                    }
                    return {};
                },
                detach: async () => { detachCalls += 1; }
            };
            const page = makeBasePage({ target: () => ({ createCDPSession: async () => client }) });
            return { page, sent, client, detachCallCount: () => detachCalls };
        }

        // Note: captureScreenshotArtifact's returned artifact object does NOT surface width/height
        // at all (only captureFullPageCDP's internal return value has them) - so these tests assert
        // on the clip actually sent to Page.captureScreenshot instead, which is the only externally
        // observable trace of that computation.
        test('happy path: computes clip width as the viewport width, clip height as contentHeight, and decodes the base64 result', async () => {
            const { page, sent } = makeCdpPage({ contentSize: { width: 300, height: 900 }, layoutViewport: { clientWidth: 500 } });
            const out = await captureScreenshotArtifact(page, { strategy: 'cdp', type: 'jpeg' });
            assert.equal(out.strategy, 'cdp');
            assert.ok(Buffer.isBuffer(out.buffer));
            assert.ok(sent.some(([m]) => m === 'Page.enable'));
            const captureCall = sent.find(([m]) => m === 'Page.captureScreenshot');
            assert.deepEqual(captureCall[1].clip, { x: 0, y: 0, width: 500, height: 900, scale: 1 }); // the viewport's width, content height only
        });

        test('falls back to visualViewport.clientWidth when layoutViewport is absent', async () => {
            const sent = [];
            const page = makeBasePage({
                target: () => ({
                    createCDPSession: async () => ({
                        send: async (method, params) => {
                            sent.push([method, params]);
                            if (method === 'Page.getLayoutMetrics') return { contentSize: { width: 100, height: 50 }, visualViewport: { clientWidth: 150 } };
                            if (method === 'Page.captureScreenshot') return { data: (await makePng()).toString('base64') };
                            return {};
                        }
                    })
                })
            });
            await captureScreenshotArtifact(page, { strategy: 'cdp' });
            const captureCall = sent.find(([m]) => m === 'Page.captureScreenshot');
            assert.equal(captureCall[1].clip.width, 150); // the viewport width via visualViewport fallback
        });

        test('missing layout metrics entirely fall back to a clip width/height of at least 1', async () => {
            const sent = [];
            const page = makeBasePage({
                target: () => ({
                    createCDPSession: async () => ({
                        send: async (method, params) => {
                            sent.push([method, params]);
                            if (method === 'Page.getLayoutMetrics') return {};
                            if (method === 'Page.captureScreenshot') return { data: (await makePng()).toString('base64') };
                            return {};
                        }
                    })
                })
            });
            await captureScreenshotArtifact(page, { strategy: 'cdp' });
            const captureCall = sent.find(([m]) => m === 'Page.captureScreenshot');
            assert.equal(captureCall[1].clip.width, 1);
            assert.equal(captureCall[1].clip.height, 1);
        });

        test('a page larger than a capture takes in is clipped to its top left, and the artifact says so', async () => {
            // A 5 MB unbroken text laid out at 3.3M x 482k px: the whole clip
            // never finished, and the scan waited out its stage limit.
            const { page, sent } = makeCdpPage({ contentSize: { width: 3329084, height: 481758 }, layoutViewport: { clientWidth: 1280 } });
            const out = await captureScreenshotArtifact(page, { strategy: 'cdp', type: 'jpeg' });
            const { clip } = sent.find(([m]) => m === 'Page.captureScreenshot')[1];
            assert.equal(clip.width, 1280);
            assert.equal(clip.height, MAX_CAPTURE_HEIGHT);
            assert.equal(out.clipped, true);
        });

        test('content wider than a phone viewport does not widen the picture past the viewport', async () => {
            // A row of filters 1,608 px wide at 375 px: the table reflowed to
            // the phone, but the picture was as wide as the row.
            const { page, sent } = makeCdpPage({ contentSize: { width: 1608, height: 900 }, layoutViewport: { clientWidth: 375 } });
            const out = await captureScreenshotArtifact(page, { strategy: 'cdp', type: 'jpeg' });
            const { clip } = sent.find(([m]) => m === 'Page.captureScreenshot')[1];
            assert.deepEqual(clip, { x: 0, y: 0, width: 375, height: 900, scale: 1 });
            assert.equal(out.clipped, false);
        });

        test('a viewport wider than a capture takes in is clipped to its left', async () => {
            assert.deepEqual(fullPageClipSize(20000, 900, 20000), { width: MAX_CAPTURE_WIDTH, height: 900, clipped: true });
        });

        test('a long page keeps its width and is clipped at the most height; a page within the limits is not clipped', async () => {
            assert.deepEqual(fullPageClipSize(1280, 200000, 1280), { width: 1280, height: MAX_CAPTURE_HEIGHT, clipped: true });
            assert.deepEqual(fullPageClipSize(300, 900, 500), { width: 500, height: 900, clipped: false });
            assert.deepEqual(fullPageClipSize(1608, 900, 375), { width: 375, height: 900, clipped: false });
            const { page } = makeCdpPage();
            assert.equal((await captureScreenshotArtifact(page, { strategy: 'cdp' })).clipped, false);
        });

        test('Page.captureScreenshot failing falls back to chunked capture, tagging strategy "cdp-chunked-fallback"', async () => {
            const { page } = makeCdpPage({ captureImpl: () => { throw new Error('capture failed'); } });
            // Wire up enough of the page for the chunked fallback (captureFullPageChunked ->
            // screenshotFullPageChunked) to succeed: viewport/addStyleTag/evaluate(totalHeight)/screenshot.
            // evaluate() is called twice total: once for captureScreenshotArtifact's own
            // viewport-ratio probe (no args), then once per screenshotFullPageChunked call
            // (totalHeight probe with no args, then one scrollTo(0, y) call per chunk with an arg).
            page.viewport = () => ({ width: 10, height: 10 });
            page.addStyleTag = async () => {};
            let evalCallCount = 0;
            page.evaluate = async (fn, arg) => {
                evalCallCount += 1;
                if (evalCallCount === 1) return { width: 1280, height: 800 }; // viewport-ratio probe
                return arg === undefined ? 10 : undefined; // totalHeight probe, then scrollTo calls
            };
            page.screenshot = async () => makePng({ width: 10, height: 10 });

            const out = await captureScreenshotArtifact(page, { strategy: 'cdp' });
            assert.equal(out.strategy, 'cdp-chunked-fallback');
            assert.ok(Buffer.isBuffer(out.buffer));
        });

        test('when chunked fallback ALSO fails, falls back to puppeteer capture, tagging "cdp-puppeteer-fallback"', async () => {
            const { page } = makeCdpPage({ captureImpl: () => { throw new Error('capture failed'); } });
            page.viewport = () => null; // makes screenshotFullPageChunked throw "Viewport not set"
            let puppeteerCalled = false;
            page.screenshot = async (opts) => { puppeteerCalled = true; return makePng(); };

            const out = await captureScreenshotArtifact(page, { strategy: 'cdp' });
            assert.equal(out.strategy, 'cdp-puppeteer-fallback');
            assert.equal(puppeteerCalled, true);
        });

        describe('CDP session cleanup', () => {
            test('the happy path detaches the CDP session exactly once', async () => {
                const { page, detachCallCount } = makeCdpPage();
                await captureScreenshotArtifact(page, { strategy: 'cdp' });
                assert.equal(detachCallCount(), 1);
            });

            test('the chunked-fallback path still detaches the CDP session', async () => {
                const { page, detachCallCount } = makeCdpPage({ captureImpl: () => { throw new Error('capture failed'); } });
                page.viewport = () => ({ width: 10, height: 10 });
                page.addStyleTag = async () => {};
                let evalCallCount = 0;
                page.evaluate = async (fn, arg) => {
                    evalCallCount += 1;
                    if (evalCallCount === 1) return { width: 1280, height: 800 };
                    return arg === undefined ? 10 : undefined;
                };
                page.screenshot = async () => makePng({ width: 10, height: 10 });

                const out = await captureScreenshotArtifact(page, { strategy: 'cdp' });
                assert.equal(out.strategy, 'cdp-chunked-fallback');
                assert.equal(detachCallCount(), 1);
            });

            test('the puppeteer-fallback path still detaches the CDP session', async () => {
                const { page, detachCallCount } = makeCdpPage({ captureImpl: () => { throw new Error('capture failed'); } });
                page.viewport = () => null; // makes screenshotFullPageChunked throw "Viewport not set"
                page.screenshot = async () => makePng();

                const out = await captureScreenshotArtifact(page, { strategy: 'cdp' });
                assert.equal(out.strategy, 'cdp-puppeteer-fallback');
                assert.equal(detachCallCount(), 1);
            });

            test('the session is still detached even when every fallback also fails', async () => {
                const { page, detachCallCount } = makeCdpPage({ captureImpl: () => { throw new Error('capture failed'); } });
                page.viewport = () => null; // chunked fallback throws
                page.screenshot = async () => { throw new Error('puppeteer capture failed too'); };

                await assert.rejects(() => captureScreenshotArtifact(page, { strategy: 'cdp' }));
                assert.equal(detachCallCount(), 1);
            });

            test('a client with no detach method (e.g. an already-closed target) does not break capture', async () => {
                const { page, client } = makeCdpPage();
                delete client.detach;
                const out = await captureScreenshotArtifact(page, { strategy: 'cdp' });
                assert.equal(out.strategy, 'cdp');
            });
        });
    });

    describe('strategy: chunked', () => {
        test('happy path delegates to screenshotFullPageChunked + mergeVerticalImageBuffers and tags strategy "chunked"', async () => {
            let evalCallCount = 0;
            const page = makeBasePage({
                viewport: () => ({ width: 8, height: 8 }),
                addStyleTag: async () => {},
                evaluate: async (fn, arg) => {
                    evalCallCount += 1;
                    if (evalCallCount === 1) return { width: 1280, height: 800 }; // viewport-ratio probe
                    return arg === undefined ? 16 : undefined; // totalHeight probe, then scrollTo
                },
                screenshot: async () => makePng({ width: 8, height: 8 })
            });
            const out = await captureScreenshotArtifact(page, { strategy: 'chunked', maxChunkHeight: 8 });
            assert.equal(out.strategy, 'chunked');
            assert.ok(Buffer.isBuffer(out.buffer));
        });

        test('a chunked capture takes in no more of the page\'s height than a single capture', async () => {
            const original = screenshotChunked.screenshotFullPageChunked;
            let given = null;
            screenshotChunked.screenshotFullPageChunked = async (_page, opts) => { given = opts; return [await makePng()]; };
            try {
                await captureScreenshotArtifact(makeBasePage(), { strategy: 'chunked' });
                assert.equal(given.maxTotalHeight, MAX_CAPTURE_HEIGHT);
            } finally {
                screenshotChunked.screenshotFullPageChunked = original;
            }
        });

        test('when screenshot-chunked.js is unavailable, throws a clear "unavailable" error', async () => {
            const original = screenshotChunked.screenshotFullPageChunked;
            screenshotChunked.screenshotFullPageChunked = undefined;
            try {
                const page = makeBasePage();
                await assert.rejects(
                    () => captureScreenshotArtifact(page, { strategy: 'chunked' }),
                    /chunked screenshot capture is unavailable/
                );
            } finally {
                screenshotChunked.screenshotFullPageChunked = original;
            }
        });
    });

    describe('output modes', () => {
        test('default output is buffer-only: sources=["buffer"], base64/dataUrl/filePath/publicUrl all null', async () => {
            const page = makeBasePage();
            const out = await captureScreenshotArtifact(page);
            assert.ok(Buffer.isBuffer(out.buffer));
            assert.equal(out.base64, null);
            assert.equal(out.dataUrl, null);
            assert.equal(out.filePath, null);
            assert.equal(out.publicUrl, null);
            assert.deepEqual(out.sources, ['buffer']);
        });

        test('output.buffer:false omits the buffer from the result (but it was still captured for bytes/base64/etc.)', async () => {
            const page = makeBasePage();
            const out = await captureScreenshotArtifact(page, { output: { buffer: false, base64: true } });
            assert.equal(out.buffer, null);
            assert.ok(out.bytes > 0);
            assert.ok(out.base64);
            assert.deepEqual(out.sources, ['base64']);
        });

        test('output.base64 and output.dataUrl can both be requested alongside the buffer, in a stable sources order', async () => {
            const page = makeBasePage();
            const out = await captureScreenshotArtifact(page, { type: 'png', output: { base64: true, dataUrl: true } });
            assert.ok(out.base64);
            assert.equal(out.dataUrl, `data:image/png;base64,${out.base64}`);
            assert.deepEqual(out.sources, ['buffer', 'base64', 'dataUrl']);
        });

        test('mimeType (and therefore dataUrl) is null for a type outside png/jpeg/webp, even if dataUrl was requested', async () => {
            const page = makeBasePage();
            const out = await captureScreenshotArtifact(page, { type: 'gif', output: { dataUrl: true } });
            assert.equal(out.mimeType, null);
            assert.equal(out.dataUrl, null);
        });

        test('output.file:true without a saveFile callback throws', async () => {
            const page = makeBasePage();
            await assert.rejects(
                () => captureScreenshotArtifact(page, { output: { file: true } }),
                /output\.file=true requires saveFile callback/
            );
        });

        test('output.file:true calls saveFile with buffer/type/mimeType/bytes/suggestedName/meta, and uses its filePath/publicUrl', async () => {
            const page = makeBasePage();
            let receivedArgs = null;
            const saveFile = async (args) => { receivedArgs = args; return { filePath: '/tmp/shot.png', publicUrl: 'https://cdn.example/shot.png' }; };
            const out = await captureScreenshotArtifact(page, {
                type: 'png',
                output: { file: true },
                saveFile,
                suggestedName: '  my-shot  ',
                meta: { scanId: 42 }
            });
            assert.ok(Buffer.isBuffer(receivedArgs.buffer));
            assert.equal(receivedArgs.type, 'png');
            assert.equal(receivedArgs.mimeType, 'image/png');
            assert.equal(receivedArgs.bytes, out.bytes);
            assert.equal(receivedArgs.suggestedName, 'my-shot'); // trimmed
            assert.deepEqual(receivedArgs.meta, { scanId: 42 });
            assert.equal(out.filePath, '/tmp/shot.png');
            assert.equal(out.publicUrl, 'https://cdn.example/shot.png');
            assert.ok(out.sources.includes('file'));
        });

        test('a non-string/blank suggestedName is normalized to null before reaching saveFile', async () => {
            const page = makeBasePage();
            let receivedArgs = null;
            const saveFile = async (args) => { receivedArgs = args; return {}; };
            await captureScreenshotArtifact(page, { output: { file: true }, saveFile, suggestedName: '   ' });
            assert.equal(receivedArgs.suggestedName, null);
        });

        test('a non-object meta is normalized to null before reaching saveFile', async () => {
            const page = makeBasePage();
            let receivedArgs = null;
            const saveFile = async (args) => { receivedArgs = args; return {}; };
            await captureScreenshotArtifact(page, { output: { file: true }, saveFile, meta: 'not-an-object' });
            assert.equal(receivedArgs.meta, null);
        });

        test('when saveFile resolves without filePath/publicUrl, sources does not include "file"', async () => {
            const page = makeBasePage();
            const saveFile = async () => ({});
            const out = await captureScreenshotArtifact(page, { output: { file: true }, saveFile });
            assert.equal(out.filePath, null);
            assert.equal(out.publicUrl, null);
            assert.ok(!out.sources.includes('file'));
        });

        test('all four output modes together produce sources in the order buffer, base64, dataUrl, file', async () => {
            const page = makeBasePage();
            const saveFile = async () => ({ filePath: '/tmp/x.png' });
            const out = await captureScreenshotArtifact(page, {
                type: 'png',
                output: { buffer: true, base64: true, dataUrl: true, file: true },
                saveFile
            });
            assert.deepEqual(out.sources, ['buffer', 'base64', 'dataUrl', 'file']);
        });
    });
});
