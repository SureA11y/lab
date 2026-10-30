'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proceduresForCriteria, MAX_IDS } = require('./procedures');

const fakeCore = (seen = []) => ({
    proceduresFor(id, { locale }) {
        seen.push([id, locale]);
        return id === '9.9.9' ? null : { id, title: `Criterion ${id}`, facets: [] };
    },
});

test('a core without procedures says so, and the app shows nothing more', () => {
    assert.deepEqual(proceduresForCriteria('1.4.13', { core: {} }), { available: false });
    assert.deepEqual(proceduresForCriteria('1.4.13', { core: null }), { available: false });
});

test('gives each criterion asked for, once, in the locale', () => {
    const seen = [];
    const out = proceduresForCriteria('1.4.13, 2.4.3,1.4.13', { locale: 'FR', core: fakeCore(seen) });
    assert.equal(out.available, true);
    assert.equal(out.locale, 'fr');
    assert.deepEqual(Object.keys(out.procedures), ['1.4.13', '2.4.3']);
    assert.deepEqual(seen, [['1.4.13', 'fr'], ['2.4.3', 'fr']]);
});

test('leaves out what is not a criterion, and caps how many', () => {
    const many = Array.from({ length: MAX_IDS + 10 }, (_, i) => `${1 + (i % 9)}.${Math.floor(i / 9)}.2`);
    const out = proceduresForCriteria(['1.1.1', 'best-practice', '../x', '9.9.9', ...many], { locale: '<script>', core: fakeCore() });
    assert.equal(out.locale, 'en', 'a locale that is no tag is English');
    assert.equal(out.procedures['best-practice'], undefined);
    assert.equal(out.procedures['9.9.9'], null, 'one core does not know');
    assert.equal(Object.keys(out.procedures).length, MAX_IDS);
});

test('a criterion core fails on gives null, not an error', () => {
    const core = { proceduresFor() { throw new Error('boom'); } };
    assert.deepEqual(proceduresForCriteria('1.1.1', { core }).procedures, { '1.1.1': null });
});

test('with a core that has them, a criterion comes with its facets', (t) => {
    const core = require('@surea11y/core');
    if (typeof core.proceduresFor !== 'function') return t.skip('the installed core has no procedures');
    const p = proceduresForCriteria('1.4.13').procedures['1.4.13'];
    assert.equal(p.id, '1.4.13');
    assert.ok(p.facets.some((f) => f.automation === 'manual' && f.procedure && f.procedure.steps.length));
});
