// The manual review checklist: a page to download, print or share, with what
// a report leaves for a person, criterion by criterion. For each WCAG
// criterion of its target: what the scans found, the verdict recorded so far,
// and the checks a person makes (core's procedures, procedures.js), each with
// its steps, what passing and failing look like, and a result to tick.

import { splitFacets, ANSWERS } from './procedures.js';

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

function checkHTML(f, criterion, answer) {
    const p = f.procedure;
    const name = `c-${safeId(criterion)}-${safeId(f.id)}`;
    const tools = (Array.isArray(f.tools) ? f.tools : []).map((t) => t && t.label).filter(isText);
    const options = ANSWERS.filter(([value]) => value).map(([value, label]) => {
        const id = `${name}-${value}`;
        return `<label for="${esc(id)}"><input type="radio" id="${esc(id)}" name="${esc(name)}" value="${value}"${answer === value ? ' checked' : ''}/>${esc(label)}</label>`;
    }).join('');
    return `<li class="check">`
        + `<p><strong>${esc(f.label)}</strong>${f.automation === 'partial' ? ' (automated checks decide part of it)' : ''}</p>`
        + (tools.length ? `<p class="meta"><span class="term">You need:</span> ${esc(tools.join(', '))}</p>` : '')
        + `<ol class="steps">${p.steps.filter(isText).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
        + (isText(p.passWhen) ? `<p><span class="term">Passes:</span> ${esc(p.passWhen)}</p>` : '')
        + (isText(p.failWhen) ? `<p><span class="term">Fails:</span> ${esc(p.failWhen)}</p>` : '')
        + `<fieldset><legend><span class="visually-hidden">${esc(f.label)}: </span>Result</legend>${options}</fieldset>`
        + `</li>`;
}

function criterionHTML(row, procedure, entry, levelLabels) {
    const { forPerson, automatic } = splitFacets(procedure);
    const found = row.draft && isText(row.draft.remarks) ? row.draft.remarks : '';
    const verdict = entry && entry.conformance && levelLabels[entry.conformance] ? levelLabels[entry.conformance] : '';
    return `<section aria-labelledby="h-${esc(safeId(row.id))}">`
        + `<h3 id="h-${esc(safeId(row.id))}">${esc(row.id)} ${esc(row.name)}${row.level ? ` (Level ${esc(row.level)})` : ''}</h3>`
        + (found ? `<p class="found"><span class="term">What the scans found:</span> ${esc(found)}</p>` : '')
        + (verdict ? `<p class="verdict"><span class="term">Recorded so far:</span> ${esc(verdict)}${isText(entry.remarks) ? `. ${esc(entry.remarks)}` : ''}</p>` : '')
        + (forPerson.length
            ? `<ol class="checks">${forPerson.map((f) => checkHTML(f, row.id, entry && entry.facets && entry.facets[f.id])).join('')}</ol>`
            : `<p class="meta">${procedure ? 'Automated checks decide this criterion in full.' : 'No procedure for this criterion yet: check it against its Understanding document.'}</p>`)
        + (automatic.length ? `<p class="automatic"><span class="term">Automated checks decide:</span> ${automatic.map((f) => esc(f.label)).join('; ')}.</p>` : '')
        + `</section>`;
}

/**
 * The checklist page, from the conformance report's model (`acr`, from
 * shared/conformance-report.js), the procedures of its criteria, and the
 * review the report holds.
 */
export function buildManualChecklistHTML({ acr, procedures, review = null, levelLabels = {}, lang = 'en', title = '' }) {
    const tables = (acr && Array.isArray(acr.tables) ? acr.tables : []).filter((t) => /^wcag-/.test(t.id));
    const criteria = review && review.criteria ? review.criteria : {};
    const product = acr && acr.product ? acr.product : {};
    const name = isText(title) ? title : (isText(product.name) ? product.name : 'The report');
    let checks = 0;
    for (const t of tables) for (const r of t.rows) checks += splitFacets(procedures && procedures[r.id]).forPerson.length;
    const count = tables.reduce((n, t) => n + t.rows.length, 0);
    const target = acr && acr.target ? `WCAG ${acr.target.wcagVersion} Level ${acr.target.level}` : 'WCAG';
    const body = tables.map((t) => `<section aria-labelledby="t-${esc(t.id)}"><h2 id="t-${esc(t.id)}">${esc(t.title)}</h2>`
        + t.rows.map((r) => criterionHTML(r, procedures && procedures[r.id], criteria[r.id], levelLabels)).join('')
        + `</section>`).join('');
    return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}: manual review checklist</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(name)}: manual review checklist</h1>
<p class="meta">${esc(target)}: ${count} criteria, ${checks} checks for a person.${isText(product.date) ? ` Report of ${esc(product.date)}.` : ''}</p>
<p>What the automated checks of this report could not decide, criterion by criterion: what the scans found, then each check a person makes, with its steps and what passing and failing look like. Results already recorded in the report's conformance review are ticked. This page does not keep what you tick: record your answers and verdicts in the app's Review conformance, which keeps them in the report.</p>
${body}
</main>
</body>
</html>
`;
}
