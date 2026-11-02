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
    // the author, as each version numbers and names them (V4.1.1 renumbered
    // chapter 12). The EN 301 549 pack gives the same, with how to assess
    // each.
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
    const DOCUMENTATION = {
        'V3.2.1': [
            ['12.1.1', 'Accessibility and compatibility features'],
            ['12.1.2', 'Accessible documentation'],
            ['12.2.2', 'Information on accessibility and compatibility features'],
            ['12.2.3', 'Effective communication'],
            ['12.2.4', 'Accessible documentation'],
        ],
        'V4.1.1': [
            ['12.1', 'Accessible information about products'],
            ['12.2', 'Accessible information about services'],
            ['12.3', 'Accessibility and compatibility features'],
            ['12.4', 'Electronic program guides'],
            ['12.5', 'Electronic program guide display'],
        ],
    };
    // Chapter 9's own requirements, beyond the WCAG criteria its clauses
    // restate: 9.6, WCAG's conformance requirements, and, from V4.1.1, 9.7.
    const CHAPTER9_OWN = {
        'V3.2.1': [['9.6', 'WCAG conformance requirements']],
        'V4.1.1': [['9.6', 'WCAG conformance requirements'], ['9.7', 'User preferences for web pages']],
    };
    // Chapter 12's title, which V4.1.1 changed with its numbering.
    const CHAPTER12_TITLE = {
        'V3.2.1': 'Chapter 12: Documentation and Support Services',
        'V4.1.1': 'Chapter 12: Information about Products and Services',
    };
    // The chapters a web product's report usually answers in one line.
    const OTHER_CHAPTERS = {
        'V3.2.1': [
            ['5', 'Generic requirements'],
            ['6', 'ICT with two-way voice communication'],
            ['7', 'ICT with video capabilities'],
            ['8', 'Hardware'],
            ['10', 'Non-web documents'],
            ['11', 'Software'],
            ['13', 'ICT providing relay or emergency service access'],
        ],
        'V4.1.1': [
            ['5', 'Generic requirements'],
            ['6', 'ICT supporting real-time bidirectional communication'],
            ['7', 'ICT with video capabilities'],
            ['8', 'Hardware'],
            ['10', 'Non-web documents'],
            ['11', 'Non-web software'],
            ['13', 'ICT providing relay or emergency service access'],
        ],
    };

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
    // A finding's WCAG criteria: its own, or under a standard's profile, whose
    // results name the standard's requirement in place of WCAG's, the criteria
    // that requirement restates (its mappings' `wcagSc`).
    function wcagScOf(f) {
        const own = asArray(f.wcag && (asArray(f.wcag.scNormative).length ? f.wcag.scNormative : f.wcag.sc));
        if (own.length) return own;
        const out = [];
        for (const m of asArray(f.standards && f.standards.normativeMappings)) {
            if (m && m.standard !== 'WCAG') out.push(...asArray(m.wcagSc));
        }
        for (const e of asArray(f.en301549)) out.push(...asArray(e && e.wcagSc));
        return [...new Set(out.map(String))];
    }

    function scanEvidence(report, requirementsOf = wcagScOf) {
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
                for (const sc of requirementsOf(f)) {
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

    const TARGET_LEVELS = ['A', 'AA', 'AAA'];
    const EN301549_PROFILE = /^en301549-v(\d+\.\d+\.\d+)$/i;

    // The WCAG version and level the report's scans came to (each scan's
    // `wcag`, or the fields an older report kept), the highest level of
    // them, and the EN 301 549 version a scan checked against, if one did.
    function scannedTarget(report) {
        let version = null;
        let level = null;
        let en301549 = null;
        for (const s of asArray(report && report.scans)) {
            if (!s || s.skipped || s.skipInfo || s.includedInReport === false) continue;
            const w = s.wcag && typeof s.wcag === 'object' ? s.wcag : { version: s.wcagVersion, level: s.wcagLevel };
            const l = str(w.level).toUpperCase();
            if (TARGET_LEVELS.includes(l) && (!level || TARGET_LEVELS.indexOf(l) > TARGET_LEVELS.indexOf(level))) {
                level = l;
                version = str(w.version) || version;
            } else if (!version && str(w.version)) {
                version = str(w.version);
            }
            const ids = [s.profile, ...asArray(s.profiles)].map((p) => str(p && typeof p === 'object' ? p.id : p));
            const en = ids.map((id) => EN301549_PROFILE.exec(id || '')).find(Boolean);
            if (en && !en301549) en301549 = `V${en[1]}`;
        }
        return { version, level, en301549 };
    }

    function targetOf(report, review, options) {
        const given = (options && options.target) || (review && review.target) || {};
        // What the scans checked against, unless the options or the review
        // say otherwise.
        const fromReport = scannedTarget(report);
        const wcagVersion = str(given.wcagVersion) || fromReport.version || '2.2';
        const level = (str(given.level) || fromReport.level || 'AA').toUpperCase();
        const en301549 = str(given.en301549) || fromReport.en301549
            || (wcagVersion === '2.1' || wcagVersion === '2.0' ? 'V3.2.1' : 'V4.1.1');
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
            m.checks ? `Manual checks following the test procedures of ${name || 'surea11y core'}: ${m.checks} check${m.checks === 1 ? '' : 's'} answered, on `
                + [
                    m.criteria ? `${m.criteria} WCAG criteri${m.criteria === 1 ? 'on' : 'a'}` : '',
                    m.enRequirements ? `${m.enRequirements} EN 301 549 requirement${m.enRequirements === 1 ? '' : 's'} of its own` : '',
                ].filter(Boolean).join(' and ')
                + ', each listed under its row.' : '',
            str(review && review.methods),
        ].filter(Boolean).join(' ');
    }

    // ---- Standards from their packs -----------------------------------------
    //
    // What a standard's pack lists, by version: its requirements (id, title,
    // and `wcag` where one restates a WCAG criterion) in its groups, as core's
    // listProcedures gives them, and the profiles that scan against it. The
    // app registers what the server's packs give, the runner what its own do;
    // with none registered, EN 301 549's rows are the lists above, and no
    // other standard has any.
    const STANDARDS = new Map(); // `${key}|${version}` -> standard

    function flattenGroup(group) {
        return [...asArray(group && group.requirements).map(String), ...asArray(group && group.groups).flatMap(flattenGroup)];
    }

    /**
     * Registers a standard's version from its listing: { key, standard (its
     * name), version, requirements: [{ id, title, wcag? }], groups: [{ id,
     * title, requirements, groups }] }, with `profiles`, the ids of the
     * profiles that scan against it. Returns whether it was taken.
     */
    function registerStandard(listing, { profiles = [] } = {}) {
        if (!listing || typeof listing !== 'object' || !str(listing.key) || !str(listing.version)) return false;
        const requirements = asArray(listing.requirements)
            .filter((r) => r && str(r.id))
            .map((r) => ({ id: str(r.id), title: str(r.title), wcag: str(r.wcag) || null }));
        const groups = asArray(listing.groups).filter((g) => g && str(g.id))
            .map((g) => ({ id: str(g.id), title: str(g.title), ids: flattenGroup(g) }));
        STANDARDS.set(`${str(listing.key)}|${str(listing.version)}`, {
            key: str(listing.key),
            name: str(listing.standard) || str(listing.key),
            version: str(listing.version),
            profiles: asArray(profiles).map(String),
            requirements,
            groups,
        });
        return true;
    }

    /** Forgets every registered standard (for tests). */
    function clearStandards() {
        STANDARDS.clear();
    }

    function standardOf(key, version) {
        return STANDARDS.get(`${key}|${version}`) || null;
    }

    // EN 301 549's own rows, from its listing when registered: chapter 4,
    // chapter 9's own requirements, chapter 12, and the other chapters.
    function en301549Own(version) {
        const listed = standardOf('en301549', version);
        const fallback = {
            chapter4: FUNCTIONAL_PERFORMANCE,
            chapter9: CHAPTER9_OWN[version] || CHAPTER9_OWN['V4.1.1'],
            chapter12: DOCUMENTATION[version] || DOCUMENTATION['V4.1.1'],
            other: OTHER_CHAPTERS[version] || OTHER_CHAPTERS['V4.1.1'],
        };
        if (!listed) return fallback;
        const byId = new Map(listed.requirements.map((r) => [r.id, r]));
        const own = (ids) => ids.map((id) => byId.get(id)).filter((r) => r && !r.wcag).map((r) => [r.id, r.title]);
        const group = (id) => listed.groups.find((g) => g.id === id);
        const in4 = own(group('4') ? group('4').ids : []);
        const in9 = own(group('9') ? group('9').ids : []);
        const in12 = own(group('12') ? group('12').ids : []);
        const other = own(listed.groups.filter((g) => !['4', '9', '12'].includes(g.id)).flatMap((g) => g.ids));
        // A listing without one of these parts keeps the lab's own for it.
        return {
            chapter4: in4.length ? in4 : fallback.chapter4,
            chapter9: group('9') ? in9 : fallback.chapter9,
            chapter12: in12.length ? in12 : fallback.chapter12,
            other: other.length ? other : fallback.other,
        };
    }

    // The registered standards, besides EN 301 549 (which the report always
    // has), that the report's scans checked against: each with the version
    // of the profile a scan used.
    function standardsScanned(report) {
        const out = [];
        const used = new Set(asArray(report && report.scans)
            .filter((sc) => sc && sc.includedInReport !== false)
            // Every profile of a scan of several.
            .flatMap((sc) => [
                str(sc.profile && (sc.profile.id || sc.profile)) || str(sc.canonical && sc.canonical.runOptions && sc.canonical.runOptions.engineOptions && sc.canonical.runOptions.engineOptions.profile),
                ...asArray(sc.profiles).map((p) => str(p && p.id)),
            ])
            .filter(Boolean));
        for (const std of STANDARDS.values()) {
            if (std.key === 'en301549') continue;
            if (std.profiles.some((id) => used.has(id)) && !out.includes(std)) out.push(std);
        }
        return out;
    }

    // A registered standard's review tables: a table per group, a row per
    // requirement of its own (one that restates a WCAG criterion is reviewed
    // as that criterion), each drafted from what the scans found for it.
    function standardTables(report, std, reviewedOf) {
        const evidence = scanEvidence(report, (f) => asArray(f.standards && f.standards.normativeMappings)
            .filter((m) => m && m.standard === std.name && (!m.version || String(m.version) === std.version))
            .map((m) => String(m.requirement)));
        const byId = new Map(std.requirements.map((r) => [r.id, r]));
        // A requirement's title where its listing has none: as the scans'
        // findings name it.
        const named = new Map();
        for (const scan of asArray(report && report.scans)) {
            for (const f of asArray(scan && scan.canonical && scan.canonical.findings)) {
                for (const m of asArray(f && f.standards && f.standards.normativeMappings)) {
                    if (m && m.standard === std.name && str(m.title) && !named.has(String(m.requirement))) named.set(String(m.requirement), str(m.title));
                }
            }
        }
        const seen = new Set();
        const tables = [];
        const tableOf = (id, title, ids) => {
            const rows = ids.map((rid) => byId.get(rid)).filter((r) => r && !r.wcag && !seen.has(r.id)).map((r) => {
                seen.add(r.id);
                return row({ id: r.id, name: r.title || named.get(r.id) || `Requirement ${r.id}` }, draftFor(null, evidence.get(r.id)), reviewedOf(r.id));
            });
            if (rows.length) tables.push({ id: `std-${std.key}-${id}`.replace(/[^A-Za-z0-9_-]/g, '-'), title: `${std.name} ${std.version}: ${title}`, standard: std.key, version: std.version, rows });
        };
        for (const g of std.groups) tableOf(g.id, g.title || g.id, g.ids);
        tableOf('other', 'Other requirements', std.requirements.map((r) => r.id));
        return tables;
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

        const enOwn = en301549Own(target.en301549);
        const enTables = [
            { id: 'en-4', title: 'Chapter 4: Functional Performance Statements', standard: 'en301549', rows: enOwn.chapter4.map(authorRow) },
            { id: 'en-9', title: 'Chapter 9: Web', standard: 'en301549', rows: [...chapter9, ...enOwn.chapter9.map(authorRow)] },
            { id: 'en-12', title: CHAPTER12_TITLE[target.en301549] || CHAPTER12_TITLE['V4.1.1'], standard: 'en301549', rows: enOwn.chapter12.map(authorRow) },
            { id: 'en-other', title: 'Chapters 5 to 8, 10, 11 and 13', standard: 'en301549', rows: enOwn.other.map(([id, name]) => row({ id, name: `Chapter ${id}: ${name}` }, { conformance: 'notEvaluated', remarks: 'For the author to answer: often Not Applicable for web content.' }, reviewedClauses[`chapter-${id}`])) },
        ];

        const reviewedStandards = (review && review.standards) || {};
        const otherTables = standardsScanned(report).flatMap((std) => standardTables(report, std,
            (id) => reviewedStandards[std.key] && reviewedStandards[std.key][std.version] && reviewedStandards[std.key][std.version][id]));

        const product = (review && review.product) || {};
        const rows = [...wcagRows, ...enTables.flatMap((t) => t.rows)];
        const engine = engineOf(report);
        // Chapter 9's clauses are the WCAG criteria's rows, so they are not
        // counted twice; its own requirements (9.6, 9.7) are.
        const enOwnRows = enTables.flatMap((t) => t.rows).filter((r) => !r.wcag);
        const manualChecks = {
            checks: [...wcagRows, ...enOwnRows].reduce((n, r) => n + r.checks.length, 0),
            criteria: wcagRows.filter((r) => r.checks.length).length,
            enRequirements: enOwnRows.filter((r) => r.checks.length).length,
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
            // Other standards the scans checked against follow, for the
            // review and the checklist; the VPAT's outputs show WCAG's and EN
            // 301 549's alone.
            tables: [...wcagTables, ...enTables, ...otherTables],
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
        // Other standards' verdicts, by standard and version, the same way.
        for (const [std, versions] of Object.entries(other.standards && typeof other.standards === 'object' ? other.standards : {})) {
            for (const [version, entries] of Object.entries(versions && typeof versions === 'object' ? versions : {})) {
                for (const [key, entry] of Object.entries(entries && typeof entries === 'object' ? entries : {})) {
                    if (!entry || !entry.conformance) continue;
                    review.standards = review.standards && typeof review.standards === 'object' ? review.standards : {};
                    review.standards[std] = review.standards[std] || {};
                    review.standards[std][version] = review.standards[std][version] || {};
                    const own = review.standards[std][version][key];
                    if (own && own.conformance) continue;
                    const merged = { ...entry };
                    if (own && str(own.remarks)) merged.remarks = own.remarks;
                    if (own && own.facets) merged.facets = { ...(entry.facets || {}), ...own.facets };
                    review.standards[std][version][key] = merged;
                    copied += 1;
                }
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

    return { buildConformanceReport, carryReviewForward, registerStandard, clearStandards, LEVELS, LEVEL_LABEL, EN_VERSIONS };
});
