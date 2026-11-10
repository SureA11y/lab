// The manual review checklist: a page to download, print or share, with what
// a report leaves for a person, criterion by criterion. For each WCAG
// criterion of its target: what the scans found, the verdict recorded so far,
// and the checks a person makes (core's procedures, procedures.js), each with
// its steps, what passing and failing look like, and a result to tick. The
// page's own words are English; each procedure's text is marked with the
// language it was read in (WCAG 3.1.2).

import { splitFacets, ANSWERS, resultOf, langAttr, inLang, procedureNoteHTML } from './procedures.js';

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const safeId = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, '-');

const STYLE = `
:root { color-scheme: light; --text: #1b1b1f; --muted: #4a4a55; --line: #c9c9d1; --bg: #fff; --accent: #2a4fb5; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 16px 3rem; }
h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
h2 { font-size: 1.3rem; margin: 2.5rem 0 1rem; padding-top: .5rem; border-top: 2px solid var(--line); }
h3 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
.meta, .found, .verdict, .automatic { color: var(--muted); margin: 0 0 .5rem; }
.note { margin: 0 0 .5rem; }
.term { font-weight: 600; color: var(--text); }
ol.checks { padding-left: 1.5rem; }
li.check { margin: 0 0 1.25rem; }
li.check p { margin: 0 0 .35rem; }
ol.steps { margin: 0 0 .35rem; padding-left: 1.25rem; }
fieldset { display: flex; flex-wrap: wrap; gap: .25rem 1.25rem; align-items: center; margin: .5rem 0 0; padding: .35rem .6rem; border: 1px solid var(--line); border-radius: 4px; }
legend { font-weight: 600; padding: 0 .25rem; }
fieldset label { display: inline-flex; gap: .35rem; align-items: center; min-height: 24px; }
input[type=radio] { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.notes { width: 100%; min-height: 3rem; margin-top: .5rem; font: inherit; }
@media print {
  main { max-width: none; padding: 0; }
  h3 { break-after: avoid; }
  li.check { break-inside: avoid; }
}
`;

function checkHTML(f, criterion, answer, lang = '') {
    const p = f.procedure;
    const labelLang = f.lang || lang;
    const textLang = f.procedureLang || f.lang || lang;
    const name = `c-${safeId(criterion)}-${safeId(f.id)}`;
    const tools = (Array.isArray(f.tools) ? f.tools : []).filter((t) => t && isText(t.label));
    const options = ANSWERS.filter(([value]) => value).map(([value, label]) => {
        const id = `${name}-${value}`;
        return `<label for="${esc(id)}"><input type="radio" id="${esc(id)}" name="${esc(name)}" value="${value}"${answer === value ? ' checked' : ''}/>${esc(label)}</label>`;
    }).join('');
    return `<li class="check">`
        + `<p><strong${langAttr(labelLang)}>${esc(f.label)}</strong>${f.automation === 'partial' ? ' (automated checks decide part of it)' : ''}</p>`
        + (tools.length ? `<p class="meta"><span class="term">You need:</span> ${tools.map((t) => inLang(t.lang || lang, t.label)).join(', ')}</p>` : '')
        + `<ol class="steps"${langAttr(textLang)}>${p.steps.filter(isText).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
        + (isText(p.passWhen) ? `<p><span class="term">Passes:</span> ${inLang(textLang, p.passWhen)}</p>` : '')
        + (isText(p.failWhen) ? `<p><span class="term">Fails:</span> ${inLang(textLang, p.failWhen)}</p>` : '')
        + `<fieldset><legend><span class="visually-hidden">${inLang(labelLang, f.label)}: </span>Result</legend>${options}</fieldset>`
        + `</li>`;
}

// A requirement its standard only says something of, with nothing to
// check: a void clause, say.
const noteOnly = (procedure) => !!procedure && isText(procedure.note) && !(Array.isArray(procedure.facets) && procedure.facets.length);

// A row of the checklist: a WCAG criterion, one of EN 301 549's own
// requirements (`en`), whose draft is the author's to answer, not the scans',
// or another standard's (`prefix`, its key), drafted from the scans.
// `lang` is the language its procedure was read in, where it doesn't say.
function criterionHTML(row, procedure, entry, levelLabels, { en = false, prefix = '', lang = '' } = {}) {
    const { forPerson, automatic } = splitFacets(procedure);
    const readIn = procedure && isText(procedure.locale) ? procedure.locale : lang;
    const found = row.draft && isText(row.draft.remarks) ? row.draft.remarks : '';
    const verdict = entry && entry.conformance && levelLabels[entry.conformance] ? levelLabels[entry.conformance] : '';
    const ownStandard = en || !!prefix;
    const key = `${en ? 'en-' : (prefix ? `${prefix}-` : '')}${row.id}`;
    const heading = en && /^Chapter /.test(row.name) ? row.name : `${row.id} ${row.name}${row.level ? ` (Level ${row.level})` : ''}`;
    return `<section aria-labelledby="h-${esc(safeId(key))}">`
        + `<h3 id="h-${esc(safeId(key))}">${esc(heading)}</h3>`
        + (found ? `<p class="found"><span class="term">${en ? 'Draft' : 'What the scans found'}:</span> ${esc(found)}</p>` : '')
        + (verdict ? `<p class="verdict"><span class="term">Recorded so far:</span> ${esc(verdict)}${isText(entry.remarks) ? `. ${esc(entry.remarks)}` : ''}</p>` : '')
        + procedureNoteHTML(procedure, { className: 'note', term: 'term' })
        + (forPerson.length
            ? `<ol class="checks">${forPerson.map((f) => checkHTML(f, key, resultOf(entry && entry.facets, f.id), readIn)).join('')}</ol>`
            : noteOnly(procedure) ? '' : `<p class="meta">${procedure ? 'Automated checks decide this criterion in full.' : `No procedure for this ${ownStandard ? 'requirement' : 'criterion'} yet${ownStandard ? '' : ': check it against its Understanding document'}.`}</p>`)
        + (automatic.length ? `<p class="automatic"><span class="term">Automated checks decide:</span> ${automatic.map((f) => inLang(f.lang || readIn, f.label)).join('; ')}.</p>` : '')
        + `</section>`;
}

// EN 301 549's own requirements, kept in the review as the dialog keeps them:
// a chapter of its own under "chapter-5", the rest by number.
const EN_OWN = ['en-4', 'en-9', 'en-12', 'en-other'];
const clauseKey = (table, row) => (table.id === 'en-other' ? `chapter-${row.id}` : row.id);

/**
 * The checklist page, from the conformance report's model (`acr`, from
 * shared/conformance-report.js), the procedures of its WCAG criteria
 * (`procedures`) and of EN 301 549's own requirements (`enProcedures`, by
 * number: '4.2.1', '12.1', '5'), of the tables of any other standard the
 * report's scans checked against (`standardProcedures`, by standard and
 * version: { [key]: { [version]: { [id]: procedure } } }), and the review the
 * report holds. Chapter 9 of EN 301 549 is the WCAG criteria, so it is not
 * listed twice. The page is in English; `lang` is the language the
 * procedures were read in, for those that don't say (each says its `locale`
 * where loadProcedures gave it).
 */
export function buildManualChecklistHTML({ acr, procedures, enProcedures = null, standardProcedures = null, review = null, levelLabels = {}, lang = 'en', title = '' }) {
    const all = acr && Array.isArray(acr.tables) ? acr.tables : [];
    const tables = all.filter((t) => /^wcag-/.test(t.id));
    // Of chapter 9, only its own requirements: its clauses are the WCAG criteria.
    const enTables = enProcedures
        ? all.filter((t) => EN_OWN.includes(t.id)).map((t) => ({ ...t, rows: t.rows.filter((r) => !r.wcag) })).filter((t) => t.rows.length)
        : [];
    // Another standard's tables, where its procedures were given.
    const otherTables = all.filter((t) => t.standard && t.standard !== 'wcag' && t.standard !== 'en301549' && t.version
        && standardProcedures && standardProcedures[t.standard] && standardProcedures[t.standard][t.version]);
    const otherProcedures = (t) => standardProcedures[t.standard][t.version];
    const otherEntries = (t) => (review && review.standards && review.standards[t.standard] && review.standards[t.standard][t.version]) || {};
    const criteria = review && review.criteria ? review.criteria : {};
    const clauses = review && review.clauses ? review.clauses : {};
    const product = acr && acr.product ? acr.product : {};
    const name = isText(title) ? title : (isText(product.name) ? product.name : 'The report');
    let checks = 0;
    for (const t of tables) for (const r of t.rows) checks += splitFacets(procedures && procedures[r.id]).forPerson.length;
    for (const t of enTables) for (const r of t.rows) checks += splitFacets(enProcedures[r.id]).forPerson.length;
    for (const t of otherTables) for (const r of t.rows) checks += splitFacets(otherProcedures(t)[r.id]).forPerson.length;
    const otherCount = otherTables.reduce((n, t) => n + t.rows.length, 0);
    const count = tables.reduce((n, t) => n + t.rows.length, 0);
    const enCount = enTables.reduce((n, t) => n + t.rows.length, 0);
    const target = acr && acr.target ? `WCAG ${acr.target.wcagVersion} Level ${acr.target.level}` : 'WCAG';
    const en = acr && acr.target && acr.target.en301549 ? `EN 301 549 ${acr.target.en301549}` : 'EN 301 549';
    const body = tables.map((t) => `<section aria-labelledby="t-${esc(t.id)}"><h2 id="t-${esc(t.id)}">${esc(t.title)}</h2>`
        + t.rows.map((r) => criterionHTML(r, procedures && procedures[r.id], criteria[r.id], levelLabels, { lang })).join('')
        + `</section>`).join('')
        + enTables.map((t) => `<section aria-labelledby="t-${esc(t.id)}"><h2 id="t-${esc(t.id)}">${esc(en)}, ${esc(t.title)}</h2>`
        + t.rows.map((r) => criterionHTML(r, enProcedures[r.id], clauses[clauseKey(t, r)], levelLabels, { en: true, lang })).join('')
        + `</section>`).join('')
        + otherTables.map((t) => `<section aria-labelledby="t-${esc(t.id)}"><h2 id="t-${esc(t.id)}">${esc(t.title)}</h2>`
        + t.rows.map((r) => criterionHTML(r, otherProcedures(t)[r.id], otherEntries(t)[r.id], levelLabels, { prefix: t.standard, lang })).join('')
        + `</section>`).join('');
    const others = [...new Set(otherTables.map((t) => t.title.split(':')[0]))];
    const counted = `${count} criteria${enCount ? `, and ${en}'s ${enCount} requirements of its own (its chapter 9 is the WCAG criteria)` : ''}`
        + (otherCount ? `, and ${otherCount} requirements of ${others.join(' and ')}` : '');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}: manual review checklist</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(name)}: manual review checklist</h1>
<p class="meta">${esc(target)}: ${esc(counted)}; ${checks} checks for a person.${isText(product.date) ? ` Report of ${esc(product.date)}.` : ''}</p>
${isText(acr.evaluation && acr.evaluation.pagesNote) ? `<p class="meta">${esc(acr.evaluation.pagesNote)}</p>\n` : ''}<p>What the automated checks of this report could not decide, criterion by criterion: what the scans found, then each check a person makes, with its steps and what passing and failing look like. Results already recorded in the report's conformance review are ticked. This page does not keep what you tick: record your answers and verdicts in the app's Review conformance, which keeps them in the report.</p>
${body}
</main>
</body>
</html>
`;
}
