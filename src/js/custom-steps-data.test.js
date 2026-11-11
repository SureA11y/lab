'use strict';

// A custom step's inputs as they are kept: {name, required?, label?, default?}.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let M;
before(async () => {
    M = await import('./custom-steps-data.js');
});

describe('normalizeCustomStepInputs', () => {
    test('keeps a label, trimmed, and leaves out an empty one', () => {
        assert.deepEqual(M.normalizeCustomStepInputs([
            { name: 'viewLabel', required: true, label: ' View label ' },
            { name: 'section', label: '  ' },
            { name: 'waitMs', default: '500', label: 7 },
            'tags',
            { name: 'viewLabel' },
        ]), [
            { name: 'viewLabel', required: true, label: 'View label' },
            { name: 'section' },
            { name: 'waitMs', default: '500' },
            { name: 'tags' },
        ]);
    });
});
