'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom');

const { buildConformanceReport } = require('./conformance-report.js');
const { conformanceReportDocx } = require('./conformance-report-docx.js');

const report = {
    scenarioName: 'Shop <script>alert(1)</script> & Co',
    timestamp: '2026-10-30T09:00:00Z',
    scans: [{
        label: 'Scan: Home',
        url: 'https://shop.test/',
        canonical: {
            engines: [{ id: 'surea11y', name: 'surea11y', version: '1.14.1' }],
            findings: [{ ruleId: 'r', title: 'Images', outcome: 'fail', wcag: { scNormative: ['1.1.1'] }, occurrences: [{}] }],
        },
        metrics: { coverageSummary: { criteria: [{ sc: '1.1.1', status: 'doesNotSupport' }] } },
    }],
    conformanceReview: { criteria: { '1.4.3': { conformance: 'supports', remarks: 'Checked by hand.', facets: { 'contrast-images': { result: 'pass', label: 'Text in images has enough contrast' } } } } },
};

describe('the conformance report as a Word document', () => {
    let parts;
    before(async () => {
        const buffer = await conformanceReportDocx(buildConformanceReport(report), JSZip, { type: 'nodebuffer', generatedAt: '2026-10-30' });
        const zip = await JSZip.loadAsync(buffer);
        parts = {};
        for (const entry of Object.values(zip.files)) {
            if (!entry.dir) parts[entry.name] = await entry.async('string');
        }
    });

    test('holds the parts Word opens', () => {
        for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) {
            assert.ok(parts[name], name);
        }
    });

    test('every part is well-formed XML', () => {
        const { DOMParser } = new JSDOM('').window;
        for (const [name, text] of Object.entries(parts)) {
            const doc = new DOMParser().parseFromString(text, 'application/xml');
            assert.equal(doc.getElementsByTagName('parsererror').length, 0, name);
        }
    });

    test('names its title and language, and escapes what it is given', () => {
        assert.match(parts['docProps/core.xml'], /<dc:title>Shop &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Co: Accessibility Conformance Report<\/dc:title>/);
        assert.match(parts['docProps/core.xml'], /<dc:language>en-GB<\/dc:language>/);
        assert.match(parts['word/styles.xml'], /<w:lang w:val="en-GB"\/>/);
        assert.doesNotMatch(parts['word/document.xml'], /<script>/);
    });

    test('has headings, a caption before each table, and header rows that repeat', () => {
        const doc = parts['word/document.xml'];
        assert.equal((doc.match(/<w:pStyle w:val="Heading1"\/>/g) || []).length, 4);
        const tables = (doc.match(/<w:tbl>/g) || []).length;
        assert.equal(tables, 9, 'details, standards, terms, two WCAG levels and four EN 301 549 parts');
        assert.equal((doc.match(/<w:pStyle w:val="Caption"\/>/g) || []).length, tables);
        assert.equal((doc.match(/<w:tblHeader\/>/g) || []).length, tables);
        assert.match(parts['word/styles.xml'], /<w:outlineLvl w:val="0"\/>/);
    });

    test('carries the draft and a reviewer\'s verdicts alike', () => {
        const doc = parts['word/document.xml'];
        assert.match(doc, /1\.1\.1 Non-text Content \(Level A\)/);
        assert.match(doc, /Does Not Support/);
        assert.match(doc, /Checked by hand\./);
        assert.match(doc, /Reviewed/);
        assert.doesNotMatch(doc, /&lt;w:/, 'no markup written as text');
    });
});

test('a criterion\'s answered checks follow its remarks in the Word document', async () => {
    const buffer = await conformanceReportDocx(buildConformanceReport(report), JSZip, { type: 'nodebuffer', generatedAt: '2026-10-30' });
    const doc = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
    assert.match(doc, /Checked by hand\.<\/w:t>[\s\S]*?Checked by hand:<\/w:t>[\s\S]*?Passes: Text in images has enough contrast<\/w:t>/);
    assert.match(doc, /1 check answered, on 1 WCAG criterion, each listed under its row/);
});
