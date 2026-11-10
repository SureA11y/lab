'use strict';

// The conformance report (conformance-report.js) as a Word document (.docx),
// for teams that edit and sign it there. Written part by part with JSZip,
// which the lab already ships: no library of its own to keep.
//
// Accessible in Word: Title and Heading styles for its parts (the navigation
// pane and screen readers follow them), a caption before every table, each
// table's header row repeated on every page and marked as a header, the
// document's language and title set.
//
// Browser: globalThis.A11Y_CONFORMANCE_REPORT_DOCX. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_CONFORMANCE_REPORT_DOCX = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    function x(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            // XML 1.0 has no place for control characters.
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    }

    function run(text, { bold = false } = {}) {
        return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
    }

    function para(text, style = null, opts = {}) {
        const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/>${opts.keepNext ? '<w:keepNext/>' : ''}</w:pPr>` : '';
        const runs = Array.isArray(text) ? text.join('') : run(text, opts);
        return `<w:p>${pPr}${runs}</w:p>`;
    }

    // A cell holds text, or paragraphs already written ({ xml }), never text
    // taken for markup.
    function cell(content, { header = false, width } = {}) {
        const paras = content && typeof content === 'object' && 'xml' in content
            ? content.xml
            : para(String(content == null ? '' : content), null, { bold: header });
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="pct"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F5F2"/>' : ''}</w:tcPr>${paras}</w:tc>`;
    }

    // A table: a caption paragraph kept with it, a header row repeated on
    // every page, widths in fiftieths of a percent.
    function table(caption, head, rows, widths) {
        // The grid in twips, of the 9638 between A4's margins: what Word and
        // LibreOffice lay columns out by.
        const grid = widths.map((w) => `<w:gridCol w:w="${Math.round((w / 5000) * 9638)}"/>`).join('');
        const headRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${head.map((h, i) => cell(h, { header: true, width: widths[i] })).join('')}</w:tr>`;
        const bodyRows = rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, { header: i === 0 && r.length > 2, width: widths[i] })).join('')}</w:tr>`).join('');
        return para(caption, 'Caption', { keepNext: true })
            + `<w:tbl><w:tblPr><w:tblStyle w:val="ReportTable"/><w:tblW w:w="5000" w:type="pct"/>`
            + `<w:tblCaption w:val="${x(caption)}"/><w:tblLook w:firstRow="1" w:firstColumn="1" w:lastRow="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>`
            + `<w:tblGrid>${grid}</w:tblGrid>${headRow}${bodyRows}</w:tbl>`
            + para('');
    }

    function criteriaTable(t) {
        const isWcagRow = (r) => t.standard === 'wcag' || /^9\./.test(r.id);
        const rows = t.rows.map((r) => [
            `${r.id} ${r.name}${isWcagRow(r) && r.level ? ` (Level ${r.level})` : ''}`,
            { xml: para(r.conformanceLabel, null, { bold: true }) + para(r.source === 'review' ? 'Reviewed' : 'Automated draft', 'Small') },
            r.checks && r.checks.length
                ? { xml: para(r.remarks || '') + para('Checked by hand:', null, { bold: true }) + r.checks.map((c) => para(`${c.resultLabel}: ${c.label}`)).join('') }
                : (r.remarks || ''),
        ]);
        return table(t.title, ['Criteria', 'Conformance Level', 'Remarks and Explanations'], rows, [1800, 1100, 2100]);
    }

    function documentXml(acr, generatedAt) {
        const p = acr.product;
        const e = acr.evaluation;
        const t = acr.target;
        const methods = e.methodsText;
        const facts = [
            ['Report date', p.date],
            ['Product description', p.description],
            ['Contact', p.contact],
            ['Evaluation methods', methods],
            ['Evaluated', e.pages.map((pg) => (pg.url && pg.label ? `${pg.label}: ${pg.url}` : (pg.label || pg.url))).join('; ')],
            // Groups the lab's view shows merged, counted here page by page.
            ['Merged in the report view', e.pagesNote],
            ['Notes', p.notes],
        ].filter(([, v]) => v);
        const drafts = acr.totals.draftsLeft;
        const terms = [
            ['Supports', 'The functionality of the product has at least one method that meets the criterion without known defects, or meets it with equivalent facilitation.'],
            ['Partially Supports', 'Some functionality of the product does not meet the criterion.'],
            ['Does Not Support', 'The majority of product functionality does not meet the criterion.'],
            ['Not Applicable', 'The criterion is not relevant to the product.'],
            ['Not Evaluated', 'The product has not been evaluated against the criterion.'],
        ];

        const body = [
            para(`${p.name}${p.version ? ` ${p.version}` : ''}`, 'Title'),
            para('Accessibility Conformance Report, based on VPAT® 2.5 (WCAG and EU edition)', 'Subtitle'),
            table('Report details', ['Item', 'Detail'], facts.map(([k, v]) => [k, v]), [1500, 3500]),
            drafts ? para(`${drafts} entr${drafts === 1 ? 'y is' : 'ies are'} still the automated draft, marked "Automated draft". Automated checks test only part of each criterion, so a draft says "Not Evaluated" wherever a person still has to decide, and never "Supports".`, 'Note') : '',
            para('Applicable standards', 'Heading1'),
            table('Standards and guidelines this report covers', ['Standard', 'Included'], [
                [`Web Content Accessibility Guidelines ${t.wcagVersion}`, `Level A and AA${t.level === 'AAA' ? ' and AAA' : ''}`],
                [`EN 301 549 ${t.en301549}, Accessibility requirements for ICT products and services`, 'Yes'],
            ], [3500, 1500]),
            para('Terms', 'Heading1'),
            table('The conformance levels this report uses', ['Term', 'Meaning'], terms, [1300, 3700]),
            para(`WCAG ${t.wcagVersion} Report`, 'Heading1'),
            ...acr.tables.filter((tb) => tb.standard === 'wcag').map(criteriaTable),
            para(`EN 301 549 ${t.en301549} Report`, 'Heading1'),
            ...acr.tables.filter((tb) => tb.standard === 'en301549').map(criteriaTable),
            para(`Generated ${generatedAt} by surea11y-lab. “VPAT” is a registered service mark of the Information Technology Industry Council (ITI).`, 'Small'),
        ].join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
            + `<w:document ${W}><w:body>${body}`
            + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`
            + `</w:body></w:document>`;
    }

    function stylesXml() {
        const heading = (id, name, size, level) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
            + `<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/>${level != null ? `<w:outlineLvl w:val="${level}"/>` : ''}</w:pPr>`
            + `<w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
            + `<w:styles ${W}>`
            + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>`
            + `<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
            + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
            + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>`
            + `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="4F5753"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>`
            + heading('Heading1', 'heading 1', 32, 0)
            + heading('Heading2', 'heading 2', 26, 1)
            + `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>`
            + `<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="C9CFCB"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F3F5F2"/><w:spacing w:before="120" w:after="240"/><w:ind w:left="170"/></w:pPr></w:style>`
            + `<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="4F5753"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>`
            + `<w:style w:type="table" w:styleId="ReportTable"><w:name w:val="Report Table"/><w:tblPr><w:tblBorders>`
            + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="C9CFCB"/>`).join('')
            + `</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`
            + `</w:styles>`;
    }

    function coreXml(title, generatedAt) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
            + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
            + `<dc:title>${x(title)}</dc:title><dc:language>en-GB</dc:language><dc:creator>surea11y-lab</dc:creator>`
            + `<dcterms:created xsi:type="dcterms:W3CDTF">${x(generatedAt)}T00:00:00Z</dcterms:created>`
            + `</cp:coreProperties>`;
    }

    const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + `<Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
        + `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
        + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
        + `</Types>`;

    const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
        + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
        + `</Relationships>`;

    const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + `</Relationships>`;

    /**
     * The report as a .docx: a Blob in the browser, or what `type` asks of
     * JSZip ('nodebuffer' in Node).
     * @param {object} acr from buildConformanceReport()
     * @param {Function} JSZip the JSZip constructor
     * @param {{ generatedAt?: string, type?: string }} [options]
     */
    async function conformanceReportDocx(acr, JSZip, options = {}) {
        const generatedAt = options.generatedAt || new Date().toISOString().slice(0, 10);
        const title = `${acr.product.name}${acr.product.version ? ` ${acr.product.version}` : ''}: Accessibility Conformance Report`;
        const zip = new JSZip();
        zip.file('[Content_Types].xml', CONTENT_TYPES);
        zip.file('_rels/.rels', ROOT_RELS);
        zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS);
        zip.file('word/document.xml', documentXml(acr, generatedAt));
        zip.file('word/styles.xml', stylesXml());
        zip.file('docProps/core.xml', coreXml(title, generatedAt));
        return zip.generateAsync({ type: options.type || 'blob', mimeType: MIME, compression: 'DEFLATE' });
    }

    return { conformanceReportDocx, DOCX_MIME: MIME };
});
