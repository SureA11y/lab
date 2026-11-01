'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { appliedConformanceProfile } = require('./a11y-runner');

const canonical = (engineIds, conformanceProfile = null) => ({
    engines: engineIds.map((id) => ({ id })),
    runOptions: { conformanceProfile }
});

describe('appliedConformanceProfile', () => {
    test('when surea11y ran, its own report decides', () => {
        const applied = { id: 'section508', label: 'Section 508' };
        assert.deepEqual(appliedConformanceProfile({ canonical: canonical(['surea11y'], applied) }, { requested: 'section508' }), applied);
        // It left the profile out: the step's includes took precedence.
        assert.equal(appliedConformanceProfile({ canonical: canonical(['surea11y']) }, { requested: 'section508' }), null);
    });

    test('finds surea11y\'s report in a multi-engine scan whatever the engine order', () => {
        const applied = { id: 'wcag22-aa', label: 'WCAG 2.2 AA' };
        const result = {
            canonical: canonical(['engine-b', 'surea11y']),
            perEngine: [{ canonical: canonical(['engine-b']) }, { canonical: canonical(['surea11y'], applied) }]
        };
        assert.deepEqual(appliedConformanceProfile(result, { requested: 'wcag22-aa' }), applied);
    });

    test('other engines get the standard through its tags, so it counts unless the step included rules or tags', () => {
        const result = { canonical: canonical(['engine-b']) };
        assert.deepEqual(appliedConformanceProfile(result, { requested: 'en301549-v4.1.1' }), { id: 'en301549-v4.1.1', label: 'EN 301 549 V4.1.1' });
        assert.equal(appliedConformanceProfile(result, { requested: 'en301549-v4.1.1', overridden: true }), null);
        assert.equal(appliedConformanceProfile(result, {}), null);
    });
});

