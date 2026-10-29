'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { reviewGroupOf, countReviewGroups, measuredText, reviewGroupsText } = require('./review-groups');

describe('review groups', () => {
    test('a question is in the group its lean points to, and open without one', () => {
        assert.equal(reviewGroupOf({ lean: { toward: 'fail' } }), 'leanFail');
        assert.equal(reviewGroupOf({ lean: { toward: 'pass' } }), 'leanPass');
        assert.equal(reviewGroupOf({}), 'open');
        assert.equal(reviewGroupOf(null), 'open');
    });

    test('counts every question by its own outcome, a failing rule\'s too', () => {
        const findings = [
            { outcome: 'cantTell', occurrences: [{ lean: { toward: 'fail' } }, { lean: { toward: 'pass' } }, {}] },
            { outcome: 'fail', occurrences: [{ occurrenceOutcome: 'fail' }, { occurrenceOutcome: 'cantTell', lean: { toward: 'fail' } }] },
            { outcome: 'pass', occurrences: [] },
            null,
        ];
        assert.deepEqual(countReviewGroups(findings), { leanFail: 2, leanPass: 1, open: 1, total: 4 });
        assert.equal(reviewGroupsText(countReviewGroups(findings)), '2 likely fail, 1 likely passes, 1 needs a person');
        assert.equal(reviewGroupsText(countReviewGroups([])), '');
    });

    test('says how often a lean of its kind was right, when core counted it', () => {
        assert.equal(measuredText({ measured: { agreed: 9, cases: 10 } }), 'right in 9 of 10 known cases');
        assert.equal(measuredText({ toward: 'fail' }), null);
        assert.equal(measuredText({ measured: { agreed: 1, cases: 0 } }), null);
    });
});
