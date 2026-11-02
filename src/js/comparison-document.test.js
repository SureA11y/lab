'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { describeComparison } = require('../shared/report-identity.js');

let M;
async function load() {
    if (!M) M = await import('./comparison-document.js');
    return M;
}

function report(o = {}) {
    return {
        runId: o.runId || 'r',
        timestamp: o.timestamp || null,
        scenarioName: o.name || null,
        url: o.url || 'https://banking.example.com/',
        scans: [],
    };
}

const AT = '2026-08-28T09:30:00Z';

function doc(reports, options = {}) {
    return describeComparison(reports, { generatedAt: AT, framing: 'trend', ...options });
}

describe('comparison document: what the file needs to explain itself', () => {
    test('a typed title wins over anything derived', async () => {
        const { documentTitle } = await load();
        const d = doc([report({ name: 'Web Banking' }), report({ name: 'Web Banking' })],
            { title: 'Q3 remediation evidence' });

        assert.equal(documentTitle(d), 'Q3 remediation evidence');
        assert.equal(d.subject, 'Web Banking', 'and the derived subject is still available');
    });

    test('untitled, the reports name it themselves', async () => {
        const { documentTitle } = await load();

        const named = doc([report({ name: 'Web Banking' }), report({ name: 'Web Banking' })]);
        assert.equal(documentTitle(named), 'Web Banking');

        // Different scenario names, one site: the site is the honest answer.
        const sameSite = doc([report({ name: 'Run A' }), report({ name: 'Run B' })]);
        assert.equal(documentTitle(sameSite), 'banking.example.com');
    });

    test('nothing is claimed about a set that agrees on nothing', async () => {
        const { documentTitle } = await load();
        const d = doc([
            report({ name: 'Bank', url: 'https://a.example/' }),
            report({ name: 'Shop', url: 'https://b.example/' }),
        ]);

        assert.equal(d.subject, null, 'two subjects are not one subject');
        assert.equal(d.scope, null);
        assert.deepEqual(d.scopes, ['https://a.example/', 'https://b.example/']);
        assert.equal(documentTitle(d), 'Accessibility comparison');
    });

    test('the summary carries the date range when the dates ordered the columns', async () => {
        const d = doc([
            report({ name: 'Web Banking', timestamp: '2026-06-02T02:15:00Z' }),
            report({ name: 'Web Banking', timestamp: '2026-08-11T02:15:00Z' }),
        ]);
        assert.equal(d.summary, '2 runs, 2 Jun 2026 to 11 Aug 2026');
    });

    test('an arrangement gets no date range, because the dates did not order it', async () => {
        const d = doc([
            report({ name: 'v1.1', timestamp: '2026-06-02T02:15:00Z' }),
            report({ name: 'v1.2', timestamp: '2026-08-11T02:15:00Z' }),
        ], { framing: 'versions', unit: { one: 'version', many: 'versions' }, ordered: false });

        assert.equal(d.span, null);
        assert.equal(d.summary, '2 versions', 'and the noun already says what they are');
    });

    test('the compiled stamp is trimmed to the second and never invented twice', async () => {
        const a = doc([report(), report()]);
        const b = doc([report(), report()]);

        assert.equal(a.generatedAt, '2026-08-28T09:30:00Z');
        assert.equal(a.generatedAt, b.generatedAt, 'the same input gives the same document');
    });
});

describe('comparison document: the masthead', () => {
    test('carries the title, the note, and the facts a reader needs first', async () => {
        const { mastheadHTML } = await load();
        const html = mastheadHTML(doc([
            report({ name: 'Web Banking', timestamp: '2026-06-02T02:15:00Z' }),
            report({ name: 'Web Banking', timestamp: '2026-08-11T02:15:00Z' }),
        ], { title: 'Q3 remediation', note: 'Sign-off evidence for the December release.' }));

        assert.match(html, /<h2 class="doc-title">Q3 remediation<\/h2>/);
        assert.match(html, /Sign-off evidence for the December release\./);
        assert.match(html, /<dt>Covering<\/dt><dd>2 runs, 2 Jun 2026 to 11 Aug 2026<\/dd>/);
        assert.match(html, /<dt>Compared as<\/dt><dd>Runs over time<\/dd>/,
            'how to read the columns, which the view implies everywhere and states nowhere');
        assert.match(html, /<dt>Compiled<\/dt><dd>28 Aug 2026<\/dd>/);
        assert.match(html, /https:\/\/banking\.example\.com\//);
    });

    test('states the machine-readable values the export reads back', async () => {
        const { mastheadHTML } = await load();
        const html = mastheadHTML(doc([report({ name: 'Web Banking' }), report({ name: 'Web Banking' })],
            { title: 'Q3 remediation' }));

        assert.match(html, /data-doc-title="Q3 remediation"/);
        assert.match(html, /data-doc-summary="2 runs"/);
        assert.match(html, /data-doc-generated="2026-08-28T09:30:00Z"/);
    });

    test('the title the export reads is a name, with nothing appended to it', async () => {
        const { mastheadHTML } = await load();
        // It becomes the <title> of the downloaded file, where there is room to
        // say which comparison this is and nothing else. Counts, ranges and
        // compiled dates are carried by the description and by the document.
        const html = mastheadHTML(doc([
            report({ name: 'Web Banking', timestamp: '2026-06-02T02:15:00Z' }),
            report({ name: 'Web Banking', timestamp: '2026-08-11T02:15:00Z' }),
        ], { title: 'Q3 remediation' }));

        const title = /data-doc-title="([^"]*)"/.exec(html)[1];
        assert.equal(title, 'Q3 remediation');
        assert.ok(!/\d{4}|runs|·/.test(title), 'no date, no count, no separator');
    });

    test('does not open by saying the same thing twice', async () => {
        const { mastheadHTML } = await load();

        const named = mastheadHTML(doc([report({ name: 'Web Banking' }), report({ name: 'Web Banking' })]));
        assert.match(named, /doc-kind/, 'a real title gets the "accessibility comparison" eyebrow above it');

        const anonymous = mastheadHTML(doc([
            report({ name: 'Bank', url: 'https://a.example/' }),
            report({ name: 'Shop', url: 'https://b.example/' }),
        ]));
        assert.ok(!/doc-kind/.test(anonymous),
            'a title that already is the generic label does not get the label repeated above it');
    });

    test('a title someone typed cannot inject markup', async () => {
        const { mastheadHTML } = await load();
        const html = mastheadHTML(doc([report(), report()], { title: '<img src=x onerror=alert(1)>' }));

        assert.ok(!html.includes('<img'), 'the tag is escaped in the heading');
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
        assert.ok(!/data-doc-title="[^"]*"[^>]*onerror/.test(html), 'and in the attribute');
    });
});

describe('comparison document: the provenance block', () => {
    const rows = [
        { label: 'Jun 2', name: 'Web Banking', timestamp: '2026-06-02T02:15:00Z', scope: 'https://x/', pages: 7, analyzed: 7, tags: [] },
        { label: 'Jul 14', name: 'Web Banking', timestamp: '2026-07-14T02:15:00Z', scope: 'https://x/', pages: 7, analyzed: 5, tags: ['mobile'] },
        { label: 'Undated', name: 'Local build', timestamp: null, scope: null, pages: null, analyzed: null, tags: [] },
    ];

    test('one row per report, in column order', async () => {
        const { provenanceHTML } = await load();
        const html = provenanceHTML(rows, doc([report(), report()]));

        assert.match(html, /What went into this comparison/);
        assert.match(html, /<th scope="row">Jun 2<\/th>/);
        assert.match(html, /2 Jun 2026/);
        assert.match(html, /mobile/);
    });

    test('a run that skipped scans shows both numbers, not the one that flatters it', async () => {
        const { provenanceHTML } = await load();
        const html = provenanceHTML(rows, doc([report(), report()]));
        assert.match(html, /class="num">5 of 7</);
    });

    test('missing values are shown as missing rather than invented', async () => {
        const { provenanceHTML } = await load();
        const html = provenanceHTML(rows, doc([report(), report()]));
        assert.match(html, /no date/);
    });

    test('a set covering several addresses says so instead of averaging over them', async () => {
        const { provenanceHTML } = await load();
        const mixed = doc([
            report({ url: 'https://a.example/' }),
            report({ url: 'https://b.example/' }),
        ]);

        assert.match(provenanceHTML(rows, mixed), /cover 2 different addresses/);
        assert.ok(!/different addresses/.test(provenanceHTML(rows, doc([report(), report()]))),
            'and stays quiet when they all cover one');
    });
});

describe('comparison document: the reports strip at the top', () => {
    const rows = [
        { label: 'UI-SDK v22.0.0', name: 'UI-SDK v22.0.0', timestamp: '2026-06-02T02:15:00Z', pages: 7, analyzed: 7 },
        { label: 'Jul 14', name: 'Web Banking', timestamp: '2026-07-14T02:15:00Z', pages: 7, analyzed: 5, incomplete: true },
        { label: 'Undated', name: null, timestamp: null, pages: 1, analyzed: 1 },
    ];

    test('one numbered entry per report, in column order', async () => {
        const { reportsStripHTML } = await load();
        const html = reportsStripHTML(rows);

        assert.match(html, /Reports compared <span class="doc-reports-count num">3<\/span>/);
        const names = [...html.matchAll(/doc-report-name">([^<]*)</g)].map((m) => m[1]);
        assert.deepEqual(names, ['UI-SDK v22.0.0', 'Jul 14', 'Undated']);
        assert.deepEqual([...html.matchAll(/doc-report-n num"[^>]*>(\d+)</g)].map((m) => m[1]), ['1', '2', '3']);
    });

    test('each entry says when it was made and how much it covered', async () => {
        const { reportsStripHTML } = await load();
        const html = reportsStripHTML(rows);

        assert.match(html, /2 Jun 2026 · 7 pages/);
        assert.match(html, /Web Banking · 14 Jul 2026 · 5 of 7 pages/, 'a renamed column keeps the report name');
        assert.ok(!/UI-SDK v22\.0\.0 · /.test(html), 'and a name equal to the label is not repeated');
        assert.match(html, /no date · 1 page</);
    });

    test('a report the trust check doubted is flagged in words, not only by colour', async () => {
        const { reportsStripHTML } = await load();
        const html = reportsStripHTML(rows);
        assert.equal((html.match(/doc-report--warn/g) || []).length, 1);
        assert.match(html, /Did not cover everything asked of it/);
    });

    test('links to the full table only when told where it is', async () => {
        const { reportsStripHTML } = await load();
        assert.match(reportsStripHTML(rows, { sourcesHref: '#cmp-sources' }), /<a class="doc-reports-more" href="#cmp-sources">Full details<\/a>/);
        assert.ok(!/doc-reports-more/.test(reportsStripHTML(rows)));
        assert.equal(reportsStripHTML([]), '');
    });

    test('names are escaped', async () => {
        const { reportsStripHTML } = await load();
        const html = reportsStripHTML([{ label: '<img src=x>', timestamp: null, pages: null }]);
        assert.ok(!html.includes('<img'));
    });
});

describe('comparison document: what the export makes of it', () => {
    // The exporter promotes the masthead's one heading rather than printing the
    // title a second time in the template. Guarded here because the two live in
    // different files and only agree by convention.
    test('the masthead heading is the shape the exporter rewrites', async () => {
        const { mastheadHTML } = await load();
        const html = mastheadHTML(doc([report({ name: 'Web Banking' }), report({ name: 'Web Banking' })]));

        const promoted = html.replace(
            /<h2 class="doc-title">([\s\S]*?)<\/h2>/,
            '<h1 class="doc-title">$1</h1>'
        );

        assert.match(promoted, /<h1 class="doc-title">Web Banking<\/h1>/);
        assert.ok(!promoted.includes('<h2 class="doc-title">'), 'and only the one heading moves');
    });
});

describe('comparison document: opt-in rules', () => {
    const withOptIn = (o, tags) => ({ ...report(o), scans: [{ id: 's', optInRules: tags, canonical: { findings: [] } }] });

    test('a report\'s identity lists the opt-in rules its scans ran, from the scan or its canonical', () => {
        const { reportIdentity } = require('../shared/report-identity.js');
        assert.deepEqual(reportIdentity(withOptIn({}, ['rgaa'])).optInRules, ['rgaa']);
        const fromCanonical = { ...report(), scans: [{ id: 's', canonical: { runOptions: { optInRules: ['RGAA'] } } }] };
        assert.deepEqual(reportIdentity(fromCanonical).optInRules, ['rgaa']);
        assert.deepEqual(reportIdentity(report()).optInRules, []);
    });

    test('the provenance names them and warns when the reports disagree', async () => {
        const { provenanceHTML } = await load();
        const reports = [withOptIn({ runId: 'a', timestamp: '2026-08-01T00:00:00Z' }, null), withOptIn({ runId: 'b', timestamp: '2026-08-02T00:00:00Z' }, ['rgaa'])];
        const d = doc(reports);
        assert.equal(d.optInMismatch, true);
        const rows = reports.map((r, i) => ({ label: `R${i}`, name: 'x', optInRules: [null, ['rgaa']][i] || [] }));
        const html = provenanceHTML(rows, d);
        assert.match(html, /plus RGAA-only rules/);
        assert.match(html, /only one standard requires/);
    });

    test('no warning when every report ran the same ones', async () => {
        const { provenanceHTML } = await load();
        const reports = [withOptIn({ runId: 'a' }, ['rgaa']), withOptIn({ runId: 'b' }, ['rgaa'])];
        const d = doc(reports);
        assert.equal(d.optInMismatch, false);
        assert.doesNotMatch(provenanceHTML([{ label: 'A', name: 'x' }], d), /only one standard requires/);
        assert.equal(doc([report({ runId: 'a' }), report({ runId: 'b' })]).optInMismatch, false);
    });
});

describe('comparison document: engine releases', () => {
    const withEngines = (o, engines) => ({ ...report(o), scans: [{ id: 's', canonical: { findings: [], engines } }] });
    const sa = (version) => ({ id: 'surea11y', name: 'surea11y', version });
    const engineB = (version) => ({ id: 'engine-b', name: 'Engine B', version });

    test('a report\'s identity lists the engine releases its scans ran, once each', () => {
        const { reportIdentity } = require('../shared/report-identity.js');
        const r = { ...report(), scans: [
            { id: 's1', canonical: { engines: [sa('1.10.0'), engineB('4.12.1')] } },
            { id: 's2', canonical: { engines: [sa('1.10.0')] } },
        ] };
        assert.deepEqual(reportIdentity(r).engines, [{ name: 'Engine B', version: '4.12.1' }, { name: 'surea11y', version: '1.10.0' }]);
        assert.deepEqual(reportIdentity(report()).engines, []);
    });

    test('names the engines whose release differs, in column order, and warns', async () => {
        const { provenanceHTML } = await load();
        const reports = [
            withEngines({ runId: 'a' }, [sa('1.9.0'), engineB('4.12.1')]),
            withEngines({ runId: 'b' }, [sa('1.10.0'), engineB('4.12.1')]),
        ];
        const d = doc(reports);
        assert.deepEqual(d.engineChanges, [{ name: 'surea11y', versions: ['1.9.0', '1.10.0'] }]);
        const html = provenanceHTML([{ label: 'A', name: 'x', engines: [{ name: 'surea11y', version: '1.9.0' }] }], d);
        assert.match(html, /different releases of\s+surea11y \(1\.9\.0, 1\.10\.0\)/);
        // surea11y as its brand tag, as the report names it; another engine as text.
        assert.match(html, /class="engine-brand" aria-label="surea11y core 1\.9\.0"/);
        const other = provenanceHTML([{ label: 'A', name: 'x', engines: [{ name: 'Engine B', version: '4.12.1' }] }], d);
        assert.match(other, /<span class="doc-engines">Engine B 4\.12\.1<\/span>/);
    });

    test('no warning for the same releases, a missing version, or an engine only one report ran', () => {
        assert.deepEqual(doc([withEngines({ runId: 'a' }, [sa('1.10.0')]), withEngines({ runId: 'b' }, [sa('1.10.0')])]).engineChanges, []);
        assert.deepEqual(doc([withEngines({ runId: 'a' }, [sa(null)]), withEngines({ runId: 'b' }, [sa('1.10.0')])]).engineChanges, []);
        assert.deepEqual(doc([withEngines({ runId: 'a' }, [sa('1.10.0')]), withEngines({ runId: 'b' }, [sa('1.10.0'), engineB('4.12.1')])]).engineChanges, []);
    });
});

describe('comparison document: reports checked against different standards', () => {
    const targeting = (o, id) => ({ ...report(o), scans: [{ id: 's', conformanceProfile: id ? { id } : null, canonical: { findings: [] } }] });

    test('warns when some reports targeted RGAA and others did not', async () => {
        const { sharedProfilesNoteHTML, provenanceHTML } = await load();
        const d = doc([targeting({ runId: 'a' }, 'rgaa-4.1.2'), targeting({ runId: 'b' }, null)]);
        assert.equal(d.criteriaMismatch, true);
        // Under the headline, once.
        assert.match(sharedProfilesNoteHTML(d), /checked against different standards or WCAG levels \(rgaa-4\.1\.2, WCAG\), which share none/);
        assert.doesNotMatch(provenanceHTML([{ label: 'A', name: 'x' }], d), /different standards/);
    });

    test('warns for EN 301 549 or any pack\'s standard against WCAG, or against another standard', () => {
        assert.equal(doc([targeting({ runId: 'a' }, 'en301549-v4.1.1'), targeting({ runId: 'b' }, 'wcag22-aa')]).criteriaMismatch, true);
        assert.equal(doc([targeting({ runId: 'a' }, 'sample-1.0'), targeting({ runId: 'b' }, 'en301549-v4.1.1')]).criteriaMismatch, true);
        assert.equal(doc([targeting({ runId: 'a' }, 'en301549-v4.1.1'), targeting({ runId: 'b' }, 'en301549-v4.1.1')]).criteriaMismatch, false);
        assert.deepEqual(doc([targeting({ runId: 'a' }, 'sample-1.0'), targeting({ runId: 'b' }, null)]).standardsCompared, ['sample-1.0', 'WCAG']);
    });

    test('reads the target from the canonical result too, and says nothing when all agree', () => {
        const { reportIdentity } = require('../shared/report-identity.js');
        const fromCanonical = { ...report(), scans: [{ id: 's', canonical: { runOptions: { conformanceProfile: { id: 'rgaa-4.1.2' } } } }] };
        assert.equal(reportIdentity(fromCanonical).rgaaTarget, true);
        assert.equal(doc([targeting({ runId: 'a' }, 'rgaa-4.1.2'), targeting({ runId: 'b' }, 'rgaa-4.1.2')]).criteriaMismatch, false);
        assert.equal(doc([targeting({ runId: 'a' }, 'wcag22-aa'), targeting({ runId: 'b' }, null)]).criteriaMismatch, false);
    });
});

describe('comparison document: reports compared on the profiles they share', () => {
    test('says under the headline what they were compared on, and what was left out', async () => {
        const { sharedProfilesNoteHTML, provenanceHTML } = await load();
        const d = { ...doc([report({ runId: 'a' }), report({ runId: 'b' })]),
            profiles: { comparedOn: [{ id: 'wcag22-aa', label: 'WCAG 2.2 AA' }], leftOut: [{ id: 'wai-aria-1.2', label: 'WAI-ARIA 1.2' }] } };
        const html = sharedProfilesNoteHTML(d);
        assert.match(html, /Compared on WCAG 2\.2 AA, which every report checked\. Left out, as not every report checked it: WAI-ARIA 1\.2\./);
        assert.match(html, /own score is left out too/);
        assert.match(html, /dash-caveat--info/);
        // Said once, there, not again in what went into the comparison.
        assert.doesNotMatch(provenanceHTML([{ label: 'A', name: 'x' }], d), /Compared on/);
        assert.equal(sharedProfilesNoteHTML(doc([report({ runId: 'a' }), report({ runId: 'b' })])), '');
    });
});
