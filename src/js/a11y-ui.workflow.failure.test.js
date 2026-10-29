'use strict';

// runFailureMessage: what the run tab logs when a run could not go on.

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');

let runFailureMessage;

before(async () => {
    ({runFailureMessage} = await import('./a11y-ui.workflow.js'));
});

describe('runFailureMessage', () => {
    test('a server that cannot be reached: the workflow did not start', () => {
        const msg = runFailureMessage(new TypeError('Failed to fetch'));
        assert.match(msg, /^Could not reach the lab's server, so the workflow did not start\./);
        assert.match(msg, /Check that the server is running/);
    });

    test('the connection lost once the run started: it may still be running there', () => {
        assert.match(runFailureMessage(new TypeError('NetworkError'), {started: true}),
            /^Lost the connection to the lab's server while the workflow was running\. It may still be running there/);
    });

    test('anything else names the error', () => {
        assert.equal(runFailureMessage(new Error('Progress polling failed'), {started: true}), 'Workflow failed: Progress polling failed');
        assert.equal(runFailureMessage(null), 'Workflow failed: Unknown error');
    });
});
