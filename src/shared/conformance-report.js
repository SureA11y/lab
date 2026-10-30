'use strict';

// An Accessibility Conformance Report (ACR) in the layout of the ITI VPAT 2.5,
// WCAG and EU edition, built from a report (docs/design/conformance-report-design.md).
//
// The report's runs give a draft; a reviewer's verdicts (the report's
// `conformanceReview`) take its place criterion by criterion. The draft never
// claims more than the scans show: a failure on some page makes "Does Not
// Support", nothing to apply to on any page "Not Applicable", and everything
// else "Not Evaluated", with what the scans found in the remarks. "Supports"
// and "Partially Supports" are a person's verdicts: automated checks test
// only part of what a criterion asks.
//
// Browser: globalThis.A11Y_CONFORMANCE_REPORT. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./wcag-criteria.js'), require('./report-conformance.js'));
    } else {
        root.A11Y_CONFORMANCE_REPORT = factory(root.A11Y_WCAG_CRITERIA, root.A11Y_REPORT_CONFORMANCE);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (wcag, reportConformance) {
    // The VPAT's terms, in its order.
    const LEVELS = [
        { id: 'supports', label: 'Supports' },
        { id: 'partiallySupports', label: 'Partially Supports' },
        { id: 'doesNotSupport', label: 'Does Not Support' },
        { id: 'notApplicable', label: 'Not Applicable' },
        { id: 'notEvaluated', label: 'Not Evaluated' },
    ];
    const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.id, l.label]));

    // EN 301 549 versions and the WCAG version their chapter 9 restates.
    const EN_VERSIONS = { 'V3.2.1': '2.1', 'V4.1.1': '2.2' };

    // Chapter 4, functional performance statements, and chapter 12,
    // documentation and support services: what no scan can judge, listed for
    // the author. Numbered as in EN 301 549 V3.2.1.
    const FUNCTIONAL_PERFORMANCE = [
        ['4.2.1', 'Usage without vision'],
        ['4.2.2', 'Usage with limited vision'],
        ['4.2.3', 'Usage without perception of colour'],
        ['4.2.4', 'Usage without hearing'],
        ['4.2.5', 'Usage with limited hearing'],
        ['4.2.6', 'Usage with no or limited vocal capability'],
        ['4.2.7', 'Usage with limited manipulation or strength'],
        ['4.2.8', 'Usage with limited reach'],
        ['4.2.9', 'Minimize photosensitive seizure triggers'],
        ['4.2.10', 'Usage with limited cognition, language or learning'],
        ['4.2.11', 'Privacy'],
    ];
    const DOCUMENTATION = [
        ['12.1.1', 'Accessibility and compatibility features'],
        ['12.1.2', 'Accessible documentation'],
        ['12.2.2', 'Information on accessibility and compatibility features'],
        ['12.2.3', 'Effective communication'],
        ['12.2.4', 'Accessible documentation'],
    ];
    // The chapters a web product's report usually answers in one line.
    const OTHER_CHAPTERS = [
        ['5', 'Generic requirements'],
        ['6', 'ICT with two-way voice communication'],
        ['7', 'ICT with video capabilities'],
        ['8', 'Hardware'],
        ['10', 'Non-web documents'],
        ['11', 'Software'],
    ];

    const PERSON_ONLY = 'Only a person can check this.';

    function str(v) { return (typeof v === 'string' && v.trim()) ? v.trim() : ''; }
    function asArray(v) { return Array.isArray(v) ? v : []; }

    function listNames(names) {
        const list = Array.from(new Set(names.filter(Boolean)));
        if (list.length <= 1) return list.join('');
        return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    }

    // What the scans found for each criterion: where it failed (and on how
    // many elements) and where they asked a person to look.
    function scanEvidence(report) {
        const bySc = new Map();
        const at = (sc) => {
            if (!bySc.has(sc)) bySc.set(sc, { failPages: [], failElements: 0, askPages: [], questions: [] });
            return bySc.get(sc);
        };
        for (const scan of asArray(report && report.scans)) {
            if (!scan || scan.includedInReport === false) continue;
            const page = str(scan.label).replace(/^Scan:\s*/, '') || str(scan.url) || 'a page';
            for (const f of asArray(scan.canonical && scan.canonical.findings)) {
                if (!f || (f.outcome !== 'fail' && f.outcome !== 'cantTell')) continue;
                for (const sc of asArray(f.wcag && (f.wcag.scNormative || f.wcag.sc))) {
                    const e = at(String(sc));
                    if (f.outcome === 'fail') {
                        e.failPages.push(page);
                        e.failElements += asArray(f.occurrences).length || 1;
                    } else {
                        e.askPages.push(page);
                        if (str(f.title)) e.questions.push(str(f.title));
                    }
                }
            }
        }
        return bySc;
    }

    // The draft for one criterion: { conformance, remarks }.
    function draftFor(entry, evidence) {
        const e = evidence || { failPages: [], failElements: 0, askPages: [], questions: [] };
        if (e.failPages.length) {
            const n = e.failElements;
            return {
                conformance: 'doesNotSupport',
                remarks: `Automated checks found ${n} failing element${n === 1 ? '' : 's'}, on ${listNames(e.failPages)}.`,
            };
        }
        const status = entry ? entry.status : null;
        if (status === 'notApplicable') {
            return { conformance: 'notApplicable', remarks: 'Nothing on the scanned pages that this applies to: confirm for the rest of the product.' };
        }
        if (e.askPages.length) {
            return { conformance: 'notEvaluated', remarks: `Automated checks need a person to confirm this on ${listNames(e.askPages)}.` };
        }
        if (status === 'supports' || status === 'needsReview' || status === 'partiallySupports') {
            return { conformance: 'notEvaluated', remarks: 'Automated checks found no failure; they check only part of this criterion.' };
        }
        return { conformance: 'notEvaluated', remarks: PERSON_ONLY };
    }

    // A person's answer to a check, in the report's words.
    const RESULT_LABEL = { pass: 'Passes', fail: 'Fails', na: "Doesn't apply" };

    // The checks a person answered for a row, kept with the review as
    // { [facet]: { result, label } }: [{ id, label, result, resultLabel }].
    function checksOf(reviewed) {
        const facets = reviewed && typeof reviewed === 'object' && reviewed.facets && typeof reviewed.facets === 'object' ? reviewed.facets : {};
        return Object.entries(facets)
            .map(([id, v]) => {
                const result = typeof v === 'string' ? v : (v && v.result);
                return RESULT_LABEL[result] ? { id, label: str(v && v.label) || id, result, resultLabel: RESULT_LABEL[result] } : null;
            })
            .filter(Boolean);
    }

    // A row as the table shows it: the reviewer's verdict where there is one,
    // else the draft. `source` says which; `checks`, what a person checked.
    function row(base, draft, reviewed) {
        const r = reviewed && typeof reviewed === 'object' && LEVEL_LABEL[reviewed.conformance] ? reviewed : null;
        return {
            ...base,
            checks: checksOf(reviewed),
            conformance: r ? r.conformance : draft.conformance,
            conformanceLabel: LEVEL_LABEL[r ? r.conformance : draft.conformance],
            remarks: r ? str(r.remarks) : draft.remarks,
            source: r ? 'review' : 'draft',
            draft,
        };
    }

    function targetOf(report, review, options) {
        const given = (options && options.target) || (review && review.target) || {};
        const fromReport = reportConformance && reportConformance.readConformance
            ? (reportConformance.readConformance(report).target || null) : null;
        const wcagVersion = str(given.wcagVersion) || str(fromReport && fromReport.version) || '2.2';
        const level = (str(given.level) || str(fromReport && fromReport.level) || 'AA').toUpperCase();
        const en301549 = str(given.en301549) || (wcagVersion === '2.1' || wcagVersion === '2.0' ? 'V3.2.1' : 'V4.1.1');
        return { wcagVersion, level, en301549 };
    }

    function evaluatedPages(report) {
        return asArray(report && report.scans)
            .filter((s) => s && s.includedInReport !== false)
            .map((s) => ({ label: str(s.label).replace(/^Scan:\s*/, ''), url: str(s.url) }));
    }

    function engineOf(report) {
        for (const s of asArray(report && report.scans)) {
            const e = asArray(s && s.canonical && s.canonical.engines)[0];
            if (e) return { name: str(e.name) || str(e.id), version: str(e.version) || null };
        }
        return null;
    }

    // The evaluation methods as the report states them: the automated checks,
    // the manual review and the checks it answered, then the reviewer's own
    // words.
    function methodsText(engine, target, review, manualChecks) {
        const name = engine ? `${engine.name}${engine.version ? ` ${engine.version}` : ''}` : '';
        const m = manualChecks;
        return [
            name ? `Automated checks with ${name} against WCAG ${target.wcagVersion} Level ${target.level}.` : '',
            str(review && review.reviewer) ? `Manual review by ${str(review.reviewer)}.` : '',
            m.checks ? `Manual checks following the test procedures of ${name || 'surea11y core'}: ${m.checks} check${m.checks === 1 ? '' : 's'} answered, on ${m.criteria} criteri${m.criteria === 1 ? 'on' : 'a'}, each listed under its criterion.` : '',
            str(review && review.methods),
        ].filter(Boolean).join(' ');
    }

    /**
     * The ACR for a report: product details, how it was evaluated, and its
     * tables, each row the reviewer's verdict where there is one, else the
     * draft.
     *
     * @param {object} report a parsed report payload
     * @param {{ review?: object, target?: { wcagVersion?: string, level?: string, en301549?: string } }} [options]
     *   `review` defaults to the report's own `conformanceReview`.
     */
    function buildConformanceReport(report, options = {}) {
        const review = options.review !== undefined ? options.review : (report && report.conformanceReview) || null;
        const target = targetOf(report, review, options);
        const conformance = reportConformance && reportConformance.readConformance
            ? reportConformance.readConformance(report) : { criteria: [] };
        const statusBySc = new Map(conformance.criteria.map((c) => [c.sc, c]));
        const evidence = scanEvidence(report);
        const reviewed = (review && review.criteria) || {};
        const reviewedClauses = (review && review.clauses) || {};

        const scope = wcag.criteriaForScope({ level: target.level, version: target.wcagVersion });
        const wcagRows = scope.map((c) => row(
            { id: c.sc, name: c.title, level: c.level },
            draftFor(statusBySc.get(c.sc), evidence.get(c.sc)),
            reviewed[c.sc],
        ));

        const wcagTables = ['A', 'AA', 'AAA']
            .filter((level) => wcagRows.some((r) => r.level === level))
            .map((level, i) => ({
                id: `wcag-${level.toLowerCase()}`,
                title: `Table ${i + 1}: Success Criteria, Level ${level}`,
                standard: 'wcag',
                rows: wcagRows.filter((r) => r.level === level),
            }));

        // Chapter 9 restates the WCAG criteria of its version at A and AA:
        // 9.1.4.3 is 1.4.3, with the same verdict.
        const enWcag = wcag.criteriaForScope({ level: 'AA', version: EN_VERSIONS[target.en301549] || '2.2' });
        const byId = new Map(wcagRows.map((r) => [r.id, r]));
        const chapter9 = enWcag.map((c) => {
            const same = byId.get(c.sc) || row(
                { id: c.sc, name: c.title, level: c.level },
                draftFor(statusBySc.get(c.sc), evidence.get(c.sc)),
                reviewed[c.sc],
            );
            return { ...same, id: `9.${c.sc}`, name: c.title, wcag: c.sc };
        });

        const authorRow = ([id, name]) => row({ id, name }, { conformance: 'notEvaluated', remarks: PERSON_ONLY }, reviewedClauses[id]);

        const enTables = [
            { id: 'en-4', title: 'Chapter 4: Functional Performance Statements', standard: 'en301549', rows: FUNCTIONAL_PERFORMANCE.map(authorRow) },
            { id: 'en-9', title: 'Chapter 9: Web', standard: 'en301549', rows: chapter9 },
            { id: 'en-12', title: 'Chapter 12: Documentation and Support Services', standard: 'en301549', rows: DOCUMENTATION.map(authorRow) },
            { id: 'en-other', title: 'Chapters 5 to 8, 10 and 11', standard: 'en301549', rows: OTHER_CHAPTERS.map(([id, name]) => row({ id, name: `Chapter ${id}: ${name}` }, { conformance: 'notEvaluated', remarks: 'For the author to answer: often Not Applicable for web content.' }, reviewedClauses[`chapter-${id}`])) },
        ];

        const product = (review && review.product) || {};
        const rows = [...wcagRows, ...enTables.flatMap((t) => t.rows)];
        const engine = engineOf(report);
        const manualChecks = {
            checks: wcagRows.reduce((n, r) => n + r.checks.length, 0),
            criteria: wcagRows.filter((r) => r.checks.length).length,
        };
        return {
            product: {
                name: str(product.name) || str(report && (report.scenarioName || report.name)) || 'Untitled product',
                version: str(product.version),
                description: str(product.description),
                contact: str(product.contact),
                notes: str(product.notes),
                date: str(product.date) || str(report && report.timestamp).slice(0, 10),
            },
            evaluation: {
                engine,
                pages: evaluatedPages(report),
                reviewer: str(review && review.reviewer),
                methods: str(review && review.methods),
                // How many checks a person answered, on how many criteria.
                manualChecks,
                methodsText: methodsText(engine, target, review, manualChecks),
            },
            target,
            tables: [...wcagTables, ...enTables],
            totals: {
                reviewed: wcagRows.filter((r) => r.source === 'review').length,
                criteria: wcagRows.length,
                byLevel: Object.fromEntries(LEVELS.map((l) => [l.id, wcagRows.filter((r) => r.conformance === l.id).length])),
                draftsLeft: rows.filter((r) => r.source === 'draft').length,
            },
        };
    }

    /**
     * Copies into `review` what `other` decided and `review` has not: an
     * earlier report's verdicts under a later run's draft, this report's own
     * kept. Fills `review`'s missing parts first. Returns how many verdicts it
     * copied.
     */
    function carryReviewForward(review, other) {
        if (!review || !other || typeof other !== 'object') return 0;
        for (const part of ['product', 'criteria', 'clauses']) {
            if (!review[part] || typeof review[part] !== 'object') review[part] = {};
        }
        let copied = 0;
        for (const part of ['criteria', 'clauses']) {
            for (const [key, entry] of Object.entries(other[part] || {})) {
                const own = review[part][key];
                if (!entry || !entry.conformance || (own && own.conformance)) continue;
                // A row with only answers to its checks, or remarks, so far
                // takes the verdict and keeps what it had.
                const merged = { ...entry };
                if (own && str(own.remarks)) merged.remarks = own.remarks;
                if (own && own.facets) merged.facets = { ...(entry.facets || {}), ...own.facets };
                review[part][key] = merged;
                copied += 1;
            }
        }
        for (const [key, value] of Object.entries(other.product || {})) {
            if (value && !review.product[key]) review.product[key] = value;
        }
        for (const key of ['reviewer', 'methods']) {
            if (other[key] && !review[key]) review[key] = other[key];
        }
        return copied;
    }

    return { buildConformanceReport, carryReviewForward, LEVELS, LEVEL_LABEL, EN_VERSIONS };
});
