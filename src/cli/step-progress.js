'use strict';

/**
 * Step progress for the headless runner.
 *
 * The same counter the app's floating panel uses
 * (src/shared/workflow-step-counter.js), rendered for a terminal instead of a
 * card, plus the end-of-run lines for the console summary and summary.md.
 *
 * Two audiences, and they want different things:
 *
 * - A person watching a run wants to know how far along it is. On a TTY they
 *   get a bar pinned below the output, redrawn as steps land and lifted out of
 *   the way whenever a log line needs to print.
 * - A pipeline wants a record. Redrawing a line into a CI log just produces
 *   thousands of half-erased copies of it, so when stdout is not a TTY the bar
 *   is never drawn at all - the log lines already narrate the run, and the
 *   summary at the end carries the totals.
 *
 * Like the panel, it shows only what is known: how many steps ran, a bar over
 * the workflow's own (top-level) steps, which is a fixed list however loops
 * and branches turn out, and the step running now. Loops and conditions decide
 * at run time how many steps a run takes, so there is no total to promise.
 */

const { createStepCounter } = require('../shared/workflow-step-counter.js');

const BAR_WIDTH = 24;

const FILLED = '\u2588';
const EMPTY = '\u2591';

// Return to column 0 and erase the line. Only ever written to a TTY.
const CLEAR_LINE = '\r\u001b[2K';

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function workflowOf(snapshot) {
    const w = snapshot && snapshot.workflow;
    const total = Math.max(0, (w && w.total) || 0);
    return {
        total,
        done: Math.min(total, Math.max(0, (w && w.done) || 0)),
        at: w && Number.isInteger(w.at) ? w.at : null
    };
}

/** The bar itself: the share of the workflow's own steps that finished. */
function formatBar(snapshot, { width = BAR_WIDTH } = {}) {
    const { total, done } = workflowOf(snapshot);
    const filled = total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
    return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/**
 * "Workflow step 5 of 8" while one runs, else how many finished: "All 8
 * workflow steps done", "3 of 8 workflow steps done". Empty for a workflow
 * with no steps.
 */
function formatPosition(snapshot) {
    const { total, done, at } = workflowOf(snapshot);
    if (!total) return '';
    if (done >= total) return `All ${plural(total, 'workflow step')} done`;
    if (at && at > done) return `Workflow step ${at} of ${total}`;
    return `${done} of ${plural(total, 'workflow step')} done`;
}

/** 'Click "Next" · item 12 of 40': the step that started last, and its loop item. */
function formatNow(snapshot) {
    const current = snapshot && snapshot.current;
    if (!current) return '';
    const name = current.label || current.type || '';
    if (!name) return '';
    const loop = current.loop;
    const item = loop && Number.isInteger(loop.index)
        ? ` · item ${loop.index + 1}${Number.isFinite(loop.total) ? ` of ${loop.total}` : ''}`
        : '';
    return name + item;
}

/** The single line redrawn below a TTY run. */
function formatProgressLine(snapshot, { width = BAR_WIDTH } = {}) {
    if (!snapshot) return '';

    const parts = [formatPosition(snapshot), `${plural(Math.max(0, snapshot.done || 0), 'step')} run`];
    const now = formatNow(snapshot);
    if (now) parts.push(`now: ${now}`);
    return `  [${formatBar(snapshot, { width })}] ${parts.filter(Boolean).join(' · ')}`;
}

/** Action types that ran, busiest first. */
function stepRows(snapshot) {
    const done = snapshot?.doneByType || {};
    return Object.keys(done)
        .map((type) => ({ type, done: done[type] || 0 }))
        .filter((row) => row.done > 0)
        .sort((a, b) => (b.done - a.done) || a.type.localeCompare(b.type));
}

/**
 * The console summary's step lines, in the same `Label       value` shape the
 * rest of printSummary uses. Returns nothing when there was no counter, so a
 * run that could not be planned prints exactly what it used to.
 */
function summaryLines(snapshot) {
    if (!snapshot) return [];

    const position = formatPosition(snapshot);
    const head = `Steps       ${Math.max(0, snapshot.done || 0)} run` + (position ? ` (${position.charAt(0).toLowerCase()}${position.slice(1)})` : '');

    const rows = stepRows(snapshot);
    if (!rows.length) return [head];

    return [head, `  by type   ${rows.map((r) => `${r.type} ${r.done}`).join(', ')}`];
}

/** The steps section of summary.md. */
function stepsSection(snapshot) {
    if (!snapshot) return [];

    const done = Math.max(0, snapshot.done || 0);
    const { total, done: finished, at } = workflowOf(snapshot);

    let sentence = `${plural(done, 'step')} ran.`;
    if (total && finished >= total) {
        sentence += ` All ${plural(total, 'step')} of the workflow finished.`;
    } else if (total) {
        sentence += ` ${finished} of the workflow's ${plural(total, 'step')} finished` +
            (at && at > finished ? `; the run stopped in step ${at}.` : '.');
    }

    const out = ['', '## Steps', '', sentence];

    const rows = stepRows(snapshot);
    if (rows.length) {
        out.push('', '| Step | Ran |', '| --- | ---: |');
        for (const row of rows) out.push(`| ${row.type} | ${row.done} |`);
    }

    return out;
}

/**
 * Wraps the run's output so the bar can stay pinned below it.
 *
 * `writeLine` is what the runner prints its log lines through: it lifts the bar,
 * writes the line, and puts the bar back. Off a TTY it is a plain write and
 * nothing else happens.
 */
function createStepProgress({
    actions,
    customSteps,
    stream = process.stdout,
    isTTY = !!(stream && stream.isTTY),
    columns = (stream && stream.columns) || 0,
    quiet = false,
    width = BAR_WIDTH
} = {}) {
    let counter = null;
    try {
        counter = createStepCounter({ actions, customSteps });
    } catch {
        // A workflow the planner cannot walk still deserves to run; it just runs
        // without a step count.
        counter = null;
    }

    // Whether a bar is currently occupying the last line of the output.
    let drawn = false;
    const live = !!(counter && isTTY && !quiet);

    const write = (text) => {
        try { stream.write(text); } catch { /* a closed stdout is not our problem */ }
    };

    function clear() {
        if (!drawn) return;
        write(CLEAR_LINE);
        drawn = false;
    }

    function draw() {
        if (!live || !counter) return;
        let line = formatProgressLine(counter.snapshot(), { width });
        if (!line) return;
        // CLEAR_LINE erases one line. A bar that wrapped would leave the half of
        // itself above the cursor stranded on screen, so it is cut to fit.
        if (columns > 1 && line.length > columns - 1) line = line.slice(0, columns - 1);
        write(`${CLEAR_LINE}${line}`);
        drawn = true;
    }

    return {
        /**
         * Fold one progress log entry in. Only step markers move the counter.
         * Counting does not redraw: every entry the runner counts is an entry it
         * is about to print, and writeLine puts the bar back afterwards. A
         * caller that counts without printing calls refresh() itself.
         */
        accept(entry) {
            if (!counter) return;
            if (!entry || !entry.extra || typeof entry.extra !== 'object' || !entry.extra.stepEvent) return;
            try {
                counter.accept(entry);
            } catch {
                // Never let a counting slip take the run down with it.
            }
        },

        /** Print a line of run output, keeping the bar below it. */
        writeLine(text) {
            clear();
            write(`${text}\n`);
            draw();
        },

        /** Draw the bar for its current state, without printing anything else. */
        refresh() {
            draw();
        },

        /** Lift the bar for good, once the run is over. */
        finish() {
            clear();
        },

        snapshot() {
            return counter ? counter.snapshot() : null;
        }
    };
}

module.exports = {
    BAR_WIDTH,
    createStepProgress,
    formatBar,
    formatNow,
    formatPosition,
    formatProgressLine,
    stepRows,
    stepsSection,
    summaryLines
};
