'use strict';

// "By profile": how much of a comparison each profile it is read on accounts
// for, from the `profiles` a diff engine returns (shared/report-diff.js
// profileBreakdown). Pure string builders, shared by the two-report view and
// the dashboard, so both say it the same way.
//
// Two readings sit side by side, and the section says which is which:
// - the broken elements put down to each profile: each to the one profile
//   that flags it, or to "More than one profile" when several do (WCAG 2.5.8
//   and EN 301 549's 9.2.5.8 flag the same small targets). These add up to
//   the comparison's broken elements;
// - each profile on its own: its problems, failures and score, the reports
//   read on that profile alone. They overlap, so they do not add up, and a
//   score is never split into shares.

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function show(v) { return v == null ? '—' : String(Math.round(v * 100) / 100); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function signed(delta) {
    if (delta == null) return '';
    if (delta === 0) return '±0';
    return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

// "3 → 5" with the change, the arrow decorative and said in words for a
// screen reader.
function fromTo(a, b) {
    const av = num(a);
    const bv = num(b);
    if (av == null && bv == null) return '<span class="byprof-dim">—</span>';
    const delta = av != null && bv != null ? Math.round((bv - av) * 100) / 100 : null;
    return `<span class="num">${show(av)}</span><span aria-hidden="true"> → </span>`
        + `<span class="visually-hidden"> to </span><span class="num">${show(bv)}</span>`
        + (delta == null ? '' : ` <span class="byprof-delta">(${esc(signed(delta))})</span>`);
}

function rowName(row) {
    if (row.kind === 'total') return '<th scope="row">As compared</th>';
    if (row.kind === 'shared') {
        return '<th scope="row">More than one profile'
            + '<span class="byprof-hint">flagged by several, as WCAG 2.5.8 and EN 301 549’s 9.2.5.8 flag the same small target</span></th>';
    }
    return `<th scope="row">${esc(row.label)}</th>`;
}

const INTRO = 'Each broken element is put down to the one profile that flags it. '
    + 'One that more than one flags, because the profiles restate each other or judge the same thing, '
    + 'is counted once, under “More than one profile”, so the elements add up to the comparison’s. '
    + '“On its own” is each profile read alone: its problems, failures and score overlap with the others’, '
    + 'so they do not add up, and a lower score on one profile says where the trouble is, not how much of the total it makes.';

/**
 * The section for two reports. `mode` 'evolution' | 'ab'; `sides` the two
 * columns' names (Baseline/Latest or A/B). '' without a breakdown.
 */
export function pairProfilesHTML(breakdown, { mode = 'evolution', sides = ['Baseline', 'Latest'] } = {}) {
    if (!breakdown || !Array.isArray(breakdown.rows) || !breakdown.rows.length) return '';
    const cats = mode === 'ab'
        ? [['aonly', `Only ${sides[0]}`], ['bonly', `Only ${sides[1]}`], ['both', 'Both']]
        : [['fixed', 'Fixed'], ['new', 'Newly broken'], ['still', 'Still broken']];
    const head = '<tr><th scope="col" rowspan="2">Profile</th>'
        + `<th scope="colgroup" colspan="${cats.length + 1}">Broken elements</th>`
        + '<th scope="colgroup" colspan="3">On its own</th></tr>'
        + '<tr>' + cats.map(([, name]) => `<th scope="col">${esc(name)}</th>`).join('')
        + '<th scope="col">In each</th><th scope="col">Problems</th><th scope="col">Failures</th><th scope="col">Score</th></tr>';
    const body = breakdown.rows.map((row) => {
        const change = row.change || {};
        const [a, b] = row.columns;
        return `<tr class="byprof-row byprof-row--${esc(row.kind)}">${rowName(row)}`
            + cats.map(([key]) => `<td class="num">${num(change[key]) == null ? '—' : change[key]}</td>`).join('')
            + `<td>${fromTo(a.elements, b.elements)}</td>`
            + `<td>${fromTo(a.problems, b.problems)}</td><td>${fromTo(a.failures, b.failures)}</td><td>${fromTo(a.score, b.score)}</td></tr>`;
    }).join('');
    return section(breakdown, `<thead>${head}</thead><tbody>${body}</tbody>`, sides);
}

/**
 * The section for a series: a column per report, each cell the broken
 * elements put down to the row there, then the profile on its own: its
 * problems and failures, and its score. `labels` the columns' names. ''
 * without a breakdown.
 */
export function seriesProfilesHTML(breakdown, { labels = [] } = {}) {
    if (!breakdown || !Array.isArray(breakdown.rows) || !breakdown.rows.length) return '';
    const head = '<tr><th scope="col">Profile</th>'
        + labels.map((l) => `<th scope="col">${esc(l)}</th>`).join('') + '</tr>';
    const body = breakdown.rows.map((row) => {
        const cells = row.columns.map((c) => {
            const own = row.kind === 'shared' || num(c.problems) == null
                ? ''
                : `<span class="byprof-hint">${row.kind === 'total' ? '' : 'on its own: '}${esc(plural(c.problems, 'problem', 'problems'))}, ${esc(plural(c.failures, 'failure', 'failures'))}</span>`;
            const score = row.kind === 'shared' || num(c.score) == null
                ? ''
                : `<span class="byprof-score">score <span class="num">${show(c.score)}</span></span>`;
            return `<td><span class="num">${c.elements}</span> broken ${c.elements === 1 ? 'element' : 'elements'}${own}${score}</td>`;
        }).join('');
        return `<tr class="byprof-row byprof-row--${esc(row.kind)}">${rowName(row)}${cells}</tr>`;
    }).join('');
    return section(breakdown, `<thead>${head}</thead><tbody>${body}</tbody>`, labels);
}

function section(breakdown, table, columnNames) {
    const names = breakdown.profiles.map((p) => p.label).join(' + ');
    return `<section class="cmp2-sec byprof"><div class="sec-head"><h3>By profile</h3>`
        + `<span class="layer">${esc(names)}</span></div>`
        + `<p class="dash-sub">${esc(INTRO)}</p>`
        + leadingSentence(breakdown, columnNames)
        + `<div class="dash-table-scroll"><table class="doc-table byprof-table">`
        + `<caption class="visually-hidden">Broken elements put down to each profile, and each profile on its own</caption>`
        + `${table}</table></div></section>`;
}

/**
 * The profile that accounts for most of the latest report's broken
 * elements, when one does: { label, elements, of }, or null when none
 * stands out or there are none.
 */
export function leadingProfile(breakdown) {
    if (!breakdown || !Array.isArray(breakdown.rows)) return null;
    const total = breakdown.rows.find((r) => r.kind === 'total');
    if (!total || !total.columns.length) return null;
    const last = total.columns.length - 1;
    const all = total.columns[last].elements;
    if (!all) return null;
    const ranked = breakdown.rows.filter((r) => r.kind === 'profile')
        .map((r) => ({ label: r.label, elements: r.columns[last].elements }))
        .sort((x, y) => y.elements - x.elements);
    const top = ranked[0];
    if (!top || !top.elements || top.elements * 2 <= all) return null;
    return { label: top.label, elements: top.elements, of: all };
}

function leadingSentence(breakdown, columnNames) {
    const lead = leadingProfile(breakdown);
    if (!lead) return '';
    const where = columnNames[columnNames.length - 1];
    return `<p class="byprof-lead">${esc(`Only ${lead.label} flags ${lead.elements} of the ${plural(lead.of, 'broken element', 'broken elements')} in ${where}.`)}</p>`;
}
