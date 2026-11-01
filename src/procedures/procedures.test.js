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
