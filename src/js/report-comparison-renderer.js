'use strict';

// Renders the Compare tab from a diffReports() result (shared/report-diff.js) into the
// mockup layout: report chips, verdict hero, KPI cards, a dumbbell severity
// chart, a deterministic narrative, and the rule-by-rule finding diff with
// occurrence drill-down. Pure string builders (unit-tested in Node, no DOM);
// renderComparison() wraps into nodes. Supports both framings — 'evolution'
// (directional) and 'ab' (symmetric). Markup is namespaced under `.cmp2` so the
// mockup class names don't collide with app styles.

import { mastheadHTML, provenanceHTML, sharedProfilesNoteHTML } from './comparison-document.js';
import { formatMarginLimit, formatMarginRoom, formatMarginValue, isNearMiss } from './margins.js';
import { failureUnitNote, problemKind } from './failure-units.js';
import { pairProfilesHTML } from './profile-breakdown-view.js';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}
function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? esc(iso)
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function n(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }
// Round to at most 2 decimals for display; integers stay integers (scores can
// arrive as long means like 67.45054945…).
function round2(v) { return Math.round(v * 100) / 100; }
function show(v) { return v == null ? '—' : String(typeof v === 'number' ? round2(v) : v); }

const CAT_LABEL = {
    resolved: 'Problems fixed', new: 'Problems newly failing', persistent: 'Problems still failing',
    aonly: 'Fails only on A', bonly: 'Fails only on B', both: 'Fails on both',
};
const OCC_LABEL = {
    fixed: 'Fixed', still: 'Still', new: 'New',
    aonly: 'Only A', bonly: 'Only B', both: 'Both',
};
const EVOLUTION_CATS = ['resolved', 'new', 'persistent'];
const AB_CATS = ['aonly', 'bonly', 'both'];

// ---------- report chips ----------

function tags(identity) {
    const t = Array.isArray(identity.scanTags) ? identity.scanTags : [];
    return t.length ? ` · ${t.map(esc).join(', ')}` : '';
}
function reportChip(identity, pages, role, letter, mode) {
    const cls = mode === 'ab'
        ? (letter === 'A' ? 'a' : 'b')
        : (letter === 'A' ? 'baseline' : 'latest');
    const roleLine = mode === 'ab'
        ? `<span class="tok">${letter}</span> ${esc(identity.label)}`
        : `${esc(role)} · ${letter}`;
    return `<div class="report-chip ${cls}"><span class="swatch"></span>`
        + `<span class="role">${roleLine}</span>`
        + `<span class="file mono">${esc(identity.label)}</span>`
        + `<span class="meta">${esc(pages)} pages · ${esc(fmtDate(identity.timestamp))}${tags(identity)}</span>`
        + `</div>`;
}
function reportsRow(d) {
    const roleA = d.mode === 'ab' ? '' : 'Baseline';
    const roleB = d.mode === 'ab' ? '' : 'Latest';
    return `<div class="reports-row">`
        + reportChip(d.identityA, d.stats.pagesA, roleA, 'A', d.mode)
        + `<div class="vs">vs</div>`
        + reportChip(d.identityB, d.stats.pagesB, roleB, 'B', d.mode)
        + `</div>`;
}

// ---------- verdict hero ----------

// Every count in this tab is a problem, a failure or a broken element, and
// the difference is the whole reason a run can improve without fixing a
// single problem, so the hero spells it out once rather than leaving it to
// be inferred from the numbers. What a problem is depends on how the reports
// were read: by criterion (the default) or by rule.
function unitsNote(d) {
    const kind = problemKind(d.rows);
    const what = kind === 'rules'
        ? 'A problem is one rule, like buttons needing an accessible name. '
        : `A problem is one of the ${kind} the scan checks, like 4.1.2 Name, Role, Value. `;
    return what + failureUnitNote(kind) + ' A broken element is counted once, whatever it breaks.';
}

function verdictHero(d) {
    const v = d.verdict;
    if (d.mode === 'ab') {
        const sA = n(d.stats.scoreA), sB = n(d.stats.scoreB);
        const diff = (sA != null && sB != null) ? round2(sB - sA) : null;
        const diffTxt = diff == null ? '' : (diff === 0 ? 'tie' : (diff > 0 ? `B +${diff}` : `A +${round2(-diff)}`));
        return `<div class="verdict"><div class="left">`
            + `<span class="badge">${esc(v.badge)}</span>`
            + `<h2>${esc(v.headline)} — <span class="cb">B</span> and <span class="ca">A</span> compared.</h2>`
            + `<p class="lead">${esc(v.lead)}</p>`
            + `<p class="disclaim">Standings only — the call between A and B is yours.</p>`
            + `<p class="disclaim">${esc(unitsNote(d))}</p>`
            + sharedProfilesNoteHTML(d.document)
            + `</div><div class="right">`
            + `<div class="rtitle">Automated accessibility result</div>`
            + `<div class="flow-row">`
            + `<div class="flow-tile ta"><div class="lab">A</div><div class="big num">${show(sA)}</div><div class="cap">/ 100</div></div>`
            + `<div class="flow-mid"><div class="vs2">vs</div><div class="d">${esc(diffTxt)}</div></div>`
            + `<div class="flow-tile tb"><div class="lab">B</div><div class="big num">${show(sB)}</div><div class="cap">/ 100</div></div>`
            + `</div></div></div>`;
    }
    // evolution
    const arrow = v.net === 0 ? '±' : (v.net < 0 ? '−' : '+');
    const rules = (c) => `across ${c} ${c === 1 ? 'kind' : 'kinds'} of problem`;
    return `<div class="verdict"><div class="left">`
        + `<span class="badge badge--${v.tone}">${esc(v.badge)}</span>`
        + `<h2>Accessibility <span class="accent accent--${v.tone}">${esc(v.headline)}</span> between these two runs.</h2>`
        + `<p class="lead">${esc(v.lead)}</p>`
        + `<p class="disclaim">${esc(unitsNote(d))}</p>`
        + sharedProfilesNoteHTML(d.document)
        + `</div><div class="right">`
        + `<div class="flow-row">`
        + `<div class="flow-tile a"><div class="lab">Baseline</div><div class="big num">${d.stats.failuresA}</div>`
        + `<div class="cap">failures</div><div class="flow-sub">${esc(rules(d.stats.rulesA))}</div></div>`
        + `<div class="flow-arrow flow-arrow--${v.tone}"><div class="d">${arrow}${Math.abs(v.net)}</div>`
        + `<svg viewBox="0 0 30 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 8h23M20 3l5 5-5 5"/></svg></div>`
        + `<div class="flow-tile b"><div class="lab">Latest</div><div class="big num">${d.stats.failuresB}</div>`
        + `<div class="cap">failures</div><div class="flow-sub">${esc(rules(d.stats.rulesB))}</div></div>`
        + `</div></div></div>`;
}

// ---------- KPI cards ----------

function evoKpi(name, a, b, goodDir, unit) {
    const av = n(a), bv = n(b);
    const delta = (av != null && bv != null) ? round2(bv - av) : null;
    let tone = 'neutral';
    if (delta != null && delta !== 0) {
        const improved = goodDir === 'down' ? delta < 0 : delta > 0;
        tone = improved ? 'good' : 'bad';
    }
    // The glyph repeats the sign, so it is decorative; the sign and the
    // improved/worsened word carry the direction without relying on hue.
    const glyph = delta == null ? '' : (delta > 0 ? '▲' : (delta < 0 ? '▼' : '±'));
    const sign = delta == null ? '' : (delta > 0 ? '+' : (delta < 0 ? '−' : ''));
    const dtxt = delta == null
        ? '—'
        : `<span aria-hidden="true">${glyph} </span>${sign}${Math.abs(delta)}`;
    const toneWord = tone === 'good' ? 'improved' : (tone === 'bad' ? 'worsened' : 'no change');
    return `<div class="kpi ${tone}"><span class="stripe"></span>`
        + `<div class="name">${esc(name)}</div>`
        + `<div class="vals"><span class="from num">${show(av)}</span>`
        + `<span class="arrow" aria-hidden="true">→</span><span class="visually-hidden"> to </span>`
        + `<span class="to num">${show(bv)}</span></div>`
        + `<div class="delta">${dtxt} <span class="unit">${esc(unit)}</span>`
        + (delta == null ? '' : `<span class="visually-hidden">, ${toneWord}</span>`)
        + `</div></div>`;
}
function abKpiPair(name, a, b, goodDir) {
    const av = n(a), bv = n(b);
    let win = 'both';
    if (av != null && bv != null && av !== bv) {
        const aWins = goodDir === 'down' ? av < bv : av > bv;
        win = aWins ? 'a' : 'b';
    }
    const tagTxt = win === 'a' ? 'A' : (win === 'b' ? 'B' : 'level');
    return `<div class="kpi win-${win}"><span class="stripe"></span>`
        + `<div class="name">${esc(name)}</div>`
        + `<div class="pair"><span class="va num">${show(av)}</span><span class="sep">·</span><span class="vb num">${show(bv)}</span></div>`
        + `<div class="tag">${esc(tagTxt === 'level' ? 'level' : tagTxt + ' leads')}</div></div>`;
}
function abKpiSingle(name, val, win, tag) {
    return `<div class="kpi win-${win}"><span class="stripe"></span>`
        + `<div class="name">${esc(name)}</div>`
        + `<div class="single num">${show(val)}</div>`
        + `<div class="tag">${esc(tag)}</div></div>`;
}
// A score with no scale beside it reads as a count: "3" next to failures in
// the thousands looks like a small number, not a low mark.
const SCORE_NAME = 'Accessibility score (out of 100)';

function kpis(d) {
    const s = d.stats;
    // When every failure on both sides is serious or critical, that card would
    // repeat Failures figure for figure, so it is left out and the section's
    // note says why.
    const allSerious = s.seriousCriticalA === s.failuresA && s.seriousCriticalB === s.failuresB;
    let cards;
    if (d.mode === 'ab') {
        cards = [
            abKpiPair(SCORE_NAME, s.scoreA, s.scoreB, 'up'),
            abKpiPair('Failures', s.failuresA, s.failuresB, 'down'),
            abKpiPair('Broken elements', s.elementsA, s.elementsB, 'down'),
            allSerious ? '' : abKpiPair('Serious or critical', s.seriousCriticalA, s.seriousCriticalB, 'down'),
            abKpiPair('Kinds of problem', s.rulesA, s.rulesB, 'down'),
            abKpiSingle('Fails only on A', d.verdict.aOnly, 'a', "A's gaps"),
            abKpiSingle('Fails only on B', d.verdict.bOnly, 'b', "B's gaps"),
        ];
    } else {
        cards = [
            evoKpi(SCORE_NAME, s.scoreA, s.scoreB, 'up', 'points'),
            evoKpi('Failures', s.failuresA, s.failuresB, 'down', 'failures'),
            evoKpi('Broken elements', s.elementsA, s.elementsB, 'down', 'elements'),
            allSerious ? '' : evoKpi('Serious or critical', s.seriousCriticalA, s.seriousCriticalB, 'down', 'failures'),
            evoKpi('Kinds of problem', s.rulesA, s.rulesB, 'down', 'kinds'),
            evoKpi('Confidence in the score', s.confidenceA, s.confidenceB, 'up', 'points'),
        ];
    }
    // The standings cards go four to a row: the counts, then what only one
    // side fails. The evolution cards go three to a row.
    const note = allSerious && s.failuresA + s.failuresB > 0
        ? '<p class="dash-sub">Every failure here is serious or critical.</p>'
        : '';
    return `${note}<div class="kpis${d.mode === 'ab' ? ' kpis-ab' : ''}">${cards.join('')}</div>`;
}

// ---------- dumbbell chart ----------

// A round step (1, 2 or 5 times a power of ten) giving about five ticks up
// to `max`: a fixed step drew hundreds of ticks once counts ran to thousands.
export function niceStep(max) {
    const raw = Math.max(max, 1) / 5;
    const power = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / power;
    return Math.max(1, (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power);
}

function dumbbellSvg(d) {
    const bands = ['critical', 'serious', 'moderate', 'minor']
        .map((sev) => ({ sev, a: d.severity.a[sev] || 0, b: d.severity.b[sev] || 0 }))
        .filter((x) => x.a > 0 || x.b > 0);
    if (!bands.length) return '';

    const W = 560, H = 40 + bands.length * 48, padL = 82, padR = 34, padT = 14, padB = 30;
    const plotW = W - padL - padR;
    const rowH = (H - padT - padB) / bands.length;
    const rawMax = Math.max(...bands.map((x) => Math.max(x.a, x.b)), 1);
    const step = niceStep(rawMax);
    const max = Math.ceil(rawMax / step) * step;
    const x = (v) => padL + (v / max) * plotW;

    let els = '';
    for (let t = 0; t <= max; t += step) {
        els += `<line class="db-track" x1="${x(t)}" y1="${padT}" x2="${x(t)}" y2="${H - padB}"/>`;
        els += `<text class="db-axis" x="${x(t)}" y="${H - padB + 14}" text-anchor="middle">${t.toLocaleString('en')}</text>`;
    }
    els += `<text class="db-axis" x="${padL + plotW / 2}" y="${H - 2}" text-anchor="middle">failures</text>`;

    bands.forEach((dd, i) => {
        const cy = padT + rowH * i + rowH / 2;
        const xa = x(dd.a), xb = x(dd.b);
        const improved = dd.b < dd.a;
        const lineCol = dd.b === dd.a ? 'var(--neutral)' : (improved ? 'var(--good-line)' : 'var(--bad-line)');
        const cap = dd.sev.charAt(0).toUpperCase() + dd.sev.slice(1);
        els += `<text class="db-sev" x="${padL - 12}" y="${cy + 4}" text-anchor="end">${cap}</text>`;
        els += `<line class="db-conn" x1="${xa}" y1="${cy}" x2="${xb}" y2="${cy}" stroke="${lineCol}"/>`;
        els += `<circle class="db-a" cx="${xa}" cy="${cy}" r="6"><title>${cap} · A ${dd.a}</title></circle>`;
        els += `<circle class="db-b" cx="${xb}" cy="${cy}" r="7"><title>${cap} · B ${dd.b}</title></circle>`;
        const dv = dd.b - dd.a;
        const label = `${dv > 0 ? '+' : (dv < 0 ? '−' : '±')}${Math.abs(dv).toLocaleString('en')}`;
        // Sit the value above dot B so it never collides with the severity
        // axis label when the Latest dot sits near the left edge. Near a plot
        // edge, pin the label inside the plot so it doesn't lean into the
        // margin when the dot lands on the last gridline (~6.2px/glyph).
        const half = (label.length * 6.2) / 2;
        let lx = xb, anchor = 'middle';
        if (xb + half > W - padR) { lx = W - padR; anchor = 'end'; }
        else if (xb - half < padL) { lx = padL; anchor = 'start'; }
        els += `<text class="db-val" x="${lx}" y="${cy - 12}" text-anchor="${anchor}" fill="${lineCol}">${label}</text>`;
    });

    const legend = d.mode === 'ab'
        ? `<span><span class="m a"></span>A</span><span><span class="m b"></span>B</span>`
        : `<span><span class="m a"></span>Baseline</span><span><span class="m b"></span>Latest</span>`;
    const chartTitle = 'Failures by severity';
    const sideA = d.mode === 'ab' ? 'A' : 'Baseline';
    const sideB = d.mode === 'ab' ? 'B' : 'Latest';

    // The plot is decorative to assistive tech; the values ship as a table
    // because <title> on a shape is not exposed once the svg is one role="img".
    const dataRows = bands.map((dd) => {
        const cap = dd.sev.charAt(0).toUpperCase() + dd.sev.slice(1);
        const dv = dd.b - dd.a;
        const change = dv === 0 ? 'no change' : `${dv > 0 ? '+' : '−'}${Math.abs(dv)}`;
        return `<tr><th scope="row">${esc(cap)}</th>`
            + `<td>${dd.a}</td><td>${dd.b}</td><td>${esc(change)}</td></tr>`;
    }).join('');

    return `<div class="chart-title"><span class="t">${chartTitle}</span>`
        + `<div class="legend">${legend}</div></div>`
        + `<svg class="dumbbell" viewBox="0 0 ${W} ${H}" aria-hidden="true">${els}</svg>`
        // Hidden in a div: a table grows to its content whatever its width,
        // so hidden itself it ran past a phone's screen.
        + `<div class="visually-hidden"><table><caption>${esc(chartTitle)}</caption>`
        + `<thead><tr><th scope="col">Severity</th><th scope="col">${esc(sideA)}</th>`
        + `<th scope="col">${esc(sideB)}</th><th scope="col">Change</th></tr></thead>`
        + `<tbody>${dataRows}</tbody></table></div>`;
}

// ---------- narrative ----------

function narrativePanel(d) {
    const paras = (d.narrative || []).map((p) => `<p>${esc(p)}</p>`).join('');
    return `<div class="panel narrative"><h4>Reading the ${d.mode === 'ab' ? 'standings' : 'change'}</h4>`
        + paras + `</div>`;
}

// ---------- finding diff ----------

function countMove(row, mode) {
    if (mode === 'ab') {
        let chg;
        if (row.category === 'aonly') chg = `<span class="chg a">only A</span>`;
        else if (row.category === 'bonly') chg = `<span class="chg b">only B</span>`;
        else {
            const dv = row.delta;
            chg = `<span class="chg both">both${dv ? ` · B ${dv < 0 ? '−' : '+'}${Math.abs(dv)}` : ''}</span>`;
        }
        return `<span class="count-move"><span class="ca num">A ${row.aCount}</span>`
            + `<span class="sep" aria-hidden="true">·</span> `
            + `<span class="cb num">B ${row.bCount}</span> ${chg}</span>`;
    }
    const dv = row.delta;
    const cls = dv < 0 ? 'down' : (dv > 0 ? 'up' : 'same');
    const chgTxt = dv < 0
        ? `−${-dv}`
        : (dv > 0 ? `+${dv}` : `<span aria-hidden="true">±0</span><span class="visually-hidden">no change</span>`);
    return `<span class="count-move"><span class="c-a num">${row.aCount}</span>`
        + `<span class="c-arrow" aria-hidden="true">→</span><span class="visually-hidden"> to </span>`
        + `<span class="c-b num">${row.bCount}</span> <span class="chg ${cls}">${chgTxt}</span></span>`;
}

function occDetail(row, mode) {
    if (!row.occ || !row.occ.length) return '';
    const shown = row.occ.slice(0, 6);
    const items = shown.map((o) => {
        const path = (() => { try { return new URL(o.pageUrl).pathname; } catch { return o.pageUrl || ''; } })();
        return `<div class="occ-item"><span class="occ-tag ${o.tag}">${esc(OCC_LABEL[o.tag] || o.tag)}</span>`
            + `<div><div class="occ-sel">${esc(o.target || '(element)')}</div>`
            + `<div class="occ-where">on <span class="u">${esc(path)}</span></div></div></div>`;
    }).join('');
    const more = row.occ.length > shown.length ? ` (showing first ${shown.length} of ${row.occ.length})` : '';
    return `<div class="occ"><div class="occ-head">Failures${esc(more)}</div>${items}</div>`;
}

// lang="fr" on a title written in another language than the page, such as
// an RGAA rollup's, so a screen reader pronounces it correctly.
function langAttr(lang) {
    const l = typeof lang === 'string' ? lang.trim() : '';
    return l && l.toLowerCase() !== 'en' && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(l) ? ` lang="${esc(l)}"` : '';
}

// "Sample Standard 1, 2": another standard's requirements a rule's findings
// named, one span per standard, as RGAA's are.
function standardsHtml(standards) {
    return (Array.isArray(standards) ? standards : [])
        .filter((s) => s && s.standard && Array.isArray(s.requirements) && s.requirements.length)
        .map((s) => ` <span class="wcag">${esc(s.standard)} ${esc(s.requirements.join(', '))}</span>`)
        .join('');
}

function diffRow(row, mode) {
    const rgaa = Array.isArray(row.rgaa) ? row.rgaa : [];
    return `<details class="diff-row"><summary class="diff-summary">`
        + `<span class="sev-dot sev-${esc(row.severity)}"></span>`
        + `<span class="rule-cell"><span class="rule"${langAttr(row.titleLang)}>${esc(row.title)}</span>`
        + (row.wcag ? ` <span class="wcag">WCAG ${esc(row.wcag)}</span>` : '')
        + (rgaa.length ? ` <span class="wcag">RGAA ${esc(rgaa.join(', '))}</span>` : '')
        + standardsHtml(row.standards)
        + `<br><span class="rid">${esc(row.ruleId)} · ${row.pages} ${row.pages === 1 ? 'page' : 'pages'}</span></span>`
        + `<span class="sev-label">${esc(row.severity)}</span>`
        + countMove(row, mode)
        + `<span class="caret" aria-hidden="true">▸</span>`
        + `</summary>${occDetail(row, mode)}</details>`;
}

function findingDiff(d) {
    const cats = d.mode === 'ab' ? AB_CATS : EVOLUTION_CATS;
    const activeCat = d.mode === 'ab' ? 'aonly' : 'persistent';

    const segs = cats.map((c) => {
        const count = (d.groups[c] || []).length;
        const sel = c === activeCat;
        // Roving tabindex: only the selected tab is in the tab order, the rest
        // are reached with the arrow keys the click handlers wire up.
        return `<button class="seg" role="tab" data-k="${c}" id="cmp-tab-${esc(c)}"`
            + ` aria-controls="cmp-pane-${esc(c)}" aria-selected="${sel}" tabindex="${sel ? '0' : '-1'}">`
            + `<span class="swatch" aria-hidden="true"></span><span class="cnt num">${count}</span> `
            + `<span class="lab">${esc(CAT_LABEL[c])}</span></button>`;
    }).join('');

    const panes = cats.map((c) => {
        const rows = d.groups[c] || [];
        const body = rows.length
            ? `<div class="diff-table">${rows.map((r) => diffRow(r, d.mode)).join('')}</div>`
            : `<p class="diff-empty">No rules in this group.</p>`;
        return `<div class="pane ${c === activeCat ? 'active' : ''}" data-pane="${c}"`
            + ` id="cmp-pane-${esc(c)}" role="tabpanel" aria-labelledby="cmp-tab-${esc(c)}" tabindex="0">`
            + `${body}</div>`;
    }).join('');

    return `<section class="cmp2-sec"><div class="sec-head"><h3>${d.mode === 'ab' ? 'Problem by problem' : 'What changed, problem by problem'}</h3>`
        + `<span class="layer">drill down</span></div>`
        + `<div class="segbar" role="tablist" aria-label="Change category">${segs}</div>${panes}</section>`;
}

// ---------- room before failing ----------

const MARGIN_CHANGE = {
    evolution: { failsMore: 'Fails on more elements', closer: 'Closer to failing', further: 'More room', same: 'No change', bonly: 'Newly measured', aonly: 'No longer measured' },
    ab: { failsMore: 'Fails on more elements on B', closer: 'Less room on B', further: 'More room on B', same: 'Same room', bonly: 'Only B', aonly: 'Only A' },
};

function marginCell(m) {
    if (!m) return '<td>—</td>';
    return `<td><span class="num">${esc(formatMarginValue(m))}</span>, ${esc(formatMarginRoom(m))} left`
        + (isNearMiss(m) ? ' <span class="margin-near">near miss</span>' : '') + '</td>';
}

// How each measuring rule's tightest pass moved: a run can pass every rule
// and still be closer to failing one than the run before.
function marginsSection(d) {
    const rows = Array.isArray(d.margins) ? d.margins : [];
    if (!rows.length) return '';
    const labels = MARGIN_CHANGE[d.mode === 'ab' ? 'ab' : 'evolution'];
    const [sideA, sideB] = d.mode === 'ab' ? ['A', 'B'] : ['Baseline', 'Latest'];
    const body = rows.map((r) => {
        const m = r.b || r.a;
        return `<tr data-change="${esc(r.change)}">`
            + `<th scope="row">${esc(r.title)} <code>${esc(r.ruleId)}</code></th>`
            + `<td>${esc(formatMarginLimit(m))}</td>`
            + marginCell(r.a) + marginCell(r.b)
            + `<td><span class="margin-chg margin-chg--${esc(r.change)}">${esc(labels[r.change] || r.change)}</span></td></tr>`;
    }).join('');
    return `<section class="cmp2-sec"><div class="sec-head"><h3>Room before failing</h3>`
        + `<span class="layer">passes</span></div>`
        + `<p class="dash-sub">For each rule that measures against a limit, the pass with the least room in each report.`
        + ` Room that shrinks is a warning before a failure.</p>`
        + `<div class="dash-table-scroll"><table class="doc-table margin-table">`
        + `<thead><tr><th scope="col">Rule</th><th scope="col">Limit</th>`
        + `<th scope="col">${esc(sideA)}</th><th scope="col">${esc(sideB)}</th><th scope="col">Change</th></tr></thead>`
        + `<tbody>${body}</tbody></table></div></section>`;
}

// ---------- top-level ----------

// The two sides, as provenance rows. A pair holds its columns as A and B rather
// than as a list, but it describes them the same way a series does.
function sourceRows(d) {
    const sides = [
        [d.identityA, d.stats.pagesA, d.mode === 'ab' ? 'A' : 'Baseline'],
        [d.identityB, d.stats.pagesB, d.mode === 'ab' ? 'B' : 'Latest'],
    ];
    return sides.map(([identity, pages, label]) => ({
        label,
        name: identity.scenarioName || identity.label,
        timestamp: identity.timestamp,
        scope: identity.scopeUrl,
        pages,
        analyzed: null,
        tags: identity.scanTags,
        optInRules: identity.optInRules,
        engines: identity.engines,
    }));
}

// "Where the failures are" (docs/design/issue-dispersion-design.md §10): how each
// report's failures spread across its scans, and how that moved. Computed by
// the caller, which holds the reports; absent, the section is left out.
function dispersionSection(d, dispersion) {
    const view = globalThis.A11Y_ISSUE_DISPERSION_VIEW;
    if (!dispersion || !view) return '';
    const labels = d.mode === 'ab' ? { labelA: 'A', labelB: 'B' } : { labelA: 'Baseline', labelB: 'Latest' };
    return `<section class="cmp2-sec"><div class="sec-head"><h3>Where the failures are</h3>`
        + `<span class="layer">by scan</span></div>${view.pairBodyHTML(dispersion, labels)}</section>`;
}

export function comparisonDiffHTML(d, { dispersion, mergedNote } = {}) {
    if (!d || typeof d !== 'object') return '<div class="cmp2"><p>No comparison data.</p></div>';
    return `<div class="cmp2" data-mode="${esc(d.mode)}">`
        + mastheadHTML(d.document)
        + `<div class="subject">${reportsRow(d)}</div>`
        // Groups merged in the reports' view, counted here page by page.
        + (mergedNote ? `<p class="cmp2-note">${esc(mergedNote)}</p>` : '')
        + verdictHero(d)
        + `<section class="cmp2-sec"><div class="sec-head"><h3>${d.mode === 'ab' ? 'Standings at a glance' : 'What changed, in numbers'}</h3>`
        + `</div>${kpis(d)}</section>`
        + `<section class="cmp2-sec"><div class="sec-head"><h3>Where ${d.mode === 'ab' ? 'they differ' : 'it moved'}</h3></div>`
        + `<div class="split"><div class="panel">${dumbbellSvg(d)}</div>${narrativePanel(d)}</div></section>`
        + pairProfilesHTML(d.profiles, { mode: d.mode, sides: d.mode === 'ab' ? ['A', 'B'] : ['Baseline', 'Latest'] })
        + dispersionSection(d, dispersion)
        + findingDiff(d)
        + marginsSection(d)
        + provenanceHTML(sourceRows(d), d.document, { columnTerm: 'Side' })
        + `</div>`;
}

export function renderComparison(d, extras) {
    const holder = document.createElement('div');
    holder.innerHTML = comparisonDiffHTML(d, extras);
    return Array.from(holder.childNodes);
}
