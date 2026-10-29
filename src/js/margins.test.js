'use strict';

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');

let M;
before(async () => { M = await import('./margins.js'); });

const ratio = (o) => ({ruleId: 'contrast-minimum', unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.52, headroom: 0.02, ...o});
const px = (o) => ({ruleId: 'target-size-minimum', unit: 'px', limit: 'min', threshold: 24, value: 24.4, headroom: 0.4, ...o});

describe('margins', () => {
    test('formats ratios to two decimals and pixels whole', () => {
        assert.equal(M.formatMarginValue(ratio()), '4.52:1');
        assert.equal(M.formatMarginValue(px({value: 31.6})), '32 px');
        assert.equal(M.formatMarginLimit(ratio()), 'at least 4.5:1');
        assert.equal(M.formatMarginLimit(px({limit: 'max', threshold: 7.5})), 'at most 7.5 px');
    });

    test('rounds the room down, and says "less than" under the smallest step', () => {
        assert.equal(M.formatMarginRoom(ratio({headroom: 0.029})), '0.02');
        assert.equal(M.formatMarginRoom(ratio({headroom: 0.004})), 'less than 0.01');
        assert.equal(M.formatMarginRoom(px({headroom: 0.4})), 'less than 1 px');
        assert.equal(M.formatMarginRoom(px({headroom: 3.4})), '3 px');
    });

    test('calls a pass a near miss under a tenth of a ratio or a pixel', () => {
        assert.equal(M.isNearMiss(ratio({headroom: 0.09})), true);
        assert.equal(M.isNearMiss(ratio({headroom: 0.1})), false);
        assert.equal(M.isNearMiss(px({headroom: 0.9})), true);
        assert.equal(M.isNearMiss(px({headroom: 1})), false);
    });

    test('lists a scan\'s margins with the near misses first', () => {
        const scan = {canonical: {margins: [
            ratio({ruleId: 'a-rule', headroom: 2}),
            px({ruleId: 'b-rule', headroom: 0.2}),
            {ruleId: 'broken'},
        ]}};
        assert.deepEqual(M.scanMargins(scan).map((m) => m.ruleId), ['b-rule', 'a-rule']);
        assert.deepEqual(M.scanMargins({}), []);
    });
});
