'use strict';

// The masthead and the provenance block: what a comparison IS, rendered inside
// the `.cmp2` subtree.
//
// Inside `.cmp2` on purpose. Only that subtree travels into the exported HTML
// file, and a downloaded comparison with no name, no date and no list of what
// went into it is unreadable the moment the person who made it is not standing
// next to you. Anything rendered in the tab's own chrome would be left behind.
//
// Shared by both renderers so a pair and a series describe themselves the same
// way. Pure string builders, no DOM.

import { enginesHTML, howTestedHTML } from './engine-brand.js';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Deterministic and unambiguous, rather than the reader's locale: this string
// is baked into a downloaded file and read by whoever it is passed on to, so
// "11 Aug 2026" beats a 08/11 that means two different days on two continents.
export function docDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function host(url) {
    try { return new URL(url).host; } catch { return String(url || ''); }
}

/**
 * What to call this comparison, in one line.
 *
 * A typed title wins. Failing that the reports name themselves: a set that all
 * carries one scenario is that scenario's comparison, and a set that at least
 * shares a site is that site's. Only a set agreeing on nothing falls back to
 * the generic label.
 */
export function documentTitle(doc) {
    if (!doc) return 'Accessibility comparison';
    if (doc.title) return doc.title;
    if (doc.subject) return doc.subject;
    if (doc.scope) return host(doc.scope);
    return 'Accessibility comparison';
}

/** The one-line description that goes with the title, for a tab or a filename. */
export function documentSummary(doc) {
    return doc && doc.summary ? doc.summary : '';
}

function fact(term, value) {
    return value
        ? `<div class="doc-fact"><dt>${esc(term)}</dt><dd>${value}</dd></div>`
        : '';
}

/**
 * The masthead: what this is, what it covers, and when it was put together.
 *
 * The title is an h2 because the view is a component sitting under a page that
 * already has a title, which is the contract the rest of the renderer keeps.
 * An exported file has no such page, so the export promotes this one heading to
 * h1 on its way out rather than printing the title a second time.
 */
export function mastheadHTML(doc, { titleTag = 'h2', sourcesHref = '' } = {}) {
    if (!doc) return '';

    const title = documentTitle(doc);
    // Suppressed when the title already is the generic label, so the page does
    // not open by saying the same thing twice.
    const kind = title === doc.kind ? '' : `<p class="doc-kind">${esc(doc.kind)}</p>`;

    const scopeFact = doc.scopes.length > 1
        ? `${doc.scopes.length} different addresses`
        : (doc.scope ? `<a href="${esc(doc.scope)}" rel="noopener noreferrer">${esc(doc.scope)}</a>` : '');

    const facts = [
        // A link to the list of reports when the page has one, because "7
        // versions" is the first thing a reader wants to open up.
        fact('Covering', sourcesHref && doc.summary
            ? `<a href="${esc(sourcesHref)}">${esc(doc.summary)}</a>`
            : esc(doc.summary)),
        // How the columns are meant to be read. Implied everywhere in the view
        // and stated nowhere, until the file is opened by someone who did not
        // choose it.
        fact('Compared as', esc(doc.framing)),
        // Only when it is not already the title, which it usually is.
        fact('Subject', doc.subject && doc.subject !== title ? esc(doc.subject) : ''),
        fact('Scope', scopeFact),
        fact('Compiled', esc(docDate(doc.generatedAt))),
    ].join('');
    // As a report names the engine that ran it: surea11y as its tag, at full
    // size, on a line of its own, as it stands taller than the text facts.
    const engines = fact((doc.engines || []).length > 1 ? 'Engines' : 'Engine', enginesHTML(doc.engines) + howTestedHTML(doc.engines));

    // The machine-readable half, for the exporter: it reads the rendered DOM
    // rather than the engine's object, so the few values that have to survive
    // into <title>, the meta description and the filename are stated here as
    // attributes instead of being scraped back out of the prose.
    const data = `data-doc-title="${esc(title)}" data-doc-summary="${esc(doc.summary)}"`
        + ` data-doc-generated="${esc(doc.generatedAt)}"`;

    return `<header class="doc-head" ${data}>
        ${kind}
        <${titleTag} class="doc-title">${esc(title)}</${titleTag}>
        ${doc.note ? `<p class="doc-note">${esc(doc.note)}</p>` : ''}
        <dl class="doc-facts">${facts}</dl>
        ${engines ? `<dl class="doc-facts doc-facts--engine">${engines}</dl>` : ''}
    </header>`;
}

/**
 * The provenance block: one row per report, at the foot of the document.
 *
 * The masthead says what the comparison is; this says what it was made from,
 * which is the part a reader needs to check a claim or to rebuild it. Rows are
 * normalized by the caller, because a pair and a series hold their columns
 * differently but describe them identically.
 *
 * @param {{label: string, name: string, timestamp: ?string, scope: ?string,
 *          pages: ?number, analyzed: ?number, tags: string[],
 *          optInRules?: string[], engines?: {name: string, version: ?string}[]}[]} rows
 */
/**
 * The reports strip: which reports the columns are, right under the masthead.
 *
 * The provenance table at the foot has every detail, but it is the last thing
 * on a long page, and "which reports am I looking at?" is the first question a
 * reader opening someone else's comparison asks. So the short answer sits at
 * the top: one numbered entry per column, in column order, with its date and
 * how much it covered, and a flag on any column the trust check doubted. The
 * numbers match the column order every chart below uses.
 */
export function reportsStripHTML(rows, { sourcesHref = '' } = {}) {
    if (!Array.isArray(rows) || !rows.length) return '';

    const items = rows.map((row, i) => {
        const pages = row.pages == null
            ? ''
            : (row.analyzed != null && row.analyzed !== row.pages
                ? `${row.analyzed} of ${row.pages} pages`
                : `${row.pages} ${row.pages === 1 ? 'page' : 'pages'}`);
        // The report's own name only when the column was given a different
        // one, so the common case does not say the same thing twice; a label
        // that is the name qualified ("v2 · Oct 21") already says it.
        const name = row.name && row.name !== row.label && !String(row.label).startsWith(`${row.name} · `) ? row.name : '';
        const meta = [name, row.timestamp ? docDate(row.timestamp) : 'no date', pages]
            .filter(Boolean).map(esc).join(' · ');

        return `<li class="doc-report${row.incomplete ? ' doc-report--warn' : ''}">
            <span class="doc-report-n num" aria-hidden="true">${i + 1}</span>
            <span class="doc-report-body">
                <span class="doc-report-name">${esc(row.label)}</span>
                <span class="doc-report-meta">${meta}</span>
                ${row.incomplete ? '<span class="doc-report-flag">Did not cover everything asked of it</span>' : ''}
            </span>
        </li>`;
    }).join('');

    return `<section class="doc-reports">
        <div class="doc-reports-head">
            <h3 class="doc-reports-title">Reports compared <span class="doc-reports-count num">${rows.length}</span></h3>
            ${sourcesHref ? `<a class="doc-reports-more" href="${esc(sourcesHref)}">Full details</a>` : ''}
        </div>
        <ol class="doc-reports-list">${items}</ol>
    </section>`;
}

export function provenanceHTML(rows, doc, { columnTerm = 'Column', id = '' } = {}) {
    if (!Array.isArray(rows) || !rows.length) return '';

    const body = rows.map((row) => {
        // Both numbers when they differ, because a run that skipped scans
        // covered less than its own scan list claims.
        const pages = row.pages == null
            ? '—'
            : (row.analyzed != null && row.analyzed !== row.pages
                ? `${row.analyzed} of ${row.pages}`
                : String(row.pages));

        return `<tr>
            <th scope="row">${esc(row.label)}</th>
            <td>${esc(row.name || '—')}${(row.tags || []).length
    ? ` <span class="doc-tags">${esc(row.tags.join(', '))}</span>` : ''}${(row.optInRules || []).length
    ? ` <span class="doc-tags">plus ${esc(row.optInRules.map((t) => t.toUpperCase()).join(', '))}-only rules</span>` : ''}${(row.engines || []).length
    ? ` <span class="doc-engines">${enginesHTML(row.engines)}</span>` : ''}</td>
            <td>${row.timestamp ? esc(docDate(row.timestamp)) : 'no date'}</td>
            <td class="num">${esc(pages)}</td>
            <td class="doc-scope">${row.scope ? esc(row.scope) : '—'}</td>
        </tr>`;
    }).join('');

    const mixed = doc && doc.scopes.length > 1
        ? `<p class="doc-warn"><span class="dash-caveat-i" aria-hidden="true">!</span>
           <span>These reports cover ${doc.scopes.length} different addresses, so they are not all
           scans of the same thing. Whether that comparison is meaningful is your call to make,
           not one this tool can check.</span></p>`
        : '';

    const optIn = doc && doc.optInMismatch
        ? `<p class="doc-warn"><span class="dash-caveat-i" aria-hidden="true">!</span>
           <span>Some of these reports also ran rules only one standard requires, such as RGAA's,
           and others did not. Those rules' findings appear or disappear between them because
           of what was checked, not because the pages changed.</span></p>`
        : '';

    const changes = doc && Array.isArray(doc.engineChanges) ? doc.engineChanges : [];
    const engines = changes.length
        ? `<p class="doc-warn"><span class="dash-caveat-i" aria-hidden="true">!</span>
           <span>These reports were made with different releases of
           ${esc(changes.map((c) => `${c.name} (${c.versions.join(', ')})`).join(' and '))}.
           A release can add rules or change what a rule finds, so some differences between them
           may come from the engine rather than from the pages.</span></p>`
        : '';

    const compared = doc && Array.isArray(doc.standardsCompared) ? doc.standardsCompared : [];
    const criteria = doc && doc.criteriaMismatch
        ? `<p class="doc-warn"><span class="dash-caveat-i" aria-hidden="true">!</span>
           <span>These reports were checked against different standards or WCAG levels${compared.length > 1 ? ` (${esc(compared.join(', '))})` : ''}.
           A scan against a standard is listed by that standard's requirements (EN 301 549's clauses,
           RGAA's criteria), one against WCAG by WCAG criterion, and a higher WCAG level checks
           criteria a lower one leaves out, so their rows do not line up: a failure can read as fixed
           in one and new in the other when only what was checked changed.</span></p>`
        : '';

    // Reports checked against different profiles, compared on those they
    // share (shared-profiles.js).
    const basis = doc && doc.profiles && Array.isArray(doc.profiles.comparedOn) && doc.profiles.comparedOn.length
        ? doc.profiles : null;
    const shared = basis
        ? `<p class="doc-note"><span>${esc(`Compared on ${basis.comparedOn.map((p) => p.label).join(' + ')}, which every report checked.`)}${
            basis.leftOut && basis.leftOut.length
                ? ` ${esc(`Left out, as not every report checked it: ${basis.leftOut.map((p) => p.label).join(', ')}.`)} Each report's own score is left out too, since it was made from everything that report checked.`
                : ''}</span></p>`
        : '';

    return `<section class="cmp2-sec doc-source"${id ? ` id="${esc(id)}"` : ''}>
        <div class="sec-head"><h3>What went into this comparison</h3><span class="layer">provenance</span></div>
        <p class="dash-sub">Every report this page was built from, in column order. Kept with the
            comparison so a copy of it can still be checked, or rebuilt, long after the tab that made
            it was closed.</p>
        ${mixed}
        ${optIn}
        ${engines}
        ${shared}
        ${criteria}
        <div class="dash-table-scroll">
            <table class="doc-table">
                <thead><tr>
                    <th scope="col">${esc(columnTerm)}</th>
                    <th scope="col">Report</th>
                    <th scope="col">Scanned</th>
                    <th scope="col">Pages</th>
                    <th scope="col">Scope</th>
                </tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
        ${doc ? `<p class="doc-gen">Compiled ${esc(docDate(doc.generatedAt))} with SureA11y.</p>` : ''}
    </section>`;
}
