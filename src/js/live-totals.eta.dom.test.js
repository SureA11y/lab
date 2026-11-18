'use strict';

// The live totals' time-left line (createLiveTotals + shared/scan-time-estimate.js),
// driven under jsdom with its clock and timer handed in. The line is worked out
// from the log entries' own times, so a run opened half way gets the pace it
// really had.

const {test, describe, before, beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

const estimator = require('../shared/scan-time-estimate.js');

let createLiveTotals;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;

    ({createLiveTotals} = await import('./live-totals.js'));
});

beforeEach(() => {
    document.body.innerHTML = '';
});

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

const snapshot = (scans, extra = {}) => ({
    done: scans,
    doneByType: scans ? {a11yScan: scans} : {},
    remaining: 10,
    total: 10 + scans,
    unsized: 0,
    workflow: {total: 4, done: 0, at: 1},
    current: null,
    ...extra
});

const entry = (seconds) => ({time: at(seconds), type: 'info', message: '', extra: {stepEvent: 'action-end'}});

function setup(options = {}) {
    const clock = {now: T0};
    const timers = {started: 0, stopped: 0, fn: null};
    const totals = createLiveTotals({
        estimator,
        now: () => clock.now,
        setInterval: (fn) => { timers.started += 1; timers.fn = fn; return timers.started; },
        clearInterval: () => { timers.stopped += 1; timers.fn = null; },
        ...options
    });
    return {totals, clock, timers};
}

const etaEl = () => document.querySelector('.live-totals-steps-eta');

describe('time left in the live totals', () => {
    test('shows nothing when the run has no expected number of scans', () => {
        const {totals} = setup();
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(2), entry(120));
        assert.equal(totals.getEtaText(), '');
        assert.equal(etaEl().hidden, true);
    });

    test('waits for a second scan before putting a time on it', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        clock.now = T0 + 60000;
        totals.setSteps(snapshot(1), entry(60));
        assert.equal(totals.getEtaText(), '1 of 10 scans done · working out the time left');
        assert.equal(etaEl().hidden, false);
    });

    test('works the time left out from the scans done', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(60));
        clock.now = T0 + 120000;
        totals.setSteps(snapshot(2), entry(120));
        assert.match(etaEl().textContent, /^2 of 10 scans done · about 8 min left/);
        assert.ok(etaEl().title.length > 0, 'says where the number comes from');
    });

    test('counts down between scans, from the clock', () => {
        const {totals, clock, timers} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(60));
        clock.now = T0 + 120000;
        totals.setSteps(snapshot(2), entry(120));
        assert.equal(timers.started, 1, 'a timer runs while a time is shown');
        assert.match(etaEl().textContent, /about 8 min left/);

        clock.now += 90000;
        timers.fn();
        assert.match(etaEl().textContent, /about 7 min left/);
    });

    test('a run opened half way gets the pace its entries say, whenever they arrive', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 10});
        clock.now = T0 + 999999;
        // The whole log so far, at once: 30 s a scan.
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(30));
        totals.setSteps(snapshot(2), entry(60));
        totals.setSteps(snapshot(3), entry(90));
        assert.match(etaEl().textContent, /^3 of 10 scans done · about 4 min left/);
    });

    test('a run before its first scan starts from what earlier runs did', () => {
        const {totals} = setup();
        const prior = estimator.priorFromRuns([
            {scans: 10, durationMs: 300000, ok: true},
            {scans: 10, durationMs: 300000, ok: true}
        ]);
        totals.setExpected({expectedScans: 10, prior});
        totals.setSteps(snapshot(0), entry(0));
        assert.match(etaEl().textContent, /^0 of 10 scans done · about 5 min left/);
        assert.match(etaEl().title, /2 finished runs/);
    });

    test('says so when the run goes past the expected number', () => {
        const {totals} = setup();
        totals.setExpected({expectedScans: 2});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(30));
        totals.setSteps(snapshot(2), entry(60));
        assert.equal(totals.getEtaText(), 'All 2 expected scans done');
        totals.setSteps(snapshot(3), entry(90));
        assert.equal(totals.getEtaText(), '3 scans done, past the 2 expected');
    });

    test('changing the expected number recalculates', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(60));
        clock.now = T0 + 120000;
        totals.setSteps(snapshot(2), entry(120));
        totals.setExpected({expectedScans: 20});
        assert.match(etaEl().textContent, /^2 of 20 scans done · about 18 min left/);
        totals.setExpected({expectedScans: null});
        assert.equal(etaEl().hidden, true);
    });

    test('stops when the run finishes, and takes the line away', () => {
        const {totals, clock, timers} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(60));
        clock.now = T0 + 120000;
        totals.setSteps(snapshot(2), entry(120));
        assert.equal(timers.started, 1);
        totals.finish();
        assert.equal(timers.stopped, 1);
        assert.equal(etaEl().hidden, true);
        assert.equal(totals.getEtaText(), '');
    });

    test('a new run starts with a clean clock and no expected number', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(2), entry(120));
        clock.now = T0 + 120000;
        totals.reset();
        totals.setSteps(snapshot(0), entry(1000));
        assert.equal(totals.getEtaText(), '');
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(1), entry(1030));
        totals.setSteps(snapshot(2), entry(1060));
        assert.match(etaEl().textContent, /^2 of 10 scans done · about 4 min left/);
    });

    test('is not a live region, so it is not read out every few seconds', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 10});
        totals.setSteps(snapshot(0), entry(0));
        totals.setSteps(snapshot(1), entry(60));
        clock.now = T0 + 120000;
        totals.setSteps(snapshot(2), entry(120));
        assert.equal(etaEl().closest('[aria-live]'), null);
        assert.equal(etaEl().getAttribute('aria-live'), null);
    });

    test('works without the shared estimator on the page', () => {
        const {totals} = setup({estimator: null});
        const lacking = createLiveTotals({estimator: null});
        lacking.setExpected({expectedScans: 10});
        lacking.setSteps(snapshot(2), entry(120));
        assert.equal(lacking.getEtaText(), '');
        assert.ok(totals);
    });
});

describe('time left from a loop in the live totals', () => {
    const loopEntry = (path, index, total, seconds) => ({
        time: at(seconds), type: 'info', message: '',
        extra: {stepEvent: 'loop-iteration', actionPath: path, index, total, loopType: 'forEachElement'}
    });
    const loopEnd = (path, seconds) => ({time: at(seconds), extra: {stepEvent: 'action-end', actionPath: path}});

    function inLoop(clock, upTo, total = 10, every = 10) {
        for (let i = 0; i <= upTo; i += 1) {
            clock.now = T0 + i * every * 1000;
            this.setSteps(snapshot(i), loopEntry('2', i, total, i * every));
        }
    }

    test('says it from the loop with no number typed', () => {
        const {totals, clock} = setup();
        inLoop.call(totals, clock, 4);
        assert.match(etaEl().textContent, /^item 5 of 10 · about 1 min left/);
        assert.match(etaEl().title, /From the loop it is in: 4 of 10 items done/);
    });

    test('the loop says it before the typed number of scans does', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 500});
        inLoop.call(totals, clock, 4);
        assert.match(etaEl().textContent, /^item 5 of 10 /);
    });

    test('counts down between entries, from the clock', () => {
        const {totals, clock, timers} = setup();
        // An iteration a minute: iteration 5 of 10 has just begun.
        inLoop.call(totals, clock, 4, 10, 60);
        assert.match(etaEl().textContent, /^item 5 of 10 · about 6 min left/);
        clock.now += 40000;
        timers.fn();
        assert.match(etaEl().textContent, /^item 5 of 10 · about 5 min left/);
    });

    test('waits for two finished iterations', () => {
        const {totals, clock} = setup();
        inLoop.call(totals, clock, 1);
        assert.equal(totals.getEtaText(), '');
        assert.equal(etaEl().hidden, true);
    });

    test('hands back to the number of scans when the loop is over', () => {
        const {totals, clock} = setup();
        totals.setExpected({expectedScans: 20});
        inLoop.call(totals, clock, 9);
        totals.setSteps(snapshot(12), loopEnd('2', 100));
        clock.now = T0 + 100000;
        assert.doesNotMatch(etaEl().textContent, /^item/);
    });

    test('a new run starts without the loops of the last', () => {
        const {totals, clock} = setup();
        inLoop.call(totals, clock, 4);
        totals.reset();
        totals.setSteps(snapshot(0), entry(5000));
        assert.equal(totals.getEtaText(), '');
    });
});
