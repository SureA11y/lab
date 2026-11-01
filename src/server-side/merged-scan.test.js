'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { describeMerges, foldMergedScans, mergeCanonicals, mergeCoreResults, occurrenceIdentity } = require('./merged-scan');

function occ(o = {}) {
    return {
        pageUrl: 'https://example.com/product',
        target: [o.target || '.price'],
        html: o.html || '<span class="price">9.99</span>',
        failureSummary: o.summary || 'Contrast too low',
        summary: o.summary || 'Contrast too low',
        occurrenceOutcome: o.outcome || 'fail',
        ...(o.details ? { details: o.details } : {}),
        ...(o.pageUrl ? { pageUrl: o.pageUrl } : {}),
    };
}

function finding(outcome, ruleId, occurrences = []) {
    return { uid: `surea11y|surea11y:${outcome}:${ruleId}`, ruleId, id: ruleId, outcome, engineId: 'surea11y', occurrences, meta: { atomic: false } };
}

function canonical(findings, extra = {}) {
    return {
        version: '1.0',
        page: { url: 'https://example.com/product' },
        engines: [{ id: 'surea11y', name: 'surea11y', version: '1.11.1' }],
        findings,
        bestPractices: [],
        notices: [],
        margins: [],
        ...extra,
    };
}

function scan(label, findings, over = {}) {
    return {
        id: over.id || `scan-${label}`,
        scanId: over.id || `scan-${label}`,
        label,
        url: 'https://example.com/product',
        wcagLevel: 'AA',
        canonical: canonical(findings, over.canonicalExtra),
        domMetrics: { totalElements: over.elements || 100 },
        screenshot: Buffer.from(label || 'x'),
        viewportRatio: over.ratio || 1.6,
        extraScreenshots: [],
        mergedScan: over.group === null ? undefined : { key: over.group || 'g1', label: 'Product page' },
        ...over.fields,
    };
}

const deps = {
    buildCoverageAwareSummary: ({ canonical: c }) => ({ findings: c.findings.length }),
    buildA11ySummary: ({ canonical: c, domMetrics }) => ({ fails: c.findings.filter((f) => f.outcome === 'fail').length, elements: domMetrics.totalElements }),
};

describe('merged scans', () => {
    test('the same result in two contexts is one occurrence listing both', () => {
        const [merged] = foldMergedScans([
            scan('Light · desktop', [finding('fail', 'contrast', [occ()])]),
            scan('Dark · desktop', [finding('fail', 'contrast', [occ()])]),
        ], deps);
        const [f] = merged.canonical.findings;
        assert.equal(f.occurrences.length, 1);
        assert.deepEqual(f.occurrences[0].contexts, ['Light · desktop', 'Dark · desktop']);
        assert.equal(f.occurrences[0].contextsTotal, 2);
    });

    test('one occurrence of several contexts keeps one picture, naming the context it shows', () => {
        const shot = (name) => ({ url: `/reports/evidence/run/elements-${name}/element-1.png`, box: { x: 16, y: 16, width: 40, height: 20 } });
        const [merged] = foldMergedScans([
            scan('Light', [finding('fail', 'contrast', [{ ...occ(), elementScreenshot: shot('light') }])]),
            scan('Dark', [finding('fail', 'contrast', [{ ...occ(), elementScreenshot: shot('dark') }])]),
        ], deps);
        const [o] = merged.canonical.findings[0].occurrences;
        assert.deepEqual(o.elementScreenshot, { ...shot('light'), context: 'Light' });
        assert.deepEqual(o.contexts, ['Light', 'Dark']);
    });

    test('a picture from a later context replaces a first one that has none', () => {
        const [merged] = foldMergedScans([
            scan('Light', [finding('fail', 'contrast', [{ ...occ(), elementScreenshot: { skipped: 'max-reached', max: 1 } }])]),
            scan('Dark', [finding('fail', 'contrast', [{ ...occ(), elementScreenshot: { url: '/reports/x.png', box: null } }])]),
            scan('Wide', [finding('fail', 'contrast', [{ ...occ(), elementScreenshot: { url: '/reports/y.png', box: null } }])]),
        ], deps);
        assert.deepEqual(merged.canonical.findings[0].occurrences[0].elementScreenshot, { url: '/reports/x.png', box: null, context: 'Dark' });
    });

    test('a result measured differently is one occurrence per result, each with its contexts', () => {
        const [merged] = foldMergedScans([
            scan('Light', [finding('fail', 'contrast', [occ({ summary: 'Contrast 2:1', details: { ratio: 2 } })])]),
            scan('Dark', [finding('fail', 'contrast', [occ({ summary: 'Contrast 1.3:1', details: { ratio: 1.3 } })])]),
            scan('Light again', [finding('fail', 'contrast', [occ({ summary: 'Contrast 2:1', details: { ratio: 2 } })])]),
        ], deps);
        const occurrences = merged.canonical.findings[0].occurrences;
        assert.deepEqual(occurrences.map((o) => [o.details.ratio, o.contexts]), [
            [2, ['Light', 'Light again']],
            [1.3, ['Dark']],
        ]);
    });

    test('markup alone does not separate two results, and the first context\'s is kept', () => {
        const [merged] = foldMergedScans([
            scan('Light', [finding('fail', 'contrast', [occ({ html: '<span class="price">9.99</span>' })])]),
            scan('Dark', [finding('fail', 'contrast', [occ({ html: '<span class="price dark">9.99</span>' })])]),
        ], deps);
        const occurrences = merged.canonical.findings[0].occurrences;
        assert.equal(occurrences.length, 1);
        assert.equal(occurrences[0].html, '<span class="price">9.99</span>');
        assert.deepEqual(occurrences[0].contexts, ['Light', 'Dark']);
    });

    test('a different page, element or outcome is a different result', () => {
        assert.notEqual(occurrenceIdentity(occ()), occurrenceIdentity(occ({ pageUrl: 'https://m.example.com/product' })));
        assert.notEqual(occurrenceIdentity(occ()), occurrenceIdentity(occ({ target: '.total' })));
        assert.notEqual(occurrenceIdentity(occ()), occurrenceIdentity(occ({ outcome: 'cantTell' })));
    });

    test('a rule that fails in one context and passes in another counts once, as failing', () => {
        const [merged] = foldMergedScans([
            scan('Mobile', [finding('fail', 'target-size', [occ({ target: 'button', summary: '20px' })])]),
            scan('Desktop', [finding('pass', 'target-size', [occ({ target: 'button', outcome: 'pass' })])]),
        ], deps);
        assert.deepEqual(merged.canonical.findings.map((f) => f.outcome), ['fail']);
        assert.deepEqual(merged.canonical.summary.outcomes, { fail: 1, cantTell: 0, pass: 0, notApplicable: 0 });
        assert.deepEqual(merged.canonical.findingsByKind.composite.length, 1);
    });

    test('an engine that lists a rule\'s passing and failing elements apart keeps both', () => {
        const [merged] = foldMergedScans([
            scan('A', [finding('fail', 'color-contrast', [occ()]), finding('pass', 'color-contrast', [occ({ target: 'h1', outcome: 'pass' })])]),
            scan('B', [finding('pass', 'color-contrast', [occ({ target: 'h1', outcome: 'pass' })])]),
        ], deps);
        assert.deepEqual(merged.canonical.findings.map((f) => f.outcome), ['fail', 'pass']);
    });

    test('a rollup\'s check counts once, in the finding of its worst outcome, and undecided elements follow it', () => {
        const rollup = (outcome, checks, occurrences) => ({
            ...finding(outcome, 'wcag-2.4.4', occurrences),
            evidence: { rollup: { contributors: checks.map((testId) => ({ testId, outcome })) } },
        });
        const [merged] = foldMergedScans([
            scan('Desktop', [
                rollup('pass', ['link-name-present'], []),
                rollup('cantTell', ['link-name-quality'], [{ ...occ({ target: 'a.more', outcome: 'cantTell' }), atomicCheckId: 'link-name-quality' }]),
            ]),
            scan('Mobile', [
                rollup('fail', ['link-name-present', 'link-name-quality'], [
                    { ...occ({ target: 'a.icon' }), atomicCheckId: 'link-name-present' },
                    { ...occ({ target: 'a.more', summary: 'Vague' }), atomicCheckId: 'link-name-quality' },
                ]),
            ]),
        ], deps);
        const findings = merged.canonical.findings;
        assert.deepEqual(findings.map((f) => [f.outcome, f.evidence.rollup.contributors.map((c) => c.testId)]), [
            ['fail', ['link-name-present', 'link-name-quality']],
        ]);
        assert.deepEqual(findings[0].occurrences.map((o) => [o.target[0], o.occurrenceOutcome || 'fail', o.contexts]), [
            ['a.icon', 'fail', ['Mobile']],
            ['a.more', 'fail', ['Mobile']],
            ['a.more', 'cantTell', ['Desktop']],
        ]);
    });

    test('a criterion one context checked in full is not made partly checked by another', () => {
        // Light ran the full scan; dark only contrast-computable, so its 1.4.3
        // is partly checked: contrast-minimum not selected.
        const rollup = (outcome, contributors, extra = {}) => ({
            ...finding(outcome, 'wcag-1.4.3', []),
            evidence: { rollup: { contributors } },
            ...extra,
        });
        const light = [rollup('pass', [{ testId: 'contrast-minimum', outcome: 'pass' }, { testId: 'contrast-computable', outcome: 'pass' }])];
        const dark = [
            rollup('pass', [{ testId: 'contrast-computable', outcome: 'pass' }]),
            rollup('cantTell', [{ testId: 'contrast-minimum', outcome: 'missing', notSelected: true }], { partlyChecked: { notSelected: 1, checks: 2 } }),
        ];
        const [full] = foldMergedScans([scan('Light', light), scan('Dark', dark)], deps);
        assert.deepEqual(full.canonical.findings.map((f) => f.outcome), ['pass'], 'light ran contrast-minimum: nothing left unchecked');

        const [partly] = foldMergedScans([scan('Dark', dark), scan('Dark again', dark)], deps);
        const p = partly.canonical.findings.find((f) => f.outcome === 'cantTell');
        assert.deepEqual(p.partlyChecked, { notSelected: 1, checks: 2 }, 'checked in part in every context: still partly checked');
    });

    test('checks a rollup holds in one context only are all kept', () => {
        const rollup = (checks) => ({
            ...finding('fail', 'wcag-1.4.3', [occ()]),
            evidence: { rollup: { contributors: checks.map((testId) => ({ testId, outcome: 'fail' })) } },
        });
        const [merged] = foldMergedScans([scan('A', [rollup(['contrast-minimum'])]), scan('B', [rollup(['contrast-minimum', 'contrast-enhanced'])])], deps);
        assert.deepEqual(merged.canonical.findings[0].evidence.rollup.contributors.map((c) => c.testId), ['contrast-minimum', 'contrast-enhanced']);
    });

    test('pass occurrences are unioned without contexts', () => {
        const passing = finding('pass', 'image-alt', [occ({ outcome: 'pass', target: 'img' })]);
        const [merged] = foldMergedScans([scan('A', [passing]), scan('B', [passing])], deps);
        const [o] = merged.canonical.findings[0].occurrences;
        assert.equal(merged.canonical.findings[0].occurrences.length, 1);
        assert.equal(o.contexts, undefined);
    });

    test('the merged scan takes the step\'s name, the first context\'s place, and lists its contexts', () => {
        const [merged] = foldMergedScans([
            scan('Light', [finding('fail', 'contrast', [occ()])], { id: 'scan-3', fields: { scanTags: ['desktop'] } }),
            scan('', [], { id: 'scan-4', fields: { scanTags: ['desktop', 'dark'] } }),
        ], deps);
        assert.equal(merged.label, 'Product page');
        assert.equal(merged.id, 'scan-3');
        assert.equal(merged.mergedScan, true);
        assert.deepEqual(merged.scanTags, ['desktop', 'dark']);
        assert.deepEqual(merged.contexts.map((c) => [c.name, c.failCount]), [['Light', 1], ['Scan 2 of 2', 0]]);
    });

    test('the step\'s tags are the scan\'s; its scans\' tags stay with their contexts', () => {
        const withStepTags = (label, tags, stepTags) => scan(label, [], { fields: {
            scanTags: tags, mergedScan: { key: 'g1', label: 'Product page', scanTags: stepTags },
        } });
        const [tagged] = foldMergedScans([
            withStepTags('Light', ['desktop'], ['checkout']),
            withStepTags('Dark', ['desktop', 'dark'], ['checkout']),
        ], deps);
        assert.deepEqual(tagged.scanTags, ['checkout']);
        assert.deepEqual(tagged.contexts.map((c) => c.scanTags), [['desktop'], ['desktop', 'dark']]);

        const [untagged] = foldMergedScans([
            withStepTags('Light', ['desktop'], null),
            withStepTags('Dark', ['desktop', 'dark'], null),
        ], deps);
        assert.deepEqual(untagged.scanTags, ['desktop', 'dark'], 'all of theirs when the step has none');
    });

    test('a skipped context is listed and adds nothing; all skipped gives a skipped scan', () => {
        const skipped = { ...scan('Dark', []), skipped: true, canonical: null, skipInfo: { reason: 'if' } };
        const [one] = foldMergedScans([scan('Light', [finding('fail', 'contrast', [occ()])]), skipped], deps);
        assert.equal(one.skipped, false);
        assert.deepEqual(one.contexts.map((c) => c.skipped), [false, true]);
        assert.equal(one.canonical.findings[0].occurrences[0].contextsTotal, 1);

        const [none] = foldMergedScans([skipped, { ...skipped, label: 'Dark 2' }], deps);
        assert.equal(none.skipped, true);
        assert.equal(none.canonical, null);
    });

    test('contexts that differ in more than their conditions are merged and say so', () => {
        const [merged] = foldMergedScans([
            scan('Desktop', [], {}),
            scan('Mobile', [], { fields: { url: 'https://m.example.com/product', profile: { id: 'wcag22-aaa', label: 'WCAG 2.2 AAA' } } }),
        ], deps);
        const codes = merged.canonical.notices.map((n) => [n.code, n.field]);
        assert.deepEqual(codes, [['merged-contexts-differ', 'url'], ['merged-contexts-differ', 'profile']]);
        assert.match(merged.canonical.notices[0].message, /Desktop: https:\/\/example\.com\/product; Mobile: https:\/\/m\.example\.com\/product/);
        // A profile by its label.
        assert.match(merged.canonical.notices[1].message, /Desktop: none; Mobile: WCAG 2\.2 AAA/);
        assert.equal(merged.url, 'https://example.com/product', 'the first context\'s settings');
    });

    test('contexts that ran different rules: no note, the rules they ran together, the widest scope for coverage', () => {
        const scoped = [];
        const spy = { ...deps, buildCoverageAwareSummary: (x) => { scoped.push(x.automationCoverage); return {}; } };
        const dark = scan('Dark', [], { fields: { runOnly: { includeRuleIds: ['contrast-minimum'], excludeRuleIds: [] }, _metricInputs: { automationCoverage: 'contrast only' } } });
        const light = scan('Light', [], { fields: { runOnly: { includeRuleIds: [], excludeRuleIds: [] }, _metricInputs: { automationCoverage: 'every AA criterion' } } });
        const [merged] = foldMergedScans([dark, light], spy);
        assert.deepEqual(merged.canonical.notices, [], 'running fewer rules in one context is what a Merged scan is for');
        assert.deepEqual(merged.runOnly, { includeRuleIds: [], excludeRuleIds: [] }, 'light ran every rule');
        assert.equal(scoped[0], 'every AA criterion', 'coverage against the context that ran the most, not the first');

        const other = scan('Mobile', [], { fields: { runOnly: { includeRuleIds: ['target-size-minimum'], excludeRuleIds: [] } } });
        const [both] = foldMergedScans([dark, other], deps);
        assert.deepEqual(both.runOnly.includeRuleIds, ['contrast-minimum', 'target-size-minimum']);
    });

    test('contexts run by different engines: scored against what the engines reach between them, and per engine', () => {
        const scoped = [];
        const asked = [];
        const spy = {
            ...deps,
            buildCoverageAwareSummary: (x) => { scoped.push(x.automationCoverage); return {}; },
            automationCoverageForEngines: (level, ids, version) => { asked.push([level, ids, version]); return `${ids.join('+')} ${version} ${level}`; },
        };
        const run = (label, engineId) => {
            const engine = { id: engineId, name: engineId, version: '1' };
            const c = canonical([], { engines: [engine] });
            return scan(label, [], {
                canonicalExtra: { engines: [engine] },
                fields: {
                    wcagVersion: '2.2',
                    _metricInputs: { automationCoverage: engineId, perEngine: [{ engineId, engine, canonical: c, automationCoverage: engineId }] },
                },
            });
        };
        const [merged] = foldMergedScans([run('surea11y', 'surea11y'), run('Engine B', 'engine-b')], spy);
        assert.deepEqual(asked, [['AA', ['surea11y', 'engine-b'], '2.2']]);
        assert.equal(scoped[0], 'surea11y+engine-b 2.2 AA');
        assert.deepEqual(merged.canonical.engines.map((e) => e.id), ['surea11y', 'engine-b']);
        assert.deepEqual(Object.keys(merged.byEngineMetrics), ['surea11y', 'engine-b']);
    });

    test('contexts run by one engine keep the widest context\'s coverage, and no per-engine metrics', () => {
        const scoped = [];
        const spy = { ...deps, buildCoverageAwareSummary: (x) => { scoped.push(x.automationCoverage); return {}; }, automationCoverageForEngines: () => 'union' };
        const engine = { id: 'surea11y', name: 'surea11y', version: '1' };
        const inputs = { automationCoverage: 'own', perEngine: [{ engineId: 'surea11y', engine, canonical: canonical([]), automationCoverage: 'own' }] };
        const [merged] = foldMergedScans([scan('Light', [], { fields: { _metricInputs: inputs } }), scan('Dark', [], { fields: { _metricInputs: inputs } })], spy);
        assert.equal(scoped[0], 'own');
        assert.equal(merged.byEngineMetrics, null);
    });

    test('a context\'s own notes keep its name', () => {
        const [merged] = foldMergedScans([
            scan('Dark', [], { canonicalExtra: { notices: [{ code: 'page-not-ready', message: 'The page was still loading.' }] } }),
            scan('Light', []),
        ], deps);
        assert.deepEqual(merged.canonical.notices, [{ code: 'page-not-ready', message: 'Dark: The page was still loading.', contexts: ['Dark'] }]);
    });

    test('a note every context had is the scan\'s, said once', () => {
        const notices = [{ code: 'page-not-ready', message: 'The page was still loading.' }];
        const [merged] = foldMergedScans([
            scan('Dark', [], { canonicalExtra: { notices } }),
            scan('Light', [], { canonicalExtra: { notices } }),
        ], deps);
        assert.deepEqual(merged.canonical.notices, [{ ...notices[0], contexts: ['Dark', 'Light'] }]);
    });

    test('margins keep their own fields; identical ones are joined, different ones kept apart', () => {
        const margin = (headroom) => ({ ruleId: 'contrast-minimum', measure: 'contrast-ratio', value: 4.5 + headroom, headroom, context: { largeText: false } });
        const [merged] = foldMergedScans([
            scan('Light', [], { canonicalExtra: { margins: [margin(2)] } }),
            scan('Dark', [], { canonicalExtra: { margins: [margin(0.1)] } }),
            scan('Light again', [], { canonicalExtra: { margins: [margin(2)] } }),
        ], deps);
        assert.deepEqual(merged.canonical.margins, [
            { ...margin(2), contexts: ['Light', 'Light again'] },
            { ...margin(0.1), contexts: ['Dark'] },
        ]);
    });

    test('surea11y\'s outcome counts are per check, each with its worst outcome across the contexts', () => {
        const withChecks = (checks) => {
            const summary = { outcomes: {} };
            Object.defineProperty(summary, 'checks', { value: checks, enumerable: false });
            return { summary };
        };
        const [merged] = foldMergedScans([
            scan('Light', [], { canonicalExtra: withChecks([
                { ruleId: 'contrast', outcome: 'pass' }, { ruleId: 'alt', outcome: 'fail' },
                { ruleId: 'lang', outcome: 'notApplicable' }, { ruleId: 'skip-link', outcome: 'pass', bestPractice: true },
            ]) }),
            scan('Dark', [], { canonicalExtra: withChecks([
                { ruleId: 'contrast', outcome: 'fail' }, { ruleId: 'alt', outcome: 'fail' },
                { ruleId: 'lang', outcome: 'pass' }, { ruleId: 'skip-link', outcome: 'cantTell', bestPractice: true },
            ]) }),
        ], deps);
        assert.deepEqual(merged.canonical.summary, {
            outcomes: { fail: 2, cantTell: 0, pass: 1, notApplicable: 0 },
            bestPractices: { fail: 0, cantTell: 1, pass: 0, notApplicable: 0 },
        });
    });

    test('metrics are computed again over the merged findings, against the largest context', () => {
        const [merged] = foldMergedScans([
            scan('Mobile', [finding('fail', 'a', [occ()])], { elements: 80 }),
            scan('Desktop', [finding('fail', 'b', [occ({ target: '.b' })])], { elements: 120 }),
        ], deps);
        assert.deepEqual(merged.a11ySummary, { fails: 2, elements: 120 });
        assert.deepEqual(merged.coverageSummary, { findings: 2 });
    });

    test('the score counts each failing element once, the lists each result', () => {
        const scored = [];
        const spy = { ...deps, buildA11ySummary: ({ canonical: c }) => { scored.push(c); return {}; } };
        const [merged] = foldMergedScans([
            scan('Light', [finding('fail', 'contrast', [occ({ summary: 'Contrast 3.5:1', details: { ratio: 3.5 } })])]),
            scan('Dark', [finding('fail', 'contrast', [occ({ summary: 'Contrast 1.9:1', details: { ratio: 1.9 } })])]),
        ], spy);
        assert.equal(merged.canonical.findings[0].occurrences.length, 2);
        assert.equal(scored[0].findings[0].occurrences.length, 1);
    });

    test('every context\'s screenshot is kept, named by its context and with its own ratio', () => {
        const artifact = { buffer: Buffer.from('jpeg'), label: 'A11y Scan', publicUrl: null };
        const [merged] = foldMergedScans([
            scan('Desktop', [], { ratio: 1.6 }),
            scan('Mobile', [], { ratio: 0.46, fields: { screenshot: artifact } }),
        ], deps);
        assert.deepEqual(merged.screenshots.map((s) => [s.name, s.label, s.viewportRatio, Buffer.isBuffer(s.buffer)]), [
            ['Desktop', 'Desktop', 1.6, true],
            ['Mobile', 'Mobile', 0.46, true],
        ]);
        assert.equal(merged.screenshot, null);
    });

    test('scans outside a merged scan pass through, and each merged scan sits where its first scan was', () => {
        const before = scan('Home', [], { group: null, id: 'scan-1' });
        const after = scan('Contact', [], { group: null, id: 'scan-9' });
        const out = foldMergedScans([
            before,
            scan('A', [], { id: 'scan-2', group: 'g1' }),
            scan('X', [], { id: 'scan-3', group: 'g2' }),
            scan('B', [], { id: 'scan-4', group: 'g1' }),
            after,
        ], deps);
        assert.deepEqual(out.map((s) => s.id), ['scan-1', 'scan-2', 'scan-3', 'scan-9']);
        assert.equal(out[0], before);
        assert.deepEqual(out[1].contexts.map((c) => c.name), ['A', 'B']);
    });

    test('one step\'s scans can be folded as it ends, leaving another step\'s for later', () => {
        const entries = [
            scan('A', [], { id: 'scan-1', group: 'g1' }),
            scan('X', [], { id: 'scan-2', group: 'g2' }),
            scan('B', [], { id: 'scan-3', group: 'g1' }),
        ];
        const once = foldMergedScans(entries, deps, { onlyKey: 'g1' });
        assert.deepEqual(once.map((s) => [s.id, s.mergedScan === true]), [['scan-1', true], ['scan-2', false]]);

        const [described] = describeMerges(entries.filter((e) => e.mergedScan.key === 'g1'), once);
        assert.deepEqual(described.contexts.map((c) => c.label), ['A', 'B']);
        assert.equal(described.scanId, 'scan-1');
        assert.equal(described.key, 'g1', 'so the live counts know it was counted once');

        // At the end, the folded scan passes through and the other is folded.
        const later = [...once, scan('Y', [], { id: 'scan-4', group: 'g2' })];
        const all = foldMergedScans(later, deps);
        assert.deepEqual(all.map((s) => s.id), ['scan-1', 'scan-2']);
        assert.equal(all[0], once[0]);
        const [g2] = describeMerges(later, all);
        assert.equal(g2.scanId, 'scan-2', 'matched by its step, not by position');
        assert.deepEqual(g2.contexts.map((c) => c.label), ['X', 'Y']);
    });

    test('each merge reports its own figures, though scans have no id during the run', () => {
        // Scans get their ids when the run ends; folded step by step, the
        // second merge was reported with the first merged scan's figures.
        const noId = (label, findings, group) => ({ ...scan(label, findings, { group }), id: null, scanId: null });
        const clean = [noId('Light', [], 'g1'), noId('Dark', [], 'g1')];
        const failing = [
            noId('Light', [finding('fail', 'contrast', [occ()])], 'g2'),
            noId('Dark', [finding('fail', 'contrast', [occ()])], 'g2'),
        ];
        let collected = [...clean];
        collected = foldMergedScans(collected, deps, { onlyKey: 'g1' });
        collected = [...collected, ...failing];
        const before = collected;
        collected = foldMergedScans(collected, deps, { onlyKey: 'g2' });
        const [merge] = describeMerges(before.filter((e) => e.mergedScan && e.mergedScan.key === 'g2'), collected);
        assert.equal(merge.key, 'g2');
        assert.equal(merge.summary.failCount, 1, 'the failing merged scan, not the clean one before it');
        assert.deepEqual(merge.contexts.map((c) => c.summary.failCount), [1, 1]);
    });

    test('mergeCanonicals keeps every engine once', () => {
        const a = canonical([], { engines: [{ id: 'surea11y' }] });
        const b = canonical([], { engines: [{ id: 'surea11y' }, { id: 'engine-b' }] });
        assert.deepEqual(mergeCanonicals([{ canonical: a, context: 'A' }, { canonical: b, context: 'B' }], 2).engines.map((e) => e.id), ['surea11y', 'engine-b']);
    });
});

function coreCheck(ruleId, outcome, occurrences = []) {
    return { ruleId, outcome, title: ruleId, severity: 'serious', type: 'automatic', occurrences };
}

function coreOcc(o = {}) {
    return {
        selector: o.selector || 'html > body > p',
        html: o.html || '<p>Price</p>',
        summary: o.summary || 'Contrast too low',
        hint: o.hint === undefined ? 'Darken the text.' : o.hint,
        data: { details: { reasonCode: 'contrast_low', ...(o.details || {}) } },
        ...(o.outcome ? { occurrenceOutcome: o.outcome } : {}),
    };
}

function coreResult(checks, rollups = []) {
    return { engine: { tag: 'a11ycore', version: '1.11.1' }, url: 'https://example.com/product', checksResults: checks, rulesResults: rollups };
}

describe('merged scans: surea11y\'s raw result', () => {
    test('a rule takes the worst outcome, and keeps only what failed or was undecided', () => {
        const merged = mergeCoreResults([
            { context: 'Desktop', result: coreResult([coreCheck('target-size', 'pass', [coreOcc({ selector: 'a' })])]) },
            { context: 'Mobile', result: coreResult([coreCheck('target-size', 'fail', [coreOcc({ selector: 'a', summary: '20px' })])]) },
        ]);
        const [check] = merged.checksResults;
        assert.equal(check.outcome, 'fail');
        assert.deepEqual(check.occurrences.map((o) => [o.summary, o.occurrenceOutcome, o.contexts]), [['20px', 'fail', ['Mobile']]]);
        assert.equal(check.occurrences[0].hint, 'Darken the text. In: Mobile.');
    });

    test('the same result is one occurrence in its contexts; a different one is its own', () => {
        const light = coreOcc({ summary: 'Contrast 3.5:1', details: { ratio: 3.5 } });
        const dark = coreOcc({ summary: 'Contrast 1.9:1', details: { ratio: 1.9 }, html: '<p class="dark">Price</p>' });
        const img = { ...coreOcc({ selector: 'img', summary: 'No alt', hint: '' }) };
        const merged = mergeCoreResults([
            { context: 'Light', result: coreResult([coreCheck('contrast', 'fail', [light]), coreCheck('img-alt', 'fail', [img])]) },
            { context: 'Dark', result: coreResult([coreCheck('contrast', 'fail', [dark]), coreCheck('img-alt', 'fail', [img])]) },
            { context: 'Light again', result: coreResult([coreCheck('contrast', 'fail', [light]), coreCheck('img-alt', 'fail', [img])]) },
        ]);
        const [contrast, alt] = merged.checksResults;
        assert.deepEqual(contrast.occurrences.map((o) => [o.data.details.ratio, o.contexts]), [[3.5, ['Light', 'Light again']], [1.9, ['Dark']]]);
        assert.equal(alt.occurrences.length, 1);
        assert.equal(alt.occurrences[0].hint, 'In all 3 contexts.');
    });

    test('an undecided context\'s occurrences stay undecided under a failing rule', () => {
        const merged = mergeCoreResults([
            { context: 'A', result: coreResult([coreCheck('contrast', 'cantTell', [coreOcc({ selector: '.bg-image' })])]) },
            { context: 'B', result: coreResult([coreCheck('contrast', 'fail', [coreOcc()])]) },
        ]);
        assert.deepEqual(merged.checksResults[0].occurrences.map((o) => [o.selector, o.occurrenceOutcome]), [['.bg-image', 'cantTell'], ['html > body > p', 'fail']]);
    });

    test('rollups merge the same way, and passing rules are unioned without contexts', () => {
        const merged = mergeCoreResults([
            { context: 'A', result: coreResult([coreCheck('lang', 'pass', [coreOcc({ selector: 'html', outcome: undefined })])], [coreCheck('wcag-1.4.3', 'pass')]) },
            { context: 'B', result: coreResult([coreCheck('lang', 'pass', [coreOcc({ selector: 'html' })])], [coreCheck('wcag-1.4.3', 'fail', [coreOcc()])]) },
        ]);
        assert.equal(merged.checksResults[0].occurrences.length, 1);
        assert.equal(merged.checksResults[0].occurrences[0].contexts, undefined);
        assert.equal(merged.rulesResults[0].outcome, 'fail');
        assert.deepEqual(merged.rulesResults[0].occurrences[0].contexts, ['B']);
    });

    test('a criterion\'s rollup is worked out again from its checks: a full context wins over a partial one', () => {
        const rollup = (outcome, reasonCode, contributors) => ({
            ruleId: 'wcag-1.4.3-contrast-minimum', outcome, occurrences: [],
            data: { details: { reasonCode, contributors, checksIds: contributors.map((c) => c.testId), metrics: {} } },
        });
        const light = coreResult([], [rollup('pass', 'composite.rollup.pass.otherwise', [
            { testId: 'contrast-computable', outcome: 'pass' }, { testId: 'contrast-minimum', outcome: 'pass' },
        ])]);
        const dark = coreResult([], [rollup('cantTell', 'composite.rollup.cantTell.notSelectedChild', [
            { testId: 'contrast-computable', outcome: 'pass' }, { testId: 'contrast-minimum', outcome: 'missing', notSelected: true },
        ])]);
        const [merged] = mergeCoreResults([{ context: 'Light', result: light }, { context: 'Dark', result: dark }]).rulesResults;
        assert.equal(merged.outcome, 'pass');
        assert.equal(merged.data.details.reasonCode, 'composite.rollup.pass.otherwise');

        const [partial] = mergeCoreResults([{ context: 'Dark', result: dark }, { context: 'Dark 2', result: dark }]).rulesResults;
        assert.deepEqual([partial.outcome, partial.data.details.reasonCode], ['cantTell', 'composite.rollup.cantTell.notSelectedChild']);

        const failingDark = coreResult([], [rollup('fail', 'composite.rollup.fail.anyFail', [
            { testId: 'contrast-computable', outcome: 'pass' }, { testId: 'contrast-minimum', outcome: 'fail' },
        ])]);
        const [failed] = mergeCoreResults([{ context: 'Light', result: light }, { context: 'Dark', result: failingDark }]).rulesResults;
        assert.deepEqual([failed.outcome, failed.data.details.metrics.failCount], ['fail', 1]);
    });

    test('nothing to merge without a result; the merged scan carries it when its contexts do', () => {
        assert.equal(mergeCoreResults([{ context: 'A', result: null }]), null);
        const [plain] = foldMergedScans([scan('A', []), scan('B', [])], deps);
        assert.equal(plain.coreResult, null);
        const [withCore] = foldMergedScans([
            scan('A', [], { fields: { coreResult: coreResult([coreCheck('img-alt', 'fail', [coreOcc()])]) } }),
            scan('B', [], { fields: { coreResult: coreResult([coreCheck('img-alt', 'fail', [coreOcc()])]) } }),
        ], deps);
        assert.equal(withCore.coreResult.checksResults[0].occurrences[0].hint, 'Darken the text. In all 2 contexts.');
    });
});
