'use strict';

// The conformance report (conformance-report.js) as one HTML file: opens
// anywhere, offline, prints to PDF, and is accessible itself: headings for its
// parts, a caption and header cells for every table, and colour never the only
// sign of a verdict. It opens with what was evaluated in a sentence, the full
// list of pages in an appendix; it follows the reader's light or dark scheme
// on screen, and prints light.
//
// Browser: globalThis.A11Y_CONFORMANCE_REPORT_HTML. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_CONFORMANCE_REPORT_HTML = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const STYLE = `
:root { color-scheme: light; --text: #1f2421; --muted: #4f5753; --line: #c9cfcb; --soft: #f3f5f2; --page: #fff;
  --fail: #9b1c1c; --ok: #0b6b3a; --na: #4f5753; --open: #7a5a08; --link: #3b2db3; }
/* On screen, the reader's dark scheme when their system has one; on paper,
   always light. Each colour keeps 4.5:1 or more on the page and on --soft. */
@media screen and (prefers-color-scheme: dark) {
  :root { color-scheme: dark; --text: #e6ebe8; --muted: #b3bdb8; --line: #4a544f; --soft: #222a26; --page: #151a17;
    --fail: #ff9e9e; --ok: #7bd9a3; --na: #b3bdb8; --open: #e8c15c; --link: #b9b0ff; }
}
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); background: var(--page); }
main { max-width: 72rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .25rem; }
h2 { font-size: 1.35rem; margin: 2.5rem 0 .75rem; padding-top: 1rem; border-top: 2px solid var(--line); }
h3 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
.subtitle { color: var(--muted); margin: 0 0 1.5rem; }
dl.facts { display: grid; grid-template-columns: minmax(10rem, max-content) 1fr; gap: .4rem 1.25rem; margin: 0; }
dl.facts dt { font-weight: 600; }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 40rem) { dl.facts { grid-template-columns: 1fr; gap: .1rem; } dl.facts dd { margin-bottom: .6rem; } }
.note { background: var(--soft); border-left: 4px solid var(--line); padding: .75rem 1rem; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; font-size: .95rem; table-layout: fixed; }
table.criteria th:nth-child(1) { width: 36%; }
table.criteria th:nth-child(2) { width: 22%; }
/* On a phone each row is a card: the criterion, then its level and remarks,
   each labelled. The ARIA roles keep it a table for a screen reader, which a
   change of display would otherwise lose. */
@media (max-width: 40rem) {
  table.criteria, table.criteria tbody, table.criteria tr, table.criteria th, table.criteria td { display: block; width: auto !important; }
  table.criteria caption { display: block; }
  table.criteria thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  table.criteria tr { border: 1px solid var(--line); margin: 0 0 .75rem; }
  table.criteria th, table.criteria td { border: 0; padding: .35rem .75rem; }
  table.criteria th[scope="row"] { background: var(--soft); }
  table.criteria td::before { content: attr(data-label); content: attr(data-label) / ""; display: block; font-size: .8rem; font-weight: 600; color: var(--muted); }
}
caption { text-align: left; font-weight: 600; padding: .25rem 0 .5rem; }
th, td { border: 1px solid var(--line); padding: .5rem .6rem; text-align: left; vertical-align: top; overflow-wrap: break-word; }
thead th { background: var(--soft); }
td.level { font-weight: 600; }
td.level[data-level="doesNotSupport"] { color: var(--fail); }
td.level[data-level="partiallySupports"] { color: var(--open); }
td.level[data-level="supports"] { color: var(--ok); }
td.level[data-level="notApplicable"], td.level[data-level="notEvaluated"] { color: var(--na); }
.source { display: block; font-weight: 400; font-size: .8rem; color: var(--muted); }
ul.pages { margin: 0; padding-left: 1.2rem; }
ul.pages li { margin: .2rem 0; }
ul.pages .url { display: block; font-size: .85rem; color: var(--muted); overflow-wrap: anywhere; }
.checks-head { margin: .5rem 0 .2rem; font-weight: 600; font-size: .9rem; }
ul.checks { margin: 0; padding-left: 1.1rem; font-size: .9rem; }
.result { font-weight: 600; }
.result[data-result="fail"] { color: var(--fail); }
.result[data-result="pass"] { color: var(--ok); }
a { color: var(--link); }
@media print {
  main { max-width: none; padding: 0; }
  h2 { break-after: avoid; }
  tr { break-inside: avoid; }
  a { color: inherit; }
}`;

    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    /**
     * A date as the HTML report writes it: "Wednesday, 11 November 2026".
     * A date of the form 2026-11-11 (or a full ISO timestamp) is read as
     * that day; anything else (a date a person typed their own way) is kept
     * as written.
     */
    function longDate(value) {
        const text = String(value == null ? '' : value).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
        if (!m) return text;
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return text;
        return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    // An address read as host and path segments; null for one that is not
    // http(s).
    function addressOf(url) {
        try {
            const u = new URL(String(url || ''));
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            return { host: u.host, segments: u.pathname.split('/').filter(Boolean) };
        } catch {
            return null;
        }
    }

    // The pages evaluated, by address pattern: pages on one host, as deep,
    // whose addresses differ only where an id or a slug goes
    // ("/en/products/…/…"). Pages that share their first two segments and
    // differ after them are one pattern; so are pages whose differing
    // segments all hold a number ("/item/1", "/item/2"). Three pages make a
    // pattern; the rest are other pages.
    function addressPatterns(pages) {
        const groups = new Map();
        const others = [];
        for (const page of pages) {
            const a = addressOf(page.url);
            if (!a || !a.segments.length) { others.push(page); continue; }
            const fixed = Math.min(2, a.segments.length - 1);
            const key = JSON.stringify([a.host, a.segments.length, a.segments.slice(0, fixed)]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ page, a });
        }
        const patterns = [];
        for (const members of groups.values()) {
            const depth = members[0].a.segments.length;
            const shape = Array.from({ length: depth }, (_, i) => {
                const first = members[0].a.segments[i];
                return members.every((m) => m.a.segments[i] === first) ? first : null;
            });
            const varying = members.flatMap((m) => m.a.segments.filter((seg, i) => shape[i] === null));
            const kept = shape.findIndex((seg) => seg === null);
            const leading = kept < 0 ? depth : kept;
            const isPattern = members.length >= 3 && varying.length > 0
                && (leading >= 2 || varying.every((seg) => /\d/.test(seg)));
            if (!isPattern) { others.push(...members.map((m) => m.page)); continue; }
            patterns.push({
                host: members[0].a.host,
                path: '/' + shape.map((seg) => (seg === null ? '…' : seg)).join('/'),
                pages: members.map((m) => m.page),
            });
        }
        patterns.sort((x, y) => y.pages.length - x.pages.length);
        return { patterns, others };
    }

    function count(n, one, many) {
        return `${n} ${n === 1 ? one : many}`;
    }

    /**
     * What was evaluated, in a sentence or two: how many pages, the address
     * patterns most of them share, and how many others ("62 scans of 60
     * pages on shop.test: 40 pages at /en/products/…/…, 12 pages at
     * /en/blog/2026/…/… and 8 other pages."). The pages themselves are
     * listed in the appendix.
     */
    function scopeText(pages) {
        if (!pages.length) return '';
        const urls = new Set(pages.map((pg) => pg.url || pg.label));
        const hosts = new Set(pages.map((pg) => addressOf(pg.url)?.host).filter(Boolean));
        const lead = (pages.length === urls.size
            ? count(urls.size, 'page', 'pages')
            : `${count(pages.length, 'scan', 'scans')} of ${count(urls.size, 'page', 'pages')}`)
            + (hosts.size === 1 ? ` on ${[...hosts][0]}` : '');
        const unique = [];
        const seen = new Set();
        for (const pg of pages) {
            const key = pg.url || pg.label;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(pg);
        }
        const { patterns, others } = addressPatterns(unique);
        if (!patterns.length) return `${lead}.`;
        const parts = patterns.map((p) => `${count(p.pages.length, 'page', 'pages')} at ${hosts.size > 1 ? p.host : ''}${p.path}`);
        if (others.length) parts.push(count(others.length, 'other page', 'other pages'));
        const listed = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
        return `${lead}: ${listed}. In an address, “…” stands for the part that differs from page to page.`;
    }

    // Only addresses a browser opens as pages become links.
    function pageLink(url, text) {
        return /^https?:\/\//i.test(String(url || ''))
            ? `<a href="${esc(url)}">${esc(text)}</a>`
            : esc(text);
    }

    function pagesListHTML(pages) {
        return `<ul class="pages">${pages.map((pg) => (pg.label && pg.url
            ? `<li>${pageLink(pg.url, pg.label)}<span class="url">${esc(pg.url)}</span></li>`
            : `<li>${pageLink(pg.url, pg.label || pg.url)}</li>`)).join('')}</ul>`;
    }

    function fact(term, value) {
        return value ? `<dt>${esc(term)}</dt><dd>${value}</dd>` : '';
    }

    // What a person checked for a criterion, under its remarks.
    function checksHTML(checks) {
        if (!Array.isArray(checks) || !checks.length) return '';
        return `<p class="checks-head">Checked by hand:</p><ul class="checks">`
            + checks.map((c) => `<li><span class="result" data-result="${esc(c.result)}">${esc(c.resultLabel)}:</span> ${esc(c.label)}</li>`).join('')
            + `</ul>`;
    }

    function tableHTML(table) {
        const isWcag = table.standard === 'wcag';
        const head = `<tr role="row"><th scope="col" role="columnheader">Criteria</th><th scope="col" role="columnheader">Conformance Level</th><th scope="col" role="columnheader">Remarks and Explanations</th></tr>`;
        const body = table.rows.map((r) => {
            const name = isWcag || /^9\./.test(r.id) ? `${esc(r.id)} ${esc(r.name)}${r.level ? ` (Level ${esc(r.level)})` : ''}` : `${esc(r.id)} ${esc(r.name)}`;
            const by = r.source === 'review' ? 'Reviewed' : 'Automated draft';
            return `<tr role="row"><th scope="row" role="rowheader">${name}</th>`
                + `<td role="cell" class="level" data-level="${esc(r.conformance)}" data-label="Conformance Level">${esc(r.conformanceLabel)}<span class="source">${by}</span></td>`
                + `<td role="cell" data-label="Remarks and Explanations">${esc(r.remarks)}${checksHTML(r.checks)}</td></tr>`;
        }).join('');
        // No box to scroll: wide, three columns; on a phone, a card a row.
        return `<table class="criteria" role="table"><caption>${esc(table.title)}</caption><thead role="rowgroup">${head}</thead><tbody role="rowgroup">${body}</tbody></table>`;
    }

    /**
     * The report as a complete HTML document.
     * @param {object} acr from buildConformanceReport()
     * @param {{ generatedAt?: string }} [options]
     */
    function conformanceReportHTML(acr, options = {}) {
        const p = acr.product;
        const e = acr.evaluation;
        const t = acr.target;
        const title = `${p.name}${p.version ? ` ${p.version}` : ''}: Accessibility Conformance Report`;
        // The scope first, in words; every page, linked, in the appendix.
        // Groups the lab's view shows merged are counted here page by page.
        const scope = (e.pages.length
            ? `${esc(scopeText(e.pages))} <a href="#evaluated-pages">Every page evaluated</a> is listed in the appendix.`
            : '')
            + (e.pagesNote ? ` <span class="pages-note">${esc(e.pagesNote)}</span>` : '');
        const methods = esc(acr.evaluation.methodsText);
        const drafts = acr.totals.draftsLeft;
        const wcagTables = acr.tables.filter((tb) => tb.standard === 'wcag');
        const enTables = acr.tables.filter((tb) => tb.standard === 'en301549');

        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(p.name)}${p.version ? ` ${esc(p.version)}` : ''}</h1>
<p class="subtitle">Accessibility Conformance Report, based on VPAT® 2.5 (WCAG and EU edition)</p>
<dl class="facts">
${fact('Report date', esc(longDate(p.date)))}
${fact('Product description', esc(p.description))}
${fact('Contact', esc(p.contact))}
${fact('Evaluation methods', methods)}
${fact('Evaluated', scope)}
${fact('Notes', esc(p.notes))}
</dl>
${drafts ? `<p class="note">${drafts} entr${drafts === 1 ? 'y is' : 'ies are'} still the automated draft, marked "Automated draft". Automated checks test only part of each criterion, so a draft says "Not Evaluated" wherever a person still has to decide, and never "Supports".</p>` : ''}

<h2>Applicable standards</h2>
<table>
<caption>Standards and guidelines this report covers</caption>
<thead><tr><th scope="col">Standard</th><th scope="col">Included</th></tr></thead>
<tbody>
<tr><th scope="row">Web Content Accessibility Guidelines ${esc(t.wcagVersion)}</th><td>Level A and AA${t.level === 'AAA' ? ' and AAA' : ''}</td></tr>
<tr><th scope="row">EN 301 549 ${esc(t.en301549)}, Accessibility requirements for ICT products and services</th><td>Yes</td></tr>
</tbody>
</table>

<h2>Terms</h2>
<dl class="facts">
<dt>Supports</dt><dd>The functionality of the product has at least one method that meets the criterion without known defects, or meets it with equivalent facilitation.</dd>
<dt>Partially Supports</dt><dd>Some functionality of the product does not meet the criterion.</dd>
<dt>Does Not Support</dt><dd>The majority of product functionality does not meet the criterion.</dd>
<dt>Not Applicable</dt><dd>The criterion is not relevant to the product.</dd>
<dt>Not Evaluated</dt><dd>The product has not been evaluated against the criterion.</dd>
</dl>

<h2>WCAG ${esc(t.wcagVersion)} Report</h2>
${wcagTables.map(tableHTML).join('\n')}

<h2>EN 301 549 ${esc(t.en301549)} Report</h2>
${enTables.map(tableHTML).join('\n')}

${e.pages.length ? `<h2 id="evaluated-pages">Appendix: pages evaluated</h2>
<p>${esc(scopeText(e.pages))}</p>
${pagesListHTML(e.pages)}
` : ''}
<p class="subtitle">Generated ${esc(longDate(options.generatedAt || new Date().toISOString().slice(0, 10)))} by surea11y-lab. “VPAT” is a registered service mark of the Information Technology Industry Council (ITI).</p>
</main>
</body>
</html>
`;
    }

    return { conformanceReportHTML, scopeText, longDate };
});
