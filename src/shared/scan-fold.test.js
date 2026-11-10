'use strict';

// The shared fold (scan-fold.js): the contexts dimension is held by the
// runner's own tests (src/server-side/merged-scan.test.js), which run it
// through merged-scan.js unchanged; these hold the scans dimension, folding
// the scans of several pages made from one template
// (docs/design/scan-grouping-design.md §9.3), and that the module loads in a
// page.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const F = require('./scan-fold.js');

const SHOP = 'https://shop.example.com';

function occ(page, o = {}) {
    return {
        pageUrl: `${SHOP}${page}`,
        target: [o.target || '.add-to-cart'],
        html: o.html || '<button class="add-to-cart"></button>',
        failureSummary: o.summary || 'Button has no accessible name',
        summary: o.summary || 'Button has no accessible name',
        occurrenceOutcome: o.outcome || 'fail',
        ...(o.details ? { details: o.details } : {}),
        ...(o.contexts ? { contexts: o.contexts, contextsTotal: o.contexts.length } : {}),
        ...(o.screenshot ? { elementScreenshot: { url: o.screenshot } } : {}),
    };
}

function finding(outcome, ruleId, occurrences = [], extra = {}) {
    return { uid: `surea11y|surea11y:${outcome}:${ruleId}`, ruleId, id: ruleId, outcome, engineId: 'surea11y', occurrences, ...extra };
}

function canonical(page, findings, extra = {}) {
    return {
        version: '1.0',
        page: { url: `${SHOP}${page}` },
        engines: [{ id: 'surea11y', name: 'surea11y', version: '1.11.1' }],
        findings,
        bestPractices: [],
        notices: [],
        margins: [],
        ...extra,
    };
}

// The member scans of a merged group, as parts: keyed by scan id, named by label.
function parts(list) {
    return list.map(([id, label, c]) => ({ canonical: c, context: id, name: label }));
}
const fold = (list) => F.mergeCanonicals(parts(list), list.length, { dimension: 'scans' });
const byRule = (c, ruleId, outcome = 'fail') => c.findings.find((f) => f.ruleId === ruleId && f.outcome === outcome);

describe('folding the scans of several pages', () => {
    test('a template failure on every page is one failure listing every scan', () => {
        const merged = fold([
            ['s1', 'Red shirt', canonical('/products/red', [finding('fail', 'button-name', [occ('/products/red')])])],
            ['s2', 'Blue shirt', canonical('/products/blue', [finding('fail', 'button-name', [occ('/products/blue')])])],
            ['s3', 'Green hat', canonical('/products/green', [finding('fail', 'button-name', [occ('/products/green')])])],
        ]);
        const [o, ...more] = byRule(merged, 'button-name').occurrences;
        assert.equal(more.length, 0);
        assert.deepEqual(o.scans, ['s1', 's2', 's3']);
        assert.equal(o.scansTotal, 3);
        // The first page's, as a single scan's occurrence has one.
        assert.equal(o.pageUrl, `${SHOP}/products/red`);
        assert.equal('contexts' in o, false);
    });

    test('a failure of one page\'s content stays on that page', () => {
        const merged = fold([
            ['s1', 'Red', canonical('/p/red', [
                finding('fail', 'button-name', [occ('/p/red')]),
                finding('fail', 'image-alt', [occ('/p/red', { target: '.gallery img:nth-child(3)', html: '<img src="red-3.jpg">', summary: 'Image has no alt' })]),
            ])],
            ['s2', 'Blue', canonical('/p/blue', [finding('fail', 'button-name', [occ('/p/blue')])])],
        ]);
        assert.deepEqual(byRule(merged, 'button-name').occurrences.map((o) => o.scans), [['s1', 's2']]);
        const img = byRule(merged, 'image-alt').occurrences;
        assert.equal(img.length, 1);
        assert.deepEqual(img[0].scans, ['s1']);
        assert.equal(img[0].scansTotal, 2);
    });

    test('the same element failing with different measured values is a failure per value', () => {
        const contrast = (page, ratio) => occ(page, { target: '.price', html: '<span class="price"></span>', summary: 'Contrast too low', details: { ratio } });
        const merged = fold([
            ['s1', 'A', canonical('/p/a', [finding('fail', 'color-contrast', [contrast('/p/a', 2.1)])])],
            ['s2', 'B', canonical('/p/b', [finding('fail', 'color-contrast', [contrast('/p/b', 2.1)])])],
            ['s3', 'C', canonical('/p/c', [finding('fail', 'color-contrast', [contrast('/p/c', 1.4)])])],
        ]);
        assert.deepEqual(byRule(merged, 'color-contrast').occurrences.map((o) => [o.details.ratio, o.scans]),
            [[2.1, ['s1', 's2']], [1.4, ['s3']]]);
    });

    test('an element whose generated ids differ by page is still one failure', () => {
        const opt = (page, n) => occ(page, {
            target: `#mat-option-${n}`,
            html: `<mat-option id="mat-option-${n}" role="option"></mat-option>`,
            summary: 'Option has no accessible name',
        });
        const merged = fold([
            ['s1', 'A', canonical('/p/a', [finding('fail', 'option-name', [opt('/p/a', 0)])])],
            ['s2', 'B', canonical('/p/b', [finding('fail', 'option-name', [opt('/p/b', 142)])])],
        ]);
        const [o, ...more] = byRule(merged, 'option-name').occurrences;
        assert.equal(more.length, 0);
        assert.deepEqual(o.scans, ['s1', 's2']);
        assert.deepEqual(o.scanTargets, { s2: ['#mat-option-142'] });
    });

    test('two scans of one page are two members, listed by their ids', () => {
        const merged = fold([
            ['s1', 'From search', canonical('/p/a', [finding('fail', 'button-name', [occ('/p/a')])])],
            ['s2', 'From menu', canonical('/p/a', [finding('fail', 'button-name', [occ('/p/a')])])],
        ]);
        assert.deepEqual(byRule(merged, 'button-name').occurrences[0].scans, ['s1', 's2']);
    });

    test('a check counts once, with the worst outcome any page gave it', () => {
        const merged = fold([
            ['s1', 'A', canonical('/p/a', [finding('pass', 'button-name', [])])],
            ['s2', 'B', canonical('/p/b', [finding('fail', 'button-name', [occ('/p/b')])])],
        ]);
        assert.deepEqual(merged.findings.map((f) => `${f.ruleId}:${f.outcome}`), ['button-name:fail']);
        assert.deepEqual(merged.summary.outcomes, { fail: 1, cantTell: 0, pass: 0, notApplicable: 0 });
    });

    test('a member that is a run\'s merged scan keeps its contexts, which tell failures apart', () => {
        const all = ['Light', 'Dark'];
        const merged = fold([
            ['s1', 'A', canonical('/p/a', [finding('fail', 'button-name', [occ('/p/a', { contexts: all })])])],
            ['s2', 'B', canonical('/p/b', [finding('fail', 'button-name', [occ('/p/b', { contexts: all })])])],
            ['s3', 'C', canonical('/p/c', [finding('fail', 'button-name', [occ('/p/c', { contexts: ['Dark'] })])])],
        ]);
        assert.deepEqual(byRule(merged, 'button-name').occurrences.map((o) => [o.contexts, o.scans]), [
            [['Light', 'Dark'], ['s1', 's2']],
            [['Dark'], ['s3']],
        ]);
    });

    test('a picture names the scan it was taken in', () => {
        const merged = fold([
            ['s1', 'A', canonical('/p/a', [finding('fail', 'button-name', [occ('/p/a')])])],
            ['s2', 'B', canonical('/p/b', [finding('fail', 'button-name', [occ('/p/b', { screenshot: 'b.png' })])])],
        ]);
        assert.deepEqual(byRule(merged, 'button-name').occurrences[0].elementScreenshot, { url: 'b.png', scan: 's2' });
    });

    test('notices are joined, named by the scans\' labels, listing their ids', () => {
        const note = { code: 'slow', message: 'The page took long to settle' };
        const merged = fold([
            ['s1', 'Red', canonical('/p/a', [], { notices: [note] })],
            ['s2', 'Blue', canonical('/p/b', [], { notices: [] })],
        ]);
        assert.deepEqual(merged.notices, [{ ...note, scans: ['s1'], message: 'Red: The page took long to settle' }]);
    });

    test('passing and not applicable findings are unioned, without scans', () => {
        const merged = fold([
            ['s1', 'A', canonical('/p/a', [finding('pass', 'lang', [occ('/p/a', { outcome: 'pass' })])])],
            ['s2', 'B', canonical('/p/b', [finding('pass', 'lang', [occ('/p/b', { outcome: 'pass' })])])],
        ]);
        const pass = byRule(merged, 'lang', 'pass');
        assert.ok(pass.occurrences.every((o) => !('scans' in o)));
    });
});

describe('the contexts dimension is what it was', () => {
    test('the default, and the page still tells occurrences apart', () => {
        const merged = F.mergeCanonicals([
            { canonical: canonical('/p/a', [finding('fail', 'button-name', [occ('/p/a')])]), context: 'Light' },
            { canonical: canonical('/p/b', [finding('fail', 'button-name', [occ('/p/b')])]), context: 'Dark' },
        ], 2);
        assert.deepEqual(byRule(merged, 'button-name').occurrences.map((o) => o.contexts), [['Light'], ['Dark']]);
    });

    test('identity: the page counts for contexts, not for scans', () => {
        const a = occ('/p/a');
        const b = occ('/p/b');
        assert.notEqual(F.occurrenceIdentity(a), F.occurrenceIdentity(b));
        assert.notEqual(F.occurrenceIdentity(a, 'contexts'), F.occurrenceIdentity(b, 'contexts'));
        assert.equal(F.occurrenceIdentity(a, 'scans'), F.occurrenceIdentity(b, 'scans'));
        assert.equal(F.occurrenceIdentity(a, F.DIMENSIONS.scans), F.occurrenceIdentity(b, F.DIMENSIONS.scans));
    });

    test('an unknown dimension throws', () => {
        assert.throws(() => F.mergeCanonicals([], 0, { dimension: 'pages' }), TypeError);
    });
});

describe('in a page', () => {
    test('loads as a plain script, as A11Y_SCAN_FOLD, with nothing else loaded', () => {
        const code = fs.readFileSync(path.join(__dirname, 'scan-fold.js'), 'utf8');
        const sandbox = {};
        sandbox.globalThis = sandbox;
        vm.runInNewContext(code, sandbox);
        assert.equal(typeof sandbox.A11Y_SCAN_FOLD.mergeCanonicals, 'function');
        const merged = sandbox.A11Y_SCAN_FOLD.mergeCanonicals(parts([
            ['s1', 'A', canonical('/p/a', [finding('fail', 'button-name', [occ('/p/a')])])],
            ['s2', 'B', canonical('/p/b', [finding('fail', 'button-name', [occ('/p/b')])])],
        ]), 2, { dimension: 'scans' });
        assert.deepEqual([...merged.findings[0].occurrences[0].scans], ['s1', 's2']);
    });
});
