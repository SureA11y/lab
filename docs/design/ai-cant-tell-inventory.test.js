'use strict';

// The inventory of "can't tell" checks (ai-cant-tell-inventory.js) keeps up
// with the engine and with what the AI answers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readChecks, render, LANES } = require('./ai-cant-tell-inventory');
const { entryFor } = require('../../src/server-side/ai-answer/registry');

const checks = readChecks();

test('every engine check that can end in "can\'t tell" has a lane', () => {
    assert.ok(checks.length > 100, 'the engine\'s checks were found');
    assert.deepEqual(checks.filter((c) => !LANES[c.id]).map((c) => c.id), [], 'give each a lane in ai-cant-tell-inventory.js');
});

test('the "answered" lane is what the AI answers', () => {
    // The page-level and per-element walk questions are keyed by rule, so
    // they are named here; the reading questions by their check.
    const walkChecks = new Set(['manual-review', 'css-focus-indicator-suppressed', 'click-handler-keyboard-operable', 'widget-keyboard-focusable', 'focus-not-obscured-minimum', 'focus-not-obscured-enhanced']);
    for (const c of checks) {
        const answered = LANES[c.id] && LANES[c.id][0] === 'answered';
        const byAi = !!entryFor(c.id) || walkChecks.has(c.id);
        assert.equal(answered, byAi, `${c.id}: lane "${LANES[c.id] && LANES[c.id][0]}" but ${byAi ? '' : 'not '}answered by the AI`);
    }
});

test('the generated page is up to date', () => {
    const page = fs.readFileSync(path.join(__dirname, 'ai-cant-tell-inventory.md'), 'utf8');
    assert.equal(page, render(checks), 'run: node docs/design/ai-cant-tell-inventory.js');
});
