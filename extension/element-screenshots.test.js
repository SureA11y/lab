'use strict';

// The extension's pictures of flagged elements (element-screenshots.js): which
// elements it pictures for the panel's choices, what each occurrence gets,
// and that the page is put back after every picture, taken or not. The
// binding's steps and the capture are stand-ins here; the real ones run in
// the page and the browser.

const {test, describe} = require('node:test');
const assert = require('node:assert/strict');

const shots = require('./element-screenshots.js');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function resultWith(...occurrences) {
    return {checksResults: [{ruleId: 'img-alt-present', outcome: 'fail', occurrences}]};
}

// The binding's steps, as far as these tests need them: each element gets
// ready unless its selector is listed in `skip`, and every prepare and
// release is recorded.
function fakeSteps({skip = {}} = {}) {
    const log = [];
    let n = 0;
    return {
        log,
        planScreenshots(result, {outcomes}) {
            const elements = [];
            const unlocated = [];
            const byKey = new Map();
            for (const cr of result.checksResults) {
                for (const o of cr.occurrences) {
                    if (!outcomes.includes(o.occurrenceOutcome || cr.outcome)) continue;
                    if (!o.selector) { unlocated.push(o); continue; }
                    if (!byKey.has(o.selector)) {
                        const el = {selector: o.selector, shadowHostSelectors: null, occurrences: []};
                        byKey.set(o.selector, el);
                        elements.push(el);
                    }
                    byKey.get(o.selector).occurrences.push(o);
                }
            }
            return {elements, unlocated};
        },
        screenshotToken: () => `t${++n}`,
        async prepareElementScreenshot({element, options, token}) {
            log.push(['prepare', element.selector, token, options.padding, options.highlight]);
            if (skip[element.selector]) {
                log.push(['release', token]);
                return {skipped: skip[element.selector]};
            }
            return {clip: {x: 0, y: 0, width: 40, height: 20}, view: {viewport: {width: 800}, scroll: {x: 0, y: 0}}, box: {x: 16, y: 16, width: 8, height: 8}};
        },
        async releaseElementScreenshot({token}) {
            log.push(['release', token]);
        }
    };
}

function driverWith(steps, {box = async () => PNG, now} = {}) {
    let closed = 0;
    return {
        steps,
        evaluate: async () => ({}),
        capturer: {box, close: async () => { closed++; }},
        now,
        closed: () => closed
    };
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

    test('none chosen: nothing is pictured, and the capture is closed', async () => {
        const steps = fakeSteps();
        const driver = driverWith(steps);
        const result = resultWith({selector: '#a'});
        await shots.pictureFlaggedElements(result, {choice: 'off'}, driver);
        assert.equal(result.checksResults[0].occurrences[0].screenshot, undefined);
        assert.deepEqual(steps.log, []);
        assert.equal(driver.closed(), 1);
    });
});

describe('each occurrence considered', () => {
    test('gets its element\'s picture, one picture for an element flagged twice', async () => {
        const steps = fakeSteps();
        const driver = driverWith(steps);
        const a1 = {selector: '#a'};
        const a2 = {selector: '#a'};
        const b = {selector: '#b', occurrenceOutcome: 'cantTell'};
        const pageLevel = {};
        await shots.pictureFlaggedElements(resultWith(a1, a2, b, pageLevel), {choice: 'fail'}, driver);
        assert.deepEqual(a1.screenshot, {dataUrl: PNG, box: {x: 16, y: 16, width: 8, height: 8}});
        assert.equal(a2.screenshot, a1.screenshot);
        assert.equal(b.screenshot, undefined, 'a can\'t tell, with failures only');
        assert.deepEqual(pageLevel.screenshot, {skipped: 'no-element'});
        assert.deepEqual(steps.log.filter((e) => e[0] === 'prepare').map((e) => e.slice(1, 2).concat(e.slice(3))), [['#a', 16, true]]);
    });

    test('says why when its element can\'t be pictured', async () => {
        const steps = fakeSteps({skip: {'#hidden': 'not-rendered'}});
        const o = {selector: '#hidden'};
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, driverWith(steps));
        assert.deepEqual(o.screenshot, {skipped: 'not-rendered'});
    });

    test('says the capture failed, and the page is put back all the same', async () => {
        const steps = fakeSteps();
        const o = {selector: '#a'};
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, driverWith(steps, {box: async () => { throw new Error('tab hidden'); }}));
        assert.deepEqual(o.screenshot, {skipped: 'capture-failed', error: 'tab hidden'});
        assert.deepEqual(steps.log.map((e) => e[0]), ['prepare', 'release']);
    });

    test('a capture that gives no PNG is a failed capture', async () => {
        const o = {selector: '#a'};
        await shots.pictureFlaggedElements(resultWith(o), {choice: 'fail'}, driverWith(fakeSteps(), {box: async () => 'data:image/jpeg;base64,/9j/'}));
        assert.equal(o.screenshot.skipped, 'capture-failed');
    });
});

describe('the limits of a scan', () => {
    test('past the most pictures chosen, the rest say the scan reached it', async () => {
        const occ = ['#a', '#b', '#c'].map((selector) => ({selector}));
        await shots.pictureFlaggedElements(resultWith(...occ), {choice: 'fail', max: 2}, driverWith(fakeSteps()));
        assert.ok(occ[0].screenshot.dataUrl && occ[1].screenshot.dataUrl);
        assert.deepEqual(occ[2].screenshot, {skipped: 'max-reached', max: 2});
    });

    test('past the time pictures may take, no further one is started', async () => {
        let t = 0;
        const now = () => t;
        const occ = ['#a', '#b'].map((selector) => ({selector}));
        const steps = fakeSteps();
        await shots.pictureFlaggedElements(resultWith(...occ), {choice: 'fail'}, driverWith(steps, {
            now,
            box: async () => { t += shots.BUDGET_MS + 1; return PNG; }
        }));
        assert.ok(occ[0].screenshot.dataUrl);
        assert.deepEqual(occ[1].screenshot, {skipped: 'time-limit'});
        assert.equal(steps.log.filter((e) => e[0] === 'prepare').length, 1);
    });

    test('every element prepared is released, and the capture closed once', async () => {
        const steps = fakeSteps({skip: {'#b': 'zero-size'}});
        const driver = driverWith(steps);
        await shots.pictureFlaggedElements(resultWith({selector: '#a'}, {selector: '#b'}, {selector: '#c'}), {choice: 'fail'}, driver);
        const prepared = steps.log.filter((e) => e[0] === 'prepare').map((e) => e[2]);
        const released = steps.log.filter((e) => e[0] === 'release').map((e) => e[1]);
        assert.deepEqual(released, prepared);
        assert.equal(driver.closed(), 1);
    });
});
