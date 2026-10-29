'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildCanonicalFromQualwebReport, qualwebLevels } = require('./qualweb-shared');

const assertion = (outcome, extra = {}) => ({ code: extra.code || 'X', metadata: { outcome, ...extra.metadata }, results: [] });

describe('qualweb-shared: best practices', () => {
    test('the best-practices module\'s findings are best practices, counted apart', () => {
        const canonical = buildCanonicalFromQualwebReport({
            modules: {
                'act-rules': { assertions: { a: assertion('failed', { code: 'QW-ACT-R1' }) } },
                'best-practices': { assertions: { b: assertion('failed', { code: 'QW-BP1' }), c: assertion('passed', { code: 'QW-BP2' }) } }
            }
        }, { engineId: 'qualweb', engineName: 'QualWeb' });
        const bp = canonical.findings.filter((f) => f.bestPractice);
        assert.deepEqual(bp.map((f) => f.id).sort(), ['QW-BP1', 'QW-BP2']);
        assert.equal(canonical.findings.find((f) => f.id === 'QW-ACT-R1').bestPractice, undefined);
        assert.deepEqual(canonical.summary.outcomes, { fail: 1, cantTell: 0, pass: 0, notApplicable: 0 });
        assert.deepEqual(canonical.summary.bestPractices, { fail: 1, cantTell: 0, pass: 1, notApplicable: 0 });
    });
});

describe('qualweb-shared: qualwebLevels', () => {
    test('every level up to the selection\'s', () => {
        assert.deepEqual(qualwebLevels({ selection: { version: '2.2', level: 'AA', profile: null, bestPractices: false } }),
            { level: 'AA', levels: ['A', 'AA'] });
        assert.deepEqual(qualwebLevels({ engineOptions: { wcagLevel: 'a' } }), { level: 'A', levels: ['A'] });
        assert.deepEqual(qualwebLevels({}), { level: null, levels: undefined });
    });
});
