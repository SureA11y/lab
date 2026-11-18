'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const S = require('./step-progress.js');

const snap = (over = {}) => ({
    done: 0, doneByType: {}, workflow: { total: 0, done: 0, at: null }, current: null, ...over
});
const flow = (total, done, at = null) => ({ total, done, at });

// The bar is drawn from these two, so name them once rather than counting
// block characters in every assertion.
const FILLED = '█';
const EMPTY = '░';

// What the runner writes to lift the bar off the last line.
const CLEAR = '\r\u001b[2K';

describe('formatBar', () => {
    test('fills in proportion to the workflow steps that finished', () => {
        assert.equal(S.formatBar(snap({ workflow: flow(8, 4, 5) }), { width: 8 }), FILLED.repeat(4) + EMPTY.repeat(4));
    });

    test('steps inside loops do not move it', () => {
        assert.equal(S.formatBar(snap({ done: 500, workflow: flow(4, 1, 2) }), { width: 8 }), FILLED.repeat(2) + EMPTY.repeat(6));
    });

    test('a workflow with no steps is an empty track, not a full one', () => {
        assert.equal(S.formatBar(snap(), { width: 8 }), EMPTY.repeat(8));
    });

    test('every workflow step done fills the whole width', () => {
        assert.equal(S.formatBar(snap({ workflow: flow(3, 3, 3) }), { width: 6 }), FILLED.repeat(6));
    });
});

describe('formatPosition', () => {
    test('names the workflow step running', () => {
        assert.equal(S.formatPosition(snap({ workflow: flow(8, 4, 5) })), 'Workflow step 5 of 8');
    });

    test('says when all are done, or how many when the run stopped', () => {
        assert.equal(S.formatPosition(snap({ workflow: flow(8, 8, 8) })), 'All 8 workflow steps done');
        assert.equal(S.formatPosition(snap({ workflow: flow(8, 3, 3) })), '3 of 8 workflow steps done');
    });

    test('nothing for a workflow with no steps', () => {
        assert.equal(S.formatPosition(snap()), '');
    });
});

describe('formatNow', () => {
    test('the step running by its label, and the loop item, with its total once known', () => {
        const current = { actionPath: '2.1', type: 'click', label: 'Next page', loop: { index: 11, total: 40 } };
        assert.equal(S.formatNow(snap({ current })), 'Next page · item 12 of 40');
        assert.equal(S.formatNow(snap({ current: { ...current, label: null, loop: { index: 0, total: null } } })), 'click · item 1');
    });

    test('outside a loop it is just the step; nothing before any step started', () => {
        assert.equal(S.formatNow(snap({ current: { actionPath: '1', type: 'navigate', label: null, loop: null } })), 'navigate');
        assert.equal(S.formatNow(snap()), '');
    });
});

describe('formatProgressLine', () => {
    test('the bar, the workflow step, the steps run and what is running, with no total', () => {
        const line = S.formatProgressLine(snap({
            done: 128,
            workflow: flow(8, 4, 5),
            current: { actionPath: '5.2', type: 'click', label: 'Next page', loop: { index: 11, total: 40 } }
        }), { width: 8 });
        assert.equal(line, `  [${FILLED.repeat(4)}${EMPTY.repeat(4)}] Workflow step 5 of 8 · 128 steps run · now: Next page · item 12 of 40`);
    });

    test('nothing to render without a snapshot', () => {
        assert.equal(S.formatProgressLine(null), '');
    });
});

describe('summaryLines', () => {
    test('a whole run: the steps that ran, the workflow steps done, and the per-type tally', () => {
        const lines = S.summaryLines(snap({
            done: 12, workflow: flow(4, 4, 4),
            doneByType: { a11yScan: 6, click: 4, navigate: 2 }
        }));
        assert.deepEqual(lines, [
            'Steps       12 run (all 4 workflow steps done)',
            '  by type   a11yScan 6, click 4, navigate 2'
        ]);
    });

    test('a run that stopped early says how many workflow steps finished', () => {
        const lines = S.summaryLines(snap({ done: 5, workflow: flow(6, 2, 3), doneByType: { click: 5 } }));
        assert.equal(lines[0], 'Steps       5 run (workflow step 3 of 6)');
    });

    test('no counter, no lines - the summary prints exactly what it used to', () => {
        assert.deepEqual(S.summaryLines(null), []);
    });

    test('a counted run with no typed work is one line, not an empty tally', () => {
        assert.deepEqual(S.summaryLines(snap()), ['Steps       0 run']);
    });
});

describe('stepsSection', () => {
    test('a whole run says so, and tables what ran', () => {
        const md = S.stepsSection(snap({
            done: 3, workflow: flow(2, 2, 2), doneByType: { a11yScan: 2, click: 1 }
        })).join('\n');

        assert.match(md, /## Steps/);
        assert.match(md, /3 steps ran\. All 2 steps of the workflow finished\./);
        assert.match(md, /\| Step \| Ran \|/);
        assert.match(md, /\| a11yScan \| 2 \|/);
        assert.doesNotMatch(md, /Left|to go|about/);
    });

    test('a run that stopped says where', () => {
        const md = S.stepsSection(snap({ done: 3, workflow: flow(7, 2, 3), doneByType: { click: 3 } })).join('\n');
        assert.match(md, /3 steps ran\. 2 of the workflow's 7 steps finished; the run stopped in step 3\./);
    });

    test('no counter, no section', () => {
        assert.deepEqual(S.stepsSection(null), []);
    });
});

describe('createStepProgress', () => {
    function fake({ isTTY = true, quiet = false, columns = 200, actions } = {}) {
        const chunks = [];
        const stream = { isTTY, columns, write: (t) => chunks.push(t) };
        const progress = S.createStepProgress({
            actions: actions || [{ type: 'navigate' }, { type: 'a11yScan' }],
            stream, isTTY, columns, quiet
        });
        return { progress, chunks, text: () => chunks.join('') };
    }

    const stepEntry = (actionType, actionPath) => ({
        message: `Action ${actionPath} completed`,
        extra: { stepEvent: 'action-end', actionType, actionPath, depth: 0 }
    });

    test('counts step markers and ignores everything else', () => {
        const { progress } = fake();
        progress.accept(stepEntry('navigate', '1'));
        progress.accept({ message: 'just a log line' });
        progress.accept(null);

        assert.equal(progress.snapshot().done, 1);
        assert.equal(progress.snapshot().workflow.done, 1);
    });

    test('on a TTY, each printed line leaves the bar below it - drawn once, not twice', () => {
        const { progress, text } = fake();
        progress.accept(stepEntry('navigate', '1'));
        progress.writeLine('Action 1 completed');

        const out = text();
        assert.equal(out.includes('Action 1 completed\n'), true);
        assert.equal(out.endsWith('1 of 2 workflow steps done · 1 step run'), true);
        assert.equal((out.match(/1 step run/g) || []).length, 1, 'the bar was drawn once for the one line');
    });

    test('off a TTY the bar is never drawn, only the lines', () => {
        const { progress, text } = fake({ isTTY: false });
        progress.accept(stepEntry('navigate', '1'));
        progress.writeLine('Action 1 completed');
        progress.finish();

        assert.equal(text(), 'Action 1 completed\n');
    });

    test('quiet draws nothing either, however friendly the terminal', () => {
        const { progress, text } = fake({ quiet: true });
        progress.accept(stepEntry('navigate', '1'));
        progress.refresh();

        assert.equal(text(), '');
        assert.equal(progress.snapshot().done, 1, 'but it is still counting, for the summary');
    });

    test('finish lifts the bar so the summary does not print onto it', () => {
        const { progress, text } = fake();
        progress.accept(stepEntry('navigate', '1'));
        progress.writeLine('a line');
        progress.finish();

        assert.equal(text().endsWith(CLEAR), true);
    });

    test('finishing twice does not keep erasing lines that are not the bar', () => {
        const { progress, chunks } = fake();
        progress.writeLine('a line');
        progress.finish();
        const after = chunks.length;
        progress.finish();

        assert.equal(chunks.length, after);
    });

    test('a bar wider than the terminal is cut, never wrapped', () => {
        const { progress, text } = fake({ columns: 20 });
        progress.accept(stepEntry('navigate', '1'));
        progress.refresh();

        const drawn = text().split(CLEAR).pop();
        assert.ok(drawn.length <= 19, `bar was ${drawn.length} wide in a 20 column terminal`);
    });

    test('a workflow the planner cannot walk still runs, just uncounted', () => {
        // ownKeys throws, so the plan's walk over the custom steps blows up.
        const hostile = new Proxy({}, { ownKeys() { throw new Error('nope'); } });
        const progress = S.createStepProgress({
            actions: [{ type: 'navigate' }],
            customSteps: hostile,
            stream: { isTTY: false, write() {} },
            isTTY: false
        });

        assert.equal(progress.snapshot(), null);
        assert.deepEqual(S.summaryLines(progress.snapshot()), []);
    });

    test('a stream that throws on write does not take the run down', () => {
        const progress = S.createStepProgress({
            actions: [{ type: 'navigate' }],
            stream: { isTTY: true, columns: 80, write() { throw new Error('EPIPE'); } },
            isTTY: true
        });

        assert.doesNotThrow(() => {
            progress.accept(stepEntry('navigate', '1'));
            progress.writeLine('a line');
            progress.finish();
        });
    });
});

describe('formatScans', () => {
    const timing = require('../shared/scan-time-estimate.js');
    const MIN = 60000;

    test('is the scans done and the estimated time left', () => {
        const est = timing.estimateRun({ expectedScans: 10, completedAtMs: [MIN, 2 * MIN], elapsedMs: 2 * MIN });
        assert.match(S.formatScans(est), /^2 of 10 scans · about 8 min left/);
    });

    test('says nothing while it is too early for a time, or with no total', () => {
        assert.equal(S.formatScans(timing.estimateRun({ expectedScans: 10, completedAtMs: [MIN] })), '');
        assert.equal(S.formatScans(timing.estimateRun({ completedAtMs: [MIN, 2 * MIN] })), '');
        assert.equal(S.formatScans(null), '');
    });

    test('says so when the run reaches or goes past its number', () => {
        assert.equal(S.formatScans(timing.estimateRun({ expectedScans: 2, completedAtMs: [MIN, 2 * MIN] })), 'all 2 expected scans done');
        assert.equal(S.formatScans(timing.estimateRun({ expectedScans: 2, completedAtMs: [MIN, 2 * MIN, 3 * MIN] })), '3 scans, past the 2 expected');
    });

    test('goes into the progress line before the step now running, which a narrow terminal cuts first', () => {
        const line = S.formatProgressLine(snap({
            done: 4, workflow: flow(8, 4, 5),
            current: { actionPath: '5', type: 'click', label: 'Next', loop: null }
        }), { scans: '2 of 10 scans · about 8 min left' });
        assert.match(line, /4 steps run · 2 of 10 scans · about 8 min left · now: Next$/);
    });
});

describe('the progress line and the time left', () => {
    const MIN = 60000;
    const T0 = Date.parse('2026-11-18T10:00:00.000Z');
    const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();
    const actions = [{ type: 'a11yScan' }, { type: 'a11yScan' }, { type: 'a11yScan' }, { type: 'a11yScan' }];

    const scanEnd = (n, seconds) => ({
        time: at(seconds), message: 'done',
        extra: { stepEvent: 'action-end', actionType: 'a11yScan', actionPath: String(n), depth: 0 }
    });

    // The run's first step starting at time 0 is what starts its clock.
    const started = { time: at(0), message: 'start', extra: { stepEvent: 'action-start', actionType: 'a11yScan', actionPath: '1', depth: 0 } };

    function run(options = {}) {
        const chunks = [];
        const clock = { now: T0 };
        const progress = S.createStepProgress({
            actions, stream: { isTTY: true, columns: 300, write: (t) => chunks.push(t) },
            isTTY: true, columns: 300, now: () => clock.now, ...options
        });
        progress.accept(started);
        return { progress, clock, text: () => chunks.join('') };
    }

    test('a workflow that cannot vary its scans gets a time from the first two', () => {
        const { progress, text } = run();
        progress.accept(scanEnd(1, 60));
        progress.accept(scanEnd(2, 120));
        progress.refresh();
        const est = progress.estimate();
        assert.equal(est.expectedScans, 4);
        assert.match(text(), /2 of 4 scans · about 2 min left/);
    });

    test('the number the spec gives wins over the one the workflow works out', () => {
        const { progress, text } = run({ expectedScans: 20 });
        progress.accept(scanEnd(1, 60));
        progress.accept(scanEnd(2, 120));
        progress.refresh();
        assert.match(text(), /2 of 20 scans · about 18 min left/);
    });

    test('a workflow whose scans depend on a loop says nothing of time until a number is given', () => {
        const loop = [{ type: 'forEachElement', selector: 'a', actions: [{ type: 'a11yScan' }] }];
        const quiet = run({ actions: loop });
        quiet.progress.accept(scanEnd(1, 60));
        quiet.progress.accept(scanEnd(2, 120));
        quiet.progress.refresh();
        assert.equal(quiet.progress.estimate(), null);
        assert.doesNotMatch(quiet.text(), /scans/);

        const given = run({ actions: loop, expectedScans: 10 });
        given.progress.accept(scanEnd(1, 60));
        given.progress.accept(scanEnd(2, 120));
        given.progress.refresh();
        assert.match(given.text(), /2 of 10 scans · about 8 min left/);
    });

    test('the time counts down between log lines, from the clock', () => {
        const { progress, clock } = run({ expectedScans: 10 });
        progress.accept(scanEnd(1, 60));
        progress.accept(scanEnd(2, 120));
        const before = progress.estimate().remainingMs;
        clock.now += 30000;
        assert.equal(Math.round((before - progress.estimate().remainingMs) / 1000), 30);
    });

    test('what a batch\'s finished runs took is where a run that has not started begins', () => {
        const prior = require('../shared/scan-time-estimate.js').priorFromRuns([
            { scans: 4, durationMs: 4 * MIN, ok: true },
            { scans: 4, durationMs: 4 * MIN, ok: true }
        ]);
        const { progress } = run({ prior });
        const est = progress.estimate();
        assert.equal(est.basis, 'prior');
        assert.equal(Math.round(est.remainingMs / MIN), 4);
    });

    test('nothing is drawn off a terminal, time or no time', () => {
        const chunks = [];
        const progress = S.createStepProgress({ actions, stream: { isTTY: false, write: (t) => chunks.push(t) }, isTTY: false, expectedScans: 4 });
        progress.accept(scanEnd(1, 60));
        progress.accept(scanEnd(2, 120));
        progress.refresh();
        assert.equal(chunks.join(''), '');
    });
});
