'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { largePageNotice } = require('./scan-notes.js');

test('a page past the threshold is noted as large, with how long its scan took and how to make it faster', () => {
    const note = largePageNotice(100006, 25000, 20522);
    assert.equal(note.code, 'large-page');
    assert.match(note.message, /^This page has 100,006 elements, more than 25,000\. It was scanned in full, which took 21 s\./);
    assert.match(note.message, /Include selectors/);
    assert.match(largePageNotice(30006, 25000, 7591).message, /which took 7\.6 s/);
    assert.equal(largePageNotice(24999, 25000, 1000), null);
});
