'use strict';

// What the lab gives for WCAG and EN 301 549, recorded before the standards
// it knows came from the installed packs rather than from lists of its own,
// and held to since: the conformance report's model, HTML and Word, the
// review's tables, the manual review checklist, the procedures the server
// gives, the scan targets and the scan step's profiles. A difference is a
// change in what a user gets, so it is a bug unless it is meant; never a
// reason to record again. Recording writes only where no record is:
//   A11Y_RECORD_BASELINE=1 node --test src/shared/standards-baseline.test.js
// The parts that need test procedures are recorded and compared only with a
// core and an EN 301 549 pack that have them.

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
const { proceduresForRequirements } = require('../server-side/procedures.js');

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

function hasProcedures() {
    const out = proceduresForRequirements('9.6', { standard: 'en301549', version: 'V4.1.1' });
    return !!(out.available && out.procedures['9.6'] && typeof require('@surea11y/core').listProcedures === 'function');
}

async function current({ withProcedures }) {
    const { reviewTables } = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'conformance-review.js')).href);
    const { buildManualChecklistHTML } = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'manual-checklist.js')).href);
    const out = { vpat: {}, review: {}, procedures: {}, checklist: {} };
    for (const [name, target] of Object.entries(TARGETS)) {
        const acr = buildConformanceReport(REPORT, target ? { target } : {});
        out.vpat[name] = { model: JSON.parse(JSON.stringify(acr)), html: hash(conformanceReportHTML(acr, { generatedAt: '2026-10-30' })), word: hash(await wordXml(acr)) };
        out.review[name] = reviewTables(acr).map((t) => ({ id: t.id, title: t.title, rows: t.rows.map((r) => [r.id, r.name]) }));
        if (!withProcedures) continue;
        const wcagIds = acr.tables.filter((t) => /^wcag-/.test(t.id)).flatMap((t) => t.rows.map((r) => r.id));
        const enIds = acr.tables.filter((t) => /^en-/.test(t.id)).flatMap((t) => t.rows.filter((r) => !r.wcag).map((r) => r.id));
        const procedures = proceduresForRequirements(wcagIds).procedures;
        const enProcedures = proceduresForRequirements(enIds, { standard: 'en301549', version: acr.target.en301549 }).procedures;
        out.procedures[name] = {
            wcag: Object.fromEntries(Object.entries(procedures).map(([id, p]) => [id, hash(p)])),
            en: Object.fromEntries(Object.entries(enProcedures).map(([id, p]) => [id, hash(p)])),
        };
        out.checklist[name] = hash(buildManualChecklistHTML({ acr, procedures, enProcedures, review: REPORT.conformanceReview, levelLabels: { supports: 'Supports', notApplicable: 'Not Applicable', partiallySupports: 'Partially Supports' }, title: 'Shop' }));
    }
    out.targets = { scan: targets.SCAN_TARGETS, conformance: targets.CONFORMANCE_TARGETS };
    const scan = ACTION_DEFINITIONS.a11yScan || Object.values(ACTION_DEFINITIONS).find((d) => d && d.fields && d.fields.profile);
    out.profileOptions = scan.fields.profile.options;
    return JSON.parse(JSON.stringify(out));
}

test('WCAG and EN 301 549 give what they gave when recorded', async (t) => {
    const withProcedures = hasProcedures();
    const now = await current({ withProcedures });
    if (!fs.existsSync(RECORD)) {
        if (!process.env.A11Y_RECORD_BASELINE) return t.skip('no record yet');
        if (!withProcedures) throw new Error('record with a core and a pack that have procedures');
        fs.writeFileSync(RECORD, JSON.stringify(now, null, 1) + '\n');
        return;
    }
    const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    for (const part of ['vpat', 'review', 'targets', 'profileOptions']) assert.deepEqual(now[part], record[part], part);
    if (!withProcedures) return;
    assert.deepEqual(now.procedures, record.procedures, 'procedures');
    assert.deepEqual(now.checklist, record.checklist, 'checklist');
});

test('EN 301 549 built from its pack\'s listing gives what was recorded', async (t) => {
    if (!hasProcedures() || !fs.existsSync(RECORD)) return t.skip('needs a core and a pack with procedures, and the record');
    const core = require('@surea11y/core');
    const pack = require('@surea11y/pack-en301549');
    for (const version of ['V3.2.1', 'V4.1.1']) {
        assert.ok(registerStandard(core.listProcedures({ packs: [pack], standard: 'en301549', version }), { profiles: [`en301549-v${version.slice(1).toLowerCase()}`] }));
    }
    try {
        const now = await current({ withProcedures: true });
        const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
        for (const part of ['vpat', 'review', 'procedures', 'checklist']) assert.deepEqual(now[part], record[part], part);
    } finally {
        clearStandards();
    }
});
