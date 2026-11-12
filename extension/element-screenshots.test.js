'use strict';

// The extension's pictures of flagged elements (element-screenshots.js): which
// elements it pictures for the panel's choices, what each occurrence gets,
// that every highlight drawn is removed, and that a capture which would need
// the page scrolled is not taken. The page's step and the capture are
// stand-ins here; the real ones run in the page and the browser.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const shots = require('./element-screenshots.js');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function resultWith(...occurrences) {
    return {checksResults: [{ruleId: 'img-alt-present', outcome: 'fail', occurrences}]};
}

// Which elements to picture, as the binding plans them: the occurrences of
// the outcomes chosen, one entry per element.
const steps = {
    planScreenshots(result, {outcomes}) {
        const elements = [];
        const unlocated = [];
        const byKey = new Map();
        for (const cr of result.checksResults) {
            for (const o of cr.occurrences) {
                if (!outcomes.includes(o.occurrenceOutcome || cr.outcome)) continue;
                if (!o.selector) { unlocated.push(o); continue; }
                if (!byKey.has(o.selector)) {
                    const el = {selector: o.selector, shadowHostSelectors: o.shadowHostSelectors || null, occurrences: []};
                    byKey.set(o.selector, el);
                    elements.push(el);
                }
                byKey.get(o.selector).occurrences.push(o);
            }
        }
        return {elements, unlocated};
    }
};

const VIEW = {devicePixelRatio: 1, scroll: {x: 0, y: 0}, viewport: {width: 800, height: 600}};

// The page's side: each element ready unless its selector is in `skip`;
// every request recorded, and the highlights it holds.
function fakePage({skip = {}, clip = {x: 0, y: 0, width: 40, height: 20}} = {}) {
    const log = [];
    const held = new Set();
    return {
        log,
        held,
        evaluate: async (fn, [request]) => {
            assert.equal(fn, shots.pictureStepInPage, 'the extension\'s own step, which never scrolls');
            log.push(request);
            if (request.op === 'release') { held.delete(request.token); return {released: true}; }
            if (skip[request.selector]) return {skipped: skip[request.selector]};
            held.add(request.token);
            return {clip, view: VIEW, box: {x: 20, y: 20, width: 8, height: 8}, cropped: false};
        }
    };
}

function driverWith(page, {box = async () => PNG, now} = {}) {
    let closed = 0;
    return {steps, evaluate: page.evaluate, capturer: {box, close: async () => { closed++; }}, now, closed: () => closed};
}

describe('the panel\'s choices', () => {
    test('pictures failures by default, at most 50, framed as the lab frames them', () => {
        assert.deepEqual(shots.optionsFor(undefined, undefined), {outcomes: ['fail'], padding: 16, highlight: true, max: 50});
        assert.deepEqual(shots.optionsFor('failCantTell', 3).outcomes, ['fail', 'cantTell']);
        assert.equal(shots.optionsFor('fail', '7').max, 7, 'a number typed in the panel');
        assert.equal(shots.optionsFor('fail', 0).max, 50);
        assert.equal(shots.optionsFor('fail', 2.5).max, 50);
        assert.equal(shots.optionsFor('off', 10), null);
    });

    test('none chosen: the page is not touched, and the capture is closed', async () => {
        const page = fakePage();
        const driver = driverWith(page);
        const result = resultWith({selector: '#a'});
        await shots.pictureFlaggedElements(result, {choice: 'off'}, driver);
        assert.equal(result.checksResults[0].occurrences[0].screenshot, undefined);
        assert.deepEqual(page.log, []);
        assert.equal(driver.closed(), 1);
    });
});

describe('each occurrence considered', () => {
    test('gets its element\'s picture, one picture for an element flagged twice', async () => {
        const page = fakePage();
        const a1 = {selector: '#a'};
        const a2 = {selector: '#a'};
        const b = {selector: '#b', occurrenceOutcome: 'cantTell'};
        const pageLevel = {};
        await shots.pictureFlaggedElements(resultWith(a1, a2, b, pageLevel), {choice: 'fail'}, driverWith(page));
        assert.deepEqual(a1.screenshot, {dataUrl: PNG, box: {x: 20, y: 20, width: 8, height: 8}});
        assert.equal(a2.screenshot, a1.screenshot);
        assert.equal(b.screenshot, undefined, 'a can\'t tell, with failures only');
        assert.deepEqual(pageLevel.screenshot, {skipped: 'no-element'});
        const targets = page.log.filter((r) => r.op === 'target');
        assert.equal(targets.length, 1);
        // The lab's 16px of page around it, and the highlight's own room.
        assert.equal(targets[0].margin, 16 + shots.RING);
        assert.equal(targets[0].ring, shots.RING);
    });

    test('goes through the shadow roots its element is in', async () => {
        const page = fakePage();
        await shots.pictureFlaggedElements(resultWith({selector: 'button', shadowHostSelectors: ['my-app', 'my-menu']}), {choice: 'fail'}, driverWith(page));
        assert.deepEqual(page.log[0].hosts, ['my-app', 'my-menu']);
    });

    test('says why when its element can\'t be pictured, and draws nothing', async () => {
        const page = fakePage({skip: {'#hidden': 'hidden-in-container'}});
        const o = {selector: '#hidden'};
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, driverWith(page));
        assert.deepEqual(o.screenshot, {skipped: 'hidden-in-container'});
        assert.equal(page.held.size, 0);
    });

    test('says the capture failed, and the highlight is removed all the same', async () => {
        const page = fakePage();
        const o = {selector: '#a'};
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, driverWith(page, {box: async () => { throw new Error('tab hidden'); }}));
        assert.deepEqual(o.screenshot, {skipped: 'capture-failed', error: 'tab hidden'});
        assert.deepEqual(page.log.map((r) => r.op), ['target', 'release']);
        assert.equal(page.held.size, 0);
    });

    test('a capture that gives no PNG is a failed capture', async () => {
        const o = {selector: '#a'};
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, driverWith(fakePage(), {box: async () => 'data:image/jpeg;base64,/9j/'}));
        assert.equal(o.screenshot.skipped, 'capture-failed');
    });
});

describe('the limits of a scan', () => {
    test('past the most pictures chosen, the rest say the scan reached it', async () => {
        const occ = ['#a', '#b', '#c'].map((selector) => ({selector}));
        await shots.pictureFlaggedElements(resultWith(...occ), {choice: 'fail', max: 2}, driverWith(fakePage()));
        assert.ok(occ[0].screenshot.dataUrl && occ[1].screenshot.dataUrl);
        assert.deepEqual(occ[2].screenshot, {skipped: 'max-reached', max: 2});
    });

    test('past the time pictures may take, no further one is started', async () => {
        let t = 0;
        const occ = ['#a', '#b'].map((selector) => ({selector}));
        const page = fakePage();
        await shots.pictureFlaggedElements(resultWith(...occ), {choice: 'fail'}, driverWith(page, {
            now: () => t,
            box: async () => { t += shots.BUDGET_MS + 1; return PNG; }
        }));
        assert.ok(occ[0].screenshot.dataUrl);
        assert.deepEqual(occ[1].screenshot, {skipped: 'time-limit'});
        assert.equal(page.log.filter((r) => r.op === 'target').length, 1);
    });

    test('every highlight drawn is removed, and the capture closed once', async () => {
        const page = fakePage({skip: {'#b': 'zero-size'}});
        const driver = driverWith(page);
        await shots.pictureFlaggedElements(resultWith({selector: '#a'}, {selector: '#b'}, {selector: '#c'}), {choice: 'fail'}, driver);
        assert.equal(page.held.size, 0);
        assert.equal(driver.closed(), 1);
    });
});

describe('without scrolling', () => {
    test('where the visible tab is all a browser can capture, an element out of view is not pictured', async () => {
        const capturer = shots.visibleCapturer(async () => { throw new Error('should not capture'); });
        const o = {selector: '#far'};
        const page = fakePage({clip: {x: 0, y: 2000, width: 40, height: 20}});
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, {steps, evaluate: page.evaluate, capturer});
        assert.deepEqual(o.screenshot, {skipped: 'outside-view'});
        assert.equal(page.held.size, 0);
    });

    test('Firefox captures the part of the document, wherever it is, at the screen\'s scale', async () => {
        const calls = [];
        const api = {tabs: {captureTab: async (tabId, options) => { calls.push([tabId, options]); return PNG; }}};
        const capturer = shots.firefoxCapturer(7, api);
        assert.equal(await capturer.box({x: 10, y: 2000, width: 72, height: 52}, {...VIEW, devicePixelRatio: 2}), PNG);
        assert.deepEqual(calls, [[7, {format: 'png', rect: {x: 10, y: 2000, width: 72, height: 52}, scale: 2}]]);
        assert.equal(shots.firefoxCapturer(7, {tabs: {}}), null, 'not where captureTab is missing');
    });
});
