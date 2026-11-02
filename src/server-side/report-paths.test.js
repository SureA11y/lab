'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { reportsRootFrom } = require('./report-paths');

const LAB = path.join(__dirname, '..', '..');

test('the reports folder is the lab\'s reports/, or A11Y_REPORTS_ROOT, from the lab\'s folder or absolute', () => {
    assert.equal(reportsRootFrom({}), path.join(LAB, 'reports'));
    assert.equal(reportsRootFrom({ A11Y_REPORTS_ROOT: '  ' }), path.join(LAB, 'reports'));
    assert.equal(reportsRootFrom({ A11Y_REPORTS_ROOT: 'out/reports' }), path.join(LAB, 'out', 'reports'));
    assert.equal(reportsRootFrom({ A11Y_REPORTS_ROOT: '/var/lab/reports' }), path.resolve('/var/lab/reports'));
});
