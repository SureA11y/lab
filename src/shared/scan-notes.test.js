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

test('a page its server answered with an error is noted, with the status; another page\'s error is not', () => {
    const { httpErrorNotice } = require('./scan-notes.js');
    const note = httpErrorNotice({ url: 'https://x.test/a', status: 500, statusText: 'Internal Server Error' }, 'https://x.test/a#top');
    assert.equal(note.code, 'http-error');
    assert.match(note.message, /^The server answered HTTP 500 \(Internal Server Error\) for this page/);
    assert.equal(httpErrorNotice({ url: 'https://x.test/a', status: 404 }, 'https://x.test/b'), null);
    assert.equal(httpErrorNotice({ url: 'https://x.test/a', status: 200 }, 'https://x.test/a'), null);
    assert.equal(httpErrorNotice(null, 'https://x.test/a'), null);
});
