'use strict';

// Renders the Compare tab's dashboard for three or more reports, from a
// diffReportSeries() result (shared/report-multi-diff.js).
//
// Section order matters: where do we stand -> headline numbers -> what changed
// -> what to fix and why -> the evidence. A reader who stops after the first
// screen should still be right about the site. Rule ids and WCAG references
// appear only in the last two sections; above them everything is phrased via
// shared/plain-language.js.
//
// Pure string builders, unit-tested in Node without a DOM. Markup is namespaced
// `.cmp2 .dash-*`: `.cmp2` so the export's CSS extraction picks it up, `dash-`
// so nothing collides with the app's own chrome.
//
// Two framings, matching the engine: 'trend' (ordered runs) and 'matrix'
// (unordered variants).

import { mastheadHTML, provenanceHTML, reportsStripHTML } from './comparison-document.js';
import { formatMarginLimit, formatMarginRoom, formatMarginValue, isNearMiss } from './margins.js';
import { failureUnitNote, problemKind, problemOne } from './failure-units.js';

// shared/plain-language.js is a plain script in the browser, so it is read at
// call time rather than when this module is evaluated.
function plain(ruleId, source) {
    const api = globalThis.A11Y_PLAIN_LANGUAGE;
    if (!api) throw new Error('report-multi-renderer: load shared/plain-language.js first');
    return api.plainFor(ruleId, source);
}

// How a problem is named. A rule RGAA numbers and WCAG does not is not in the
// plain-language table and would read as "Accessibility problem", like every
// other one; its own title, RGAA's French wording, says which it is. An RGAA
// rollup (core names them rgaa-<version>-<criterion>) is named by RGAA's title
// even when it lists the WCAG criteria of its rules: in a scan read by RGAA
// criterion, the criterion is what the row is about. `lang` marks that title
// for screen readers.
const RGAA_ROLLUP_ID = /^rgaa-\d/;

function ruleWords(row) {
    const base = plain(row.ruleId, row.wcag);
    const hasRgaa = Array.isArray(row.rgaa) && row.rgaa.length > 0;
    const rgaaRollup = hasRgaa && RGAA_ROLLUP_ID.test(String(row.ruleId || ''));
    const rgaaOnly = hasRgaa && !row.wcag;
    if (!row.title || row.title === row.ruleId) return { ...base, lang: null };
    if (!rgaaRollup && (!rgaaOnly || globalThis.A11Y_PLAIN_LANGUAGE.isKnown(row.ruleId, row.wcag))) {
        return { ...base, lang: null };
    }
    return { ...base, name: row.title, lang: row.titleLang || null };
}

function langAttr(lang) {
    const l = typeof lang === 'string' ? lang.trim() : '';
    return l && l.toLowerCase() !== 'en' && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(l) ? ` lang="${esc(l)}"` : '';
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}

const SEV_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const SEV_LABEL = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor', unknown: 'Unrated' };
const SEV_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 };

const CAT = {
    trend: {
        resolved: { label: 'Fixed and stayed fixed', tone: 'good' },
        new: { label: 'New, still here', tone: 'bad' },
        persistent: { label: 'Never went away', tone: 'warn' },
        flapping: { label: 'Keeps coming back', tone: 'flap' },
    },
    matrix: {
        universal: { label: 'Everywhere', tone: 'bad' },
        shared: { label: 'On some variants', tone: 'warn' },
        unique: { label: 'On one variant only', tone: 'info' },
    },
};

function label(column) {
    return String((column && (column.label || (column.identity && column.identity.label))) || '');
}
function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }

// Column order changes what the chart claims, so it is stated wherever the
// columns are read.
// The noun for a column: runs by default, versions when the reader said these
// are releases.
function unitOf(d) {
    return (d && d.unit) || { one: 'run', many: 'runs' };
}

// What the columns ARE, which is not always what the sentences count in: a
// matrix counts instances in runs but its columns are variants, and "can these
// runs be compared?" over four device profiles asks the wrong question.
function columnNoun(d) {
    if (d && d.mode === 'matrix') return { one: 'variant', many: 'variants' };
    return unitOf(d);
}

// Room for the widest y-axis label. Six-figure counts need more than the 40px a
// two-digit axis needs, and a fixed pad clips them.
function axisRoom(maxValue) {
    return Math.max(34, 12 + String(Math.round(maxValue)).length * 7.5);
}

function listOf(values) {
    if (values.length < 2) return String(values[0]);
    return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

// Which columns covered how much. Comparing only the two ends would call a
// window unchanged when a run in the middle covered something else entirely,
// and the swing itself matters: a run that reached less of the site had less to
// find, so its counts sit low for a reason that is not an improvement.
function workloadNote(d) {
    const pages = d.gate.pages;
    const unit = unitOf(d);
    const latest = pages[pages.length - 1];
    const earlier = pages.slice(0, -1);

    if (earlier.length && earlier.every((p) => p === earlier[0]) && latest !== earlier[0]) {
        return `The latest ${unit.one} covered ${latest} pages where `
            + `${earlier.length === 1 ? 'the one before it' : 'the earlier ones'} covered ${earlier[0]}.`;
    }

    // Short enough to name each one: the shape of the variation is the point.
    if (pages.length <= 6) {
        return `These ${unit.many} covered ${listOf(pages)} pages, in that order — `
            + `whichever reached less of the site had less to find.`;
    }

    return `These ${unit.many} covered between ${Math.min(...pages)} and ${Math.max(...pages)} pages, `
        + `so they did not all reach the same amount of the site.`;
}

function orderingNote(d) {
    const ordering = d.ordering || { by: d.mode === 'matrix' ? 'given' : 'time', undated: 0 };
    if (ordering.by !== 'time') return 'In the order you arranged them.';

    const undated = ordering.undated || 0;
    return undated
        ? `Ordered by run date — except ${undated} report${undated === 1 ? '' : 's'} with no date, `
          + `which sit${undated === 1 ? 's' : ''} at the end.`
        : 'Ordered by run date.';
}
// Scores arrive as long means (83.808900523...). Everything printed is rounded
// to two decimals, matching the two-report view; the charts keep the raw value.
function round(v) { return Math.round(v * 100) / 100; }
function showNum(v) {
    const n = num(v);
    return n == null ? '—' : String(round(n));
}
function showPercent(v) {
    const n = num(v);
    return n == null ? '—' : `${round(n)}%`;
}

// ---------- deltas and sparklines ----------

// Direction pairs a glyph and a word with the number, so it survives greyscale.
function delta(from, to, { good = 'down' } = {}) {
    const a = num(from);
    const b = num(to);
    if (a == null || b == null) return `<span class="dash-delta dash-delta--none">no comparable figure</span>`;

    const move = round(b - a);
    if (move === 0) return `<span class="dash-delta dash-delta--flat"><span aria-hidden="true">→</span> unchanged</span>`;

    const better = (move < 0) === (good === 'down');
    return `<span class="dash-delta dash-delta--${better ? 'good' : 'bad'}">`
        + `<span aria-hidden="true">${move < 0 ? '↓' : '↑'}</span> ${move < 0 ? 'down' : 'up'} ${Math.abs(move)}</span>`;
}

// Shape only — the charts below carry the values.
//
// A column with no figure breaks the line instead of being drawn through: a run
// whose score was withheld did not score zero, and joining across it would draw
// a slope nobody measured. The series is split into runs of known values and
// each is stroked separately, so the gap is visible as a gap.
function sparkline(values, { good = 'down' } = {}) {
    const points = values.map(num);
    const known = points.filter((v) => v != null);
    if (known.length < 2) return '';

    const w = 132;
    const h = 34;
    const pad = 4;
    const max = Math.max(...known);
    const min = Math.min(...known);
    const span = max - min || 1;
    const x = (i) => pad + (i * (w - pad * 2)) / (points.length - 1);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);

    const segments = [];
    let run = [];
    points.forEach((v, i) => {
        if (v == null) { if (run.length) segments.push(run); run = []; return; }
        run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (run.length) segments.push(run);

    const last = points[points.length - 1];
    const first = known[0];
    const tone = (last == null || last === first) ? 'flat' : ((last < first) === (good === 'down') ? 'good' : 'bad');

    // The fill only sits under an unbroken stretch, for the same reason.
    const areas = segments.filter((seg) => seg.length > 1).map((seg) => {
        const startX = seg[0].split(',')[0];
        const endX = seg[seg.length - 1].split(',')[0];
        return `<path class="dash-spark-area" d="M ${startX},${h} L ${seg.join(' L ')} L ${endX},${h} Z"/>`;
    }).join('');
    const lines = segments.filter((seg) => seg.length > 1)
        .map((seg) => `<path class="dash-spark-line" d="M ${seg.join(' L ')}"/>`).join('');
    const dots = segments.filter((seg) => seg.length === 1)
        .map((seg) => `<circle class="dash-spark-dot" cx="${seg[0].split(',')[0]}" cy="${seg[0].split(',')[1]}" r="2.5"/>`).join('');

    return `<svg class="dash-spark dash-spark--${tone}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`
        + ` aria-hidden="true" focusable="false">`
        + areas + lines + dots
        + (last == null ? ''
            : `<circle class="dash-spark-dot" cx="${x(points.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5"/>`)
        + `</svg>`;
}

// ---------- how long, how far ----------

// Elapsed time reads better than a column count for anything a person is meant
// to feel bad about. Deliberately coarse: "three months" is the point, not
// "94 days".
function humanSpan(ms) {
    const days = ms / 86400000;
    if (days < 1.5) return 'a day';
    if (days < 14) return `${Math.round(days)} days`;
    if (days < 70) { const w = Math.round(days / 7); return w === 1 ? 'a week' : `${w} weeks`; }
    if (days < 730) { const m = Math.round(days / 30.44); return m === 1 ? 'a month' : `${m} months`; }
    const y = Math.round(days / 365.25);
    return y === 1 ? 'a year' : `${y} years`;
}

// "for three months" when the dates ordered the series, "across four runs"
// when they did not. Never both, and never elapsed time off an arrangement
// somebody typed.
function ageWords(row, unit) {
    if (!row || !row.age) return '';
    if (row.age.spanMs) return `for ${humanSpan(row.age.spanMs)}`;
    return `across ${row.age.runs} ${row.age.runs === 1 ? unit.one : unit.many}`;
}

const SCOPE_WORDS = {
    systemic: 'on most pages',
    partial: 'on several pages',
    local: 'in one place',
};

// Whether this is one screen's problem or the design system's. It is the reading
// that decides who picks it up, and one the instance count alone never gives:
// twelve instances on one page and twelve across twelve pages are different
// pieces of work.
function scopeNote(row) {
    const words = reachWords(row);
    if (!words) return '';
    const scope = row.reach && row.reach.scope;
    return ` · <span class="dash-scope dash-scope--${scope || 'local'}">${words}`
        + `${scope && SCOPE_WORDS[scope] && scope !== 'local' ? `, ${SCOPE_WORDS[scope]}` : ''}</span>`;
}

// How far a problem reaches, as a phrase rather than a ratio. The distinction
// it draws is the one that decides who fixes it: a component or a page.
function reachWords(row) {
    if (!row || !row.reach || !row.reach.pages) return '';
    const { pages, of } = row.reach;
    return of ? `on ${pages} of ${of} pages` : `on ${pages} page${pages === 1 ? '' : 's'}`;
}

// ---------- charts ----------

// Column numbers along an x axis, in place of names. The numbers match the key
// under the charts and the "Reports compared" list at the top, and a number
// fits its place whatever the report is called, where a name has to be cut or
// thinned out until it no longer says which report it is. When the columns sit
// closer than a badge is wide, only every so many are numbered, always the last.
//
// `scale` is for a chart drawn on a wider canvas and shrunk to fit: the badges
// grow to match, so the numbers look the same size on every chart.
function numberedAxis(names, xAt, step, y, { scale = 1 } = {}) {
    const r = 8 * scale;
    const every = Number.isFinite(step) && step > 0 ? Math.max(1, Math.ceil((r * 2 + 2) / step)) : 1;
    const last = names.length - 1;
    return names.map((name, i) => {
        if (!(i === last || (i % every === 0 && last - i >= every))) return '';
        const cx = xAt(i).toFixed(1);
        return `<g class="dash-axis-n"><title>${esc(name)}</title>`
            + `<circle cx="${cx}" cy="${y}" r="${r}"/>`
            + `<text class="dash-axis" x="${cx}" y="${(y + 3.5 * scale).toFixed(1)}" text-anchor="middle"`
            + `${scale === 1 ? '' : ` style="font-size:${10 * scale}px"`}>${i + 1}</text></g>`;
    }).join('');
}

/**
 * Failing instances per run: one series, one axis, area + line, direct labels
 * only where they mean something, and the largest regression flagged in place.
 */
function runChart(columns, verdict) {
    const values = columns.map((c) => c.stats.failures);
    const labels = columns.map(label);

    const w = 720;
    // Taller than its width alone would suggest: it sits beside the severity
    // chart, which is about 1.55 times narrower, and the two are drawn so their
    // plots come out about the same height and share a baseline.
    const h = 360;
    const padR = 18;
    // Deep enough to give the regression flag its own lane above the plot: at
    // 26 the flag's caption and the label on a peak point land on the same line
    // whenever the peak sits inside the flagged step.
    const padT = 42;
    const padB = 34;
    const max = Math.ceil(Math.max(...values, 1) / 10) * 10 || 10;
    const padL = axisRoom(max);
    const x = (i) => (values.length === 1 ? w / 2 : padL + (i * (w - padL - padR)) / (values.length - 1));
    const y = (v) => padT + (1 - v / max) * (h - padT - padB);

    const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L ');
    const area = `M ${x(0).toFixed(1)},${y(0)} L ${line} L ${x(values.length - 1).toFixed(1)},${y(0)} Z`;

    const grid = [0, max / 2, max].map((t) => (
        `<line class="dash-gridline" x1="${padL}" x2="${w - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`
        + `<text class="dash-axis" x="${padL - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t}</text>`
    )).join('');

    // This canvas is about twice the severity chart's and shown at a similar
    // height, so its badges are drawn larger to come out the same size.
    const xlabels = numberedAxis(labels, x,
        values.length > 1 ? (w - padL - padR) / (values.length - 1) : Infinity, h - 18, { scale: 1.35 });

    const marked = new Set([0, values.length - 1, values.indexOf(Math.max(...values))]);
    const r = values.length > 12 ? 3 : 4.5;
    const dots = values.map((v, i) => {
        const anchor = i === 0 ? 'start' : (i === values.length - 1 ? 'end' : 'middle');
        const dx = i === 0 ? 5 : 0;
        const text = marked.has(i)
            ? `<text class="dash-ptlabel" x="${(x(i) + dx).toFixed(1)}" y="${(y(v) - 12).toFixed(1)}" text-anchor="${anchor}">${v}</text>`
            : '';
        // Not focusable: the chart is one image, whose name gives every
        // point's value, as the table under it does; a point inside an image
        // that took focus would be a stop a screen reader can't describe.
        return `${text}<circle class="dash-dot${i === values.length - 1 ? ' dash-dot--last' : ''}"`
            + ` cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}"`
            + ` data-tip-label="${esc(labels[i])}" data-tip-value="${v}"/>`;
    }).join('');

    // The regression is flagged where it happened rather than in a caption.
    let flag = '';
    const rise = verdict && verdict.rise;
    if (rise && rise.move > 0) {
        const cx = (x(rise.from) + x(rise.to)) / 2;
        flag = `<g class="dash-flag">`
            + `<rect class="dash-flag-band" x="${x(rise.from).toFixed(1)}" y="${padT}"`
            + ` width="${(x(rise.to) - x(rise.from)).toFixed(1)}" height="${(h - padT - padB).toFixed(1)}"/>`
            + `<text class="dash-flag-text" x="${cx.toFixed(1)}" y="16" text-anchor="middle">+${rise.move} gave back</text>`
            + `</g>`;
    }

    return `<svg class="dash-runchart" viewBox="0 0 ${w} ${h}" role="img"`
        + ` aria-label="Failures per run. ${labels.map((l, i) => `${esc(l)}: ${values[i]}`).join('; ')}">`
        + grid + flag
        + `<path class="dash-area" d="${area}"/><path class="dash-line" d="M ${line}"/>`
        + dots + xlabels + `</svg>`;
}

/**
 * Severity is ordinal, so one hue in four steps rather than four colours.
 *
 * Two things carry the reading without a pointer and without colour: each
 * column prints its total above the bar, and the segments are stacked in a
 * stated order (critical at the bottom), so a segment is identified by where it
 * sits rather than by its shade. The table underneath carries every figure.
 */
function severityChart(columns) {
    const w = 320;
    const h = 260;
    const padT = 26;
    const padB = 34;
    const padL = 10;
    const totals = columns.map((c) => SEV_ORDER.reduce((sum, s) => sum + (c.stats.severity[s] || 0), 0));
    const max = Math.ceil(Math.max(...totals, 1) / 10) * 10 || 10;
    const bandW = (w - padL * 2) / columns.length;
    const barW = Math.min(30, bandW * 0.56);
    const bars = columns.map((c, i) => {
        const cx = padL + bandW * i + bandW / 2;
        let acc = 0;
        const segments = SEV_ORDER.map((s) => {
            const v = c.stats.severity[s] || 0;
            if (!v) return '';
            const height = (v / max) * (h - padT - padB);
            const top = h - padB - ((acc + v) / max) * (h - padT - padB);
            acc += v;
            // A 2px gap of surface between stacked segments keeps the boundary
            // readable without an outline. The floor below it matters more: one
            // column of 120,000 makes every other column's true height a
            // fraction of a pixel, and a band that exists has to be visible even
            // when the scale says otherwise.
            return `<rect class="dash-sev dash-sev--${s}" x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}"`
                + ` width="${barW.toFixed(1)}" height="${Math.max(2, height - 2).toFixed(1)}" rx="2"`
                + ` data-tip-label="${esc(label(c))} · ${SEV_LABEL[s]}" data-tip-value="${v}"/>`;
        }).join('');

        // The column's own total: the shape says which is biggest, the number
        // says by how much. Dropped once the bands are too narrow to hold it,
        // because two totals printed over each other say less than none, and
        // the table underneath still has every figure.
        const total = totals[i];
        const top = h - padB - (total / max) * (h - padT - padB);
        const totalLabel = (total && bandW >= 26)
            ? `<text class="dash-bar-total" x="${cx.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle">${total}</text>`
            : '';

        return segments + totalLabel;
    }).join('')
        + numberedAxis(columns.map(label), (i) => padL + bandW * i + bandW / 2, bandW, h - 16);

    return `<svg class="dash-sevchart" viewBox="0 0 ${w} ${h}" role="img"`
        + ` aria-label="Failures by severity. ${columns.map((c) => `${esc(label(c))}: `
            + SEV_ORDER.map((s) => `${SEV_LABEL[s]} ${c.stats.severity[s] || 0}`).join(', ')).join('; ')}">`
        + bars + `</svg>`;
}

// A grid's column headers: the column's number, which every chart and the
// "Reports compared" list use too, over its full name. The name wraps rather
// than being cut: seven names that all begin "UI-SDK v22" and are cut there
// make seven identical headers.
function columnHeads(columns) {
    return columns.map((c, i) => `<th scope="col" class="dash-num-col">`
        + `<span class="dash-col-n num" aria-hidden="true">${i + 1}</span>`
        + `<span class="dash-col-name">${esc(label(c))}</span></th>`).join('');
}

// Something wider than a phone, in a box that scrolls sideways. The box is a
// named stop in the tab order, so it can be scrolled from the keyboard in every
// browser, and on a narrow screen a line under it says there is more to the
// side, because nothing else does until the reader happens to swipe.
function sideScroll(cls, name, inner, more) {
    return `<div class="${cls}" tabindex="0" role="region" aria-label="${esc(name)}">${inner}</div>`
        + `<p class="dash-scroll-hint" aria-hidden="true">${esc(more)} →</p>`;
}

function gridScroll(d, name, table) {
    return sideScroll('dash-grid-scroll', name, table,
        `Scroll sideways to see all ${d.columns.length} ${columnNoun(d).many}`);
}

// The two charts drawn on a 720-wide canvas. Below a certain width they would
// be shrunk until their text is a few pixels tall, so they keep a readable
// width and scroll instead (the widths are in the stylesheet).
function chartScroll(name, svg) {
    return sideScroll('dash-chart-scroll', name, svg,
        `Scroll sideways to see the whole chart`);
}

// The key to a chart whose columns are numbered: each number with the column's
// full name, in the same order and numbering as the "Reports compared" list.
function columnKey(columns, { start = false } = {}) {
    return `<ol class="dash-key" aria-label="Column numbers">`
        + columns.map((c, i) => `<li><span class="dash-key-n num" aria-hidden="true">${i + 1}</span>${esc(label(c))}`
            + `${start && i === 0 ? ' <span class="dash-key-note">(starting point)</span>' : ''}</li>`).join('')
        + `</ol>`;
}

/** Every chart has a table under it, so nothing is available only as a picture. */
function chartTable(headers, rows) {
    return `<details class="dash-tableview"><summary>Show the numbers as a table</summary>`
        + `<div class="dash-table-scroll"><table><thead><tr>`
        + headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')
        + `</tr></thead><tbody>`
        + rows.map((r) => `<tr>${r.map((cell, i) => (
            i === 0 ? `<th scope="row">${esc(cell)}</th>` : `<td>${esc(cell)}</td>`
        )).join('')}</tr>`).join('')
        + `</tbody></table></div></details>`;
}

// ---------- hero ----------

function heroTrend(d) {
    const columns = d.columns;
    const verdict = d.verdict;
    const first = columns[0];
    const last = columns[columns.length - 1];

    const tone = verdict.tone === 'good' ? 'Improving' : (verdict.tone === 'bad' ? 'Getting worse' : 'Holding steady');
    const raw = first.stats.failures
        ? Math.round(((last.stats.failures - first.stats.failures) / first.stats.failures) * 100)
        : 0;
    // 124,893 down to 10 rounds to 100%, and "100% lower" says the problems are
    // gone when ten of them are not. Rounding is allowed to flatter a headline;
    // it is not allowed to change what it claims.
    const cleared = last.stats.failures === 0;
    const pct = (Math.abs(raw) >= 100 && !cleared) ? 99 : Math.abs(raw);
    const almost = Math.abs(raw) >= 100 && !cleared;

    const caveat = d.gate.comparable ? '' : `<p class="dash-caveat"><span class="dash-caveat-i" aria-hidden="true">!</span>`
        + `<span>${esc(workloadNote(d))} `
        + `Counts include the difference, so read the direction from the problems below, not from the totals.</span></p>`;

    const best = columns[verdict.bestIndex];

    return `<section class="dash-hero">
        <div class="dash-hero-main">
            <p class="dash-status dash-status--${verdict.tone}"><span class="dash-status-dot" aria-hidden="true"></span>${tone}</p>
            <h2 class="dash-hero-h">Accessibility failures are <strong>${almost ? 'over ' : ''}${pct}% ${raw <= 0 ? 'lower' : 'higher'}</strong>
                than ${esc(verdict.span)} ago${verdict.flapping ? `, but ${verdict.flapping === 1 ? 'one problem keeps' : `${verdict.flapping} problems keep`} coming back` : ''}.</h2>
            <p class="dash-hero-lead">${esc(verdict.lead)}</p>
            ${caveat}
        </div>
        <div class="dash-figures">
            <div class="dash-figure">
                <span class="dash-figure-label">Failures today</span>
                <span class="dash-figure-value num">${last.stats.failures}</span>
                <span class="dash-figure-note">was ${first.stats.failures} on ${esc(label(first))}</span>
            </div>
            <div class="dash-figure">
                <span class="dash-figure-label">Of those, serious or critical</span>
                <span class="dash-figure-value num">${last.stats.seriousCritical}</span>
                <span class="dash-figure-note">${delta(first.stats.seriousCritical, last.stats.seriousCritical)}</span>
            </div>
            <div class="dash-figure">
                <span class="dash-figure-label">Best the site has been</span>
                <span class="dash-figure-value num">${best.stats.failures}</span>
                <span class="dash-figure-note">${verdict.bestIndex === columns.length - 1
                    ? 'that is this run — a new low'
                    : `on ${esc(label(best))}`}</span>
            </div>
            ${oldestFigure(d)}
        </div>
    </section>`;
}

// Age, not size. A problem that has survived every run in the window is a
// different argument from a big one, and it is the argument nobody makes
// because no view has ever counted it.
function oldestFigure(d) {
    const row = d.verdict.oldest;
    if (!row || !row.age || row.age.runs < 2) return '';

    const words = ruleWords(row);
    const since = label(d.columns[row.age.sinceIndex]);
    return `<div class="dash-figure">
        <span class="dash-figure-label">Open the longest</span>
        <span class="dash-figure-value dash-figure-value--text" title="${esc(words.name)}"${langAttr(words.lang)}>${esc(words.name)}</span>
        <span class="dash-figure-note">failing ${esc(ageWords(row, unitOf(d)))}, unbroken since ${esc(since)}${
    row.age.fromStart ? ' or earlier' : ''}</span>
    </div>`;
}

function heroMatrix(d) {
    const columns = d.columns;
    const verdict = d.verdict;

    // With nothing failing everywhere there is no shared fix to promise, and the
    // sentence has to stop rather than offer one.
    const claim = verdict.universal
        ? `${esc(verdict.headline)}, <strong>${verdict.universalOcc} failures</strong> that one fix would clear everywhere.`
        : `${esc(verdict.headline)}, so there is no single fix that moves all of them.`;

    return `<section class="dash-hero">
        <div class="dash-hero-main">
            <p class="dash-status dash-status--neutral"><span class="dash-status-dot" aria-hidden="true"></span>${columns.length} variants compared</p>
            <h2 class="dash-hero-h">${claim}</h2>
            <p class="dash-hero-lead">${esc(verdict.lead)}</p>
            <p class="dash-caveat dash-caveat--info"><span class="dash-caveat-i" aria-hidden="true">i</span>
                <span>No winner is declared. These are variants of one subject, not candidates competing.</span></p>
        </div>
        <div class="dash-figures">
            <div class="dash-figure">
                <span class="dash-figure-label">Fails everywhere</span>
                <span class="dash-figure-value num">${verdict.universal}</span>
                <span class="dash-figure-note">the shared backlog</span>
            </div>
            <div class="dash-figure">
                <span class="dash-figure-label">Needs most attention</span>
                <span class="dash-figure-value dash-figure-value--text"
                    title="${esc(label(columns[verdict.outlier]))}">${esc(label(columns[verdict.outlier]))}</span>
                <span class="dash-figure-note">${verdict.uniqueByColumn[verdict.outlier]}
                    problem${verdict.uniqueByColumn[verdict.outlier] === 1 ? '' : 's'} no other variant has</span>
            </div>
            <div class="dash-figure">
                <span class="dash-figure-label">Cleanest</span>
                <span class="dash-figure-value dash-figure-value--text"
                    title="${esc(label(columns[verdict.cleanest]))}">${esc(label(columns[verdict.cleanest]))}</span>
                <span class="dash-figure-note">${columns[verdict.cleanest].stats.failures} failures</span>
            </div>
        </div>
    </section>`;
}

// ---------- headline numbers ----------

// The unit every failure count on the tab is in, said once where the counts
// start and again under the charts.
function failureUnitNoteFor(d) {
    return failureUnitNote(problemKind(d.rows));
}

function kpiRow(d) {
    const columns = d.columns;
    const first = columns[0];
    const last = columns[columns.length - 1];
    const over = `over ${columns.length} ${unitOf(d).many}`;
    const kind = problemKind(d.rows);

    const failureTiles = [
        { label: 'Failures', value: last.stats.failures, pick: (c) => c.stats.failures, good: 'down',
            caption: `One per element, for each ${problemOne(kind)} it fails, on each page. Lower is better.` },
        { label: 'Broken elements', value: last.stats.elements, pick: (c) => c.stats.elements, good: 'down',
            caption: 'Elements with at least one failure, each counted once whatever it breaks.' },
        { label: 'Serious or critical', value: last.stats.seriousCritical, pick: (c) => c.stats.seriousCritical, good: 'down',
            caption: 'The failures that stop people completing a task.' },
        { label: 'Kinds of problem', value: last.stats.rules, pick: (c) => c.stats.rules, good: 'down',
            caption: `Distinct ${kind} failing: the size of the to-do list.` },
    ];
    const otherTiles = [
        { label: 'Accessibility score', value: showNum(last.stats.score), pick: (c) => c.stats.score, good: 'up',
            caption: 'Out of 100, comparable between runs of any size.' },
        { label: 'Confidence in the score', value: showPercent(last.stats.confidence), pick: (c) => c.stats.confidence, good: 'up',
            caption: 'How much of the site the run actually reached.' },
        // Not a failure count and never added to one: these are the checks that
        // declined to conclude. A rule that moves from failing to needing review
        // has not been fixed, and a failures-only reading calls it fixed.
        { label: 'Questions to review', value: last.stats.reviewOccurrences, pick: (c) => c.stats.reviewOccurrences, good: 'down',
            caption: 'Checks that could not decide, counted like failures. Not failures, and not in any failure count.' },
    ];

    const tile = (t) => `<article class="dash-kpi">
            <p class="dash-kpi-label">${esc(t.label)}</p>
            <p class="dash-kpi-value num">${esc(String(t.value))}</p>
            <p class="dash-kpi-delta">${delta(t.pick(first), t.pick(last), { good: t.good })}
                <span class="dash-kpi-since">${over}</span></p>
            ${sparkline(columns.map(t.pick), { good: t.good })}
            <p class="dash-kpi-caption">${esc(t.caption)}</p>
        </article>`;

    // Two groups, so the questions to review are never read as more failures.
    return `<section class="dash-kpi-group">`
        + `<h3 class="dash-kpi-group-h">What failed</h3>`
        + `<p class="dash-sub">${esc(failureUnitNoteFor(d))}</p>`
        + `<div class="dash-kpis dash-kpis--four">${failureTiles.map(tile).join('')}</div></section>`
        + `<section class="dash-kpi-group">`
        + `<h3 class="dash-kpi-group-h">Score and open questions</h3>`
        + `<div class="dash-kpis dash-kpis--three">${otherTiles.map(tile).join('')}</div></section>`;
}

function variantCards(d) {
    const columns = d.columns;
    const worst = Math.max(...columns.map((c) => c.stats.failures), 1);

    return `<p class="dash-sub dash-sub--order">${esc(orderingNote(d))}</p>`
        + `<section class="dash-kpis dash-kpis--variants" aria-label="Variants compared">`
        + columns.map((c, i) => {
            const badge = i === d.verdict.outlier
                ? '<span class="dash-cat-chip dash-cat-chip--bad">Most variant-specific problems</span>'
                : (i === d.verdict.cleanest ? '<span class="dash-cat-chip dash-cat-chip--good">Cleanest</span>' : '');
            const width = Math.round((c.stats.failures / worst) * 100);
            return `<article class="dash-kpi dash-kpi--variant">
                <p class="dash-kpi-label">${esc(label(c))}</p>
                <p class="dash-kpi-value num">${c.stats.failures}</p>
                <p class="dash-kpi-caption">failures · ${c.stats.elements} broken ${c.stats.elements === 1 ? 'element' : 'elements'}${c.stats.score == null ? '' : ` · score ${showNum(c.stats.score)}`}</p>
                <div class="dash-bar" role="img" aria-label="${c.stats.failures} failures, ${width}% of the worst variant">
                    <span style="width:${width}%"></span>
                </div>
                <p class="dash-kpi-badges">${badge}</p>
            </article>`;
        }).join('')
        + `</section>`;
}

// ---------- what changed ----------

function narrativePanel(d, level = 4) {
    return `<div class="dash-read">
        <h${level} class="dash-read-h">What this says</h${level}>
        ${d.narrative.map((p) => `<p>${esc(p)}</p>`).join('')}
    </div>`;
}

function changeSection(d) {
    return `<section class="cmp2-sec dash-split">
        <div class="dash-panel">
            <div class="sec-head"><h3>Failures ${unitOf(d).one === 'version' ? 'by version' : 'over time'}</h3></div>
            <p class="dash-sub">Every failure found, per ${unitOf(d).one}. ${esc(failureUnitNoteFor(d))} ${esc(orderingNote(d))}</p>
            ${chartScroll(`Failures ${unitOf(d).one === 'version' ? 'by version' : 'over time'}, chart`, runChart(d.columns, d.verdict))}
            ${chartTable([unitOf(d).one === 'version' ? 'Version' : 'Run', 'Failures', 'Broken elements', 'Serious or critical', 'Score', 'Pages'],
        d.columns.map((c) => [label(c), String(c.stats.failures), String(c.stats.elements), String(c.stats.seriousCritical),
            showNum(c.stats.score), String(c.stats.pages)]))}
        </div>
        <div class="dash-panel">
            <div class="sec-head"><h3>Failures by severity</h3></div>
            <p class="dash-sub">The same failures, by the severity of what they break: each bar adds up to that ${unitOf(d).one}'s total.</p>
            ${severityChart(d.columns)}
            <p class="dash-legend">${SEV_ORDER.map((s) => (
        `<span><span class="dash-sw dash-sev--${s}" aria-hidden="true"></span>${SEV_LABEL[s]}</span>`
    )).join('')}<span class="dash-legend-note">stacked in that order, critical at the bottom</span></p>
            ${chartTable(
        [unitOf(d).one === 'version' ? 'Version' : 'Run', ...SEV_ORDER.map((s) => SEV_LABEL[s]), 'Total'],
        d.columns.map((c) => [
            label(c),
            ...SEV_ORDER.map((s) => String(c.stats.severity[s] || 0)),
            String(SEV_ORDER.reduce((sum, s) => sum + (c.stats.severity[s] || 0), 0)),
        ])
    )}
        </div>
        <div class="dash-split-key">
            <p class="dash-key-title">The numbers on both charts</p>
            ${columnKey(d.columns)}
        </div>
    </section>`;
}

// ---------- what to fix first ----------

function fixFirst(d) {
    const mode = d.mode;
    const cats = CAT[mode];

    // Ranked by cost to people, not instance count: category first (a rule that
    // keeps returning, or fails everywhere, outranks a one-off), then severity,
    // then size.
    const catRank = mode === 'trend'
        ? { flapping: 0, new: 1, persistent: 1, resolved: 9 }
        : { universal: 0, shared: 1, unique: 2 };

    const picks = d.rows
        .map((row) => {
            const latest = row.counts[row.counts.length - 1];
            const now = mode === 'trend' ? latest : Math.max(...row.counts);
            return { row, now, rank: [catRank[row.category] ?? 5, SEV_RANK[row.severity] ?? 4, -now] };
        })
        .filter((entry) => entry.now > 0 || entry.row.category === 'flapping')
        .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2])
        .slice(0, 3);

    if (!picks.length) return '';

    const cards = picks.map((entry, i) => {
        const row = entry.row;
        const words = ruleWords(row);
        const cat = cats[row.category] || { label: row.category, tone: 'warn' };
        const latest = row.counts[row.counts.length - 1];
        const lastSeen = row.lifecycle ? row.lifecycle.lastSeen : -1;

        // A rule that is clean right now still has a size: the last time it was
        // there. "0 places" would read as "nothing to do".
        const size = (mode === 'trend' && latest === 0 && lastSeen >= 0)
            ? { n: row.counts[lastSeen], when: ` when it was last seen, on ${esc(label(d.columns[lastSeen]))}` }
            : { n: entry.now, when: '' };

        let why;
        if (mode === 'trend') {
            if (row.category === 'flapping') {
                const back = row.lifecycle.returns;
                why = `Gone and come back ${back} time${back === 1 ? '' : 's'} across ${row.counts.length} ${unitOf(d).many}. `
                    + (latest
                        ? 'It is failing again right now.'
                        : 'It is clean in the latest run — but it was clean before too, and it returned.');
            } else if (row.category === 'persistent') {
                why = `Present in every one of the ${row.counts.length} ${unitOf(d).many}`
                    + `${row.age ? `, failing ${ageWords(row, unitOf(d))} without a break` : ''}. `
                    + 'Nobody has picked it up.';
            } else if (row.category === 'new') {
                why = `First appeared on ${esc(label(d.columns[row.lifecycle.firstSeen]))} and has not gone away`
                    + `${row.age && row.age.runs > 1 ? `, ${esc(ageWords(row, unitOf(d)))} now` : ''}.`;
            } else {
                why = `Last seen on ${esc(label(d.columns[lastSeen]))}.`;
            }
        } else {
            const where = row.present.map((p, idx) => (p ? esc(label(d.columns[idx])) : null)).filter(Boolean);
            why = row.category === 'universal'
                ? `Fails on all ${row.present.length} variants — one fix improves every one of them.`
                : `Fails on ${where.join(' and ')}. The others are clean, so the cause is in `
                  + `${where.length === 1 ? 'that variant' : 'what those share'}.`;
        }

        return `<article class="dash-fix">
            <p class="dash-fix-rank" aria-hidden="true">${i + 1}</p>
            <div>
                <p class="dash-fix-head">
                    <span class="dash-sev-chip dash-sev-chip--${row.severity}">${SEV_LABEL[row.severity]}</span>
                    <span class="dash-cat-chip dash-cat-chip--${cat.tone}">${esc(cat.label)}</span>
                </p>
                <h4 class="dash-fix-h"${langAttr(words.lang)}>${esc(words.name)}</h4>
                <p class="dash-fix-impact">${esc(words.impact)}</p>
                <p class="dash-fix-why">${why}</p>
                <p class="dash-fix-meta"><span class="dash-fix-count num">${size.n}</span>
                    place${size.n === 1 ? '' : 's'} affected${size.when}${scopeNote(row)}
                    · <span class="mono">${esc(row.ruleId)}</span>${row.wcag ? ` · WCAG ${esc(row.wcag)}` : ''}</p>
            </div>
        </article>`;
    }).join('');

    return `<section class="cmp2-sec">
        <div class="sec-head"><h3>What to fix first</h3><span class="layer">ranked</span></div>
        <p class="dash-sub">Ordered by what it costs people, not by how many failures it has.</p>
        <div class="dash-fix-list">${cards}</div>
    </section>`;
}

// ---------- the evidence ----------

function cellClass(value, max) {
    if (!value) return 'c0';
    const ratio = value / (max || 1);
    if (ratio > 0.66) return 'c4';
    if (ratio > 0.4) return 'c3';
    if (ratio > 0.18) return 'c2';
    return 'c1';
}

function ruleGrid(d) {
    const cats = CAT[d.mode];
    const max = Math.max(1, ...d.rows.map((r) => Math.max(...r.counts)));
    const order = Object.keys(cats).filter((k) => (d.groups[k] || []).length);

    const filters = `<div class="dash-filters" role="group" aria-label="Filter by what happened">`
        + `<button type="button" class="dash-chip" data-dash-filter="all" aria-pressed="true">`
        + `All <span class="dash-chip-n num">${d.rows.length}</span></button>`
        + order.map((k) => `<button type="button" class="dash-chip dash-chip--${cats[k].tone}"`
            + ` data-dash-filter="${esc(k)}" aria-pressed="false">${esc(cats[k].label)} `
            + `<span class="dash-chip-n num">${d.groups[k].length}</span></button>`).join('')
        + `</div>`;

    const head = `<tr><th scope="col" class="dash-rule-col">Problem</th>`
        + columnHeads(d.columns)
        + `<th scope="col" class="dash-what-col">What happened</th></tr>`;

    const body = d.rows.map((row) => {
        const words = ruleWords(row);
        const cat = cats[row.category] || { label: row.category, tone: 'warn' };
        const cells = row.counts.map((v, i) => `<td class="dash-cell dash-${cellClass(v, max)}">`
            + `<span class="dash-cell-v num" aria-label="${esc(label(d.columns[i]))}: ${v}">${v || '·'}</span></td>`).join('');

        return `<tr data-dash-cat="${esc(row.category)}">
            <th scope="row" class="dash-rule-col">
                <span class="dash-sev-dot dash-sev-dot--${row.severity}" aria-hidden="true"></span>
                <span class="dash-rule-name"${langAttr(words.lang)}>${esc(words.name)}</span>
                <span class="dash-rule-meta">${SEV_LABEL[row.severity]}${row.wcag ? ` · WCAG ${esc(row.wcag)}` : ''}${esc(rgaaMeta(row.rgaa))}${esc(standardsMeta(row.standards))}${
    reachWords(row) ? ` · ${esc(reachWords(row))}` : ''}${
    row.age && row.age.runs > 1 ? ` · open ${esc(ageWords(row, unitOf(d)))}` : ''}</span>
                <span class="dash-rule-id mono">${esc(row.ruleId)}</span>
            </th>${cells}
            <td class="dash-what-col"><span class="dash-cat-chip dash-cat-chip--${cat.tone}">${esc(cat.label)}</span></td>
        </tr>`;
    }).join('');

    return `<section class="cmp2-sec">
        <div class="sec-head"><h3>Every problem, ${d.mode === 'trend'
        ? `${unitOf(d).one} by ${unitOf(d).one}` : 'variant by variant'}</h3>
            <span class="layer">detail</span></div>
        <p class="dash-sub">${d.mode === 'trend'
        ? 'Read a row left to right: that is the life of one problem.'
        : 'Read a row across: that is where one problem shows up.'} ${esc(orderingNote(d))}</p>
        ${filters}
        ${gridScroll(d, `Every problem, ${d.mode === 'trend' ? `${unitOf(d).one} by ${unitOf(d).one}` : 'variant by variant'}`,
        `<table class="dash-grid${d.columns.length > 10 ? ' dash-grid--wide' : ''}">
                <thead>${head}</thead><tbody>${body}</tbody>
            </table>`)}
        <p class="dash-grid-legend">
            <span class="dash-lg"><span class="dash-sw dash-c0" aria-hidden="true"></span> none</span>
            <span class="dash-lg"><span class="dash-sw dash-c1" aria-hidden="true"></span><span class="dash-sw dash-c2" aria-hidden="true"></span><span class="dash-sw dash-c3" aria-hidden="true"></span><span class="dash-sw dash-c4" aria-hidden="true"></span> more failures</span>
            <span class="dash-lg-note">Every cell prints its number, so the shading is never the only signal.</span>
        </p>
        ${matrixCsv(d)}
    </section>`;
}

// ---------- can these be compared at all? ----------

// The question a reader should settle before reading any count, and the one the
// findings alone cannot answer. A run that skipped scans, lost iterations or
// failed an action found fewer problems because it looked at less, which is
// indistinguishable from progress in every chart on this page.
// A column worth stopping on: it did not finish, or it did not reach every scan
// it was given.
function isSuspect(column) {
    return !(column.health && column.health.ok) || column.stats.analyzed !== column.stats.pages;
}

function trustCards(d) {
    const unit = columnNoun(d);

    const card = (c) => {
        const health = c.health || { ok: true, reasons: [] };
        const short = c.stats.analyzed !== c.stats.pages;
        const tone = (!health.ok || short) ? 'warn' : (c.stats.score == null ? 'info' : 'ok');

        const facts = [
            `<li><b class="num">${c.stats.analyzed}</b> of ${c.stats.pages} `
            + `page${c.stats.pages === 1 ? '' : 's'} scanned</li>`,
            `<li>score <b class="num">${showNum(c.stats.score)}</b>`
            + `${c.stats.confidence == null ? '' : ` · confidence <b class="num">${showPercent(c.stats.confidence)}</b>`}</li>`,
        ];

        // The spread behind the average. A mean that rose while the worst page
        // fell is the case one number cannot show, and the per-page score has
        // been in the payload all along.
        const spread = c.stats.pageScores;
        if (spread && spread.n > 1) {
            facts.push(`<li>worst page <b class="num">${showNum(spread.min)}</b>, `
                + `best <b class="num">${showNum(spread.max)}</b> `
                + `<span class="dash-trust-dim">across ${spread.n} pages</span></li>`);
        }

        const flags = [];
        if (c.stats.score == null) {
            flags.push('No score: this run evaluated too little to carry one, so its line breaks here.');
        }
        for (const reason of (health.reasons || [])) flags.push(reason);
        if (health.cancelled) flags.push('The run was cancelled before it finished.');
        if (health.failed) flags.push('The run ended in failure.');

        return `<article class="dash-trust-card dash-trust-card--${tone}">
            <p class="dash-trust-name">${esc(label(c))}</p>
            <ul class="dash-trust-facts">${facts.join('')}</ul>
            ${flags.length
        ? `<p class="dash-trust-flag"><span class="dash-caveat-i" aria-hidden="true">!</span>
                   <span>${esc(flags.join(' '))}</span></p>`
        : '<p class="dash-trust-ok">Completed as specified.</p>'}
        </article>`;
    };

    // Twenty-four cards that all say "completed as specified" push every chart
    // below the fold to tell the reader nothing. So the ones with something to
    // say are shown, and the rest fold away behind a count. At three or four
    // columns there is nothing to fold, and they all stay open.
    const suspects = d.columns.filter(isSuspect);
    const clean = d.columns.filter((c) => !isSuspect(c));
    const foldClean = d.columns.length > 6 && clean.length > 2;

    const cards = foldClean
        ? `${suspects.length ? `<div class="dash-trust">${suspects.map(card).join('')}</div>` : ''}
           <details class="dash-tableview dash-trust-more">
               <summary>${clean.length} ${clean.length === 1 ? `${unit.one} covered` : `${unit.many} covered`}
                   everything asked of ${clean.length === 1 ? 'it' : 'them'}. Show their figures</summary>
               <div class="dash-trust dash-trust--folded">${clean.map(card).join('')}</div>
           </details>`
        : `<div class="dash-trust">${d.columns.map(card).join('')}</div>`;

    const suspect = d.columns.filter(isSuspect);
    const verdictLine = suspect.length
        ? `${suspect.length} of these ${unit.many} did not cover everything they were asked to. `
          + `Read ${suspect.length === 1 ? 'that column' : 'those columns'} as incomplete, not as better.`
        : `Every ${unit.one} here completed what its workflow asked for, so the columns can be read against each other.`;

    const premise = d.mode === 'matrix'
        ? `A ${unit.one} that reached less of the site looks cleaner than it is.`
        : `Fewer problems is only good news when the ${unit.one} was whole.`;

    return `<section class="cmp2-sec">
        <div class="sec-head"><h3>Can these ${esc(unit.many)} be compared?</h3><span class="layer">read first</span></div>
        <p class="dash-sub">${esc(premise)} ${esc(verdictLine)}</p>
        ${cards}
    </section>`;
}

// ---------- what was fixed, and what was broken ----------

/**
 * Fixes and regressions per step, as a diverging bar chart: cleared above the
 * line, introduced below it.
 *
 * A net delta is the difference between two numbers people worked hard on, and
 * it credits neither. A window that closed 53 and opened 17 is a team shipping
 * fixes faster than it breaks things; the same window reported as "-36" is a
 * shrug.
 */
function flowChart(d) {
    const steps = d.flow.steps;
    const columns = d.columns;
    const w = 720;
    const h = 250;
    const padL = 52;
    const padR = 16;
    const padT = 22;
    const padB = 40;
    const plotH = h - padT - padB;

    // The line sits where the two sides' peaks put it, not in the middle. With
    // 209 cleared and 24 introduced, a centred line leaves the lower half nearly
    // empty and pushes the bars away from their badges. Each side still keeps
    // room for its axis word, even when it has no bars. The numbers above the
    // bars print into the top padding; the ones below get a strip of their own,
    // or the longest bar's number lands on the step badge under it.
    const peakUp = Math.max(0, ...steps.map((s) => s.fixed));
    const peakDown = Math.max(0, ...steps.map((s) => s.introduced));
    const numberRoom = 16;
    const barsH = plotH - numberRoom;
    const minSide = 14;
    const share = peakUp + peakDown ? (barsH * peakUp) / (peakUp + peakDown) : barsH / 2;
    const upRoom = Math.min(barsH - minSide, Math.max(minSide, share));
    const downRoom = barsH - upRoom;
    const mid = +(padT + upRoom).toFixed(1);

    // One scale for both sides, so a bar of 24 below the line is still 24/209
    // of the bar above it. Scaling each side to fill its own room would make
    // the small side look as big as the large one.
    const perUnit = Math.min(peakUp ? upRoom / peakUp : Infinity, peakDown ? downRoom / peakDown : Infinity);
    // Same floor as the severity stack: beside one huge step, a real step of
    // three would otherwise be a bar with no height at all.
    const scale = (v) => (v > 0 ? Math.max(2, v * perUnit) : 0);

    // One band per column, not one per step. Four reports make three steps, and
    // a chart drawn with three bands looks like it lost a report: the reader
    // counts what they loaded. So the first column keeps a band of its own and
    // is drawn as what it is, the point everything after it is measured from.
    const bandW = (w - padL - padR) / columns.length;
    const barW = Math.min(34, bandW * 0.32);
    // Past a certain density the printed figures collide with the next step's,
    // so they drop out and the table below carries them instead. A number drawn
    // on top of another number is worse than no number.
    const roomForNumbers = bandW >= 46;

    const bars = steps.map((step) => {
        // Band `step.to`, so each step sits under the column it arrived at.
        const i = step.to;
        const cx = padL + bandW * i + bandW / 2;
        const upH = scale(step.fixed);
        const downH = scale(step.introduced);

        const up = step.fixed
            ? `<rect class="dash-flow-fixed" x="${(cx - barW - 2).toFixed(1)}" y="${(mid - upH).toFixed(1)}"`
              + ` width="${barW.toFixed(1)}" height="${upH.toFixed(1)}" rx="2"`
              + ` data-tip-label="${esc(step.toLabel)} · cleared" data-tip-value="${step.fixed}"/>`
              + (roomForNumbers
                  ? `<text class="dash-flow-num dash-flow-num--good" x="${(cx - barW / 2 - 2).toFixed(1)}"`
                    + ` y="${(mid - upH - 6).toFixed(1)}" text-anchor="middle">${step.fixed}</text>`
                  : '')
            : '';
        const down = step.introduced
            ? `<rect class="dash-flow-new" x="${(cx + 2).toFixed(1)}" y="${mid.toFixed(1)}"`
              + ` width="${barW.toFixed(1)}" height="${downH.toFixed(1)}" rx="2"`
              + ` data-tip-label="${esc(step.toLabel)} · introduced" data-tip-value="${step.introduced}"/>`
              + (roomForNumbers
                  ? `<text class="dash-flow-num dash-flow-num--bad" x="${(cx + barW / 2 + 2).toFixed(1)}"`
                    + ` y="${(mid + downH + 14).toFixed(1)}" text-anchor="middle">${step.introduced}</text>`
                  : '')
            : '';

        return up + down;
    }).join('');

    // Full page width, so drawn at about the size it is shown: badges at their
    // plain size come out like the other charts'.
    const axis = numberedAxis(columns.map(label), (i) => padL + bandW * i + bandW / 2, bandW, h - 18);

    // The first column has no step into it, so it gets a mark on the axis and a
    // word instead of a pair of bars.
    const startX = padL + bandW / 2;
    // The word needs about 90 units; in a narrower band it would run into the
    // "cleared" label on its left, so it is left to the key, which says it too.
    const start = `<g class="dash-flow-start">`
        + `<circle class="dash-flow-origin" cx="${startX.toFixed(1)}" cy="${mid}" r="4"/>`
        + (bandW >= 96
            ? `<text class="dash-flow-origin-t" x="${startX.toFixed(1)}" y="${(mid - 12).toFixed(1)}"`
              + ` text-anchor="middle">starting point</text>`
            : '')
        + `</g>`;

    return `<svg class="dash-flowchart" viewBox="0 0 ${w} ${h}" role="img"`
        + ` aria-label="Failures cleared and introduced at each step. `
        + `${esc(label(columns[0]))} is the starting point. `
        + `${steps.map((s) => `into ${esc(s.toLabel)}: ${s.fixed} cleared, ${s.introduced} introduced`).join('; ')}">`
        + `<line class="dash-flow-axis" x1="${padL - 6}" x2="${w - padR}" y1="${mid}" y2="${mid}"/>`
        + `<text class="dash-axis" x="${padL - 10}" y="${(mid - 8).toFixed(1)}" text-anchor="end">cleared</text>`
        + `<text class="dash-axis" x="${padL - 10}" y="${(mid + 16).toFixed(1)}" text-anchor="end">added</text>`
        + start + bars + axis + `</svg>`;
}

function flowSection(d) {
    if (!d.flow || d.flow.steps.length < 1) return '';
    const unit = unitOf(d);
    const totals = d.flow.totals;

    const ratio = totals.introduced
        ? `For every problem introduced, ${round(totals.fixed / totals.introduced)} were cleared.`
        : 'Nothing was introduced across the whole window.';

    // Said in numbers, because "one fewer bar than I loaded reports" is the
    // first thing a reader notices and the last thing they should have to work
    // out for themselves.
    const arithmetic = `${d.columns.length} ${unit.many} give ${d.flow.steps.length} `
        + `${d.flow.steps.length === 1 ? 'step' : 'steps'}: ${label(d.columns[0])} is the starting point, `
        + `and each bar is the move into the ${unit.one} beneath it.`;

    return `<section class="cmp2-sec">
        <div class="sec-head"><h3>Cleared and introduced, ${esc(unit.one)} by ${esc(unit.one)}</h3>
            <span class="layer">the work</span></div>
        <p class="dash-sub">The headline delta is the difference between these two bars, so a flat window
            can still be a busy one. ${esc(arithmetic)}</p>
        <p class="dash-sub dash-sub--fine">Counted in failures, per kind of problem per step, which is a floor: a failure fixed in
            one place and reappearing in another within the same ${esc(unit.one)} cancels out here.</p>
        <div class="dash-panel">
            <p class="dash-flow-totals">
                <span class="dash-flow-total dash-flow-total--good"><b class="num">${totals.fixed}</b> cleared</span>
                <span class="dash-flow-total dash-flow-total--bad"><b class="num">${totals.introduced}</b> introduced</span>
                <span class="dash-flow-note">${esc(ratio)}</span>
            </p>
            ${chartScroll(`Cleared and introduced, ${unit.one} by ${unit.one}, chart`, flowChart(d))}
            ${columnKey(d.columns, { start: true })}
            ${chartTable(
        ['Step', 'Cleared', 'Introduced', 'Net', 'Rules gone', 'Rules new'],
        d.flow.steps.map((s) => [
            `${s.fromLabel} → ${s.toLabel}`, String(s.fixed), String(s.introduced),
            `${s.net > 0 ? '+' : ''}${s.net}`, String(s.rulesFixed), String(s.rulesNew),
        ]),
    )}
        </div>
    </section>`;
}

// ---------- WCAG, in the standard's own words ----------

const STATUS_CELL = {
    doesNotSupport: { short: 'fails', cls: 'bad', full: 'does not support' },
    partiallySupports: { short: 'partly', cls: 'part', full: 'partially supports' },
    needsReview: { short: 'check', cls: 'review', full: 'needs a human check' },
    supports: { short: 'ok', cls: 'ok', full: 'supports' },
    notApplicable: { short: 'n/a', cls: 'na', full: 'not applicable here' },
    notEvaluated: { short: '·', cls: 'none', full: 'not evaluated' },
};

const PRINCIPLES = [
    { id: '1', name: 'Perceivable', gloss: 'Can people take it in at all?' },
    { id: '2', name: 'Operable', gloss: 'Can people work the controls?' },
    { id: '3', name: 'Understandable', gloss: 'Can people follow what happens?' },
    { id: '4', name: 'Robust', gloss: 'Does it hold up in their own tools?' },
];

// The plain-language table is keyed by criterion, so it names criteria as well
// as rules. A criterion it does not know keeps its number, which is still the
// thing an auditor will look up.
function criterionName(sc) {
    const api = globalThis.A11Y_PLAIN_LANGUAGE;
    const hit = api && api.BY_CRITERION ? api.BY_CRITERION[sc] : null;
    return hit ? hit.name : `Success criterion ${sc}`;
}

// " · EN 301 549 9.1.4.3", naming the version when the reports saw only one:
// the two restate different WCAG versions, so 9.2.5.8 is V4.1.1 alone. When
// every scan targeted that version, it goes without saying.
function en301549Meta(entry) {
    if (!entry || !entry.clause) return '';
    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    return ` · EN 301 549 ${entry.clause}${versions.length === 1 && !entry.versionImplied ? ` (${versions[0]})` : ''}`;
}

// " · RGAA 1.1, 1.2": the RGAA criteria the reports' findings named. Only
// scans that targeted RGAA carry them, so other rows get nothing.
function rgaaMeta(criteria) {
    const list = Array.isArray(criteria) ? criteria.filter(Boolean) : [];
    return list.length ? ` · RGAA ${list.join(', ')}` : '';
}

// " · Sample Standard 1, 2": another standard's requirements the reports'
// findings named, standard by standard. Only scans against that standard's
// profile carry them.
function standardsMeta(standards) {
    return (Array.isArray(standards) ? standards : [])
        .filter((s) => s && s.standard && Array.isArray(s.requirements) && s.requirements.length)
        .map((s) => ` · ${s.standard} ${s.requirements.join(', ')}`)
        .join('');
}

function conformanceSourceNote(d) {
    const source = d.conformance.source;
    if (source === 'coverage') {
        return 'Read from each run’s own criterion verdicts, so a criterion the run passed is '
            + 'shown as passed rather than as silence.';
    }
    if (source === 'mixed') {
        return 'Some of these reports carry criterion verdicts and some do not, so the columns are not all '
            + 'measured the same way. An empty cell may mean "passed" in one column and "never checked" in another.';
    }
    return 'These reports carry no criterion verdicts, so the criteria below are read off the findings '
        + 'themselves: a criterion is only shown where some rule reached it. An empty cell means nothing '
        + 'was checked there, never that it passed.';
}

// One card per principle. A trend reads them as a movement: the latest figure
// and where it came from; a matrix has no latest, so it reads the same numbers
// as a spread across the variants instead. A sparkline over unordered columns
// would draw a slope nobody claimed, so it only appears where there is an order.
function principleCards(d) {
    const trend = d.mode !== 'matrix';
    const noun = columnNoun(d);

    const cards = PRINCIPLES.map((principle) => {
        const perColumn = d.columns.map((c) => {
            const bucket = c.conformance.byPrinciple[principle.id];
            return bucket ? bucket.failing : 0;
        });

        if (trend) {
            const latest = perColumn[perColumn.length - 1];
            return `<article class="dash-kpi">
                <p class="dash-kpi-label">${esc(principle.name)}</p>
                <p class="dash-kpi-value num">${latest}</p>
                <p class="dash-kpi-delta">${delta(perColumn[0], latest)}
                    <span class="dash-kpi-since">criteria failing</span></p>
                ${sparkline(perColumn)}
                <p class="dash-kpi-caption">${esc(principle.gloss)}</p>
            </article>`;
        }

        // Criteria failing on at least one column: the union, which is the
        // backlog, rather than any single variant's share of it.
        const anywhere = d.conformance.rows
            .filter((row) => row.principle === principle.id && row.columns > 0).length;
        const low = Math.min(...perColumn);
        const high = Math.max(...perColumn);

        return `<article class="dash-kpi">
            <p class="dash-kpi-label">${esc(principle.name)}</p>
            <p class="dash-kpi-value num">${anywhere}</p>
            <p class="dash-kpi-delta"><span class="dash-delta dash-delta--flat">${
    low === high ? `${low} on every ${noun.one}` : `${low} to ${high} per ${noun.one}`}</span>
                <span class="dash-kpi-since">criteria failing</span></p>
            <p class="dash-kpi-caption">${esc(principle.gloss)}</p>
        </article>`;
    }).join('');

    return `<section class="dash-kpis dash-kpis--principles" aria-label="Failing criteria by WCAG principle">`
        + cards + `</section>`;
}

function conformanceGrid(d) {
    const cats = CAT[d.mode];
    const rows = d.conformance.rows;
    if (!rows.length) return '';

    const groups = {};
    for (const row of rows) (groups[row.category] = groups[row.category] || []).push(row);
    const order = Object.keys(cats).filter((k) => (groups[k] || []).length);

    const filters = `<div class="dash-filters" role="group" aria-label="Filter criteria by what happened">`
        + `<button type="button" class="dash-chip" data-dash-filter="all" aria-pressed="true">`
        + `All <span class="dash-chip-n num">${rows.length}</span></button>`
        + order.map((k) => `<button type="button" class="dash-chip dash-chip--${cats[k].tone}"`
            + ` data-dash-filter="${esc(k)}" aria-pressed="false">${esc(cats[k].label)} `
            + `<span class="dash-chip-n num">${groups[k].length}</span></button>`).join('')
        + `</div>`;

    const head = `<tr><th scope="col" class="dash-rule-col">Success criterion</th>`
        + columnHeads(d.columns)
        + `<th scope="col" class="dash-what-col">What happened</th></tr>`;

    const body = rows.map((row) => {
        const cat = cats[row.category] || { label: row.category, tone: 'warn' };
        const cells = row.statuses.map((status, i) => {
            const cell = STATUS_CELL[status] || STATUS_CELL.notEvaluated;
            return `<td class="dash-cell dash-sc dash-sc--${cell.cls}">`
                + `<span class="dash-cell-v" aria-label="${esc(label(d.columns[i]))}: ${esc(cell.full)}">`
                + `${esc(cell.short)}</span></td>`;
        }).join('');

        return `<tr data-dash-cat="${esc(row.category)}">
            <th scope="row" class="dash-rule-col">
                <span class="dash-rule-name">${esc(criterionName(row.sc))}</span>
                <span class="dash-rule-meta">WCAG ${esc(row.sc)}${row.level ? ` · level ${esc(row.level)}` : ''}${esc(en301549Meta(row.en301549))}${esc(rgaaMeta(row.rgaa))}${esc(standardsMeta(row.standards))}</span>
            </th>${cells}
            <td class="dash-what-col"><span class="dash-cat-chip dash-cat-chip--${cat.tone}">${esc(cat.label)}</span></td>
        </tr>`;
    }).join('');

    return filters
        + gridScroll(d, 'WCAG, criterion by criterion', `<table class="dash-grid${d.columns.length > 10 ? ' dash-grid--wide' : ''}">
                <thead>${head}</thead><tbody>${body}</tbody>
            </table>`)
        + `
        <p class="dash-grid-legend">`
        + ['doesNotSupport', 'partiallySupports', 'needsReview', 'supports', 'notEvaluated'].map((k) => (
            `<span class="dash-lg"><span class="dash-sw dash-sc--${STATUS_CELL[k].cls}" aria-hidden="true"></span>`
            + `${esc(STATUS_CELL[k].full)}</span>`
        )).join('')
        + `</p>`;
}

function conformanceSection(d) {
    if (!d.conformance || !d.conformance.rows.length) return '';
    const noun = columnNoun(d);
    const totals = d.columns.map((c) => c.conformance.totals);

    // A trend has a latest column and the reader wants that one. A matrix has
    // none, so it gets the union: the criteria failing on at least one column,
    // which is the backlog the whole set shares.
    let headline;
    if (d.mode === 'matrix') {
        const failingSomewhere = d.conformance.rows.filter((row) => row.columns > 0).length;
        const reachable = Math.max(...totals.map((t) => t.concluded));
        headline = `${failingSomewhere} criteria fail on at least one ${noun.one}, out of the `
            + `${reachable} these ${noun.many} could conclude on.`;
    } else {
        const latest = totals[totals.length - 1];
        headline = latest.concluded
            ? `${latest.failing} of the ${latest.concluded} criteria the latest ${noun.one} could conclude on `
              + `${latest.failing === 1 ? 'is' : 'are'} failing.`
            : `The latest ${noun.one} could not conclude on any criterion.`;
    }

    return `<section class="cmp2-sec">
        <div class="sec-head"><h3>WCAG, criterion by criterion</h3><span class="layer">the standard</span></div>
        <p class="dash-sub">Rule ids are the scanner’s vocabulary; success criteria are the standard’s, and they are the
            one an audit, a VPAT and an accessibility statement are all written in. ${esc(headline)}
            ${esc(conformanceSourceNote(d))}</p>
        ${principleCards(d)}
        <div class="dash-conf-grid">${conformanceGrid(d)}</div>
    </section>`;
}

// ---------- the matrix, as a spreadsheet would want it ----------

// A pipeline or a spreadsheet wants rows and columns, not a picture. Rendered
// as text rather than offered as a download so it survives the exported file,
// where a script-driven save would not run.
function matrixCsv(d) {
    const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ['rule', 'name', 'severity', 'wcag', 'category', 'pagesAtWorst',
        ...d.columns.map((c) => label(c))];

    const lines = [header.map(quote).join(',')];
    for (const row of d.rows) {
        lines.push([
            quote(row.ruleId), quote(ruleWords(row).name), quote(row.severity),
            quote(row.wcag || ''), quote(row.category), row.reach ? row.reach.pages : 0,
            ...row.counts,
        ].join(','));
    }

    return `<details class="dash-tableview dash-csv">
        <summary>Copy this grid as CSV</summary>
        <p class="dash-csv-note">One row per problem, one column per ${esc(columnNoun(d).one)}: the shape a
            spreadsheet or a pipeline wants.</p>
        <pre class="dash-csv-text"><code>${esc(lines.join('\n'))}</code></pre>
    </details>`;
}

// One provenance row per column, in the order the columns are drawn.
// Both list the date beside the label, so a label qualified only by its day
// ("v2 · Oct 21") is shown as the name alone.
function sourceRows(d) {
    return d.columns.map((c) => ({
        label: c.undatedLabel || label(c),
        name: c.identity.scenarioName || c.identity.label,
        timestamp: c.identity.timestamp,
        scope: c.identity.scopeUrl,
        pages: c.stats.pages,
        analyzed: c.stats.analyzed,
        tags: c.identity.scanTags,
        optInRules: c.identity.optInRules,
        engines: c.identity.engines,
        incomplete: isSuspect(c),
    }));
}

// ---------- room before failing ----------

const MARGIN_TREND = { failsMore: 'Fails on more elements', closer: 'Closer to failing', further: 'More room', same: 'No change' };

// For each measuring rule, the pass with the least room in each column: a
// series can pass every rule and still be heading for a failure.
function marginsSection(d) {
    const rows = Array.isArray(d.margins) ? d.margins : [];
    if (!rows.length) return '';
    const trend = d.mode !== 'matrix';
    const cell = (m) => (m
        ? `<td><span class="num">${esc(formatMarginValue(m))}</span>, ${esc(formatMarginRoom(m))} left`
            + (isNearMiss(m) ? ' <span class="margin-near">near miss</span>' : '') + '</td>'
        : '<td>—</td>');
    const body = rows.map((r) => {
        const any = r.cells.find(Boolean);
        return `<tr${r.change ? ` data-change="${esc(r.change)}"` : ''}>`
            + `<th scope="row">${esc(r.title)} <code>${esc(r.ruleId)}</code></th>`
            + `<td>${esc(formatMarginLimit(any))}</td>`
            + r.cells.map(cell).join('')
            + (trend ? `<td>${r.change ? `<span class="margin-chg margin-chg--${esc(r.change)}">${esc(MARGIN_TREND[r.change])}</span>` : '—'}</td>` : '')
            + '</tr>';
    }).join('');
    return `<section class="cmp2-sec"><div class="sec-head"><h3>Room before failing</h3>`
        + `<span class="layer">passes</span></div>`
        + `<p class="dash-sub">For each rule that measures against a limit, the pass with the least room in each `
        + `${esc(trend ? unitOf(d).one : 'variant')}.${trend ? ' Room that shrinks is a warning before a failure.' : ''}</p>`
        + `<div class="dash-table-scroll"><table class="doc-table margin-table">`
        + `<thead><tr><th scope="col">Rule</th><th scope="col">Limit</th>`
        + d.columns.map((c) => `<th scope="col">${esc(label(c))}</th>`).join('')
        + (trend ? '<th scope="col">First to last</th>' : '')
        + `</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

// ---------- top level ----------

// "Where the failures are" across the columns (docs/design/issue-dispersion-design.md
// §10). The caller computes it, in column order; absent, the section is left out.
function dispersionSection(d, dispersion) {
    const view = globalThis.A11Y_ISSUE_DISPERSION_VIEW;
    if (!dispersion || !view) return '';
    return `<section class="cmp2-sec"><div class="sec-head"><h3>Where the failures are</h3>`
        + `<span class="layer">by scan</span></div>`
        + view.seriesBodyHTML(dispersion, { labels: d.columns.map((c) => c.label), mode: d.mode })
        + `</section>`;
}

// Where the strip at the top and the "Covering" fact point to: the provenance
// table at the foot, which has every detail of every report.
const SOURCES_ID = 'cmp-sources';

export function comparisonSeriesHTML(d, { dispersion } = {}) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.columns)) {
        return '<div class="cmp2"><p>No comparison data.</p></div>';
    }

    const hero = d.mode === 'matrix' ? heroMatrix(d) : heroTrend(d);
    const numbers = d.mode === 'matrix' ? variantCards(d) : kpiRow(d);
    // "What this says" is a reading of the whole page, so it gets the whole
    // width in both framings rather than hanging off the severity chart.
    const reading = `<section class="cmp2-sec">${narrativePanel(d, 3)}</section>`;
    const change = d.mode === 'matrix' ? reading : changeSection(d) + reading;

    // Order: what is this document -> where do we stand -> the headline numbers
    // -> can these be read against each other at all -> what moved -> the work
    // behind the move -> WCAG in its own words -> what to fix -> the evidence ->
    // what it was all made from. The trust strip sits above every chart because
    // it can invalidate all of them; the masthead and the provenance block sit
    // at the two ends because they are what the file needs to explain itself.
    return `<div class="cmp2 cmp2--dash" data-mode="${esc(d.mode)}">`
        + mastheadHTML(d.document, { sourcesHref: `#${SOURCES_ID}` })
        + reportsStripHTML(sourceRows(d), { sourcesHref: `#${SOURCES_ID}` })
        + hero + numbers + trustCards(d) + change
        + dispersionSection(d, dispersion)
        + (d.mode === 'matrix' ? '' : flowSection(d))
        + conformanceSection(d) + fixFirst(d) + ruleGrid(d)
        + marginsSection(d)
        + provenanceHTML(sourceRows(d), d.document, {
            columnTerm: d.mode === 'matrix' ? 'Variant' : 'Column',
            id: SOURCES_ID,
        })
        + `</div>`;
}

export function renderComparisonSeries(d, extras) {
    const holder = document.createElement('div');
    holder.innerHTML = comparisonSeriesHTML(d, extras);
    return Array.from(holder.childNodes);
}
