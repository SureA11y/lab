'use strict';

// The definitions used to exist twice, hand-maintained. The copies drifted: one
// definition was missing entirely and an Infinity interval bound had become null,
// which stops a band ever matching. These tests keep the sources collapsed.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { METRIC_DEFS } = require('./a11y-metric-defs.js');
const ROOT = path.resolve(__dirname, '..', '..');

function loadAsBrowserScripts(files) {
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Number, String, Set, Map });
    ctx.globalThis = ctx;
    for (const f of files) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return ctx;
}

describe('metric definitions: one source', () => {
    test('the server-side path re-exports the shared definitions rather than copying them', () => {
        const { METRIC_DEFS: viaServer } = require('../server-side/metrics/a11y-metric-defs.cjs');
        assert.equal(viaServer, METRIC_DEFS);
    });

    test('the payload deps expose the same object, not a parallel literal', () => {
        require('./workflow-payload-deps.js');
        assert.equal(globalThis.A11Y_WORKFLOW_DEPS.METRIC_DEFS, METRIC_DEFS);
    });

    test('workflow-payload-deps.js carries no definition literal of its own', () => {
        const src = fs.readFileSync(path.join(__dirname, 'workflow-payload-deps.js'), 'utf8');
        assert.ok(!src.includes('"scores.adjusted"'), 'a copied definition block has come back');
        assert.ok(!src.includes("'scores.adjusted':"), 'a copied definition block has come back');
    });
});

describe('metric definitions: interval bounds survive', () => {
    test('open-ended intervals keep a real Infinity, which JSON cannot carry', () => {
        const openEnded = Object.entries(METRIC_DEFS)
            .flatMap(([key, def]) => (def.intervals || []).map((it) => [key, it]))
            .filter(([, it]) => it.to === Number.POSITIVE_INFINITY);

        assert.ok(openEnded.length > 0, 'expected at least one open-ended interval');
        for (const [key, it] of openEnded) {
            assert.notEqual(it.to, null, `${key} lost its upper bound`);
        }
    });

    test('a count above an open-ended threshold classifies into that band', () => {
        const def = METRIC_DEFS['dom.statefulComponentsCount'];
        const band = def.intervals.find((it) => it.key === 'warn');
        assert.ok(band);
        assert.equal(band.to, Number.POSITIVE_INFINITY);
        assert.ok(22 >= band.from);
    });
});

describe('metric definitions: the extension build stays in sync', () => {
    test('the copied extension file is byte-identical to the shared source', () => {
        const shared = fs.readFileSync(path.join(__dirname, 'a11y-metric-defs.js'), 'utf8');
        const copied = fs.readFileSync(path.join(ROOT, 'extension', 'a11y-metric-defs.js'), 'utf8');
        assert.equal(copied, shared, 'run build:extension-shared');
    });

    test('loaded as plain scripts, the extension gets every definition with bounds intact', () => {
        const ctx = loadAsBrowserScripts(['extension/a11y-metric-defs.js', 'extension/workflow-payload-deps.js']);
        const defs = ctx.A11Y_WORKFLOW_DEPS.METRIC_DEFS;

        assert.deepEqual(Object.keys(defs).sort(), Object.keys(METRIC_DEFS).sort());
        assert.equal(defs['dom.statefulComponentsCount'].intervals[0].to, Number.POSITIVE_INFINITY);
        assert.ok('dom.customControlsRatio' in defs);
    });

    test('both extension pages load the definitions before the file that reads them', () => {
        for (const page of ['extension/panel.html', 'extension/popup.html']) {
            const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
            const defsAt = html.indexOf('a11y-metric-defs.js');
            const depsAt = html.indexOf('workflow-payload-deps.js');
            assert.ok(defsAt !== -1, `${page} does not load a11y-metric-defs.js`);
            assert.ok(depsAt !== -1, `${page} does not load workflow-payload-deps.js`);
            assert.ok(defsAt < depsAt, `${page} loads them in the wrong order`);
        }
    });

    test('reading the deps without the definitions loaded fails loudly', () => {
        assert.throws(
            () => loadAsBrowserScripts(['extension/workflow-payload-deps.js']),
            /load a11y-metric-defs\.js before this file/
        );
    });
});
