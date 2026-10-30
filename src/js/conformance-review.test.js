'use strict';

// The Conformance view's record: the review a report holds. Carrying one
// forward is shared/conformance-report.js's, and tested there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'conformance-review.js')).href);

test('a report without a review gets an empty one to write to', async () => {
    const { reviewOf } = await load();
    assert.deepEqual(reviewOf({}), { product: {}, criteria: {}, clauses: {} });
    const held = { conformanceReview: { criteria: { '1.1.1': { conformance: 'supports' } } } };
    assert.equal(reviewOf(held), held.conformanceReview, 'the report\'s own, made whole');
    assert.deepEqual(reviewOf(held).clauses, {});
});
