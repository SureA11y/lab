'use strict';

// pollWorkflowUntilDone reads a run's progress until it ends. The run tab uses
// it for runs started from the form and, through progressUrl and shouldStop,
// for a queued run being watched.

const {test, describe, before, afterEach} = require('node:test');
const assert = require('node:assert/strict');

let pollWorkflowUntilDone;
const realFetch = globalThis.fetch;

before(async () => {
    ({pollWorkflowUntilDone} = await import('./a11y-ui.workflow.js'));
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

/** A fetch answering with the given progress replies in turn, recording URLs. */
function serve(replies) {
    const urls = [];
    globalThis.fetch = async (url) => {
        urls.push(url);
        const body = replies.length > 1 ? replies.shift() : replies[0];
        return {ok: true, json: async () => body};
    };
    return urls;
}

describe('pollWorkflowUntilDone', () => {
    test('reads /workflow-progress by default, passing on the index to ask for next', async () => {
        const urls = serve([
            {status: 'running', nextIndex: 2, logs: [{}, {}]},
            {status: 'done', nextIndex: 3, logs: [{}]},
        ]);
        const out = await pollWorkflowUntilDone('r1', {pollIntervalMs: 0});
        assert.deepEqual(urls, ['/workflow-progress?runId=r1&since=0', '/workflow-progress?runId=r1&since=2']);
        assert.deepEqual(out, {status: 'done', since: 3});
    });

    test('progressUrl reads another run\'s progress, such as a watched queue item', async () => {
        const urls = serve([{status: 'done', nextIndex: 0, logs: []}]);
        await pollWorkflowUntilDone('item-7', {pollIntervalMs: 0, progressUrl: (since) => `/queue/items/item-7/progress?since=${since}`});
        assert.deepEqual(urls, ['/queue/items/item-7/progress?since=0']);
    });

    test('shouldStop ends the polling early, without handing on the reply it was waiting for', async () => {
        let stop = false;
        const seen = [];
        serve([{status: 'running', nextIndex: 1, logs: [{}]}]);
        const polling = pollWorkflowUntilDone('r1', {
            pollIntervalMs: 5,
            shouldStop: () => stop,
            onProgress: (p) => { seen.push(p); stop = true; },
        });
        const out = await polling;
        assert.equal(out.status, 'stopped');
        assert.equal(seen.length, 1);
    });

    test('hands on each reply\'s logs before its status, so a run that ended says so after its last steps', async () => {
        serve([
            {status: 'running', nextIndex: 1, logs: [{message: 'a'}]},
            {status: 'error', nextIndex: 3, logs: [{message: 'b'}, {message: 'Workflow failed'}]},
        ]);
        const seen = [];
        await pollWorkflowUntilDone('r1', {
            pollIntervalMs: 0,
            onProgress: (p) => seen.push(...p.logs.map((l) => l.message)),
            onStatus: (s) => seen.push(`status:${s}`),
        });
        assert.deepEqual(seen, ['a', 'status:running', 'b', 'Workflow failed', 'status:error']);
    });
});

