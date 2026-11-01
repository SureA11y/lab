'use strict';

// The lab's procedures for what no rule evaluates, read into core's
// (lab-procedures.js): what core and the packs give comes first, the lab's
// fills the rest, and a core that can't take them is left as it is.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { withLabProcedures, withLabRequirements, wcagDictionary, dictionariesOf, filtered, pruned } = require('./lab-procedures');
const WCAG = require('../procedures/wcag.json');
const { ownRequirements } = require('../procedures/en301549.js');

const tmpDictionaries = (dicts) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-procedures-'));
    for (const [locale, d] of Object.entries(dicts)) fs.writeFileSync(path.join(dir, `${locale}.json`), JSON.stringify(d));
    return dir;
};

test('a core that can\'t read them is left as it is', () => {
    const core = { proceduresFor: () => null };
    assert.equal(withLabProcedures(core, { from: null, dir: '/nowhere' }), core);
    assert.equal(withLabProcedures(core, { from: { proceduresFrom() {}, listProceduresFrom() {} }, dir: null }), core);
    assert.equal(withLabProcedures(core, { from: { proceduresFrom() {}, listProceduresFrom() {} }, dir: '/nowhere' }), core);
    assert.equal(withLabProcedures(null), null);
});

test('the lab\'s steps join core\'s English where core has none, and no other language', () => {
    const lab = wcagDictionary();
    const [c] = WCAG.criteria;
    const [f] = c.facets;
    const stem = `wcag_${c.id}_${f.id}_`;
    assert.equal(lab[`${stem}step1`], f.steps[0]);
    assert.equal(lab[`${stem}pass`], f.passWhen);
    assert.equal(lab[`${stem}fail`], f.failWhen);
    // A facet core has steps for keeps core's.
    const dir = tmpDictionaries({ en: { [`${stem}step1`]: 'Core.', [`${stem}pass`]: 'P.', [`${stem}fail`]: 'F.' }, fr: { x: 'y' } });
    const { dictionaries, added } = dictionariesOf(dir);
    assert.equal(dictionaries.en[`${stem}step1`], 'Core.');
    assert.equal(dictionaries.en[`${stem}step2`], undefined);
    assert.ok(!added.has(stem));
    const other = WCAG.criteria[1].facets[0];
    const otherStem = `wcag_${WCAG.criteria[1].id}_${other.id}_`;
    assert.ok(added.has(otherStem));
    assert.equal(dictionaries.en[`${otherStem}step1`], other.steps[0]);
    assert.deepEqual(dictionaries.fr, { x: 'y' });
    assert.equal(dictionariesOf(tmpDictionaries({ fr: {} })), null, 'no English');
});

test('a pack\'s standard gains the lab\'s own requirements, in its chapters, where it gives none of that id', () => {
    const plain = { standard: { key: 'other', procedures: { 1: {} } } };
    assert.equal(withLabRequirements(plain), plain);
    const bare = { standard: { key: 'en301549' } };
    assert.equal(withLabRequirements(bare), bare, 'a pack that gives no procedures');
    const pack = {
        name: 'p',
        standard: {
            key: 'en301549',
            versions: ['V3.2.1', 'V4.1.1'],
            procedures: { 'V4.1.1': { '9.1.1.1': { title: 'Non-text content', wcag: '1.1.1' }, '4.2.1': { title: 'The pack\'s own' } } },
            groups: { 'V4.1.1': [] },
        },
    };
    const out = withLabRequirements(pack);
    assert.equal(withLabRequirements(pack), out, 'once each');
    assert.equal(out.name, 'p');
    const v4 = out.standard.procedures['V4.1.1'];
    assert.deepEqual(v4['4.2.1'], { title: 'The pack\'s own' });
    assert.deepEqual(v4['9.1.1.1'], { title: 'Non-text content', wcag: '1.1.1' });
    for (const [id, entry] of Object.entries(ownRequirements('V4.1.1'))) if (id !== '4.2.1') assert.equal(v4[id], entry, id);
    assert.deepEqual(Object.keys(out.standard.procedures), ['V4.1.1']);
    const placed = (groups) => groups.flatMap((g) => (g.requirements || []).concat(placed(g.groups || [])));
    const ids = placed(out.standard.groups['V4.1.1']);
    assert.deepEqual(ids.slice().sort(), Object.keys(v4).sort());
    assert.deepEqual(out.standard.groups['V4.1.1'].map((g) => g.id), ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    assert.equal(pack.standard.procedures['V4.1.1']['4.2.2'], undefined, 'the pack itself is left as it is');
});

test('the filters keep what core keeps, and the groups what is left', () => {
    const facet = (id, automation, tools, extra = {}) => ({ id, automation, rules: [], tools: tools.map((t) => ({ id: t })), ...extra });
    const r = { id: '1.1.1', facets: [facet('a', 'manual', ['keyboard']), facet('b', 'partial', [], { coveredBy: 'a' }), facet('c', 'manual', ['zoom'])] };
    const none = { tools: null, automation: null, rules: null };
    assert.equal(filtered(r, none), r);
    assert.deepEqual(filtered(r, { ...none, tools: ['keyboard'] }).facets.map((f) => f.id), ['a', 'b'], 'a technology facet by its coverer\'s tools');
    assert.deepEqual(filtered(r, { ...none, automation: ['partial'] }).facets.map((f) => f.id), ['a', 'b'], 'and its coverer with it');
    assert.equal(filtered(r, { ...none, tools: ['pointer'] }), null);
    const groups = [{ id: '1', requirements: [], groups: [{ id: '1.1', requirements: ['1.1.1'], groups: [] }, { id: '1.2', requirements: ['1.2.1'], groups: [] }] }];
    assert.deepEqual(pruned(groups, new Set(['1.1.1'])), [{ id: '1', requirements: [], groups: [{ id: '1.1', requirements: ['1.1.1'], groups: [] }] }]);
    assert.deepEqual(pruned(groups, new Set()), []);
});

// With a core that reads procedures (1.15) installed: the guide's calls give
// every criterion and requirement a procedure.
const real = () => {
    const core = require('@surea11y/core');
    const lab = withLabProcedures(core);
    return lab === core ? null : { core, lab };
};

test('with a core that reads them, every WCAG criterion has a procedure, the lab\'s with their tools', (t) => {
    const found = real();
    if (!found) return t.skip('the installed core can\'t read the lab\'s procedures');
    const { lab } = found;
    for (const version of ['2.0', '2.1', '2.2']) {
        const listing = lab.listProcedures({ standard: 'wcag', version, locale: 'en' });
        for (const r of listing.requirements) assert.equal(r.complete, true, `${version} ${r.id}`);
    }
    for (const c of WCAG.criteria) {
        const r = lab.proceduresFor(c.id, { locale: 'en' });
        for (const f of c.facets) {
            const got = r.facets.find((x) => x.id === f.id);
            assert.deepEqual(got.procedure.steps, f.steps, `${c.id} ${f.id}`);
            assert.equal(got.procedure.failWhen, f.failWhen.split('{{requirement}}').join(`WCAG ${c.id}`));
            assert.deepEqual(got.tools.map((x) => x.id), f.tools || [], `${c.id} ${f.id} tools`);
        }
    }
    // A tool filter finds the lab's facets by their tools, as core's.
    const withTool = WCAG.criteria.find((c) => c.facets.some((f) => (f.tools || []).includes('screen-reader')));
    const sr = lab.listProcedures({ standard: 'wcag', tools: ['screen-reader'], locale: 'en' });
    assert.ok(sr.requirements.some((r) => r.id === withTool.id), withTool.id);
    assert.deepEqual(sr.scope.tools, ['screen-reader']);
    for (const r of sr.requirements) for (const f of r.facets.filter((x) => !x.coveredBy)) assert.ok(f.tools.some((x) => x.id === 'screen-reader') || r.facets.some((x) => x.coveredBy === f.id), `${r.id} ${f.id}`);
});

test('with a core that reads them, EN 301 549 has its own requirements, in its chapters, and its clauses their procedures', (t) => {
    const found = real();
    if (!found) return t.skip('the installed core can\'t read the lab\'s procedures');
    const pack = require('./standard-packs').packForStandard('en301549');
    if (!pack || !pack.standard.procedures) return t.skip('the EN 301 549 pack gives no procedures');
    const { lab } = found;
    for (const version of ['V3.2.1', 'V4.1.1']) {
        const listing = lab.listProcedures({ packs: [pack], standard: 'en301549', version, locale: 'en' });
        const ids = listing.requirements.map((r) => r.id);
        for (const id of Object.keys(ownRequirements(version))) assert.ok(ids.includes(id), `${version} ${id}`);
        for (const r of listing.requirements) assert.equal(r.complete, true, `${version} ${r.id}`);
        assert.deepEqual(listing.groups.map((g) => g.id), ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    }
    // A clause that restates a criterion no rule evaluates names itself.
    const clause = lab.proceduresFor('9.1.2.3', { packs: [pack], standard: 'en301549', version: 'V4.1.1', locale: 'en' });
    assert.match(clause.facets[0].procedure.failWhen, /EN 301 549 9\.1\.2\.3/);
    assert.equal(lab.proceduresFor('4.2.1', { packs: [pack], standard: 'en301549', version: 'V4.1.1', locale: 'en' }).title, 'Usage without vision');
});

test('with a core that reads them, the lab\'s English is marked so, and a language without it is not complete', (t) => {
    const found = real();
    if (!found) return t.skip('the installed core can\'t read the lab\'s procedures');
    const { lab } = found;
    const [c] = WCAG.criteria;
    const fr = lab.proceduresFor(c.id, { locale: 'fr' });
    assert.equal(fr.facets[0].procedureLang, 'en');
    assert.equal(fr.facets[0].procedure.steps[0], c.facets[0].steps[0]);
    const languages = lab.procedureLanguages({ standard: 'wcag' });
    assert.deepEqual(languages[0], { locale: 'en', complete: true, missing: 0 });
    for (const l of languages.slice(1)) assert.equal(l.complete, false, l.locale);
});
