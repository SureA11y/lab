'use strict';

// The scan step's fields that describe what surea11y reports: which rules
// run beyond the profile, and how findings are grouped.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { ACTION_DEFINITIONS } = require('./action-definitions.js');

const scan = ACTION_DEFINITIONS.a11yScan;

describe('a11yScan fields', () => {
    test('there is no "Opt-in rules" field: the lab runs no rules core keeps off', () => {
        assert.equal(scan.fields.optInRules, undefined);
        assert.ok(!Object.values(scan.fieldOrder).flat().includes('optInRules'));
    });

    test('"Screenshot view" takes the page\'s picture unless set to false, after the selectors, and a scan saves no evidence', () => {
        const field = scan.fields.screenshotView;
        assert.equal(field.type, 'boolean');
        assert.equal(field.default, true);
        assert.equal(field.alias, 'Screenshot view');
        const order = scan.fieldOrder.secondary;
        assert.equal(order.indexOf('screenshotView'), order.indexOf('exclude') + 1);
        // The Save evidence step does; a scan's own pictures are its screenshots.
        assert.equal(scan.fields.evidenceVariant, undefined);
    });

    test('"Wait timeout" is only Wait for\'s, and the stage limit is a minute unless set', () => {
        assert.equal(scan.fields.waitTimeout.default, 10000);
        // The runner reads this default too, for a step that gives none.
        assert.equal(scan.fields.stageTimeout.default, 60000);
        assert.equal(scan.fields.timeout, undefined);
        const order = scan.fieldOrder.secondary;
        assert.equal(order.indexOf('waitTimeout'), order.indexOf('waitVisible') + 1);
    });

    test('"Report findings by" no longer says rollups are WCAG criteria only', () => {
        const field = scan.fields.findingsSource;
        const composite = field.options.find((o) => o.value === 'composite');
        assert.notEqual(composite.label, 'WCAG SC');
        assert.doesNotMatch(field.description, /RGAA/);
    });
});
