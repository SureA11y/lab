'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const D = require('../shared/report-diff.js');
let R;
async function load() {
    if (!R) R = await import('./report-comparison-renderer.js');
    return { ...R, ...D };
}

function finding(ruleId, severity, pages) {
    return {
        ruleId, id: ruleId, title: `${ruleId} title`, severity, outcome: 'fail',
        wcag: { sc: [{ ref: '1.4.3', level: 'AA' }] },
        occurrences: pages.map((p, i) => ({ pageUrl: `https://x${p}`, target: [`${ruleId}-${p}-${i}`] })),
    };
}
function report(o = {}) {
    return {
        runId: o.runId, timestamp: o.timestamp, scenarioName: o.name || null, url: 'https://x/',
        scans: (o.scans || [1]).map((_, i) => ({ id: `s${i}`, url: 'https://x/', canonical: { findings: i === 0 ? (o.findings || []) : [] } })),
        metrics: { a11ySummary: { scores: { avgPageAccessibility: o.score ?? 70, confidence: o.conf ?? 90 } } },
    };
}

const A = () => report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', name: 'v1', score: 61, scans: [1, 1],
    findings: [finding('color-contrast', 'serious', ['/1', '/2', '/3']), finding('image-alt', 'serious', ['/1'])] });
const B = () => report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', name: 'v2', score: 74, scans: [1, 1],
    findings: [finding('color-contrast', 'serious', ['/1']), finding('label', 'critical', ['/9'])] });

describe('comparisonDiffHTML — evolution', () => {
    test('renders every layer', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'evolution' }));
        assert.match(html, /class="cmp2" data-mode="evolution"/);
        assert.match(html, /report-chip/);            // report chips
        assert.match(html, /class="verdict"/);         // verdict hero
        assert.match(html, /Accessibility <span class="accent/);
        assert.match(html, /class="kpis"/);            // KPI cards
        assert.equal((html.match(/class="kpi /g) || []).length, 6);
        assert.match(html, /<svg class="dumbbell"/);   // chart
        assert.match(html, /class="panel narrative"/); // narrative
        assert.match(html, /class="segbar"/);          // finding diff tabs
    });

    test('classifies rules into the three panes', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'evolution' }));
        assert.match(html, /data-pane="resolved"/);
        assert.match(html, /data-pane="new"/);
        assert.match(html, /data-pane="persistent"/);
        // resolved image-alt row present, occurrence tagged fixed
        assert.match(html, /image-alt title/);
        assert.match(html, /occ-tag fixed/);
    });

    test('KPI direction: fewer failures reads good, score up reads good', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'evolution' }));
        assert.match(html, /class="kpi good"/); // at least one improvement
    });
});

describe('comparisonDiffHTML — a/b', () => {
    test('renders symmetric framing with A/B panes', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'ab' }));
        assert.match(html, /data-mode="ab"/);
        assert.match(html, /data-pane="aonly"/);
        assert.match(html, /data-pane="bonly"/);
        assert.match(html, /data-pane="both"/);
        assert.match(html, /win-a|win-b|win-both/); // KPI standings
        assert.match(html, /no winner/i);            // verdict disclaimer
    });
});

describe('robustness', () => {
    test('escapes rule titles and labels', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const evil = report({ runId: 'z', timestamp: '2026-03-01T00:00:00Z', name: '<script>x</script>',
            findings: [{ ruleId: 'r', id: 'r', title: '<b>bad</b>', severity: 'minor', outcome: 'fail', wcag: { sc: [] }, occurrences: [{ pageUrl: 'https://x/p', target: ['.x'] }] }] });
        const html = comparisonDiffHTML(diffReports(A(), evil, { mode: 'evolution' }));
        assert.doesNotMatch(html, /<b>bad<\/b>/);
        assert.match(html, /&lt;b&gt;bad/);
    });
    test('rounds long-float scores and deltas to <=2 decimals', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const a = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', score: 67.45054945054945,
            findings: [finding('r', 'serious', ['/1'])] });
        const b = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', score: 73.89010989010988,
            findings: [finding('r', 'serious', ['/1'])] });
        const html = comparisonDiffHTML(diffReports(a, b, { mode: 'evolution' }));
        assert.doesNotMatch(html, /67\.45054/);   // raw float gone
        assert.match(html, /67\.45/);              // rounded shown
        assert.doesNotMatch(html, /\d\.\d{3,}/);   // no 3+ decimal numbers anywhere
    });

    test('degrades on missing input', async () => {
        const { comparisonDiffHTML } = await load();
        assert.match(comparisonDiffHTML(null), /No comparison data/);
    });
});

describe('comparisonDiffHTML — accessibility invariants', () => {
    for (const mode of ['evolution', 'ab']) {
        test(`${mode}: every tab points at a panel that points back`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));

            const tabs = [...html.matchAll(/<button class="seg"[^>]*id="([^"]+)"[^>]*aria-controls="([^"]+)"/g)];
            assert.ok(tabs.length >= 3, `expected the category tabs, found ${tabs.length}`);

            for (const [, tabId, panelId] of tabs) {
                assert.ok(
                    html.includes(`id="${panelId}" role="tabpanel" aria-labelledby="${tabId}"`),
                    `${tabId} controls ${panelId}, which is not a tabpanel labelled by it`
                );
            }
        });

        test(`${mode}: exactly one tab is selected and in the tab order`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));

            assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
            assert.equal((html.match(/<button class="seg"[^>]*tabindex="0"/g) || []).length, 1);
            // the unselected tabs stay reachable by arrow key, not by Tab
            assert.ok((html.match(/<button class="seg"[^>]*tabindex="-1"/g) || []).length >= 2);
        });

        test(`${mode}: the severity chart ships its values as text, not just an image`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));

            assert.match(html, /<svg class="dumbbell"[^>]*aria-hidden="true"/,
                'the plot must be hidden from assistive tech once its data ships as a table');
            assert.doesNotMatch(html, /<svg class="dumbbell"[^>]*role="img"/,
                'role="img" suppresses the per-shape <title>, so the values would be unreachable');
            assert.match(html, /<div class="visually-hidden"><table><caption>/);
            assert.match(html, /<th scope="col">Severity<\/th>/);
            assert.match(html, /<th scope="row">/);
        });

        test(`${mode}: directional glyphs are decorative, never the only cue`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));

            // every arrow/triangle/caret glyph sits inside an aria-hidden element
            for (const glyph of ['→', '▲', '▼', '▸', '◆']) {
                let at = html.indexOf(glyph);
                while (at !== -1) {
                    const openedAt = html.lastIndexOf('<', at);
                    const tag = html.slice(openedAt, at);
                    assert.ok(
                        tag.includes('aria-hidden="true"'),
                        `"${glyph}" is exposed to assistive tech in: ${tag.slice(0, 120)}`
                    );
                    at = html.indexOf(glyph, at + 1);
                }
            }
        });
    }
});

// Problems and failures are two different counts, and the tab used to name
// them with four words between them ("issues", "instances", "occurrences",
// "rules"). These pin the vocabulary (a problem is a criterion or rule, a
// failure one element failing one problem, a broken element counted once),
// and pin the claim to the measure that carries it.
describe('comparisonDiffHTML — problems and failures read as different things', () => {
    // same two rules in both runs, failing in half as many places: nothing fixed,
    // and still an improvement
    const wider = () => report({ runId: 'c', timestamp: '2026-03-01T00:00:00Z', name: 'v3', score: 80, scans: [1, 1],
        findings: [finding('color-contrast', 'serious', ['/1', '/2', '/3']), finding('image-alt', 'serious', ['/1', '/2'])] });
    const same = () => report({ runId: 'd', timestamp: '2026-04-01T00:00:00Z', name: 'v4', score: 80, scans: [1, 1],
        findings: [finding('color-contrast', 'serious', ['/1']), finding('image-alt', 'serious', ['/1'])] });

    for (const mode of ['evolution', 'ab']) {
        test(`${mode}: neither "issue" nor "occurrence" is used for a count`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));
            assert.doesNotMatch(html, /\bissues?\b/i, '"issue" reads as one element to anyone who has not learnt otherwise');
            assert.doesNotMatch(html, /occurrences?\b|failing instances?/i, 'the tab settled on "failures" for this unit');
        });

        test(`${mode}: the hero explains what a problem, a failure and a broken element are`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));
            assert.match(html, /A problem is one rule, like buttons needing an accessible name\./);
            assert.match(html, /A failure is one element failing one rule on one page, so an element that breaks three rules counts three times\./);
            assert.match(html, /A broken element is counted once, whatever it breaks\./);
        });

        test(`${mode}: reports read by criterion say the problems are criteria`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const byCriterion = (r) => {
                r.scans.forEach((s) => s.canonical.findings.forEach((f) => { f.ruleId = `wcag-1.4.3-${f.ruleId}`; f.id = f.ruleId; }));
                return r;
            };
            const html = comparisonDiffHTML(diffReports(byCriterion(A()), byCriterion(B()), { mode }));
            assert.match(html, /A problem is one of the WCAG criteria the scan checks/);
            assert.match(html, /an element that breaks three WCAG criteria counts three times/);
        });

        test(`${mode}: the severity chart says it plots failures, because it does`, async () => {
            const { comparisonDiffHTML, diffReports } = await load();
            const html = comparisonDiffHTML(diffReports(A(), B(), { mode }));
            // severityRollup() sums occurrences in both framings, so a title
            // promising rule counts would be wrong
            assert.match(html, /Failures by severity/);
            assert.doesNotMatch(html, /Rules failed by severity/);
        });
    }

    test('evolution: the hero tiles carry both counts', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'evolution' }));
        assert.equal((html.match(/<div class="cap">failures<\/div>/g) || []).length, 2);
        assert.match(html, /<div class="flow-sub">across 2 kinds of problem<\/div>/); // baseline: 2 failing rules
    });

    test('evolution: an improvement with nothing fixed leads on the failure count', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(wider(), same(), { mode: 'evolution' }));
        assert.match(html, /badge--good/);
        assert.match(html, /3 fewer failures — the same 2 problems still fail, just in fewer places\./);
        assert.match(html, /Problems: 0 fixed, 0 newly failing, 2 still failing\./);
    });

    test('evolution: a run that trades problems for failures is badged mixed, not improved', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        // one rule fixed, the other spreading from 1 element to 6
        const before = report({ runId: 'e', timestamp: '2026-05-01T00:00:00Z', name: 'v5', score: 70, scans: [1],
            findings: [finding('color-contrast', 'serious', ['/1']), finding('image-alt', 'serious', ['/1'])] });
        const after = report({ runId: 'f', timestamp: '2026-06-01T00:00:00Z', name: 'v6', score: 70, scans: [1],
            findings: [finding('color-contrast', 'serious', ['/1', '/2', '/3', '/4', '/5', '/6'])] });
        const html = comparisonDiffHTML(diffReports(before, after, { mode: 'evolution' }));
        assert.match(html, /badge badge--mixed/);
        assert.match(html, /accent accent--mixed/);
        assert.match(html, /Mixed result/);
        assert.match(html, /1 fewer problem failing, but 4 more failures/);
    });

    test('a/b: the standings show the failure count the verdict can rest on, and the broken elements', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'ab' }));
        assert.match(html, /<div class="kpis kpis-ab">/);
        assert.equal((html.match(/class="kpi /g) || []).length, 7);
        assert.match(html, /<div class="name">Failures<\/div>/);
        assert.match(html, /<div class="name">Broken elements<\/div>/);
        assert.match(html, /<div class="name">Kinds of problem<\/div>/);
    });

    test('a/b: measures pointing opposite ways declare no leader', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        // A scores better; B fails in fewer places
        const a = report({ runId: 'g', name: 'left', score: 80, findings: [finding('color-contrast', 'serious', ['/1', '/2', '/3'])] });
        const b = report({ runId: 'h', name: 'right', score: 65, findings: [finding('color-contrast', 'serious', ['/1'])] });
        const html = comparisonDiffHTML(diffReports(a, b, { mode: 'ab' }));
        assert.match(html, /Too close to call/);
        assert.match(html, /The two measures disagree/);
        assert.doesNotMatch(html, /leads on/);
    });
});

describe('comparisonDiffHTML — RGAA rollups', () => {
    const rgaaRollup = (pages) => ({
        ruleId: 'rgaa-4.1.2-8.1', id: 'rgaa-4.1.2-8.1', severity: 'serious', outcome: 'fail',
        title: 'Chaque page web est-elle définie par un type de document ?', titleLang: 'fr',
        wcag: { sc: [], scNormative: [] }, rgaa: [{ criterion: '8.1', tests: [], version: '4.1.2' }],
        meta: { atomic: false, standard: 'RGAA' },
        occurrences: pages.map((p) => ({ pageUrl: `https://x${p}`, target: ['html'] })),
    });

    test('a row names the RGAA criterion and marks the French title', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const a = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [] });
        const b = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [rgaaRollup(['/1'])] });
        const d = diffReports(a, b, { mode: 'evolution' });
        const row = d.groups.new.find((r) => r.ruleId === 'rgaa-4.1.2-8.1');
        assert.deepEqual(row.rgaa, ['8.1']);
        assert.equal(row.titleLang, 'fr');
        const html = comparisonDiffHTML(d);
        assert.match(html, /<span class="rule" lang="fr">Chaque page web/);
        assert.match(html, /RGAA 8\.1/);
        assert.doesNotMatch(html, /WCAG <\/span>|WCAG undefined/);
    });

    test('an English title gets no lang, and a WCAG row no RGAA label', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const html = comparisonDiffHTML(diffReports(A(), B(), { mode: 'evolution' }));
        assert.doesNotMatch(html, /class="rule" lang=/);
        assert.doesNotMatch(html, /RGAA /);
    });
});

describe('comparisonDiffHTML — opt-in rules', () => {
    test('says which side also ran RGAA\'s own rules, and that it changes what was checked', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const b = B();
        b.scans.forEach((s) => { s.optInRules = ['rgaa']; });
        const html = comparisonDiffHTML(diffReports(A(), b, { mode: 'evolution' }));
        assert.match(html, /plus RGAA-only rules/);
        assert.match(html, /only one standard requires/);
        assert.doesNotMatch(comparisonDiffHTML(diffReports(A(), B(), { mode: 'evolution' })), /only one standard requires/);
    });
});

describe('comparison: room before failing', () => {
    const m = (headroom) => ({ ruleId: 'contrast-minimum', title: 'Text contrast', unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.5 + headroom, headroom, selector: 'p' });
    const withMargin = (runId, timestamp, headroom) => ({ ...report({ runId, timestamp }), scans: [{ id: 's', url: 'https://x/', canonical: { findings: [], margins: [m(headroom)] } }] });

    test('lists the rule on both sides, marks the near miss, and says it got closer', async () => {
        const { diffReports, comparisonDiffHTML } = await load();
        const d = diffReports(withMargin('a', '2026-01-01T00:00:00Z', 0.8), withMargin('b', '2026-02-01T00:00:00Z', 0.02), { mode: 'evolution' });
        const html = comparisonDiffHTML(d);
        assert.match(html, /<h3>Room before failing<\/h3>/);
        assert.match(html, /5\.30:1<\/span>, 0\.80 left/);
        assert.match(html, /4\.52:1<\/span>, 0\.02 left <span class="margin-near">near miss<\/span>/);
        assert.match(html, /margin-chg--closer">Closer to failing</);
    });

    test('names the sides A and B in the symmetric framing', async () => {
        const { diffReports, comparisonDiffHTML } = await load();
        const d = diffReports(withMargin('a', null, 0.8), withMargin('b', null, 0.02), { mode: 'ab' });
        assert.match(comparisonDiffHTML(d), /Less room on B/);
    });

    test('is left out when neither report has margins', async () => {
        const { diffReports, comparisonDiffHTML } = await load();
        assert.doesNotMatch(comparisonDiffHTML(diffReports(A(), B())), /Room before failing/);
    });
});

describe('groups merged in the reports\' view (scan-grouping-design.md §11)', () => {
    test('the note is shown under the reports compared, escaped, and only when given', async () => {
        const { comparisonDiffHTML, diffReports } = await load();
        const d = diffReports(A(), B(), { mode: 'evolution' });
        assert.match(comparisonDiffHTML(d, { mergedNote: 'Product <pages> merged' }),
            /<div class="subject">[\s\S]*?<\/div><p class="cmp2-note">Product &lt;pages&gt; merged<\/p>/);
        assert.doesNotMatch(comparisonDiffHTML(d), /cmp2-note/);
    });
});
