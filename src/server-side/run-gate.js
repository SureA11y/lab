'use strict';

/**
 * How many /workflow-start runs go at once (server.js); the others wait their
 * turn, first come first served. Twelve started together all ran, each
 * twice as slow as four did, Chrome over 3 GB. The queue has its own limit.
 */

const DEFAULT_MAX_RUNS = 4;

/** A whole number from 1, from A11Y_MAX_RUNS, else DEFAULT_MAX_RUNS. */
function maxRunsFrom(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_RUNS;
}

function createRunGate(max = DEFAULT_MAX_RUNS) {
    let active = 0;
    const waiting = [];

    /**
     * Resolves when the run may go. `onWait(ahead)` is called once when it
     * has to wait, with how many runs are going.
     */
    function enter(onWait = null) {
        if (active < max) {
            active += 1;
            return Promise.resolve();
        }
        if (onWait) {
            try { onWait(active); } catch {}
        }
        return new Promise((resolve) => waiting.push(resolve));
    }

    /** A run ended: the next waiting one goes in its place. */
    function leave() {
        const next = waiting.shift();
        if (next) next();
        else active = Math.max(0, active - 1);
    }

    return { enter, leave, get active() { return active; }, get waiting() { return waiting.length; }, max };
}

module.exports = { createRunGate, maxRunsFrom, DEFAULT_MAX_RUNS };
