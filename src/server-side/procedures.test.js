'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proceduresForCriteria, proceduresForRequirements, MAX_IDS } = require('./procedures');

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

test('leaves out what is not a requirement, and caps how many', () => {
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

test('a standard\'s own requirements are read with its pack, in the version asked', () => {
    const seen = [];
    const core = { proceduresFor(id, options) { seen.push([id, options]); return { id }; } };
    const pack = { name: 'pack' };
    const packFor = (key) => (key === 'en301549' || key === 'rgaa' ? pack : null);
    const out = proceduresForRequirements('4.2.1,12.1,5', { standard: 'en301549', version: 'V4.1.1', core, packFor });
    assert.deepEqual(Object.keys(out.procedures).sort(), ['12.1', '4.2.1', '5']);
    assert.deepEqual(seen.find(([id]) => id === '5'), ['5', { locale: 'en', packs: [pack], standard: 'en301549', version: 'V4.1.1' }]);
    assert.equal(proceduresForRequirements('5', { standard: 'en301549', version: '../x', core, packFor }).available, true);
    assert.equal(seen[seen.length - 1][1].version, undefined, 'a version that is no version is left to the pack');
    assert.deepEqual(proceduresForRequirements('1.1', { standard: 'rgaa', version: '4.1', core, packFor }).procedures, { '1.1': { id: '1.1' } }, 'any installed standard');
    assert.deepEqual(proceduresForRequirements('5', { standard: 'bitv', core, packFor }), { available: false }, 'a standard with no pack installed');
    assert.deepEqual(proceduresForRequirements('5', { standard: '../x', core, packFor }), { available: false }, 'no key');
});

test('with the pack and a core that reads it, every requirement of its own has procedures', (t) => {
    const core = require('@surea11y/core');
    if (typeof core.proceduresFor !== 'function' || typeof core.listProcedures !== 'function') return t.skip('the installed core has no procedures of packs');
    const ids = { 'V4.1.1': ['4.2.1', '4.2.11', '9.6', '9.7', '12.1', '12.5', '5', '11', '13'], 'V3.2.1': ['4.2.1', '9.6', '12.1.1', '12.2.4', '6', '11', '13'] };
    for (const [version, list] of Object.entries(ids)) {
        const out = proceduresForRequirements(list, { standard: 'en301549', version });
        if (!out.available) return t.skip('the EN 301 549 pack is not installed');
        for (const id of list) {
            const p = out.procedures[id];
            if (!p) return t.skip(`the installed pack has no procedures for ${id} ${version}`);
            assert.ok(p.facets.every((f) => f.procedure && f.procedure.steps.length), `${version} ${id}`);
        }
    }
});

test('the testing guide lists a standard as core does, with the choices it takes', () => {
    const { listOptions, listStandardProcedures, renderStandardProcedures } = require('./procedures');
    const pack = { name: 'pack' };
    const packFor = (k) => (k === 'en301549' ? pack : null);
    assert.deepEqual(listOptions({ standard: 'wcag', version: '2.1', levels: 'A,AA,Z', tools: 'screen-reader,x', automation: 'manual,partial', locale: 'FR' }, { packFor }),
        { locale: 'fr', tools: ['screen-reader'], automation: ['manual', 'partial'], standard: 'wcag', version: '2.1', levels: ['A', 'AA'] });
    assert.deepEqual(listOptions({ standard: 'wcag', version: '9.9' }, { packFor }), { locale: 'en', standard: 'wcag' }, 'an unknown version is core\'s default');
    assert.deepEqual(listOptions({ standard: 'best-practice' }, { packFor }), { locale: 'en', standard: 'best-practice' });
    assert.deepEqual(listOptions({ standard: 'en301549', version: 'V4.1.1' }, { packFor }), { locale: 'en', packs: [pack], standard: 'en301549', version: 'V4.1.1' });
    assert.equal(listOptions({ standard: 'rgaa' }, { packFor }), null, 'no pack installed');

    const seen = [];
    const core = { listProcedures: (o) => { seen.push(o); return { standard: 'WCAG', version: '2.2', requirements: [] }; }, renderProcedures: () => '<!doctype html>page' };
    assert.deepEqual(listStandardProcedures({ standard: 'wcag' }, { core, packFor }), { available: true, listing: { standard: 'WCAG', version: '2.2', requirements: [] } });
    assert.deepEqual(listStandardProcedures({ standard: 'rgaa' }, { core, packFor }), { available: true, listing: null });
    assert.deepEqual(listStandardProcedures({}, { core: {}, packFor }), { available: false });
    assert.deepEqual(renderStandardProcedures({ standard: 'wcag' }, { core, packFor }), { html: '<!doctype html>page', name: 'WCAG 2.2 testing guide.html' });
    assert.equal(renderStandardProcedures({ standard: 'wcag' }, { core: { listProcedures: core.listProcedures }, packFor }), null, 'a core that cannot render');
});
