'use strict';

/**
 * How many /workflow-start runs go at once (server.js); the others wait their
 * turn, first come first served. Twelve started together all ran, each
 * twice as slow as four did, Chrome over 3 GB. The queue has its own limit.
 *
 * How many may wait is limited too (A11Y_MAX_WAITING): two hundred started
 * at once were all taken, and each held its place until its turn. Past the
 * limit the server refuses a run (429) rather than holding it. A run that is
 * cancelled while it waits leaves its place at once, without opening a page.
 */

const DEFAULT_MAX_RUNS = 4;
const DEFAULT_MAX_WAITING = 50;

/** A whole number from 1, from A11Y_MAX_RUNS, else DEFAULT_MAX_RUNS. */
function maxRunsFrom(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_RUNS;
}

/** A whole number from 0, from A11Y_MAX_WAITING, else DEFAULT_MAX_WAITING. */
function maxWaitingFrom(value) {
    if (value == null || value === '') return DEFAULT_MAX_WAITING;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_WAITING;
}

function createRunGate(max = DEFAULT_MAX_RUNS, maxWaiting = Infinity) {
    let active = 0;
    const waiting = [];

    /**
     * Resolves with true when the run may go, or with false when `signal`
     * aborts while it waits: it has left its place, and must not leave() the
     * gate. `onWait(ahead)` is called once when it has to wait, with how many
     * runs are going.
     */
    function enter(onWait = null, signal = null) {
        if (signal && signal.aborted) return Promise.resolve(false);
        if (active < max) {
            active += 1;
            return Promise.resolve(true);
        }
        if (onWait) {
            try { onWait(active); } catch {}
        }
        return new Promise((resolve) => {
            const entry = { go: () => resolve(true) };
            waiting.push(entry);
            if (signal) {
                signal.addEventListener('abort', () => {
                    const at = waiting.indexOf(entry);
                    if (at === -1) return; // already admitted
                    waiting.splice(at, 1);
                    resolve(false);
                }, { once: true });
            }
        });
    }

    /** A run ended: the next waiting one goes in its place. */
    function leave() {
        const next = waiting.shift();
        if (next) next.go();
        else active = Math.max(0, active - 1);
    }

    return {
        enter,
        leave,
        get active() { return active; },
        get waiting() { return waiting.length; },
        /** Whether a new run would have neither a slot nor a place to wait. */
        get full() { return active >= max && waiting.length >= maxWaiting; },
        max,
        maxWaiting,
    };
}

module.exports = { createRunGate, maxRunsFrom, maxWaitingFrom, DEFAULT_MAX_RUNS, DEFAULT_MAX_WAITING };
