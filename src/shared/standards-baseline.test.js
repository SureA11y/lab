'use strict';

// What the lab gives for WCAG and EN 301 549, recorded before the standards
// it knows came from the installed packs rather than from lists of its own,
// and held to since: the conformance report's model, HTML and Word, the
// review's tables, the scan targets and the scan step's profiles. A
// difference is a change in what a user gets, so it is a bug unless it is
// meant; never a reason to record again. Recording writes only where no
// record is:
//   A11Y_RECORD_BASELINE=1 node --test src/shared/standards-baseline.test.js
// The procedures themselves are core's and the packs': whatever they say,
// add or remove, the lab shows when its dependencies are updated, so nothing
// here holds their content.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const { buildConformanceReport, registerStandard, clearStandards } = require('./conformance-report.js');
const { conformanceReportHTML } = require('./conformance-report-html.js');
const { conformanceReportDocx } = require('./conformance-report-docx.js');
const targets = require('./conformance-targets.js');
const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');

const RECORD = path.join(__dirname, 'fixtures', 'standards-baseline.json');

// Long texts are kept as a hash: the record says whether they changed, the
// readable parts (the model, the review's rows, the targets) say where.
const hash = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

function finding(sc, outcome, elements = 1) {
    return {
        ruleId: `wcag-${sc}`, title: `Rule for ${sc}`, outcome,
        wcag: { sc: [sc], scNormative: [sc] },
        occurrences: Array.from({ length: elements }, (_, i) => ({ target: [`#e${i}`] })),
    };
}

const REPORT = {
    scenarioName: 'Shop',
    timestamp: '2026-10-30T09:00:00Z',
    scans: [{
        label: 'Scan: Home', url: 'https://shop.test/',
        canonical: { findings: [finding('1.1.1', 'fail', 2), finding('2.4.7', 'cantTell')], engines: [{ id: 'surea11y', name: 'surea11y', version: '1.14.1' }] },
        metrics: { coverageSummary: { criteria: [{ sc: '1.1.1', status: 'doesNotSupport' }, { sc: '1.2.1', status: 'notApplicable' }, { sc: '2.4.7', status: 'needsReview' }] } },
    }],
    conformanceReview: {
        reviewer: 'Ana',
        product: { name: 'Shop', version: '2' },
        criteria: { '2.4.7': { conformance: 'partiallySupports', remarks: 'Mine.', facets: { 'focus-visible': { result: 'fail', label: 'Focus is visible' } } } },
        clauses: {
            '4.2.1': { conformance: 'supports', facets: { tasks: { result: 'pass', label: 'Tasks with a screen reader' } } },
            '9.6': { remarks: 'Conformance requirements, checked.' },
            '12.1.1': { conformance: 'notApplicable' },
            '12.1': { conformance: 'supports' },
            'chapter-11': { conformance: 'notApplicable', facets: { applies: { result: 'na', label: 'Software' } } },
        },
    },
};

const TARGETS = {
    default: undefined,
    'v3.2.1': { wcagVersion: '2.1', level: 'AA', en301549: 'V3.2.1' },
    aaa: { wcagVersion: '2.2', level: 'AAA', en301549: 'V4.1.1' },
};

async function wordXml(acr) {
    const zip = await JSZip.loadAsync(await conformanceReportDocx(acr, JSZip, { type: 'nodebuffer', generatedAt: '2026-10-30' }));
    return zip.file('word/document.xml').async('string');
}

async function current() {
    const { reviewTables } = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'conformance-review.js')).href);
    const out = { vpat: {}, review: {} };
    for (const [name, target] of Object.entries(TARGETS)) {
        const acr = buildConformanceReport(REPORT, target ? { target } : {});
        out.vpat[name] = { model: JSON.parse(JSON.stringify(acr)), html: hash(conformanceReportHTML(acr, { generatedAt: '2026-10-30' })), word: hash(await wordXml(acr)) };
        out.review[name] = reviewTables(acr).map((t) => ({ id: t.id, title: t.title, rows: t.rows.map((r) => [r.id, r.name]) }));
    }
    out.targets = { scan: targets.SCAN_TARGETS, conformance: targets.CONFORMANCE_TARGETS };
    const scan = ACTION_DEFINITIONS.a11yScan || Object.values(ACTION_DEFINITIONS).find((d) => d && d.fields && d.fields.profile);
    out.profileOptions = scan.fields.profile.options;
    return JSON.parse(JSON.stringify(out));
}

test('WCAG and EN 301 549 give what they gave when recorded', async (t) => {
    const now = await current();
    if (!fs.existsSync(RECORD)) {
        if (!process.env.A11Y_RECORD_BASELINE) return t.skip('no record yet');
        fs.writeFileSync(RECORD, JSON.stringify(now, null, 1) + '\n');
        return;
    }
    const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    for (const part of ['vpat', 'review', 'targets', 'profileOptions']) assert.deepEqual(now[part], record[part], part);
});

// The listing as the app reads it (/api/standards): core's, with the lab's
// procedures for what no rule evaluates, EN 301 549's own requirements among
// them (src/server-side/lab-procedures.js).
test('built from its pack\'s listing, EN 301 549\'s own rows are what the pack lists, and the rest is as recorded', async (t) => {
    const core = require('../server-side/lab-procedures.js').withLabProcedures(require('@surea11y/core'));
    const pack = (() => { try { return require('@surea11y/pack-en301549'); } catch { return null; } })();
    if (typeof core.listProcedures !== 'function' || !pack || !fs.existsSync(RECORD)) return t.skip('needs a core that lists procedures, the pack, and the record');
    const listings = {};
    for (const version of ['V3.2.1', 'V4.1.1']) {
        const listing = core.listProcedures({ packs: [pack], standard: 'en301549', version });
        if (!listing) return t.skip(`the pack lists no ${version}`);
        listings[version] = listing;
        registerStandard(listing, { profiles: [`en301549-v${version.slice(1).toLowerCase()}`] });
    }
    try {
        const now = await current();
        const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
        const OWN = ['en-4', 'en-9', 'en-12', 'en-other'];
        for (const [name, target] of Object.entries(TARGETS)) {
            const acr = buildConformanceReport(REPORT, target ? { target } : {});
            // WCAG's rows are the lab's own, as recorded.
            assert.deepEqual(now.vpat[name].model.tables.filter((tb) => !OWN.includes(tb.id)), record.vpat[name].model.tables.filter((tb) => !OWN.includes(tb.id)), `${name}: WCAG`);
            // EN 301 549's own: every requirement the pack lists that restates no WCAG criterion, once each.
            const listed = listings[acr.target.en301549].requirements.filter((r) => !r.wcag).map((r) => String(r.id)).sort();
            const shown = acr.tables.filter((tb) => OWN.includes(tb.id)).flatMap((tb) => tb.rows.filter((r) => !r.wcag).map((r) => String(r.id))).sort();
            assert.deepEqual(shown, listed, `${name}: EN 301 549's own requirements`);
        }
    } finally {
        clearStandards();
    }
});
