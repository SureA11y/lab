'use strict';

// The pause after a step, which lets a real page settle before the next one.
//
// It was a fixed 500 ms: 40% of a 120-scan run was spent waiting on pages
// that had long settled. Given the page, it now waits until the page is
// quiet, no request in flight and no change to its document for QUIET_MS,
// and no longer than MAX_MS: near nothing on a quiet page, the old 500 ms on
// a busy one. Without a page it waits the fixed 500 ms as before. None under
// `node --test`, or what the run sets (postStepDelayMs), which is a fixed
// pause either way.

const {sleep} = require('./utils');

const POST_STEP_DELAY = 500; // ms, the most a settle waits, and the fixed pause
const QUIET_MS = 100;

// node --test sets NODE_TEST_CONTEXT in the process that runs test files (undocumented but
// stable internal plumbing). Real/production runs never have it set, so they keep the
// pause unless they opt out.
const IS_TEST_RUN = !!process.env.NODE_TEST_CONTEXT;

/**
 * Resolves once `page` has been quiet for `quietMs` (no request in flight,
 * no change to its document), or after `maxMs` whatever it is doing. A page
 * that navigates meanwhile is waited on by its requests alone. Never rejects.
 */
async function settlePage(page, {maxMs = POST_STEP_DELAY, quietMs = QUIET_MS} = {}) {
    const deadline = Date.now() + maxMs;
    const left = () => Math.max(0, deadline - Date.now());
    const network = typeof page.waitForNetworkIdle === 'function'
        ? page.waitForNetworkIdle({idleTime: quietMs, timeout: maxMs}).catch(() => {})
        : Promise.resolve();
    const dom = typeof page.evaluate === 'function'
        ? page.evaluate((quiet, max) => new Promise((resolve) => {
            let timer = null;
            const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
            const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
            observer.observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
            timer = setTimeout(done, quiet);
            const cap = setTimeout(done, max);
        }), quietMs, maxMs).catch(() => {})
        : Promise.resolve();
    let capTimer = null;
    const cap = new Promise((resolve) => { capTimer = setTimeout(resolve, left()); });
    try {
        await Promise.race([Promise.all([network, dom]), cap]);
    } finally {
        clearTimeout(capTimer);
    }
}

// Pause between workflow steps: a settle on `page` when given one, else the
// fixed pause. Overridable per run via createWorkflowContext({ postStepDelayMs: N }),
// a fixed pause of N ms.
function postStepDelay(ctxLike, page = null) {
    const fixed = ctxLike && typeof ctxLike.postStepDelayMs === 'number' ? ctxLike.postStepDelayMs : null;
    if (fixed === null && IS_TEST_RUN) return Promise.resolve();
    if (fixed !== null && fixed <= 0) return Promise.resolve();
    const wait = fixed === null && page && typeof page.evaluate === 'function'
        ? settlePage(page)
        : sleep(fixed === null ? POST_STEP_DELAY : fixed);
    return (ctxLike && typeof ctxLike.race === 'function')
        ? ctxLike.race(wait, 'post-action delay')
        : wait;
}

module.exports = {postStepDelay, settlePage, POST_STEP_DELAY};
