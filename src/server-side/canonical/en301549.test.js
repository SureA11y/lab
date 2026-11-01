'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { en301549ForFinding, annotateEn301549, en301549FromMappings } = require('./en301549');

describe('en301549ForFinding', () => {
    test('a criterion in both versions gives one clause listing both', () => {
        assert.deepEqual(en301549ForFinding({ wcag: { sc: ['1.1.1'] } }), [
            { clause: '9.1.1.1', title: 'Non-text content', versions: ['V3.2.1', 'V4.1.1'], wcagSc: ['1.1.1'] }
        ]);
    });

    test('WCAG 2.2 and removed criteria only map to the version that has them', () => {
        assert.deepEqual(en301549ForFinding({ wcag: { sc: ['2.5.8'] } }).map((c) => [c.clause, c.versions]), [['9.2.5.8', ['V4.1.1']]]);
        assert.deepEqual(en301549ForFinding({ wcag: { sc: ['4.1.1'] } }).map((c) => [c.clause, c.versions]), [['9.4.1.1', ['V3.2.1']]]);
    });

    test('AAA criteria and findings without criteria have none', () => {
        assert.deepEqual(en301549ForFinding({ wcag: { sc: ['1.4.6'] } }), []);
        assert.deepEqual(en301549ForFinding({}), []);
    });

    test('reads { ref } entries and prefers the normative list when there is one', () => {
        assert.deepEqual(en301549ForFinding({ wcag: { sc: [{ ref: '4.1.2' }] } }).map((c) => c.clause), ['9.4.1.2']);
        assert.deepEqual(en301549ForFinding({ wcag: { sc: ['1.1.1', '2.4.4'], scNormative: ['2.4.4'] } }).map((c) => c.clause), ['9.2.4.4']);
    });

    test('clauses come out in document order', () => {
        const clauses = en301549ForFinding({ wcag: { sc: ['4.1.2', '1.4.10', '1.4.3'] } }).map((c) => c.clause);
        assert.deepEqual(clauses, ['9.1.4.3', '9.1.4.10', '9.4.1.2']);
    });
});

describe('annotateEn301549', () => {
    test('under an EN 301 549 target, sets that version\'s clauses and leaves the rest without one', () => {
        const canonical = { findings: [{ wcag: { sc: ['1.1.1', '2.5.8'] } }, { wcag: { sc: [] }, en301549: ['stale'] }] };
        annotateEn301549(canonical, { profile: 'en301549-v3.2.1' });
        assert.deepEqual(canonical.findings[0].en301549.map((c) => [c.clause, c.versions]), [['9.1.1.1', ['V3.2.1']]]);
        assert.equal('en301549' in canonical.findings[1], false);
    });

    test('names no clause on a scan of another target, or of none', () => {
        for (const profile of [null, 'section508', 'rgaa-4.1.2']) {
            const canonical = { findings: [{ wcag: { sc: ['1.1.1'] }, en301549: ['stale'] }] };
            annotateEn301549(canonical, { profile });
            assert.equal('en301549' in canonical.findings[0], false, String(profile));
        }
    });
});

describe('en301549FromMappings', () => {
    test('sets the clauses core named on a finding, and leaves one with none without', () => {
        const canonical = {
            findings: [
                { standards: { normativeMappings: [
                    { standard: 'EN 301 549', version: 'V4.1.1', requirement: '9.1.1.1', title: 'Non-text content', wcagSc: ['1.1.1'] },
                    { standard: 'WCAG', requirement: '1.1.1' },
                ] } },
                { standards: { normativeMappings: [{ standard: 'WCAG', requirement: '1.4.3' }] }, en301549: ['stale'] },
            ],
            bestPractices: [{ standards: { normativeMappings: [] } }],
        };
        en301549FromMappings(canonical);
        assert.deepEqual(canonical.findings[0].en301549, [{ clause: '9.1.1.1', title: 'Non-text content', versions: ['V4.1.1'], wcagSc: ['1.1.1'] }]);
        assert.equal('en301549' in canonical.findings[1], false);
        assert.equal('en301549' in canonical.bestPractices[0], false);
    });
});
