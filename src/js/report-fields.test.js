'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// These fields are read by the renderers; dropping one from the lists makes
// the feature vanish from the report view with no error anywhere.
test('the report view keeps the fields its renderers read', async () => {
    const { SCAN_FIELDS, FINDING_FIELDS, CANONICAL_FIELDS } = await import('./report-fields.js');

    for (const key of ['wcagLevel', 'conformanceProfile', 'optInRules', 'canonical', 'label']) {
        assert.ok(SCAN_FIELDS.includes(key), `scan field "${key}" would be dropped`);
    }
    for (const key of ['title', 'wcag', 'occurrences', 'lang', 'titleLang', 'en301549', 'rgaa']) {
        assert.ok(FINDING_FIELDS.includes(key), `finding field "${key}" would be dropped`);
    }
    for (const key of ['findings', 'diagnostics', 'notices', 'margins']) {
        assert.ok(CANONICAL_FIELDS.includes(key), `canonical field "${key}" would be dropped`);
    }
});

test('a finding keeps the parts of meta and evidence the renderers read, and nothing else of them', async () => {
    const { pickFindingFields } = await import('./report-fields.js');
    const rollup = { reasonCode: 'X', checksIds: ['a'], contributors: [{ testId: 'a', outcome: 'cantTell' }] };
    const picked = pickFindingFields({
        ruleId: 'wcag-4.1.2-name', outcome: 'cantTell', title: 't', rgaa: [{ criterion: '6.2' }],
        meta: { atomic: false, normativeMappings: [{ standard: 'WCAG' }], expectation: 'long text' },
        evidence: { rollup, somethingElse: 1 },
        internal: 'dropped',
    });

    assert.deepEqual(picked.meta, { atomic: false });
    assert.deepEqual(pickFindingFields({ meta: { atomic: false, standard: 'RGAA', title: 'x' } }).meta, { atomic: false, standard: 'RGAA' });
    assert.deepEqual(picked.evidence, { rollup });
    assert.deepEqual(picked.rgaa, [{ criterion: '6.2' }]);
    assert.equal('internal' in picked, false);
});

test('a finding without meta or evidence gets neither', async () => {
    const { pickFindingFields } = await import('./report-fields.js');
    const picked = pickFindingFields({ ruleId: 'image-alt', outcome: 'fail' });
    assert.equal('meta' in picked, false);
    assert.equal('evidence' in picked, false);
});

test('optInRulesLabel names the standards whose own rules a scan added', async () => {
    const { optInRulesLabel } = await import('./report-fields.js');
    assert.equal(optInRulesLabel({ optInRules: ['rgaa'] }), 'RGAA-only rules');
    assert.equal(optInRulesLabel({ optInRules: null }), '');
    assert.equal(optInRulesLabel({}), '');
    assert.equal(optInRulesLabel(null), '');
});

test('a finding keeps the requirements of a standard besides WCAG and EN 301 549, and only those', async () => {
    const { pickFindingFields } = await import('./report-fields.js');
    const picked = pickFindingFields({
        ruleId: 'sample-1.0-1',
        standards: {
            normativeMappings: [
                { standard: 'WCAG', requirement: '1.1.1', conformanceLevel: 'A' },
                { standard: 'EN 301 549', requirement: '9.1.1.1', version: 'V4.1.1' },
                { standard: 'Sample Standard', requirement: '1', version: '1.0', title: 'Images have a text alternative', wcagSc: ['1.1.1'], extra: 'left out' },
            ],
            informativeReferences: [{ standard: 'x' }],
        },
    });
    assert.deepEqual(picked.standards, { normativeMappings: [{ standard: 'Sample Standard', requirement: '1', version: '1.0', title: 'Images have a text alternative', wcagSc: ['1.1.1'] }] });
    assert.equal('standards' in pickFindingFields({ ruleId: 'w', standards: { normativeMappings: [{ standard: 'WCAG', requirement: '1.1.1' }] } }), false, 'none for WCAG alone');
});
