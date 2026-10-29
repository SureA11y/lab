'use strict';

// The runner hands a scan step to performA11yScan field by field, so a field
// the step declares but the handler does not copy is offered in the builder
// and then never read. That is how the step's "profile" was lost when it was
// renamed from wcagLevel. This reads the handler's source rather than
// running it, which needs a browser.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

// Read by the workflow engine before it hands the scan over, so the runner
// has no use for them.
const READ_BY_THE_ENGINE = ['waitForSelector', 'waitVisible', 'waitTimeout'];

test('the runner\'s scan handler reads every field the a11yScan step declares', () => {
    const source = fs.readFileSync(path.join(__dirname, 'a11y-runner.js'), 'utf8');
    const start = source.indexOf('workflowCtx.handleA11yScanAction = async');
    const end = source.indexOf('\n    };\n', start);
    assert.ok(start > 0 && end > start, 'the handler is where this test looks for it');
    const handler = source.slice(start, end);

    const missing = Object.keys(ACTION_DEFINITIONS.a11yScan.fields)
        .filter((name) => !READ_BY_THE_ENGINE.includes(name))
        .filter((name) => !new RegExp(`\\bs\\??\\.${name}\\b`).test(handler));
    assert.deepEqual(missing, []);
});
