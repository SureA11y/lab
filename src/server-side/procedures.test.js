'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { proceduresForCriteria, proceduresForRequirements, listStandardProcedures, standardLanguages, completeLocale, MAX_IDS } = require('./procedures');

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

// The procedures are core's and the packs': these take whatever they list,
// so a change there (a requirement added, removed or reworded) is shown, not
// a failure here.
test('with a core that has them, each criterion it lists comes as core gives it', (t) => {
    const core = require('@surea11y/core');
    if (typeof core.proceduresFor !== 'function' || typeof core.listProcedures !== 'function') return t.skip('the installed core has no procedures');
    const ids = core.listProcedures({ levels: ['A', 'AA', 'AAA'] }).requirements.map((r) => String(r.id));
    assert.ok(ids.length > 0);
    const out = proceduresForCriteria(ids.slice(0, MAX_IDS));
    for (const id of ids.slice(0, MAX_IDS)) assert.deepEqual(out.procedures[id], core.proceduresFor(id, { locale: 'en' }), id);
});

test('with the pack and a core that reads it, each requirement of its own the pack lists comes as core gives it', (t) => {
    const core = require('@surea11y/core');
    if (typeof core.proceduresFor !== 'function' || typeof core.listProcedures !== 'function') return t.skip('the installed core has no procedures of packs');
    const pack = require('./standard-packs').packForStandard('en301549');
    if (!pack) return t.skip('the EN 301 549 pack is not installed');
    for (const version of pack.standard.versions || []) {
        const listing = core.listProcedures({ packs: [pack], standard: 'en301549', version });
        if (!listing) continue;
        const own = listing.requirements.filter((r) => !r.wcag).map((r) => String(r.id));
        const out = proceduresForRequirements(own, { standard: 'en301549', version });
        for (const id of own) {
            assert.deepEqual(out.procedures[id], core.proceduresFor(id, { packs: [pack], standard: 'en301549', version, locale: 'en' }), `${version} ${id}`);
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

// A core that says which languages a standard can be read in: French all
// of it, German one text short.
const LANGUAGES = [
    { locale: 'en', complete: true, missing: 0 },
    { locale: 'de', complete: false, missing: 1 },
    { locale: 'fr', complete: true, missing: 0 },
];
const languageCore = (seen = []) => ({
    ...fakeCore(seen),
    procedureLanguages: (options) => (options.standard === 'rgaa' ? null : LANGUAGES),
});

test('a report reads a standard in a language only where it is all in it, else in the standard\'s own', () => {
    assert.equal(completeLocale('fr', LANGUAGES), 'fr');
    assert.equal(completeLocale('fr-ca', LANGUAGES), 'fr', 'a regional tag reads in its language');
    assert.equal(completeLocale('de', LANGUAGES), 'en', 'not part German, part English');
    assert.equal(completeLocale('pt', LANGUAGES), 'en', 'a language the standard lacks');
    assert.equal(completeLocale('pt', [{ locale: 'fr', complete: true, missing: 0 }]), 'fr', 'a standard written in French reads in French');
    assert.equal(completeLocale('de', null), 'de', 'a core that does not say reads the locale asked for');

    const seen = [];
    const out = proceduresForCriteria('1.4.13', { locale: 'de', core: languageCore(seen) });
    assert.equal(out.locale, 'en');
    assert.deepEqual(seen, [['1.4.13', 'en']]);
    assert.equal(proceduresForCriteria('1.4.13', { locale: 'FR-CA', core: languageCore() }).locale, 'fr');
});

test('the languages of a standard are core\'s, its own first', () => {
    const packFor = (key) => (key === 'en301549' ? { standard: { key } } : null);
    assert.deepEqual(standardLanguages({ standard: 'wcag', version: '2.1' }, { core: languageCore(), packFor }), { available: true, languages: LANGUAGES });
    assert.deepEqual(standardLanguages({ standard: 'nope' }, { core: languageCore(), packFor }), { available: true, languages: null }, 'a standard with no pack');
    assert.deepEqual(standardLanguages({ standard: 'wcag' }, { core: fakeCore(), packFor }), { available: false }, 'a core that does not say');
    const asked = [];
    standardLanguages({ standard: 'en301549', version: 'V4.1.1' }, { core: { procedureLanguages: (o) => { asked.push(o); return LANGUAGES; } }, packFor });
    assert.deepEqual(asked, [{ standard: 'en301549', version: 'V4.1.1', packs: [{ standard: { key: 'en301549' } }] }]);
});

test('with a core that says, each language it gives reads the standard in it, and a WCAG title it has no translation of is marked English', (t) => {
    const core = require('@surea11y/core');
    if (typeof core.procedureLanguages !== 'function') return t.skip('the installed core does not say which languages it has');
    for (const version of ['2.0', '2.1', '2.2']) {
        const { languages } = standardLanguages({ standard: 'wcag', version });
        assert.equal(languages[0].locale, 'en');
        for (const l of languages) {
            const { listing } = listStandardProcedures({ standard: 'wcag', version, levels: 'A,AA,AAA', locale: l.locale });
            assert.equal(listing.locale, l.locale, `${version} ${l.locale}`);
            // Core counts what is left in another language; the guide marks as
            // many requirement and group titles of it.
            const marked = listing.requirements.filter((r) => r.titleLang && r.titleLang !== l.locale).length;
            if (l.complete) assert.equal(marked, 0, `${version} ${l.locale}`);
            else assert.ok(marked > 0 && marked <= l.missing, `${version} ${l.locale}: ${marked} of ${l.missing}`);
        }
    }
});
