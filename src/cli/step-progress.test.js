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
