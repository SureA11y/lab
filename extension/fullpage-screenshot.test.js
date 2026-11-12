'use strict';

// The scan's picture of the whole page (fullpage-screenshot.js), in Firefox:
// one capture of the document by its rect, at the screen's scale, smaller for
// a page larger than an image may be, and the visible part when that fails;
// never a scroll of the page. Firefox's extension API is a stand-in here.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, 'fullpage-screenshot.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
// Plain copies: what the module makes comes from its own context.
const plain = (v) => JSON.parse(JSON.stringify(v));

// The module in a context like Firefox's background page: `browser` with
// tabs.captureTab, and the background's execInTab, which answers the
// page's size and records every function sent to the page.
function firefoxWith({page = {width: 1200, height: 5000, dpr: 2}, captureTab} = {}) {
    const calls = {capture: [], visible: 0, inPage: []};
    const browser = {
        tabs: {
            captureTab: captureTab || (async (tabId, options) => { calls.capture.push([tabId, options]); return PNG; }),
            captureVisibleTab: async () => { calls.visible++; return 'data:image/png;base64,VISIBLE'; },
            get: async () => ({windowId: 1}),
        },
    };
    const context = {
        browser,
        console,
        __A11Y_EXEC_IN_TAB: async (tabId, {func}) => {
            calls.inPage.push(String(func));
            return [page];
        },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(SOURCE, context);
    return {shot: context.A11YFullPageScreenshot, calls};
}

describe('the whole page, in Firefox', () => {
    test('is one capture of the document, at the screen\'s scale, and nothing scrolls', async () => {
        const {shot, calls} = firefoxWith();
        const out = await shot.captureBest(3);
        assert.deepEqual(plain(out), {dataUrl: PNG, mode: 'firefox-fullpage'});
        assert.deepEqual(plain(calls.capture), [[3, {format: 'png', rect: {x: 0, y: 0, width: 1200, height: 5000}, scale: 2}]]);
        for (const fn of calls.inPage) assert.doesNotMatch(fn, /scroll(To|By)?\s*\(|scrollIntoView/, 'the page is only measured');
    });

    test('a page larger than an image may be is pictured smaller', async () => {
        const {shot, calls} = firefoxWith({page: {width: 1200, height: 80000, dpr: 2}});
        await shot.captureBest(3);
        const {scale, rect} = calls.capture[0][1];
        assert.deepEqual(plain(rect), {x: 0, y: 0, width: 1200, height: 80000});
        assert.ok(scale < 1 && 80000 * scale <= 32000, `scale ${scale}`);
    });

    test('when the capture fails, the visible part, not a scroll', async () => {
        const {shot, calls} = firefoxWith({captureTab: async () => { throw new Error('rect not supported'); }});
        const out = await shot.captureBest(3);
        assert.equal(out.mode, 'viewport-fallback');
        assert.equal(calls.visible, 1);
        for (const fn of calls.inPage) assert.doesNotMatch(fn, /scroll(To|By)?\s*\(|scrollIntoView/);
    });
});
