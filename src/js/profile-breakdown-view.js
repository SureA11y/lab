'use strict';

// "By profile": how much of a comparison each profile it is read on accounts
// for, from the `profiles` a diff engine returns (shared/report-diff.js
// profileBreakdown). Pure string builders, shared by the two-report view and
// the dashboard, so both say it the same way.
//
// Two readings sit side by side, and the section says which is which:
// - the problems put down to each profile: each failing problem to the one
//   profile it fails under, or to "More than one profile". These add up to
//   the comparison's own numbers;
// - each profile's score: the reports scored again on that profile alone.
//   Scores do not add up, so they are never split into shares.

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
    const delta = av != null && bv != null ? Math.round((bv - av) * 100) / 100 : null;
    return `<span class="num">${show(av)}</span><span aria-hidden="true"> → </span>`
        + `<span class="visually-hidden"> to </span><span class="num">${show(bv)}</span>`
        + (delta == null ? '' : ` <span class="byprof-delta">(${esc(signed(delta))})</span>`);
}

function rowName(row) {
    if (row.kind === 'total') return '<th scope="row">As compared</th>';
    if (row.kind === 'shared') {
        return '<th scope="row">More than one profile'
            + '<span class="byprof-hint">fails under several, or is a best practice every profile keeps</span></th>';
    }
    return `<th scope="row">${esc(row.label)}</th>`;
}

// What a profile reads on its own, shared problems included: said under its
// name, since it is not part of the sum.
function aloneHint(row) {
    if (!Array.isArray(row.alone) || row.alone.length !== 2) return '';
    const [a, b] = row.alone.map((c) => c.problems);
    return `<span class="byprof-hint">on its own, shared ones included: from ${a} to ${b} ${b === 1 ? 'problem' : 'problems'}</span>`;
}

const INTRO = 'Each failing problem is put down to the one profile it fails under. '
    + 'One that fails under more than one, like a rule two profiles both judge, is counted once, under '
    + '“More than one profile”, so the rows add up to the comparison. '
    + 'A profile’s score is the report scored again on that profile alone: scores do not add up, '
    + 'so a lower score on one profile says where the trouble is, not how much of the total it makes.';

/**
 * The section for two reports. `mode` 'evolution' | 'ab'; `sides` the two
 * columns' names (Baseline/Latest or A/B). '' without a breakdown.
 */
export function pairProfilesHTML(breakdown, { mode = 'evolution', sides = ['Baseline', 'Latest'] } = {}) {
    if (!breakdown || !Array.isArray(breakdown.rows) || !breakdown.rows.length) return '';
    const cats = mode === 'ab'
        ? [['aonly', `Only ${sides[0]}`], ['bonly', `Only ${sides[1]}`], ['both', 'Both']]
        : [['resolved', 'Fixed'], ['new', 'Newly failing'], ['persistent', 'Still failing']];
    const head = '<tr><th scope="col">Profile</th>'
        + cats.map(([, name]) => `<th scope="col">${esc(name)}</th>`).join('')
        + `<th scope="col">Problems</th><th scope="col">Failures</th><th scope="col">Score on it alone</th></tr>`;
    const body = breakdown.rows.map((row) => {
        const change = row.change || {};
        const [a, b] = row.columns;
        const name = rowName(row).replace('</th>', `${aloneHint(row)}</th>`);
        const scoreCell = row.kind === 'shared'
            ? '<td><span class="byprof-dim">—</span></td>'
            : `<td>${fromTo(a.score, b.score)}</td>`;
        return `<tr class="byprof-row byprof-row--${esc(row.kind)}">${name}`
            + cats.map(([key]) => `<td class="num">${num(change[key]) == null ? '—' : change[key]}</td>`).join('')
            + `<td>${fromTo(a.problems, b.problems)}</td><td>${fromTo(a.failures, b.failures)}</td>${scoreCell}</tr>`;
    }).join('');
    return section(breakdown, `<thead>${head}</thead><tbody>${body}</tbody>`, sides);
}

/**
 * The section for a series: a column per report, each cell the problems and
 * failures put down to the row there, and the score on that profile alone.
 * `labels` the columns' names. '' without a breakdown.
 */
export function seriesProfilesHTML(breakdown, { labels = [] } = {}) {
    if (!breakdown || !Array.isArray(breakdown.rows) || !breakdown.rows.length) return '';
    const head = '<tr><th scope="col">Profile</th>'
        + labels.map((l) => `<th scope="col">${esc(l)}</th>`).join('') + '</tr>';
    const body = breakdown.rows.map((row) => {
        const cells = row.columns.map((c) => {
            const score = row.kind === 'shared' || num(c.score) == null
                ? ''
                : `<span class="byprof-score">score <span class="num">${show(c.score)}</span></span>`;
            return `<td><span class="num">${c.problems}</span> ${c.problems === 1 ? 'problem' : 'problems'}`
                + `<span class="byprof-hint">${esc(plural(c.failures, 'failure', 'failures'))}</span>${score}</td>`;
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
        + `<caption class="visually-hidden">Problems put down to each profile, and each profile’s score on its own</caption>`
        + `${table}</table></div></section>`;
}

/**
 * The profile that accounts for most of the latest report's problems, said
 * in a sentence, when one does: "WAI-ARIA 1.2 accounts for 7 of the 9
 * problems in Latest." '' when none stands out or there are none.
 */
export function leadingProfile(breakdown) {
    if (!breakdown || !Array.isArray(breakdown.rows)) return null;
    const total = breakdown.rows.find((r) => r.kind === 'total');
    if (!total || !total.columns.length) return null;
    const last = total.columns.length - 1;
    const all = total.columns[last].problems;
    if (!all) return null;
    const ranked = breakdown.rows.filter((r) => r.kind === 'profile')
        .map((r) => ({ label: r.label, problems: r.columns[last].problems }))
        .sort((x, y) => y.problems - x.problems);
    const top = ranked[0];
    if (!top || !top.problems || top.problems * 2 <= all) return null;
    return { label: top.label, problems: top.problems, of: all };
}

function leadingSentence(breakdown, columnNames) {
    const lead = leadingProfile(breakdown);
    if (!lead) return '';
    const where = columnNames[columnNames.length - 1];
    return `<p class="byprof-lead">${esc(`${lead.label} alone accounts for ${lead.problems} of the ${plural(lead.of, 'problem', 'problems')} in ${where}.`)}</p>`;
}
