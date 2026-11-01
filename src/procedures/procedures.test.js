'use strict';

/**
 * The procedures for what no rule of core or the pack evaluates (README.md
 * beside this file): each is well formed, as core and the pack read theirs,
 * so that nothing is lost before the lab shows them.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const WCAG = require('./wcag.json');
const EN301549 = require('./en301549.json');
const ANNEX_B = require('./en301549-annex-b.json');

const TOOLS = ['keyboard', 'pointer', 'screen-reader', 'zoom', 'contrast-theme', 'devtools'];
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function assertFacet(f, where) {
    assert.ok(isText(f.id), `${where}: id`);
    assert.ok(isText(f.label), `${where}: label`);
    assert.equal(f.automation, 'manual', `${where}: no rule evaluates it`);
    for (const t of f.tools || []) assert.ok(TOOLS.includes(t), `${where}: unknown tool ${t}`);
    assert.ok(Array.isArray(f.steps) && f.steps.length > 0, `${where}: steps`);
    for (const s of f.steps) assert.ok(isText(s), `${where}: a step is empty`);
    assert.ok(isText(f.passWhen), `${where}: passWhen`);
    assert.ok(isText(f.failWhen), `${where}: failWhen`);
}

describe('WCAG 2.2', () => {
    test('51 criteria, each once, in number order, with their facets', () => {
        const ids = WCAG.criteria.map((c) => c.id);
        assert.equal(ids.length, 51);
        assert.equal(new Set(ids).size, ids.length);
        const byNumber = (a, b) => {
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
        };
        assert.deepEqual([...ids].sort(byNumber), ids);
        assert.equal(WCAG.criteria.reduce((n, c) => n + c.facets.length, 0), 54);
    });

    test('every facet is a whole procedure that names the requirement it fails', () => {
        for (const c of WCAG.criteria) {
            assert.ok(isText(c.title), `${c.id}: title`);
            assert.ok(['A', 'AA', 'AAA'].includes(c.level), `${c.id}: level`);
            const ids = c.facets.map((f) => f.id);
            assert.equal(new Set(ids).size, ids.length, `${c.id}: a facet twice`);
            for (const f of c.facets) {
                assertFacet(f, `${c.id} ${f.id}`);
                assert.match(f.failWhen, /\{\{requirement\}\}/, `${c.id} ${f.id}: failWhen`);
            }
        }
    });
});

describe('EN 301 549', () => {
    const VERSIONS = EN301549.versions;
    const isByVersion = (v) =>
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        Object.keys(v).length > 0 && Object.keys(v).every((k) => VERSIONS.includes(k));
    // A value as version v shows it; undefined where v has none.
    const forVersion = (value, v) => {
        if (isByVersion(value)) return forVersion(value[v], v);
        if (Array.isArray(value)) {
            return value.map((x) => forVersion(x, v)).filter((x) => x !== undefined);
        }
        return value;
    };
    const inVersion = (item, v) => !item.versions || item.versions.includes(v);
    // A facet's fields as version v shows them.
    const facetFor = (f, v) =>
        Object.fromEntries(Object.entries(f).map(([k, x]) => [k, forVersion(x, v)]));

    test('both versions, and each requirement once in each', () => {
        assert.deepEqual(VERSIONS, ['V3.2.1', 'V4.1.1']);
        for (const v of VERSIONS) {
            const ids = EN301549.requirements.filter((r) => inVersion(r, v)).map((r) => r.id);
            assert.equal(new Set(ids).size, ids.length, v);
            assert.ok(ids.includes('4.2.1') && ids.includes('9.6') && ids.includes('13'), v);
        }
    });

    test('every facet, in each version, is a whole procedure', () => {
        for (const v of VERSIONS) {
            for (const r of EN301549.requirements.filter((x) => inVersion(x, v))) {
                assert.ok(isText(forVersion(r.title, v)), `${v} ${r.id}: title`);
                if (r.note !== undefined) {
                    assert.ok(isText(forVersion(r.note, v)), `${v} ${r.id}: note`);
                    continue;
                }
                const facets = r.facets.filter((f) => inVersion(f, v));
                assert.ok(facets.length > 0, `${v} ${r.id}: no facet`);
                for (const f of facets) {
                    const where = `${v} ${r.id} ${f.id}`;
                    if (f.template === undefined) {
                        assertFacet(facetFor(f, v), where);
                        continue;
                    }
                    const template = EN301549.templates[f.template];
                    assert.ok(template, `${where}: unknown template`);
                    for (const k of ['column', 'need', 'clauses', 'example']) {
                        assert.ok(forVersion(f[k], v) !== undefined, `${where}: ${k}`);
                    }
                    const fields = new Set(['id', 'column', 'need', 'clauses', 'example']);
                    const texts = JSON.stringify(facetFor(template, v)).match(/\{(\w+)\}/g) || [];
                    for (const t of texts) assert.ok(fields.has(t.slice(1, -1)), `${where}: ${t}`);
                    assertFacet({ id: f.id, ...facetFor(template, v) }, where);
                }
            }
        }
    });

    test('in V4.1.1, a related-clauses facet names only clauses Table B.2 marks P', () => {
        for (const r of EN301549.requirements) {
            for (const f of r.facets || []) {
                if (f.template !== 'related-clauses' || !inVersion(f, 'V4.1.1')) continue;
                const { primary } = ANNEX_B['V4.1.1'][r.id];
                const missing = forVersion(f.clauses, 'V4.1.1').filter((c) => !primary.includes(c));
                assert.deepEqual(missing, [], r.id);
            }
        }
    });
});

describe('EN 301 549, as a version gives it (en301549.js)', () => {
    const { ownRequirements, groupsOf } = require('./en301549.js');

    test('each version\'s own requirements, with their titles and facets', () => {
        const v3 = ownRequirements('V3.2.1');
        const v4 = ownRequirements('V4.1.1');
        assert.equal(v3['4.2.1'].title, 'Usage without vision');
        assert.equal(v3['6'].title, 'ICT with two-way voice communication');
        assert.equal(v4['6'].title, 'ICT supporting real-time bidirectional communication');
        assert.ok(v3['12.1.1'] && !v3['12.1'] && v4['12.1'] && !v4['12.1.1']);
        assert.ok(!v3['9.7'] && v4['9.7']);
        assert.match(v4['9.4.1.1'].note, /void in V4\.1\.1/);
        assert.equal(v4['9.4.1.1'].facets, undefined);
        assert.deepEqual(ownRequirements('V9'), {});
    });

    test('a related-clauses facet is filled in, and its criterion relates to WCAG', () => {
        const v3 = ownRequirements('V3.2.1')['4.2.4'].facets[0];
        const v4 = ownRequirements('V4.1.1')['4.2.4'].facets[0];
        assert.equal(v3.id, 'related-clauses');
        assert.equal(v3.label, 'The chapter 9 clauses that serve usage without hearing are met');
        assert.match(v3.steps[0], /column WH, for 4\.2\.4/);
        assert.match(v3.failWhen, /a video with no captions/);
        assert.match(v4.failWhen, /a video with no subtitles/);
        for (const text of [v4.label, ...v4.steps, v4.passWhen, v4.failWhen]) assert.ok(!/[{}]/.test(text), `no field left unfilled: ${text}`);
        // V4.1.1: the WCAG criteria of the chapter 9 clauses Table B.2 marks P.
        assert.ok(ownRequirements('V4.1.1')['4.2.2'].relatesTo.includes('1.4.3'));
        // V3.2.1: those of the clauses its procedure names.
        assert.deepEqual(ownRequirements('V3.2.1')['4.2.3'].relatesTo, ['1.3.3', '1.4.1']);
        // 9.6 relates to the criteria its non-interference names.
        assert.deepEqual(ownRequirements('V4.1.1')['9.6'].relatesTo, ['1.4.2', '2.1.2', '2.2.2', '2.3.1']);
        assert.equal(ownRequirements('V3.2.1')['5'].relatesTo, undefined);
    });

    test('the groups put each requirement in its chapter, once', () => {
        const groups = groupsOf({ 'V3.2.1': { ...ownRequirements('V3.2.1'), '9.1.1.1': { title: 'x' } } })['V3.2.1'];
        assert.deepEqual(groups.map((g) => [g.id, g.title]).slice(0, 2), [['4', 'Functional performance'], ['5', 'Generic requirements']]);
        const web = groups.find((g) => g.id === '9');
        assert.deepEqual(web.groups.map((g) => g.id), ['9.1', '9.6']);
        assert.deepEqual(web.groups[0].groups[0], { id: '9.1.1', title: 'Text alternatives', requirements: ['9.1.1.1'] });
        assert.equal(groups.find((g) => g.id === '12').title, 'Documentation and support services');
    });
});
