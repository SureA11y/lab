'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('./report-diff.js');
async function load() {
    return mod;
}

// finding with N occurrences on given page paths (host implied)
function finding(ruleId, severity, pages, extra = {}) {
    return {
        ruleId, id: ruleId, title: extra.title || `${ruleId} title`, severity,
        outcome: 'fail', wcag: { sc: [{ ref: extra.wcag || '1.4.3', level: 'AA' }] },
        occurrences: pages.map((p, i) => ({ pageUrl: `https://x${p}`, target: [`${ruleId}-${p}-${i}`] })),
    };
}
function report(o = {}) {
    return {
        runId: o.runId, timestamp: o.timestamp, scenarioName: o.name || null, url: 'https://x/',
        scans: [{ id: 's1', url: 'https://x/', canonical: { findings: o.findings || [] } }],
        metrics: { a11ySummary: { scores: { avgPageAccessibility: o.score ?? 70, confidence: o.conf ?? 90 } } },
    };
}

describe('diffReports — evolution rule classification', () => {
    test('resolved / new / persistent', async () => {
        const { diffReports } = await load();
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [
            finding('color-contrast', 'serious', ['/1', '/2']), // 2 occ, persists (fewer in B)
            finding('image-alt', 'serious', ['/1']),            // resolved (gone in B)
        ]});
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [
            finding('color-contrast', 'serious', ['/1']),       // 1 occ
            finding('label', 'critical', ['/9']),               // new
        ]});
        const d = diffReports(A, B, { mode: 'evolution' });
        const byId = Object.fromEntries(d.rows.map((r) => [r.ruleId, r]));
        assert.equal(byId['image-alt'].category, 'resolved');
        assert.equal(byId['label'].category, 'new');
        assert.equal(byId['color-contrast'].category, 'persistent');
        assert.equal(byId['color-contrast'].aCount, 2);
        assert.equal(byId['color-contrast'].bCount, 1);
        assert.equal(byId['color-contrast'].delta, -1);
    });

    test('orders baseline vs latest by timestamp regardless of arg order', async () => {
        const { diffReports } = await load();
        const older = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'minor', ['/1', '/2'])] });
        const newer = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'minor', ['/1'])] });
        const d = diffReports(newer, older, { mode: 'evolution' }); // reversed
        assert.equal(d.identityA.runId, 'a');
        assert.equal(d.rows[0].aCount, 2); // baseline (older) had 2
        assert.equal(d.rows[0].bCount, 1);
    });
});

describe('diffReports — elements in shadow roots', () => {
    test('the same selector in two shadow roots is two elements', async () => {
        const { diffReports } = await load();
        const inRoots = (n) => ({
            ruleId: 'button-name', id: 'button-name', title: 't', severity: 'serious', outcome: 'fail',
            wcag: { sc: [{ ref: '4.1.2', level: 'A' }] },
            occurrences: Array.from({ length: n }, (_, i) => ({
                pageUrl: 'https://x/', target: ['button:not(* > *)'], shadowHostSelectors: [`#m > div:nth-of-type(${i + 1})`],
            })),
        });
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [inRoots(5)] });
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [inRoots(3)] });
        const row = diffReports(A, B, { mode: 'evolution' }).rows.find((r) => r.ruleId === 'button-name');
        assert.equal(row.aCount, 5);
        assert.equal(row.bCount, 3);
    });
});

describe('diffReports — rules that list only some of their elements', () => {
    test('the elements a rule counted and did not list are counted on both sides', async () => {
        const { diffReports } = await load();
        const capped = (unlisted) => ({ ...finding('contrast', 'serious', Array.from({ length: 50 }, (_, i) => `/${i}`)), unlisted });
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [capped(950)] });
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [capped(10)] });
        const row = diffReports(A, B, { mode: 'evolution' }).rows.find((r) => r.ruleId === 'contrast');
        assert.equal(row.aCount, 1000);
        assert.equal(row.bCount, 60);
    });
});

describe('diffReports — a/b rule classification', () => {
    test('aonly / bonly / both, caller order preserved', async () => {
        const { diffReports } = await load();
        const A = report({ runId: 'a', name: 'prod', findings: [
            finding('image-alt', 'serious', ['/1']),      // aonly
            finding('color-contrast', 'serious', ['/1', '/2']), // both
        ]});
        const B = report({ runId: 'b', name: 'beta', findings: [
            finding('aria-required-attr', 'serious', ['/1']), // bonly
            finding('color-contrast', 'serious', ['/1']),     // both
        ]});
        const d = diffReports(A, B, { mode: 'ab' });
        const byId = Object.fromEntries(d.rows.map((r) => [r.ruleId, r]));
        assert.equal(byId['image-alt'].category, 'aonly');
        assert.equal(byId['aria-required-attr'].category, 'bonly');
        assert.equal(byId['color-contrast'].category, 'both');
        assert.equal(d.identityA.scenarioName, 'prod'); // not reordered
        assert.equal(d.identityB.scenarioName, 'beta');
    });
});

describe('occurrence-level diff', () => {
    test('fixed / still / new by page+selector', async () => {
        const { diffReports } = await load();
        // same rule, occurrence sets overlap partially
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [{
            ruleId: 'color-contrast', id: 'color-contrast', title: 't', severity: 'serious', outcome: 'fail',
            wcag: { sc: [] },
            occurrences: [{ pageUrl: 'https://x/p', target: ['.a'] }, { pageUrl: 'https://x/p', target: ['.b'] }],
        }]});
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [{
            ruleId: 'color-contrast', id: 'color-contrast', title: 't', severity: 'serious', outcome: 'fail',
            wcag: { sc: [] },
            occurrences: [{ pageUrl: 'https://x/p', target: ['.b'] }, { pageUrl: 'https://x/p', target: ['.c'] }],
        }]});
        const d = diffReports(A, B, { mode: 'evolution' });
        const occ = d.rows[0].occ;
        const tags = occ.reduce((m, o) => { m[o.tag] = (m[o.tag] || 0) + 1; return m; }, {});
        assert.equal(tags.fixed, 1);  // .a only in A
        assert.equal(tags.still, 1);  // .b in both
        assert.equal(tags.new, 1);    // .c only in B
    });
    test('each occurrence row carries its id, the same one a saved report records', async () => {
        const { diffReports } = await load();
        const { occurrenceId } = require('./report-format.js');
        const occ = (target) => ({ pageUrl: 'https://x/p', target: [target] });
        const f = (occurrences) => [{ ruleId: 'image-alt', severity: 'serious', outcome: 'fail', wcag: { sc: [] }, occurrences }];
        // The baseline is older: no ids saved. The current run saved its own.
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: f([occ('.a')]) });
        const saved = { ...occ('.a'), occurrenceId: occurrenceId('image-alt', occ('.a')) };
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: f([saved, occ('.c')]) });
        const rows = diffReports(A, B, { mode: 'evolution' }).rows[0].occ;
        const byTarget = Object.fromEntries(rows.map((r) => [r.target, r]));
        assert.equal(byTarget['.a'].tag, 'still');
        assert.equal(byTarget['.a'].occurrenceId, saved.occurrenceId);
        assert.equal(byTarget['.c'].occurrenceId, occurrenceId('image-alt', occ('.c')));
    });
});

describe('rollups, stats, verdict', () => {
    test('severity rollup counts occurrences per band', async () => {
        const { diffReports } = await load();
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [
            finding('c', 'critical', ['/1', '/2']),
            finding('s', 'serious', ['/1']),
        ]});
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('c', 'critical', ['/1'])] });
        const d = diffReports(A, B, { mode: 'evolution' });
        assert.equal(d.severity.a.critical, 2);
        assert.equal(d.severity.a.serious, 1);
        assert.equal(d.severity.b.critical, 1);
        assert.equal(d.stats.failuresA, 3);
        assert.equal(d.stats.failuresB, 1);
        assert.equal(d.stats.seriousCriticalA, 3);
        assert.equal(d.stats.rulesA, 2);
        assert.equal(d.stats.rulesB, 1);
    });

    test('evolution verdict reads improvement', async () => {
        const { diffReports } = await load();
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', score: 61, findings: [finding('r', 'serious', ['/1', '/2', '/3'])] });
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', score: 74, findings: [finding('r', 'serious', ['/1'])] });
        const d = diffReports(A, B, { mode: 'evolution' });
        assert.equal(d.verdict.tone, 'good');
        assert.equal(d.verdict.headline, 'improved');
        assert.equal(d.verdict.net, -2);
        assert.match(d.verdict.lead, /2 fewer failures/);
    });

    test('a/b verdict declares a leader by score but no winner language', async () => {
        const { diffReports } = await load();
        const A = report({ runId: 'a', name: 'prod', score: 71, findings: [finding('x', 'serious', ['/1'])] });
        const B = report({ runId: 'b', name: 'beta', score: 74, findings: [finding('y', 'serious', ['/1'])] });
        const d = diffReports(A, B, { mode: 'ab' });
        assert.equal(d.verdict.leader, 'b');
        assert.equal(d.verdict.headline, 'B leads');
        assert.match(d.verdict.badge, /no winner/i);
    });

    test('narrative is deterministic prose', async () => {
        const { diffReports } = await load();
        const A = report({ runId: 'a', timestamp: '2026-01-01T00:00:00Z', findings: [finding('r', 'serious', ['/1', '/2', '/3', '/4'])] });
        const B = report({ runId: 'b', timestamp: '2026-02-01T00:00:00Z', findings: [finding('r', 'serious', ['/1'])] });
        const d1 = diffReports(A, B, { mode: 'evolution' });
        const d2 = diffReports(A, B, { mode: 'evolution' });
        assert.ok(d1.narrative.length > 0);
        assert.deepEqual(d1.narrative, d2.narrative); // stable
        assert.match(d1.narrative[0], /serious band/);
    });
});

// A rule that fails and an element that fails it are different units, and they
// move independently: the same rules can fail in fewer places, and dropping a
// rule can still leave more failing elements behind. The verdict has to be
// justified by the measure that actually moved, so these walk every combination
// of the two.
function runOf(id, ts, rules, score) {
    const findings = Object.entries(rules).map(([ruleId, count]) =>
        finding(ruleId, 'serious', Array.from({ length: count }, (_, i) => `/p${i}`)));
    return report({ runId: id, timestamp: ts, findings, score });
}
function verdictFor(diffReports, before, after) {
    const A = runOf('a', '2026-01-01T00:00:00Z', before);
    const B = runOf('b', '2026-02-01T00:00:00Z', after);
    return diffReports(A, B, { mode: 'evolution' }).verdict;
}

describe('evolution verdict — rules and instances are judged separately', () => {
    const CASES = [
        {
            name: 'fewer rules and fewer instances: a plain improvement',
            before: { r1: 2, r2: 2 }, after: { r1: 1 },
            tone: 'good', headline: 'improved', dominant: 'both',
            claim: /3 fewer failures, spread across 1 fewer problem\./,
        },
        {
            name: 'same rules, fewer instances: still an improvement, and it says why',
            before: { r1: 3, r2: 3 }, after: { r1: 1, r2: 1 },
            tone: 'good', headline: 'improved', dominant: 'instances',
            claim: /4 fewer failures — the same 2 problems still fail, just in fewer places\./,
        },
        {
            name: 'fewer rules, same instances: the failures concentrated',
            before: { r1: 1, r2: 1 }, after: { r1: 2 },
            tone: 'good', headline: 'improved', dominant: 'rules',
            claim: /The same 2 failures overall, now concentrated in 1 fewer problem\./,
        },
        {
            name: 'fewer rules but more instances: mixed, not an improvement',
            before: { r1: 1, r2: 1 }, after: { r1: 5 },
            tone: 'mixed', headline: 'moved both ways', dominant: 'mixed',
            claim: /1 fewer problem failing, but 3 more failures/,
        },
        {
            name: 'more rules but fewer instances: mixed, not a regression',
            before: { r1: 5 }, after: { r1: 1, r2: 1 },
            tone: 'mixed', headline: 'moved both ways', dominant: 'mixed',
            claim: /3 fewer failures overall, but 1 more problem failing than before\./,
        },
        {
            name: 'nothing moved on either measure',
            before: { r1: 2, r2: 1 }, after: { r1: 2, r2: 1 },
            tone: 'neutral', headline: 'held steady', dominant: 'none',
            claim: /No change on either measure: the same 2 problems fail, in the same 3 places\./,
        },
        // the mirror image of the first three, so a regression cannot hide either
        {
            name: 'more rules and more instances: a plain regression',
            before: { r1: 1 }, after: { r1: 2, r2: 1 },
            tone: 'bad', headline: 'regressed', dominant: 'both',
            claim: /2 more failures, spread across 1 more problem\./,
        },
        {
            name: 'same rules, more instances: a regression on instances alone',
            before: { r1: 1 }, after: { r1: 3 },
            tone: 'bad', headline: 'regressed', dominant: 'instances',
            claim: /2 more failures — the same 1 problem now fails in more places\./,
        },
        {
            name: 'more rules, same instances: the failures spread',
            before: { r1: 2 }, after: { r1: 1, r2: 1 },
            tone: 'bad', headline: 'regressed', dominant: 'rules',
            claim: /The same 2 failures overall, now spread across 1 more problem\./,
        },
    ];

    for (const c of CASES) {
        test(c.name, async () => {
            const { diffReports } = await load();
            const v = verdictFor(diffReports, c.before, c.after);
            assert.equal(v.tone, c.tone);
            assert.equal(v.headline, c.headline);
            assert.equal(v.dominant, c.dominant);
            assert.match(v.lead, c.claim);
        });
    }

    test('every lead names the unit of every number it prints', async () => {
        const { diffReports } = await load();
        for (const c of CASES) {
            const { lead } = verdictFor(diffReports, c.before, c.after);
            // "issue" is the word that blurs the two units. The tab defines its
            // own (a problem is a criterion or rule, a failure one element
            // failing one problem), so the old "rule" and "instance" are gone.
            assert.doesNotMatch(lead, /\bissues?\b/i, `"issue" is ambiguous here: ${lead}`);
            assert.doesNotMatch(lead, /\binstances?\b|\brules?\b(?!:)/i, `an undefined unit: ${lead}`);
            // the problem tally trails the claim, so a zero in it is never the reason
            assert.match(lead, /Problems: \d+ fixed, \d+ newly failing, \d+ still failing\.$/);
        }
    });

    test('a run that fixes no rule still reads as improved, on the instance count', async () => {
        const { diffReports } = await load();
        // the case the wording used to garble: "4 fewer failures. 0 issues were
        // resolved" — nothing was fixed, and it was still better
        const v = verdictFor(diffReports, { r1: 4, r2: 4 }, { r1: 2, r2: 2 });
        assert.equal(v.tone, 'good');
        assert.equal(v.resolved, 0);
        assert.equal(v.added, 0);
        assert.equal(v.ruleNet, 0);
        assert.equal(v.net, -4);
        // the claim leads on the measure that moved; the zeros trail behind it
        assert.match(v.lead, /^4 fewer failures — the same 2 problems still fail/);
        assert.match(v.lead, /Problems: 0 fixed, 0 newly failing, 2 still failing\.$/);
    });
});

describe('a/b standings — the claim names the measure it rests on', () => {
    const ab = (diffReports, a, b) => diffReports(a, b, { mode: 'ab' }).verdict;

    test('both measures agree: the lead cites both', async () => {
        const { diffReports } = await load();
        const A = runOf('a', undefined, { r1: 4, r2: 1 }, 61);
        const B = runOf('b', undefined, { r1: 1 }, 74);
        const v = ab(diffReports, A, B);
        assert.equal(v.leader, 'b');
        assert.equal(v.basis, 'both');
        assert.match(v.lead, /B leads on both measures — accessibility score A 61 vs B 74, failures A 5 vs B 1\./);
    });

    test('scores split a tie on instances: the lead says the instances are level', async () => {
        const { diffReports } = await load();
        const A = runOf('a', undefined, { r1: 2 }, 71);
        const B = runOf('b', undefined, { r2: 2 }, 74);
        const v = ab(diffReports, A, B);
        assert.equal(v.leader, 'b');
        assert.equal(v.basis, 'score');
        assert.match(v.lead, /B leads on the accessibility score \(A 71 vs B 74\); both have the same 2 failures\./);
    });

    test('instances split a tie on score', async () => {
        const { diffReports } = await load();
        const A = runOf('a', undefined, { r1: 1 }, 70);
        const B = runOf('b', undefined, { r1: 4 }, 70);
        const v = ab(diffReports, A, B);
        assert.equal(v.leader, 'a');
        assert.equal(v.basis, 'instances');
        assert.match(v.lead, /scores are level at 70; A has fewer failures \(A 1 vs B 4\)\./);
    });

    test('the two measures disagree: no leader is declared', async () => {
        const { diffReports } = await load();
        // A scores better, B fails in fewer places — the standings must not pick one
        const A = runOf('a', undefined, { r1: 9 }, 80);
        const B = runOf('b', undefined, { r1: 2 }, 70);
        const v = ab(diffReports, A, B);
        assert.equal(v.leader, 'split');
        assert.equal(v.basis, 'split');
        assert.equal(v.headline, 'Too close to call');
        assert.match(v.lead, /score favours A \(A 80 vs B 70\), the failure count favours B \(A 9 vs B 2\)/);
    });

    test('level on both measures', async () => {
        const { diffReports } = await load();
        const A = runOf('a', undefined, { r1: 2 }, 70);
        const B = runOf('b', undefined, { r2: 2 }, 70);
        const v = ab(diffReports, A, B);
        assert.equal(v.leader, 'tie');
        assert.equal(v.headline, 'Level result');
        assert.match(v.lead, /A and B are level: the same accessibility score \(70\) and the same 2 failures\./);
    });

    test('no score to compare: the standings fall back to instances and say so', async () => {
        const { diffReports } = await load();
        const strip = (rep) => ({ ...rep, metrics: {} });
        const A = strip(runOf('a', undefined, { r1: 3 }));
        const B = strip(runOf('b', undefined, { r1: 1 }));
        const v = ab(diffReports, A, B);
        assert.equal(v.basis, 'instances');
        assert.equal(v.leader, 'b');
        assert.match(v.lead, /No accessibility score to compare; B has fewer failures \(A 3 vs B 1\)\./);
    });

    test('long-float scores are rounded before they reach the prose', async () => {
        const { diffReports } = await load();
        const A = runOf('a', undefined, { r1: 1 }, 67.45054945054945);
        const B = runOf('b', undefined, { r1: 1 }, 73.89010989010988);
        const v = ab(diffReports, A, B);
        assert.match(v.lead, /A 67\.45 vs B 73\.89/);
        assert.doesNotMatch(v.lead, /\d\.\d{3,}/);
    });

    test('the rule tally follows the claim and keeps its unit', async () => {
        const { diffReports } = await load();
        const A = runOf('a', undefined, { r1: 1, shared: 1 }, 61);
        const B = runOf('b', undefined, { r2: 1, shared: 1 }, 74);
        const v = ab(diffReports, A, B);
        assert.match(v.lead, /Of 3 problems in play, 1 fail only on A, 1 only on B, and 1 on both\.$/);
        assert.doesNotMatch(v.lead, /\bissues?\b/i);
    });
});

describe('diffReports — room before failing (margins)', () => {
    const m = (ruleId, headroom, o = {}) => ({ ruleId, title: `${ruleId} title`, unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.5 + headroom, headroom, selector: 'p', ...o });
    const withMargins = (runId, timestamp, ...perScan) => ({
        runId, timestamp, url: 'https://x/',
        scans: perScan.map((margins, i) => ({ id: `s${i}`, url: `https://x/${i}`, canonical: { findings: [], margins } })),
    });

    test('compares each rule\'s tightest pass across the scans, closer to failing first', async () => {
        const { diffReports } = await load();
        const A = withMargins('a', '2026-01-01T00:00:00Z',
            [m('contrast-minimum', 0.8), m('target-size-minimum', 2, { unit: 'px', threshold: 24, value: 26 })],
            [m('contrast-minimum', 0.5)]);
        const B = withMargins('b', '2026-02-01T00:00:00Z',
            [m('contrast-minimum', 0.02), m('target-size-minimum', 6, { unit: 'px', threshold: 24, value: 30 }), m('link-in-text-block', 1)]);
        const d = diffReports(A, B, { mode: 'evolution' });
        assert.deepEqual(d.margins.map((r) => [r.ruleId, r.change]),
            [['contrast-minimum', 'closer'], ['link-in-text-block', 'bonly'], ['target-size-minimum', 'further']]);
        const contrast = d.margins[0];
        assert.equal(contrast.a.headroom, 0.5, 'the tightest of the baseline\'s scans');
        assert.equal(contrast.a.pageUrl, 'https://x/1');
        assert.equal(contrast.b.headroom, 0.02);
    });

    test('reads a change smaller than what is shown as no change', async () => {
        const { diffReports } = await load();
        const d = diffReports(
            withMargins('a', '2026-01-01T00:00:00Z', [m('contrast-minimum', 0.104)]),
            withMargins('b', '2026-02-01T00:00:00Z', [m('contrast-minimum', 0.1)]),
            { mode: 'evolution' });
        assert.equal(d.margins[0].change, 'same');
    });

    test('skips a scan with no canonical result, as a skipped scan has', async () => {
        const { diffReports } = await load();
        const A = withMargins('a', '2026-01-01T00:00:00Z', [m('contrast-minimum', 0.8)]);
        A.scans.push({ id: 'skipped', url: 'https://x/big', skipped: true, canonical: null });
        const d = diffReports(A, withMargins('b', '2026-02-01T00:00:00Z', [m('contrast-minimum', 0.5)]), { mode: 'evolution' });
        assert.equal(d.margins[0].change, 'closer');
    });

    test('says a rule fails on more elements, rather than that it has more room, when a pass turned into a failure', async () => {
        const { diffReports } = await load();
        const A = withMargins('a', '2026-01-01T00:00:00Z', [m('contrast-minimum', 0.5)]);
        const B = withMargins('b', '2026-02-01T00:00:00Z', [m('contrast-minimum', 13.7)]);
        // The text that had 0.5 of room now fails, under its rollup.
        B.scans[0].canonical.findings = [{ ruleId: 'wcag-1.4.3', outcome: 'fail', meta: { atomic: false },
            occurrences: [{ target: ['p'], atomicCheckId: 'contrast-minimum' }] }];
        const d = diffReports(A, B, { mode: 'evolution' });
        assert.equal(d.margins[0].change, 'failsMore');
    });

    test('is empty when neither report has margins', async () => {
        const { diffReports } = await load();
        assert.deepEqual(diffReports(report({ runId: 'a' }), report({ runId: 'b' })).margins, []);
    });
});
