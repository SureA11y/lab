'use strict';

// The pause after a step, which lets a real page settle before the next one:
// 500ms in a real run, none under `node --test`, or what the run sets.

const {sleep} = require('./utils');

const POST_STEP_DELAY = 500; // ms

// node --test sets NODE_TEST_CONTEXT in the process that runs test files (undocumented but
// stable internal plumbing). Real/production runs never have it set, so they keep the full
// delay unless they opt out.
const IS_TEST_RUN = !!process.env.NODE_TEST_CONTEXT;
const DEFAULT_POST_STEP_DELAY = IS_TEST_RUN ? 0 : POST_STEP_DELAY;

// Pause between workflow steps, letting a real page settle before the next action.
// Defaults to 0 automatically under `node --test`; production keeps the real 500ms.
// Still overridable per-run via createWorkflowContext({ postStepDelayMs: N }).
function postStepDelay(ctxLike) {
    const ms = (ctxLike && typeof ctxLike.postStepDelayMs === 'number')
        ? ctxLike.postStepDelayMs
        : DEFAULT_POST_STEP_DELAY;
    if (ms <= 0) return Promise.resolve();
    return (ctxLike && typeof ctxLike.race === 'function')
        ? ctxLike.race(sleep(ms), 'post-action delay')
        : sleep(ms);
}

module.exports = {postStepDelay};
