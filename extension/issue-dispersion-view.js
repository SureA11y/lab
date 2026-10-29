'use strict';

// The words and pictures for issue dispersion (docs/design/issue-dispersion-design.md):
// the generated explanation, the scan strip, the rule map, and the comparison
// views, all as HTML strings built from issue-dispersion.js results. One
// delegated interaction layer (installDispersionInteractions) gives the strips
// and the tooltips their behaviour, in the app and in the exported files alike,
// reading only what the markup itself carries.
//
// Browser: available as globalThis.A11Y_ISSUE_DISPERSION_VIEW.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./issue-dispersion.js'));
    } else {
        if (!root.A11Y_ISSUE_DISPERSION) {
            throw new Error('issue-dispersion-view.js: load issue-dispersion.js before this file');
        }
        root.A11Y_ISSUE_DISPERSION_VIEW = factory(root.A11Y_ISSUE_DISPERSION);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {

    const T = core.THRESHOLDS;

    // ------------------------------------------------------------------
    // Vocabulary
    // ------------------------------------------------------------------

    const PATTERN = {
        widespread: { label: 'Widespread', icon: '\u2261' },
        concentrated: { label: 'Concentrated', icon: '\u25ce' },
        scattered: { label: 'Scattered', icon: '\u2234' },
        mixed: { label: 'Mixed', icon: '\u2261\u25ce' },
        clean: { label: 'No automatic failures', icon: '\u2713' },
        few: { label: 'Too few scans', icon: '\u2026' },
    };
    const KIND = {
        component: 'Shared component',
        template: 'Broken template',
        page: 'Broken page or state',
        oneOff: 'One-off',
    };
    const CHANGE = {
        contained: { icon: '\u2193', label: 'Contained' },
        spread: { icon: '\u2191', label: 'Spread' },
        steady: { icon: '\u2192', label: 'Steady' },
        new: { icon: '+', label: 'New' },
        resolved: { icon: '\u2713', label: 'Resolved' },
    };
    const SEV_R = { critical: 8, serious: 6.5, moderate: 5, minor: 4, unknown: 4 };

    // ------------------------------------------------------------------
    // Formatting
    // ------------------------------------------------------------------

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }
    // Shares under 10% keep one decimal, so 1.7% of 300 scans does not read as 2%.
    function pct(v) {
        const p = (Number(v) || 0) * 100;
        if (p > 0 && p < 10 && Math.round(p) !== p) return p.toFixed(1).replace(/\.0$/, '') + '%';
        return Math.round(p) + '%';
    }
    function num1(v) {
        const x = Number(v) || 0;
        return x < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x));
    }
    function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
    function codeList(ids) {
        const c = ids.map((x) => `<code>${esc(x)}</code>`);
        if (c.length <= 1) return c.join('');
        return c.slice(0, -1).join(', ') + ' and ' + c[c.length - 1];
    }
    function mean(vals) { return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0; }
    function reachRange(rules, pick) {
        const vals = rules.map(pick || ((r) => r.reach));
        const a = Math.min(...vals), b = Math.max(...vals);
        return a === b ? pct(a) : `${pct(a)}\u2013${pct(b)}`;
    }
    function scanRange(h) {
        return h.fromIndex === h.toIndex ? `scan ${h.fromIndex + 1}` : `scans ${h.fromIndex + 1}\u2013${h.toIndex + 1}`;
    }
    function hotspotLabels(h) {
        if (!h.labels.length) return '';
        return h.ellipsis ? `${h.labels[0]} \u2026 ${h.labels[1]}` : h.labels.join(', ');
    }
    function hotspotText(h) {
        const labels = hotspotLabels(h);
        return labels ? `${scanRange(h)} (${esc(labels)})` : scanRange(h);
    }
    function uid(prefix) {
        return String(prefix || 'dsp').replace(/[^a-zA-Z0-9_-]/g, '-');
    }

    function badgeHTML(pattern) {
        const p = PATTERN[pattern] || PATTERN.clean;
        return `<span class="dsp-badge dsp-badge--${esc(pattern)}"><span class="dsp-badge-icon" aria-hidden="true">${p.icon}</span>${esc(p.label)}</span>`;
    }
    function changeHTML(change) {
        const c = CHANGE[change];
        return `<span class="dsp-change dsp-change--${esc(change)}"><span aria-hidden="true">${c.icon}</span> ${esc(c.label)}</span>`;
    }
    function tableHTML(caption, head, rows, numCols) {
        const nums = numCols || [];
        const th = head.map((h, i) => `<th scope="col"${nums.includes(i) ? ' class="dsp-num"' : ''}>${h}</th>`).join('');
        const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${nums.includes(i) ? ' class="dsp-num"' : ''}>${c}</td>`).join('')}</tr>`).join('');
        return `<details class="dsp-table"><summary>Show as table</summary><div class="dsp-table-wrap"><table>`
            + `<caption>${caption}</caption><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></details>`;
    }

    // ------------------------------------------------------------------
    // Explanation (design notes §6)
    // ------------------------------------------------------------------

    /** Paragraphs (HTML) that say what the pattern means and what to do next. */
    function explainParagraphs(r) {
        const out = [];
        const wide = r.rules.filter((x) => x.band === 'widespread');
        const h = r.hotspots[0];
        switch (r.pattern) {
        case 'few':
            out.push(`Only ${plural(r.scansAnalyzed, 'scan')} in view, so spread percentages would not mean much. `
                + `The charts still show which scans fail; the pattern and the percentages need at least ${T.minScans} scans.`);
            break;
        case 'clean':
            out.push(`None of the ${r.scansAnalyzed} scans has automatic failures.`);
            break;
        case 'widespread':
            out.push(`<strong>The same ${plural(r.rulesFailing, 'rule')} fail almost everywhere:</strong> `
                + `${codeList(wide.map((x) => x.ruleId))} fail in ${reachRange(wide)} of the ${r.scansAnalyzed} scans, `
                + `with about ${num1(mean(wide.map((x) => x.intensity)))} elements each time.`);
            out.push(`A rule that repeats across a whole run usually comes from something every page shares, such as the header, `
                + `the navigation or the footer. Fixing ${r.rulesFailing === 1 ? 'it' : 'these rules'} once would clear failures from ${plural(r.affectedScans, 'scan')}.`);
            break;
        case 'concentrated':
            out.push(`<strong>All ${plural(r.rulesFailing, 'failing rule')} sit in just ${r.affectedScans} of ${r.scansAnalyzed} scans `
                + `(${pct(r.affectedRate)})</strong>${h && r.affectedRate <= T.fewAffected ? `, mostly in ${hotspotText(h)}` : ''}. `
                + (r.affectedRate <= T.fewAffected
                    ? `The other ${r.scansAnalyzed - r.affectedScans} scans have no automatic failures.`
                    : `The worst 10% of scans hold ${pct(r.top10Share)} of the failing elements.`));
            out.push('This points to a problem in a specific flow or page state rather than in a site-wide component. '
                + 'Start by opening those scans.');
            break;
        case 'scattered': {
            const maxReach = Math.max(...r.rules.map((x) => x.reach));
            out.push(`<strong>${r.affectedScans} of ${r.scansAnalyzed} scans fail (${pct(r.affectedRate)}), `
                + `but no rule reaches more than ${pct(maxReach)} of them.</strong> Each failing scan has its own small set of problems `
                + `(typically ${plural(r.medianRulesPerAffectedScan, 'rule')}), spread over ${plural(r.rulesFailing, 'different rule')}.`);
            out.push('There is no single fix here. This usually comes from content and authoring rather than shared code, '
                + 'and is better handled with guidance and checks for authors than with one patch.');
            break;
        }
        case 'mixed': {
            const rest = r.rulesFailing - wide.length;
            out.push(`<strong>A widespread core plus local problems.</strong> ${codeList(wide.map((x) => x.ruleId))} `
                + `${wide.length === 1 ? 'fails' : 'fail'} in ${reachRange(wide)} of the ${r.scansAnalyzed} scans, which suggests a shared component. `
                + `Fixing ${wide.length === 1 ? 'it' : 'those ' + wide.length} alone would leave ${r.cleanIfWidespreadFixed} of ${r.scansAnalyzed} scans clean.`);
            if (h) {
                out.push(`The other ${plural(rest, 'rule')} ${rest === 1 ? 'is' : 'are'} more local: ${pct(h.share)} of their failing elements are in ${hotspotText(h)}.`);
            } else {
                out.push(`The other ${plural(rest, 'rule')} ${rest === 1 ? 'is' : 'are'} spread thinly, with no single place where ${rest === 1 ? 'it gathers' : 'they gather'}.`);
            }
            break;
        }
        default:
            break;
        }
        const heavy = r.rules.filter((x) => x.kind === 'template');
        if (r.pattern !== 'few' && heavy.length) {
            out.push(`${codeList(heavy.map((x) => x.ruleId))} ${heavy.length === 1 ? 'is' : 'are'} both widespread and heavy `
                + `(${num1(mean(heavy.map((x) => x.intensity)))} elements per scan), more like a template-wide style or markup pattern than a single element.`);
        }
        return out;
    }

    function reviewNote(r) {
        if (!r.cantTell.rules) return '';
        return `Also, ${plural(r.cantTell.rules, 'rule')} ${r.cantTell.rules === 1 ? 'needs' : 'need'} manual review in `
            + `${plural(r.cantTell.scans, 'scan')}. ${r.cantTell.rules === 1 ? 'It is' : 'They are'} not counted here.`;
    }

    // ------------------------------------------------------------------
    // Scan strip
    // ------------------------------------------------------------------

    const CW = 4; // viewBox units per scan column (3 filled + 1 gap)

    // A strip's scans as its markup carries them, for the interaction layer:
    // [label, widespread rules, other rules, failing elements, rule list,
    //  scanId, [[ruleId, failing elements, widespread 0|1], ...]].
    function stripRows(r) {
        const wide = new Set(r.rules.filter((x) => x.band === 'widespread').map((x) => x.ruleId));
        return r.perScan.map((p) => [p.label, p.widespread, p.other, p.elements, p.ruleIds.join(', '), p.scanId,
            p.ruleIds.map((id, k) => [id, p.ruleElements[k], wide.has(id) ? 1 : 0])]);
    }

    // What the strips count: every failing rule unless some are picked, and
    // the column height as rules or as failing elements.
    const DEFAULT_VIEW = { mode: 'rules', rules: [] };
    function prepView(view) {
        const v = view || DEFAULT_VIEW;
        const rules = Array.isArray(v.rules) ? v.rules.map(String) : [];
        return { mode: v.mode === 'elements' ? 'elements' : 'rules', rules, sel: rules.length ? new Set(rules) : null };
    }
    function countRow(row, v) {
        const rules = (row[6] || []).filter((x) => !v.sel || v.sel.has(x[0]));
        const c = { wide: 0, other: 0, wideEl: 0, otherEl: 0, rules };
        for (const [, el, w] of rules) {
            if (w) { c.wide++; c.wideEl += el; } else { c.other++; c.otherEl += el; }
        }
        return c;
    }
    function measureOf(c, v) {
        return v.mode === 'elements' ? c.wideEl + c.otherEl : c.wide + c.other;
    }
    /** The tallest column over strips [{rows, name}], with where it is. */
    function tallestColumn(strips, v) {
        let top = { value: 0, index: -1, name: '' };
        for (const s of strips) {
            s.rows.forEach((row, i) => {
                const m = measureOf(countRow(row, v), v);
                if (m > top.value) top = { value: m, index: i, name: s.name || '' };
            });
        }
        return top;
    }

    // Widespread rules at the bottom, the rest on top. Failing elements go on
    // a square-root scale: a scan with hundreds of them would otherwise
    // flatten every other column. `max` is the tallest column's count.
    function stripBars(rows, H, max, v) {
        const byEl = v.mode === 'elements';
        const unit = (H - 4) / Math.max(1, byEl ? Math.sqrt(max) : max);
        let rects = '';
        rows.forEach((row, i) => {
            const x = i * CW;
            const c = countRow(row, v);
            const a = byEl ? c.wideEl : c.wide, b = byEl ? c.otherEl : c.other;
            if (!a && !b) {
                rects += `<rect class="dsp-s-clean" x="${x}" y="${H - 2}" width="${CW - 1}" height="2"/>`;
                return;
            }
            const total = (byEl ? Math.sqrt(a + b) : a + b) * unit;
            const hw = total * a / (a + b), ho = total - hw;
            if (hw) rects += `<rect class="dsp-s-wide" x="${x}" y="${(H - hw).toFixed(2)}" width="${CW - 1}" height="${hw.toFixed(2)}"/>`;
            if (ho) {
                const gap = hw ? 1.5 : 0;
                rects += `<rect class="dsp-s-other" x="${x}" y="${(H - hw - ho).toFixed(2)}" width="${CW - 1}" height="${Math.max(1, ho - gap).toFixed(2)}"/>`;
            }
        });
        return rects;
    }

    function scanTipText(rows, i, v) {
        const label = rows[i][0];
        const head = `Scan ${i + 1} of ${rows.length}${label ? ` · ${label}` : ''}`;
        const c = countRow(rows[i], v);
        if (!c.rules.length) return `${head}: ${v.sel ? 'none of the selected rules fail' : 'no automatic failures'}`;
        return `${head}: ${plural(c.rules.length, v.sel ? 'selected rule' : 'failing rule')}${v.sel ? ' failing' : ''} `
            + `(${c.wide} widespread, ${c.other} other), ${plural(c.wideEl + c.otherEl, 'failing element')}`;
    }

    /**
     * One column per scan in the report's scan order. Height is the number of
     * failing rules; widespread rules at the bottom, the rest on top.
     * `max` shares one height scale between strips that are compared; `name`
     * says which report a strip is, for the strips' status line.
     */
    function stripHTML(r, opts) {
        const o = opts || {};
        const N = r.scansAnalyzed;
        if (!N) return '';
        const H = o.height || 96;
        const v = prepView(null);
        const rows = stripRows(r);
        const rects = stripBars(rows, H, Math.max(1, o.max || r.maxRulesInScan), v);
        // Each hotspot's label has a line of its own, the leftmost on top, so
        // two can never run into each other however long their scan names.
        // A label starts at its bracket's left edge, or ends at its right edge
        // in the strip's right half, and is cut short with an ellipsis where
        // it would leave the strip; the text above the strip names them whole.
        const shown = (o.hotspots === false || r.pattern === 'few') ? []
            : r.hotspots.slice().sort((a, b) => a.fromIndex - b.fromIndex);
        const hots = shown.map((h, i) => {
            const left = (h.fromIndex / N) * 100, right = ((h.toIndex + 1) / N) * 100;
            const labels = hotspotLabels(h);
            const text = `Hotspot · ${scanRange(h)}${labels ? ` · ${labels}` : ''}`;
            const anchor = (left + right) / 2 <= 50
                ? `left:${left.toFixed(3)}%;max-width:${(100 - left).toFixed(3)}%`
                : `right:${(100 - right).toFixed(3)}%;max-width:${right.toFixed(3)}%`;
            return `<div class="dsp-hot" style="left:${left.toFixed(3)}%;width:${(right - left).toFixed(3)}%"></div>`
                + `<span class="dsp-hot-label" style="${anchor};bottom:${10 + (shown.length - 1 - i) * 16}px" title="${esc(text)}">${esc(text)}</span>`;
        }).join('');
        const first = Math.max(0, r.perScan.findIndex((p) => p.ruleIds.length));
        const label = o.label || `Scan strip: ${N} scans in report order, ${r.affectedScans} with automatic failures`;
        const ticks = [0, 0.25, 0.5, 0.75].filter((t) => Math.floor(t * N) < N)
            .map((t) => {
                const i = Math.floor(t * N);
                return `<span style="left:${((i / N) * 100).toFixed(3)}%">${i + 1}</span>`;
            }).join('') + `<span class="dsp-axis-end">${N}</span>`;
        return `<div class="dsp-strip-fig${o.compact ? ' dsp-strip-fig--compact' : ''}">`
            + (o.hotspots === false ? '' : `<div class="dsp-strip-marks${shown.length > 1 ? ' dsp-strip-marks--2' : ''}" aria-hidden="true">${hots}</div>`)
            + `<div class="dsp-strip" role="slider" tabindex="0" aria-label="${esc(label)}"`
            + ` aria-valuemin="1" aria-valuemax="${N}" aria-valuenow="${first + 1}"`
            + ` aria-valuetext="${esc(scanTipText(rows, first, v))}"`
            + ` data-dsp-strip="${esc(JSON.stringify(rows))}"${o.name ? ` data-dsp-name="${esc(o.name)}"` : ''}${o.linkScans ? ' data-dsp-link="1"' : ''}>`
            + `<svg viewBox="0 0 ${N * CW} ${H}" preserveAspectRatio="none" style="height:${H}px" aria-hidden="true" focusable="false">`
            + `${rects}<rect class="dsp-s-cursor" x="-10" y="0" width="${CW}" height="${H}"/></svg></div>`
            + `<div class="dsp-strip-axis" aria-hidden="true">${ticks}</div>`
            + `</div>`;
    }

    function cleanLegendText(v) {
        return v.sel ? 'None of the selected rules fail here' : 'Scan with no automatic failures';
    }
    function stripLegendHTML() {
        return `<div class="dsp-legend">`
            + `<span><i class="dsp-sw dsp-sw--wide"></i>Widespread rules (fail in ≥${pct(T.widespread)} of scans)</span>`
            + `<span><i class="dsp-sw dsp-sw--other"></i>Other rules</span>`
            + `<span><i class="dsp-sw dsp-sw--clean"></i><span data-dsp-clean>${cleanLegendText(prepView(null))}</span></span>`
            + `</div>`;
    }

    // The strip's table counts what the strip counts.
    function stripTableParts(rows, v) {
        const affected = [];
        rows.forEach((row, i) => {
            const c = countRow(row, v);
            if (c.rules.length) affected.push({ i, row, c });
        });
        const shown = affected.slice(0, 100);
        const more = affected.length > shown.length ? ` Showing the first ${shown.length} of ${affected.length}.` : '';
        const rest = rows.length - affected.length;
        const caption = v.sel
            ? `Scans where the selected rules fail, in report order.${more} They fail in none of the other ${rest} scans.`
            : `Scans with automatic failures, in report order.${more} The other ${rest} scans have none.`;
        const body = shown.map(({ i, row, c }) => [String(i + 1), esc(row[0] || '—'), String(c.wide), String(c.other),
            String(c.wideEl + c.otherEl), esc(c.rules.map((x) => x[0]).join(', '))]);
        return { caption, body };
    }
    const STRIP_TABLE_NUMS = [0, 2, 3, 4];
    function stripTableBodyHTML(body) {
        return body.map((r) => `<tr>${r.map((c, i) => `<td${STRIP_TABLE_NUMS.includes(i) ? ' class="dsp-num"' : ''}>${c}</td>`).join('')}</tr>`).join('');
    }

    function stripTableHTML(r) {
        const { caption, body } = stripTableParts(stripRows(r), prepView(null));
        return tableHTML(caption,
            ['Scan', 'Name', 'Widespread rules', 'Other rules', 'Failing elements', 'Rules'],
            body, STRIP_TABLE_NUMS)
            .replace('<details class="dsp-table">', '<details class="dsp-table" data-dsp-strip-table>');
    }

    // ------------------------------------------------------------------
    // Strip controls: which rules the strips count, and what the height is
    // ------------------------------------------------------------------

    // The rules the filter offers, over every report its strips show: widest
    // reach first, and widespread when the rule is widespread in any of them.
    function filterRules(results) {
        const by = new Map();
        for (const res of results) {
            for (const x of res.rules) {
                const o = by.get(x.ruleId) || { ruleId: x.ruleId, reports: 0, reach: 0, wide: false };
                o.reports++;
                o.reach = Math.max(o.reach, x.reach);
                o.wide = o.wide || x.band === 'widespread';
                by.set(x.ruleId, o);
            }
        }
        return [...by.values()].sort((a, b) => b.reach - a.reach || String(a.ruleId).localeCompare(String(b.ruleId)));
    }

    function stripsStatusText(v, ruleCount, top) {
        let s = v.sel
            ? `Counting ${v.rules.length} of ${plural(ruleCount, 'failing rule')}.`
            : `Counting all ${plural(ruleCount, 'failing rule')}.`;
        if (!top.value) return `${s} None of the selected rules fail in these scans.`;
        const where = `scan ${top.index + 1}${top.name ? ` of ${top.name}` : ''}`;
        s += v.mode === 'elements'
            ? ` Tallest column: ${plural(top.value, 'failing element')} (${where}), on a square-root scale.`
            : ` Tallest column: ${plural(top.value, 'rule')} (${where}).`;
        if (v.rules.length === 1 && v.mode === 'rules') s += ' Switch the height to failing elements to see how much it fails in each scan.';
        return s;
    }

    function heightHelpText(v) {
        return v.mode === 'elements'
            ? 'Height is the number of failing elements in that scan, on a square-root scale.'
            : 'Height is the number of failing rules in that scan.';
    }

    let stripsSeq = 0;

    /**
     * The strips with their controls above them: one filter and one height
     * switch for every strip inside, so strips that are compared stay on one
     * scale. `results` are the analyses the strips draw, `names` their report
     * names; `inner` is the legend, the strips and anything else they drive.
     */
    function stripsGroupHTML(results, names, inner, opts) {
        const o = opts || {};
        const id = uid(o.id || `dsp-strips-${++stripsSeq}`);
        const rules = filterRules(results);
        const multi = results.length > 1;
        const v = prepView(null);
        const top = tallestColumn(results.map((r, i) => ({ rows: stripRows(r), name: names[i] || '' })), v);
        const opt = (x) => `<label class="dsp-opt" data-dsp-rule="${esc(x.ruleId)}"><input type="checkbox" value="${esc(x.ruleId)}">`
            + `<code>${esc(x.ruleId)}</code><span class="dsp-opt-meta">`
            + `${multi ? `${x.reports} of ${results.length} reports · up to ` : ''}${pct(x.reach)} of scans</span></label>`;
        const wide = rules.filter((x) => x.wide), other = rules.filter((x) => !x.wide);
        const set = (legend, list) => (list.length ? `<fieldset><legend>${legend}</legend>${list.map(opt).join('')}</fieldset>` : '');
        return `<div class="dsp-strips" data-dsp-strips="${esc(id)}" data-dsp-view="${esc(JSON.stringify(DEFAULT_VIEW))}">`
            + `<div class="dsp-tools">`
            + `<fieldset class="dsp-seg"><legend>Column height</legend>`
            + `<label><input type="radio" name="${esc(id)}-height" value="rules" checked>Failing rules</label>`
            + `<label><input type="radio" name="${esc(id)}-height" value="elements">Failing elements</label>`
            + `</fieldset>`
            + `<div class="dsp-filter">`
            + `<button type="button" class="dsp-filter-btn" aria-expanded="false" aria-controls="${esc(id)}-rules" data-dsp-filter-toggle>`
            + `Filter rules<span class="dsp-filter-n" hidden></span><span class="dsp-filter-caret" aria-hidden="true">▾</span></button>`
            + `<div class="dsp-filter-panel" id="${esc(id)}-rules" role="group" aria-label="Rules the strips count" hidden>`
            + `<input type="search" class="dsp-filter-find" placeholder="Find a rule" aria-label="Find a rule" autocomplete="off" data-dsp-find>`
            + `<div class="dsp-filter-list">${set(multi ? 'Widespread in a report' : 'Widespread', wide)}${set('Other rules', other)}`
            + `<p class="dsp-help" data-dsp-nomatch hidden>No rule matches.</p></div>`
            + `<div class="dsp-filter-foot"><span data-dsp-filter-count>None selected: every rule counts</span>`
            + `<span><button type="button" class="dsp-link" data-dsp-clear>Clear</button>`
            + `<button type="button" class="dsp-link" data-dsp-filter-done>Done</button></span></div>`
            + `</div></div></div>`
            + `<div class="dsp-chips" role="group" aria-label="Rules counted" data-dsp-chips hidden></div>`
            + `<p class="dsp-strips-status" role="status" data-dsp-status>${esc(stripsStatusText(v, rules.length, top))}</p>`
            + inner
            + `</div>`;
    }

    // ------------------------------------------------------------------
    // Rule map
    // ------------------------------------------------------------------

    // `dots` ({x, y, r} in chart units) let each quadrant title take a corner
    // of its quadrant that no dot sits on.
    function mapFrame(ymax, dots) {
        const W = 640, H = 380, m = { l: 48, r: 18, t: 16, b: 46 };
        const sx = (v) => m.l + v * (W - m.l - m.r);
        const sy = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
        let g = '';
        [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
            g += `<line class="dsp-grid" x1="${sx(v)}" x2="${sx(v)}" y1="${m.t}" y2="${H - m.b}"/>`;
            g += `<text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle">${v * 100}%</text>`;
        });
        const yStep = ymax > 16 ? 4 : 2;
        for (let v = 0; v <= ymax; v += yStep) {
            g += `<line class="dsp-grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`;
            g += `<text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
        }
        g += `<line class="dsp-axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
        g += `<line class="dsp-thr" x1="${sx(T.widespread)}" x2="${sx(T.widespread)}" y1="${m.t}" y2="${H - m.b}"/>`;
        g += `<line class="dsp-thr" x1="${m.l}" x2="${W - m.r}" y1="${sy(T.heavy)}" y2="${sy(T.heavy)}"/>`;
        const dotBox = (dots || []).map((d) => ({ x: d.x - d.r - 3, y: d.y - d.r - 3, w: 2 * d.r + 6, h: 2 * d.r + 6 }));
        const over = (p, q) => p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;
        const qboxes = [];
        const q = (left, right, top, bottom, t1, t2) => {
            const w = Math.max(t1.length * 7.4, t2.length * 5.8);
            const cands = [];
            for (const y of [top + 14, bottom - 18]) {
                cands.push({ x: left + 8, y, anchor: 'start' });
                cands.push({ x: right - 8, y, anchor: 'end' });
            }
            const boxOf = (c) => ({ x: c.anchor === 'start' ? c.x : c.x - w, y: c.y - 12, w, h: 30 });
            // Outer corners first: the titles read best at the chart's edges.
            const outer = left === m.l ? [0, 2, 1, 3] : [1, 3, 0, 2];
            const pick = outer.map((i) => cands[i]).find((c) => !dotBox.some((d) => over(d, boxOf(c)))) || cands[outer[0]];
            qboxes.push(boxOf(pick));
            return `<text class="dsp-q" x="${pick.x}" y="${pick.y}" text-anchor="${pick.anchor}">${t1}</text>`
                + `<text class="dsp-qs" x="${pick.x}" y="${pick.y + 13}" text-anchor="${pick.anchor}">${t2}</text>`;
        };
        const midX = sx(T.widespread), midY = sy(T.heavy);
        g += q(m.l, midX, m.t, midY, KIND.page, 'few scans, many elements');
        g += q(midX, W - m.r, m.t, midY, KIND.template, 'most scans, many elements');
        g += q(m.l, midX, midY, H - m.b, KIND.oneOff, 'few scans, few elements');
        g += q(midX, W - m.r, midY, H - m.b, KIND.component, 'most scans, few elements');
        g += `<text class="dsp-ttl" x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">Reach: share of scans where the rule fails \u2192</text>`;
        g += `<text class="dsp-ttl" transform="translate(13 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">Elements per failing scan \u2192</text>`;
        return { W, H, m, sx, sy, g, qboxes };
    }

    // Chart-unit positions of a rule list, before the frame exists.
    function mapScale(ymax) {
        const W = 640, H = 380, m = { l: 48, r: 18, t: 16, b: 46 };
        return {
            sx: (v) => m.l + v * (W - m.l - m.r),
            sy: (v) => H - m.b - (v / ymax) * (H - m.t - m.b),
        };
    }

    // Labels go right, left, above or below their dot, whichever is free of
    // other dots, arrows and the quadrant titles; failing that, nudged with a
    // leader line.
    function placeLabels(items, f, obstacles) {
        const boxes = f.qboxes.concat(obstacles);
        const over = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        const inside = (b) => b.x >= f.m.l + 2 && b.x + b.w <= f.W - 4 && b.y >= 2 && b.y + b.h <= f.H - f.m.b - 2;
        const free = (b) => inside(b) && !boxes.some((o) => over(o, b));
        let out = '';
        items.forEach((it) => {
            const w = it.text.length * 6.7 + 2, h = 12;
            const cands = [
                { x: it.x + it.r + 4, y: it.y - h / 2 },
                { x: it.x - it.r - 4 - w, y: it.y - h / 2 },
                { x: it.x - w / 2, y: it.y - it.r - 3 - h },
                { x: it.x - w / 2, y: it.y + it.r + 3 },
            ].map((c) => ({ x: c.x, y: c.y, w, h }));
            let box = cands.find(free);
            let leader = false;
            for (let n = 1; !box && n <= 8; n++) {
                for (const dy of [-16 * n, 16 * n]) {
                    box = [cands[0], cands[1]].map((c) => ({ x: c.x, y: c.y + dy, w, h })).find(free);
                    if (box) { leader = true; break; }
                }
            }
            if (!box) box = cands[0];
            boxes.push(box);
            if (leader) {
                const lx = box.x > it.x ? box.x - 2 : box.x + box.w + 2;
                out += `<line class="dsp-leader" x1="${it.x}" y1="${it.y}" x2="${lx}" y2="${box.y + h / 2}"/>`;
            }
            out += `<text class="dsp-lbl" x="${box.x}" y="${box.y + h - 2}">${esc(it.text)}</text>`;
        });
        return out;
    }
    const dotBoxes = (pts) => pts.map((d) => ({ x: d.x - d.r - 2, y: d.y - d.r - 2, w: 2 * d.r + 4, h: 2 * d.r + 4 }));
    function lineBoxes(x1, y1, x2, y2) {
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
        const out = [];
        for (let i = 0; i <= n; i++) out.push({ x: x1 + (x2 - x1) * i / n - 3, y: y1 + (y2 - y1) * i / n - 3, w: 6, h: 6 });
        return out;
    }

    function ruleTip(rule, total, extra) {
        return `<b>${esc(rule.ruleId)}</b> \u00b7 ${esc(rule.severity)}<br>${esc(rule.title)}`
            + `<span class="dsp-tip-meta">Fails in ${rule.scans} of ${total} scans (${pct(rule.reach)}) \u00b7 `
            + `${num1(rule.intensity)} elements per failing scan \u00b7 ${esc(KIND[rule.kind])}</span>${extra || ''}`;
    }
    function yMaxFor(rules) {
        return Math.max(8, Math.ceil(Math.max(0, ...rules.map((x) => x.intensity)) + 1));
    }
    function labelLimit(count) { return count > 10 ? 3 : 8; }

    function ruleMapHTML(r) {
        const ymax = yMaxFor(r.rules);
        const sc = mapScale(ymax);
        const pts = r.rules.map((x) => ({ x: sc.sx(x.reach), y: sc.sy(x.intensity), r: SEV_R[x.severity] || 4, rule: x }));
        const f = mapFrame(ymax, pts);
        const dots = pts.map((p) => `<circle class="dsp-dot dsp-dot--${p.rule.band === 'widespread' ? 'wide' : 'other'}"`
            + ` cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r}" data-dsp-tip="${esc(ruleTip(p.rule, r.scansAnalyzed))}"/>`).join('');
        const labelled = pts.slice().sort((p, q) => (q.rule.reach * q.rule.intensity) - (p.rule.reach * p.rule.intensity))
            .slice(0, labelLimit(pts.length))
            .map((p) => ({ x: p.x, y: p.y, r: p.r, text: p.rule.ruleId }));
        const labels = placeLabels(labelled, f, dotBoxes(pts));
        const aria = `Rule map: ${plural(r.rulesFailing, 'failing rule')} placed by reach and by elements per failing scan. The table that follows lists them.`;
        return `<div class="dsp-map"><svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(aria)}" focusable="false">`
            + `${f.g}${dots}${labels}</svg></div>`;
    }

    function ruleMapLegendHTML() {
        return `<div class="dsp-legend">`
            + `<span><i class="dsp-sw dsp-sw--wide"></i>Widespread (\u2265${pct(T.widespread)} of scans)</span>`
            + `<span><i class="dsp-sw dsp-sw--other"></i>Partial or local</span>`
            + `<span>Dot size: minor \u2192 critical</span>`
            + `</div>`;
    }

    function ruleTableHTML(r) {
        return tableHTML('Failing rules by reach',
            ['Rule', 'Severity', 'Scans', 'Reach', 'Elements per failing scan', 'Kind'],
            r.rules.map((x) => [`<code>${esc(x.ruleId)}</code>`, esc(x.severity), String(x.scans), pct(x.reach),
                num1(x.intensity), esc(KIND[x.kind])]),
            [2, 3, 4]);
    }

    // ------------------------------------------------------------------
    // Report section
    // ------------------------------------------------------------------

    function kpisHTML(r) {
        if (!r.enoughData) {
            return `<div class="dsp-kpis">`
                + `<div class="dsp-kpi"><div class="dsp-kpi-v">${r.affectedScans} / ${r.scansAnalyzed}</div><div class="dsp-kpi-l">scans with automatic failures</div></div>`
                + `<div class="dsp-kpi"><div class="dsp-kpi-v">${r.rulesFailing}</div><div class="dsp-kpi-l">failing rules</div></div>`
                + `</div>`;
        }
        return `<div class="dsp-kpis">`
            + `<div class="dsp-kpi"><div class="dsp-kpi-v">${pct(r.affectedRate)}</div><div class="dsp-kpi-l">of scans have automatic failures</div><div class="dsp-kpi-s">${r.affectedScans} of ${r.scansAnalyzed}</div></div>`
            + `<div class="dsp-kpi"><div class="dsp-kpi-v">${pct(r.footprint)}</div><div class="dsp-kpi-l">footprint: how much of the run each failing rule covers, on average</div><div class="dsp-kpi-s">100% = every rule in every scan</div></div>`
            + `<div class="dsp-kpi"><div class="dsp-kpi-v">${pct(r.top10Share)}</div><div class="dsp-kpi-l">of failing elements are in the worst 10% of scans</div><div class="dsp-kpi-s">about 10% when evenly spread</div></div>`
            + `<div class="dsp-kpi"><div class="dsp-kpi-v">${r.bands.widespread} \u00b7 ${r.bands.partial} \u00b7 ${r.bands.local}</div><div class="dsp-kpi-l">rules that are widespread \u00b7 partial \u00b7 local</div><div class="dsp-kpi-s">\u2265${pct(T.widespread)} \u00b7 ${pct(T.partial)}\u2013${pct(T.widespread)} \u00b7 &lt;${pct(T.partial)} of scans</div></div>`
            + `</div>`;
    }

    function concentrationHTML(r) {
        if (!r.enoughData || !r.totalElements) return '';
        const s = r.scansFor80Share;
        const head = s >= 0.5
            ? `Evenly spread: it takes ${pct(s)} of the scans to hold 80% of the failing elements.`
            : (s < 0.2
                ? `Just ${pct(s)} of the scans hold 80% of the failing elements.`
                : `${pct(s)} of the scans hold 80% of the failing elements.`);
        return `<div class="dsp-conc">`
            + `<p class="dsp-conc-head">${head}</p>`
            + `<div class="dsp-conc-row"><span>Scans</span><span class="dsp-conc-bar dsp-conc-bar--scans"><i style="width:${(s * 100).toFixed(2)}%"></i></span><span class="dsp-num">${pct(s)}</span></div>`
            + `<div class="dsp-conc-row"><span>Failing elements</span><span class="dsp-conc-bar dsp-conc-bar--elements"><i style="width:80%"></i></span><span class="dsp-num">80%</span></div>`
            + `</div>`;
    }

    /**
     * The report view's "Where the failures are" section. `id` must be unique
     * in the page; `linkScans` makes strip columns open their scan card;
     * `open: false` starts it collapsed.
     */
    function reportSectionHTML(r, opts) {
        const o = opts || {};
        const id = uid(o.id || 'dsp-report');
        const paras = explainParagraphs(r).map((p) => `<p>${p}</p>`).join('');
        const note = reviewNote(r);
        const head = `<div class="dsp-verdict">`
            + `<div class="dsp-verdict-badge">${badgeHTML(r.pattern)}<span class="dsp-verdict-meta">${plural(r.scansAnalyzed, 'scan')} in view</span></div>`
            + `<div class="dsp-explain">${paras}${note ? `<p class="dsp-note">${note}</p>` : ''}</div>`
            + `</div>`;
        let body = head;
        if (r.scansAnalyzed && r.pattern !== 'clean') {
            body += kpisHTML(r) + concentrationHTML(r);
            body += `<div class="dsp-block">`
                + `<h4 class="dsp-h" id="${id}-strip">Scan strip</h4>`
                + `<p class="dsp-help">One column per scan, in the order of the scans in this report. <span data-dsp-height-help>${heightHelpText(prepView(null))}</span> `
                + `Use the arrow keys to read each scan${o.linkScans ? ', and Enter to open it' : ''}.</p>`
                + stripsGroupHTML([r], [''], stripLegendHTML()
                    + stripHTML(r, { linkScans: !!o.linkScans })
                    + stripTableHTML(r), { id: `${id}-strips` })
                + `</div>`;
            body += `<div class="dsp-block">`
                + `<h4 class="dsp-h" id="${id}-map">Rule map</h4>`
                + `<p class="dsp-help">Each failing rule, placed by how many scans it reaches and how many elements it hits in each. `
                + `Each corner suggests a different fix: a shared component (fix once), a broken template, one broken page or state, or one-offs.</p>`
                + ruleMapLegendHTML()
                + ruleMapHTML(r)
                + (r.rulesFailing > 10 ? `<p class="dsp-help">Only the ${labelLimit(r.rulesFailing)} most prominent rules are labelled. Hover a dot, or open the table, for the rest.</p>` : '')
                + ruleTableHTML(r)
                + `</div>`;
        }
        return `<details class="a11y-details dsp"${o.open === false ? '' : ' open'} data-dsp-section="${esc(id)}">`
            + `<summary>Where the failures are</summary>${body}</details>`;
    }

    // ------------------------------------------------------------------
    // Two reports
    // ------------------------------------------------------------------

    function pairParagraphs(cmp, ctx) {
        const { a, b } = cmp;
        const out = [];
        const nameA = ctx.labelA || 'A', nameB = ctx.labelB || 'B';
        const ruleSent = a.rulesFailing === b.rulesFailing
            ? `The number of failing rules is unchanged (${a.rulesFailing})`
            : `Failing rules went from ${a.rulesFailing} to ${b.rulesFailing}`;
        const rateMoved = Math.abs(a.affectedRate - b.affectedRate) >= 0.05;
        const rateSent = `scans with automatic failures went from ${pct(a.affectedRate)} to ${pct(b.affectedRate)}`;
        const joiner = (a.rulesFailing === b.rulesFailing) === rateMoved ? 'but' : 'and';
        out.push(`<strong>${ruleSent}, ${joiner} ${rateSent}.</strong>`);
        const of = (k) => cmp.rows.filter((row) => row.change === k);
        const contained = of('contained'), spread = of('spread');
        if (contained.length) {
            const left = contained.some((row) => row.b.reach > 0);
            out.push(`${codeList(contained.map((row) => row.ruleId))} ${contained.length === 1 ? 'was' : 'were'} contained: `
                + `${contained.length === 1 ? 'it' : 'they'} failed in ${reachRange(contained, (row) => row.a.reach)} of the scans in ${esc(nameA)} `
                + `and in ${reachRange(contained, (row) => row.b.reach)} in ${esc(nameB)}. That usually means a shared component was fixed`
                + `${left ? ', with some pages or states left behind' : ''}.`);
        }
        if (spread.length) {
            out.push(`${codeList(spread.map((row) => row.ruleId))} spread: from ${reachRange(spread, (row) => row.a.reach)} `
                + `to ${reachRange(spread, (row) => row.b.reach)} of the scans. Check recent changes to shared components.`);
        }
        const added = of('new'), gone = of('resolved');
        if (added.length || gone.length) {
            const parts = [];
            if (gone.length) parts.push(`${plural(gone.length, 'rule')} no longer ${gone.length === 1 ? 'fails' : 'fail'}`);
            if (added.length) {
                parts.push(`${plural(added.length, 'rule')} ${added.length === 1 ? 'is' : 'are'} new`
                    + (added.length <= 3 ? ` (${codeList(added.map((row) => row.ruleId))})` : ''));
            }
            out.push(parts.join('; ') + '.');
        }
        const h = b.hotspots[0];
        if (h && (b.pattern === 'concentrated' || b.pattern === 'mixed')) {
            out.push(`In ${esc(nameB)}, most of what is left sits in ${hotspotText(h)}.`);
        }
        return out;
    }

    function pairNotes(cmp) {
        const notes = [];
        const { a, b } = cmp;
        if (a.scansAnalyzed !== b.scansAnalyzed) {
            notes.push(`The reports have different numbers of scans (${a.scansAnalyzed} and ${b.scansAnalyzed}), so everything here is compared as a share of scans.`);
        }
        if (!a.enoughData || !b.enoughData) {
            notes.push(`One of the reports has fewer than ${T.minScans} scans, so read the percentages with care.`);
        }
        return notes;
    }

    function compareMapHTML(cmp) {
        const { a, b } = cmp;
        const ymax = yMaxFor(a.rules.concat(b.rules));
        const sc = mapScale(ymax);
        const f = mapFrame(ymax, cmp.rows.map((row) => {
            const at = row.b || row.a;
            return { x: sc.sx(at.reach), y: sc.sy(at.intensity), r: SEV_R[at.severity] || 4 };
        }));
        let defs = '', marks = '';
        ['contained', 'spread', 'steady'].forEach((k) => {
            defs += `<marker id="dsp-m-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
                + `<path class="dsp-arrowhead dsp-arrowhead--${k}" d="M0 0 L10 5 L0 10 z"/></marker>`;
        });
        const labels = [], obstacles = [];
        cmp.rows.forEach((row) => {
            const c = CHANGE[row.change];
            const extra = `<span class="dsp-tip-meta">${c.icon} ${c.label}${row.a && row.b ? ` \u00b7 reach ${pct(row.a.reach)} \u2192 ${pct(row.b.reach)}` : ''}</span>`;
            if (row.change === 'resolved') {
                const x = f.sx(row.a.reach), y = f.sy(row.a.intensity), s = 5;
                marks += `<g data-dsp-tip="${esc(ruleTip(row.a, a.scansAnalyzed, extra))}">`
                    + `<path class="dsp-gone" d="M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}"/>`
                    + `<circle class="dsp-hit" cx="${x}" cy="${y}" r="9"/></g>`;
                labels.push({ x, y, r: 6, text: row.ruleId });
                return;
            }
            const bx = f.sx(row.b.reach), by = f.sy(row.b.intensity), r = SEV_R[row.b.severity] || 4;
            if (row.a) {
                const ax = f.sx(row.a.reach), ay = f.sy(row.a.intensity);
                const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
                if (len > r + 6) {
                    const ex = bx - dx / len * (r + 3), ey = by - dy / len * (r + 3);
                    obstacles.push(...lineBoxes(ax, ay, ex, ey));
                    marks += `<circle class="dsp-ghost" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.5"/>`
                        + `<path class="dsp-arrow dsp-arrow--${row.change}" d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}" marker-end="url(#dsp-m-${row.change})"/>`;
                }
            }
            marks += `<circle class="dsp-dot dsp-dot--${row.b.band === 'widespread' ? 'wide' : 'other'}${row.change === 'new' ? ' dsp-dot--new' : ''}"`
                + ` cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${r}" data-dsp-tip="${esc(ruleTip(row.b, b.scansAnalyzed, extra))}"/>`;
            labels.push({ x: bx, y: by, r, text: row.ruleId });
        });
        obstacles.push(...dotBoxes(labels));
        const text = placeLabels(labels.slice(0, 10), f, obstacles);
        const aria = `Rule map from A to B: arrows show how each rule's reach and elements per failing scan changed. The table above lists every rule.`;
        return `<div class="dsp-map"><svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${esc(aria)}" focusable="false">`
            + `<defs>${defs}</defs>${f.g}${marks}${text}</svg></div>`;
    }

    /**
     * Body of the two-report dispersion panel (the comparison renderer supplies
     * the section frame and heading). `labelA`/`labelB` name the reports.
     */
    function pairBodyHTML(cmp, ctx) {
        const c = ctx || {};
        const { a, b } = cmp;
        const nameA = c.labelA || 'A', nameB = c.labelB || 'B';
        const paras = pairParagraphs(cmp, c).map((p) => `<p>${p}</p>`).join('');
        const notes = pairNotes(cmp).map((n) => `<p class="dsp-note">${esc(n)}</p>`).join('');
        const row = (label, x, y, fmt) => `<tr><th scope="row">${label}</th><td class="dsp-num">${fmt(x)}</td><td class="dsp-num">${fmt(y)}</td></tr>`;
        const max = Math.max(1, a.maxRulesInScan, b.maxRulesInScan);
        const ruleRows = cmp.rows.map((r) => `<tr><td><code>${esc(r.ruleId)}</code></td>`
            + `<td class="dsp-num">${r.a ? pct(r.a.reach) : '\u2013'}</td><td class="dsp-num">${r.b ? pct(r.b.reach) : '\u2013'}</td>`
            + `<td>${changeHTML(r.change)}</td></tr>`).join('');
        return `<div class="dsp dsp-pair">`
            + `<div class="dsp-shift"><span class="dsp-shift-label">Pattern</span>${badgeHTML(a.pattern)}`
            + `<span class="dsp-shift-arrow" aria-label="changed to">\u2192</span>${badgeHTML(b.pattern)}</div>`
            + `<div class="dsp-explain">${paras}${notes}</div>`
            + `<div class="dsp-cols">`
            + `<div class="dsp-block"><h4 class="dsp-h">Key numbers</h4><div class="dsp-table-wrap"><table>`
            + `<thead><tr><td></td><th scope="col" class="dsp-num">${esc(nameA)}</th><th scope="col" class="dsp-num">${esc(nameB)}</th></tr></thead><tbody>`
            + row('Scans', a.scansAnalyzed, b.scansAnalyzed, String)
            + row('Failing rules', a.rulesFailing, b.rulesFailing, String)
            + row('Scans with failures', a.affectedRate, b.affectedRate, pct)
            + row('Footprint', a.footprint, b.footprint, pct)
            + row('Worst 10% of scans hold', a.top10Share, b.top10Share, pct)
            + row('Widespread rules', a.bands.widespread, b.bands.widespread, String)
            + `</tbody></table></div><p class="dsp-help">Shares, not raw counts, so reports with different numbers of scans compare fairly.</p></div>`
            + `<div class="dsp-block"><h4 class="dsp-h">How each rule's reach changed</h4><div class="dsp-table-wrap dsp-table-wrap--scroll"><table>`
            + `<thead><tr><th scope="col">Rule</th><th scope="col" class="dsp-num">${esc(nameA)}</th><th scope="col" class="dsp-num">${esc(nameB)}</th><th scope="col">Change</th></tr></thead>`
            + `<tbody>${ruleRows}</tbody></table></div>`
            + `<p class="dsp-help">Contained or spread: reach moved by ${Math.round(T.change * 100)} points or more.</p></div>`
            + `</div>`
            + `<div class="dsp-block"><h4 class="dsp-h">Scan strips</h4>`
            + stripsGroupHTML([a, b], [nameA, nameB], stripLegendHTML()
                + `<div class="dsp-strip-row"><div class="dsp-strip-who"><b>${esc(nameA)}</b>${badgeHTML(a.pattern)}</div>`
                + stripHTML(a, { height: 64, max, compact: true, name: nameA, label: `Scan strip for ${nameA}: ${a.scansAnalyzed} scans, ${a.affectedScans} with automatic failures` }) + `</div>`
                + `<div class="dsp-strip-row"><div class="dsp-strip-who"><b>${esc(nameB)}</b>${badgeHTML(b.pattern)}</div>`
                + stripHTML(b, { height: 64, max, compact: true, name: nameB, label: `Scan strip for ${nameB}: ${b.scansAnalyzed} scans, ${b.affectedScans} with automatic failures` }) + `</div>`)
            + `<p class="dsp-help">Both strips use the full width and the same height scale, so reports with different numbers of scans line up.</p></div>`
            + `<div class="dsp-block"><h4 class="dsp-h">Rule map, ${esc(nameA)} \u2192 ${esc(nameB)}</h4>`
            + `<div class="dsp-legend">`
            + `<span>${changeHTML('contained')} reach went down</span><span>${changeHTML('spread')} reach went up</span>`
            + `<span>${changeHTML('steady')}</span><span>\u25cb where the rule was in ${esc(nameA)} \u00b7 \u2715 resolved \u00b7 dashed ring: new</span></div>`
            + compareMapHTML(cmp)
            + `</div>`
            + `</div>`;
    }

    // ------------------------------------------------------------------
    // Three or more reports
    // ------------------------------------------------------------------

    function shortLabel(s, n) {
        const t = String(s || '');
        return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
    }

    function lineChartHTML(title, labels, vals) {
        const W = 320, H = 170, m = { l: 38, r: 16, t: 16, b: 30 };
        const n = vals.length;
        const sx = (i) => m.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - m.l - m.r);
        const sy = (v) => H - m.b - v * (H - m.t - m.b);
        let g = '';
        [0, 0.5, 1].forEach((v) => {
            g += `<line class="dsp-grid" x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`
                + `<text x="${m.l - 6}" y="${sy(v) + 4}" text-anchor="end">${v * 100}%</text>`;
        });
        labels.forEach((l, i) => { g += `<text x="${sx(i)}" y="${H - 10}" text-anchor="middle">${i + 1}</text>`; });
        const pts = vals.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
        const dots = vals.map((v, i) => `<circle class="dsp-pt" cx="${sx(i).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="4.5"`
            + ` data-dsp-tip="${esc(`<b>${esc(labels[i])}</b><br>${esc(title)}: ${pct(v)}`)}"/>`).join('');
        const last = n - 1;
        const end = `<text class="dsp-val" x="${sx(last)}" y="${(sy(vals[last]) + (vals[last] > 0.85 ? 18 : -10)).toFixed(1)}" text-anchor="end">${pct(vals[last])}</text>`;
        const aria = `${title}: ${vals.map((v, i) => `${labels[i]} ${pct(v)}`).join(', ')}`;
        return `<div class="dsp-line"><h4 class="dsp-h">${esc(title)}</h4>`
            + `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}" focusable="false">${g}`
            + `<polyline class="dsp-ln" points="${pts}"/>${dots}${end}</svg></div>`;
    }

    function sparkHTML(vals) {
        const W = 90, H = 22, n = vals.length;
        const sx = (i) => 3 + (n === 1 ? 0.5 : i / (n - 1)) * (W - 6);
        const sy = (v) => H - 3 - v * (H - 6);
        return `<svg class="dsp-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`
            + `<polyline points="${vals.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')}"/>`
            + `<circle cx="${sx(n - 1).toFixed(1)}" cy="${sy(vals[n - 1]).toFixed(1)}" r="2.5"/></svg>`;
    }

    function dedupeRuns(list) {
        return list.filter((x, i) => i === 0 || list[i - 1] !== x);
    }

    function seriesParagraphs(series, ctx) {
        const res = series.results;
        const out = [];
        const labels = ctx.labels || res.map((_, i) => `Report ${i + 1}`);
        const first = res[0], last = res[res.length - 1];
        if (ctx.mode === 'matrix') {
            const rates = res.map((r) => r.affectedRate);
            out.push(`<strong>Across ${res.length} variants, scans with automatic failures range from `
                + `${pct(Math.min(...rates))} to ${pct(Math.max(...rates))}.</strong>`);
            const differ = series.rows.filter((row) => Math.max(...row.reach) - Math.min(...row.reach) >= T.change);
            if (differ.length) {
                const shown = differ.slice(0, 3);
                out.push(`${codeList(shown.map((row) => row.ruleId))} ${shown.length === 1 ? 'reaches' : 'reach'} very differently across the variants `
                    + `(by ${Math.round(T.change * 100)} points or more), which points to something specific to `
                    + `${shown.length === 1 ? 'one of them' : 'some of them'} rather than to shared code.`);
            } else if (series.rows.length) {
                out.push('Every failing rule reaches about as far in each variant, so what fails is shared rather than specific to one of them.');
            }
            return out;
        }
        out.push(`<strong>Over ${plural(res.length, 'run')}, failing rules went ${res.map((r) => r.rulesFailing).join(' \u2192 ')} `
            + `and scans with automatic failures went from ${pct(first.affectedRate)} to ${pct(last.affectedRate)}.</strong>`);
        const patterns = dedupeRuns(res.map((r) => PATTERN[r.pattern].label));
        const contained = series.rows.filter((row) => row.trend === 'contained'
            || (row.trend === 'resolved' && Math.max(...row.reach) >= T.widespread));
        const spread = series.rows.filter((row) => row.trend === 'spread');
        out.push(patterns.length > 1
            ? `The pattern moved ${patterns.map(esc).join(' \u2192 ')}.`
            : `The pattern stayed ${esc(patterns[0])}.`);
        if (contained.length) {
            const shown = contained.slice(0, 4);
            out.push(`${codeList(shown.map((row) => row.ruleId))}${contained.length > shown.length ? ` and ${contained.length - shown.length} more` : ''} `
                + `${contained.length === 1 ? 'was' : 'were'} contained: ${contained.length === 1 ? 'it' : 'they'} used to fail widely and now reach far fewer scans, or none.`);
        }
        if (spread.length) {
            const shown = spread.slice(0, 4);
            out.push(`${codeList(shown.map((row) => row.ruleId))}${spread.length > shown.length ? ` and ${spread.length - shown.length} more` : ''} `
                + `spread over the period. Check recent changes to shared components.`);
        }
        const h = last.hotspots[0];
        if (h && (last.pattern === 'concentrated' || last.pattern === 'mixed')) {
            out.push(`In ${esc(labels[labels.length - 1])}, most of what is left sits in ${hotspotText(h)}.`);
        }
        return out;
    }

    /**
     * Body of the N-report dispersion panel. `ctx.labels` names the columns in
     * order; `ctx.mode` is 'trend' or 'matrix'.
     */
    function seriesBodyHTML(series, ctx) {
        const c = ctx || {};
        const res = series.results;
        const labels = c.labels || res.map((_, i) => `Report ${i + 1}`);
        const max = Math.max(1, ...res.map((r) => r.maxRulesInScan));
        const paras = seriesParagraphs(series, { ...c, labels }).map((p) => `<p>${p}</p>`).join('');
        const few = res.some((r) => !r.enoughData)
            ? `<p class="dsp-note">Some reports have fewer than ${T.minScans} scans; their percentages are shown but mean little.</p>` : '';
        const badges = res.map((r, i) => `<span class="dsp-series-badge"><span class="dsp-series-n">${i + 1}</span>${badgeHTML(r.pattern)}</span>`)
            .join(c.mode === 'matrix' ? '' : '<span class="dsp-shift-arrow" aria-hidden="true">\u2192</span>');
        const strips = res.map((r, i) => `<div class="dsp-strip-row"><div class="dsp-strip-who"><b>${i + 1} \u00b7 ${esc(shortLabel(labels[i], 28))}</b>`
            + `<span>${esc(PATTERN[r.pattern].label)}</span></div>`
            + stripHTML(r, { height: 44, max, compact: true, hotspots: false, name: labels[i],
                label: `Scan strip for ${labels[i]}: ${r.scansAnalyzed} scans, ${r.affectedScans} with automatic failures` })
            + `</div>`).join('');
        const head = labels.map((l, i) => `<th scope="col" class="dsp-num" title="${esc(l)}">${i + 1}</th>`).join('');
        const rows = series.rows.map((row) => `<tr><td><code>${esc(row.ruleId)}</code></td><td>${sparkHTML(row.reach)}</td>`
            + row.reach.map((v) => `<td class="dsp-num">${v ? pct(v) : '\u2013'}</td>`).join('')
            + `<td>${c.mode === 'matrix' ? '' : changeHTML(row.trend)}</td></tr>`).join('');
        const key = labels.map((l, i) => `<li><span class="dsp-series-n">${i + 1}</span>${esc(l)}</li>`).join('');
        return `<div class="dsp dsp-series">`
            + `<div class="dsp-shift"><span class="dsp-shift-label">${c.mode === 'matrix' ? 'Pattern per variant' : 'Pattern over time'}</span>${badges}</div>`
            + `<div class="dsp-explain">${paras}${few}</div>`
            + `<ol class="dsp-series-key">${key}</ol>`
            + `<div class="dsp-block"><h4 class="dsp-h">Scan strips</h4>${stripsGroupHTML(res, labels, stripLegendHTML() + strips)}`
            + `<p class="dsp-help">One strip per report, on the same height scale. ${c.mode === 'matrix'
                ? 'Read down to compare where each variant fails.'
                : 'Read down to see a band disappear, a hotspot shrink or a problem spread.'}</p></div>`
            + `<div class="dsp-cols">`
            + lineChartHTML('Scans with automatic failures', labels, res.map((r) => r.affectedRate))
            + lineChartHTML('Failing elements in the worst 10% of scans', labels, res.map((r) => r.top10Share))
            + `</div>`
            + `<p class="dsp-help">Two charts on purpose, each on its own 0\u2013100% scale. ${c.mode === 'matrix'
                ? 'A variant with many failing scans but a low worst-10% share has its problems everywhere; a high share means they gather in a few scans.'
                : 'Fewer failing scans while what remains gathers in a few of them means shared problems were fixed.'}</p>`
            + `<div class="dsp-block"><h4 class="dsp-h">Reach of each rule</h4><div class="dsp-table-wrap dsp-table-wrap--scroll"><table>`
            + `<thead><tr><th scope="col">Rule</th><th scope="col">Reach</th>${head}<th scope="col">${c.mode === 'matrix' ? '' : 'Trend'}</th></tr></thead>`
            + `<tbody>${rows}</tbody></table></div></div>`
            + `</div>`;
    }

    // ------------------------------------------------------------------
    // Interaction: one delegated layer for tooltips and strips
    // ------------------------------------------------------------------

    // Strip state lives on the element, read from the markup it carries, so the
    // same behaviour works in the app and in an exported file.
    function stripData(el) {
        if (!el.__dsp) {
            let rows = [];
            try { rows = JSON.parse(el.getAttribute('data-dsp-strip') || '[]'); } catch (e) { rows = []; }
            el.__dsp = { rows, index: -1 };
        }
        return el.__dsp;
    }
    // A group's view is kept in its markup too, so an exported file opens on
    // the view it was saved with and its controls still match it.
    function groupView(group) {
        if (!group) return prepView(null);
        const raw = group.getAttribute('data-dsp-view') || '';
        if (group.__dspViewRaw !== raw) {
            let v = null;
            try { v = JSON.parse(raw); } catch (e) { v = null; }
            group.__dspViewRaw = raw;
            group.__dspView = prepView(v);
        }
        return group.__dspView;
    }
    function viewOf(strip) {
        return groupView(typeof strip.closest === 'function' ? strip.closest('[data-dsp-strips]') : null);
    }
    function rowHTML(rows, i, link, v) {
        const label = rows[i][0];
        const head = `<b>Scan ${i + 1}</b>${label ? ` · ${esc(label)}` : ''}`;
        const c = countRow(rows[i], v);
        if (!c.rules.length) return `${head}<br>${v.sel ? 'None of the selected rules fail here' : 'No automatic failures'}`;
        return `${head}<br>${plural(c.rules.length, v.sel ? 'selected rule' : 'failing rule')}${v.sel ? ' failing' : ''}: `
            + `${c.wide} widespread, ${c.other} other<br>${plural(c.wideEl + c.otherEl, 'failing element')}`
            + `<span class="dsp-tip-meta">${esc(c.rules.map(([id, el]) => `${id} (${el})`).join(', '))}</span>`
            + (link ? '<span class="dsp-tip-meta">Click to open the scan</span>' : '');
    }
    function setIndex(el, i) {
        const st = stripData(el);
        if (!st.rows.length) return;
        st.index = Math.max(0, Math.min(st.rows.length - 1, i));
        const cur = el.querySelector('.dsp-s-cursor');
        if (cur) cur.setAttribute('x', String(st.index * CW));
        el.setAttribute('aria-valuenow', String(st.index + 1));
        el.setAttribute('aria-valuetext', scanTipText(st.rows, st.index, viewOf(el)));
    }
    function clearCursor(el) {
        const cur = el.querySelector('.dsp-s-cursor');
        if (cur) cur.setAttribute('x', '-10');
    }
    /** Put a strip's cursor on the scan with this id (after a re-render). */
    function selectStripScan(el, scanId) {
        const st = stripData(el);
        const i = st.rows.findIndex((row) => String(row[5]) === String(scanId));
        if (i >= 0) setIndex(el, i);
    }
    function stripScanId(el) {
        const st = stripData(el);
        const row = st.rows[st.index];
        return row ? String(row[5]) : null;
    }

    // Draw every strip in the group, and everything around them that says
    // what they count, for the group's current view.
    function redrawGroup(group) {
        const v = groupView(group);
        const strips = Array.from(group.querySelectorAll('[data-dsp-strip]'));
        const lists = strips.map((s) => ({ rows: stripData(s).rows, name: s.getAttribute('data-dsp-name') || '' }));
        const top = tallestColumn(lists, v);
        strips.forEach((s, k) => {
            const svg = s.querySelector('svg');
            if (!svg) return;
            const H = Number((svg.getAttribute('viewBox') || '').split(/\s+/)[3]) || 96;
            const cur = s.querySelector('.dsp-s-cursor');
            const cx = cur ? cur.getAttribute('x') : '-10';
            svg.innerHTML = stripBars(lists[k].rows, H, top.value, v)
                + `<rect class="dsp-s-cursor" x="${esc(cx)}" y="0" width="${CW}" height="${H}"/>`;
            const st = stripData(s);
            const i = st.index >= 0 ? st.index : Number(s.getAttribute('aria-valuenow') || 1) - 1;
            if (st.rows[i]) s.setAttribute('aria-valuetext', scanTipText(st.rows, i, v));
        });

        const boxes = Array.from(group.querySelectorAll('.dsp-filter-panel input[type="checkbox"]'));
        boxes.forEach((b) => { b.checked = b.defaultChecked = !!(v.sel && v.sel.has(b.value)); });
        group.querySelectorAll('.dsp-seg input[type="radio"]').forEach((b) => { b.checked = b.defaultChecked = b.value === v.mode; });
        group.classList.toggle('dsp-strips--filtered', !!v.sel);

        const n = v.rules.length;
        const btn = group.querySelector('[data-dsp-filter-toggle]');
        const badge = group.querySelector('.dsp-filter-n');
        if (badge) { badge.textContent = n ? String(n) : ''; badge.hidden = !n; }
        if (btn) {
            if (n) btn.setAttribute('aria-label', `Filter rules, ${n} selected`);
            else btn.removeAttribute('aria-label');
        }
        const count = group.querySelector('[data-dsp-filter-count]');
        if (count) count.textContent = n ? `${n} selected` : 'None selected: every rule counts';
        const chips = group.querySelector('[data-dsp-chips]');
        if (chips) {
            chips.innerHTML = n ? v.rules.map((id) => `<button type="button" class="dsp-chip" data-dsp-unselect="${esc(id)}" aria-label="Stop counting only ${esc(id)}">`
                + `${esc(id)}<span aria-hidden="true">×</span></button>`).join('')
                + '<button type="button" class="dsp-link" data-dsp-clear>Clear all</button>' : '';
            chips.hidden = !n;
        }
        const status = group.querySelector('[data-dsp-status]');
        if (status) status.textContent = stripsStatusText(v, boxes.length, top);
        group.querySelectorAll('[data-dsp-clean]').forEach((el) => { el.textContent = cleanLegendText(v); });
        const block = group.closest('.dsp-block') || group;
        block.querySelectorAll('[data-dsp-height-help]').forEach((el) => { el.textContent = heightHelpText(v); });

        const table = group.querySelector('[data-dsp-strip-table]');
        if (table && strips[0]) {
            const { caption, body } = stripTableParts(lists[0].rows, v);
            const cap = table.querySelector('caption');
            const tbody = table.querySelector('tbody');
            if (cap) cap.textContent = caption;
            if (tbody) tbody.innerHTML = stripTableBodyHTML(body);
        }
    }

    function setGroupView(group, view) {
        const known = new Set(Array.from(group.querySelectorAll('.dsp-filter-panel input[type="checkbox"]'), (b) => b.value));
        const v = prepView(view);
        group.setAttribute('data-dsp-view', JSON.stringify({ mode: v.mode, rules: v.rules.filter((id) => known.has(id)) }));
        redrawGroup(group);
    }
    function firstGroup(el) {
        if (!el) return null;
        if (el.matches && el.matches('[data-dsp-strips]')) return el;
        return el.querySelector ? el.querySelector('[data-dsp-strips]') : null;
    }
    /** The view of the first strip group in `el` ({mode, rules}), to carry over a re-render. */
    function stripsView(el) {
        const g = firstGroup(el);
        if (!g) return null;
        const v = groupView(g);
        return { mode: v.mode, rules: v.rules.slice() };
    }
    /** Apply a view from stripsView to the first strip group in `el`; rules it no longer has are dropped. */
    function setStripsView(el, view) {
        const g = firstGroup(el);
        if (g && view) setGroupView(g, view);
    }

    function installDispersionInteractions(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d || d.__dspInstalled) return;
        d.__dspInstalled = true;

        let tip = null;
        function tipEl() {
            if (tip && tip.isConnected) return tip;
            tip = d.createElement('div');
            tip.className = 'dsp-tip';
            tip.hidden = true;
            tip.setAttribute('role', 'presentation');
            d.body.appendChild(tip);
            return tip;
        }
        function showTip(html, x, y) {
            const t = tipEl();
            t.innerHTML = html;
            t.hidden = false;
            const view = d.defaultView || { innerWidth: 1024, innerHeight: 768 };
            const w = t.offsetWidth, h = t.offsetHeight;
            let left = x + 14, top = y + 14;
            if (left + w > view.innerWidth - 8) left = x - w - 14;
            if (top + h > view.innerHeight - 8) top = y - h - 14;
            t.style.left = Math.max(8, left) + 'px';
            t.style.top = Math.max(8, top) + 'px';
        }
        function hideTip() { if (tip) tip.hidden = true; }

        function indexAt(el, clientX) {
            const b = el.getBoundingClientRect();
            const n = stripData(el).rows.length;
            return Math.floor(((clientX - b.left) / Math.max(1, b.width)) * n);
        }
        function openScan(el) {
            if (el.getAttribute('data-dsp-link') !== '1') return;
            const st = stripData(el);
            const row = st.rows[st.index];
            if (!row) return;
            const target = d.getElementById('sc-' + row[5]);
            if (!target) return;
            target.scrollIntoView({ block: 'start', behavior: 'smooth' });
            if (typeof target.focus === 'function') target.focus({ preventScroll: true });
        }

        d.addEventListener('mousemove', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            const strip = t.closest('[data-dsp-strip]');
            if (strip) {
                setIndex(strip, indexAt(strip, e.clientX));
                const st = stripData(strip);
                showTip(rowHTML(st.rows, st.index, strip.getAttribute('data-dsp-link') === '1', viewOf(strip)), e.clientX, e.clientY);
                return;
            }
            const tipped = t.closest('[data-dsp-tip]');
            if (tipped) showTip(tipped.getAttribute('data-dsp-tip'), e.clientX, e.clientY);
        });
        d.addEventListener('mouseout', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            const strip = t.closest('[data-dsp-strip]');
            const tipped = t.closest('[data-dsp-tip]');
            if (!strip && !tipped) return;
            const to = e.relatedTarget;
            if (to && typeof to.closest === 'function' && (to.closest('[data-dsp-strip]') === strip && strip)) return;
            hideTip();
            if (strip && d.activeElement !== strip) clearCursor(strip);
        });
        // The strip controls: the height switch, the rule filter and its chips.
        function panelOf(group) { return group.querySelector('.dsp-filter-panel'); }
        function openPanel(group) {
            const panel = panelOf(group);
            const btn = group.querySelector('[data-dsp-filter-toggle]');
            if (!panel || !btn) return;
            panel.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            const find = panel.querySelector('[data-dsp-find]');
            if (find) find.focus();
        }
        function closePanel(group, focusButton) {
            const panel = panelOf(group);
            const btn = group.querySelector('[data-dsp-filter-toggle]');
            if (!panel || panel.hidden) return;
            panel.hidden = true;
            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                if (focusButton) btn.focus();
            }
        }
        function findRules(input) {
            const panel = input.closest('.dsp-filter-panel');
            const q = input.value.trim().toLowerCase();
            let any = false;
            panel.querySelectorAll('[data-dsp-rule]').forEach((opt) => {
                const hit = !q || opt.getAttribute('data-dsp-rule').toLowerCase().includes(q);
                opt.hidden = !hit;
                any = any || hit;
            });
            panel.querySelectorAll('.dsp-filter-list fieldset').forEach((fs) => {
                fs.hidden = !fs.querySelector('[data-dsp-rule]:not([hidden])');
            });
            const none = panel.querySelector('[data-dsp-nomatch]');
            if (none) none.hidden = any;
        }

        d.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            const group = t.closest('[data-dsp-strips]');
            if (!group) return;
            const v = groupView(group);
            if (t.type === 'radio' && t.closest('.dsp-seg')) {
                setGroupView(group, { mode: t.value, rules: v.rules });
            } else if (t.type === 'checkbox' && t.closest('.dsp-filter-panel')) {
                const rules = v.rules.filter((id) => id !== t.value);
                if (t.checked) rules.push(t.value);
                setGroupView(group, { mode: v.mode, rules });
            }
        });
        d.addEventListener('input', (e) => {
            const t = e.target;
            if (t && typeof t.matches === 'function' && t.matches('[data-dsp-find]')) findRules(t);
        });
        d.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            // A click anywhere outside an open rule list closes it.
            d.querySelectorAll('.dsp-filter-panel:not([hidden])').forEach((panel) => {
                const filter = panel.closest('.dsp-filter');
                if (filter && !filter.contains(t)) closePanel(panel.closest('[data-dsp-strips]'), false);
            });
            const group = t.closest('[data-dsp-strips]');
            if (group) {
                if (t.closest('[data-dsp-filter-toggle]')) {
                    if (panelOf(group) && panelOf(group).hidden) openPanel(group);
                    else closePanel(group, false);
                    return;
                }
                if (t.closest('[data-dsp-filter-done]')) { closePanel(group, true); return; }
                const unselect = t.closest('[data-dsp-unselect]');
                if (unselect) {
                    const id = unselect.getAttribute('data-dsp-unselect');
                    const v = groupView(group);
                    const at = v.rules.indexOf(id);
                    setGroupView(group, { mode: v.mode, rules: v.rules.filter((x) => x !== id) });
                    const chips = group.querySelectorAll('[data-dsp-unselect]');
                    const next = chips[Math.min(at, chips.length - 1)] || group.querySelector('[data-dsp-filter-toggle]');
                    if (next) next.focus();
                    return;
                }
                const clear = t.closest('[data-dsp-clear]');
                if (clear) {
                    const fromChips = !!clear.closest('[data-dsp-chips]');
                    setGroupView(group, { mode: groupView(group).mode, rules: [] });
                    const btn = group.querySelector('[data-dsp-filter-toggle]');
                    if (fromChips && btn) btn.focus();
                    return;
                }
            }
            const strip = t.closest('[data-dsp-strip]');
            if (!strip) return;
            setIndex(strip, indexAt(strip, e.clientX));
            openScan(strip);
        });
        d.addEventListener('focusin', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            const strip = t.closest('[data-dsp-strip]');
            if (!strip) return;
            const st = stripData(strip);
            setIndex(strip, st.index < 0 ? Number(strip.getAttribute('aria-valuenow') || 1) - 1 : st.index);
        });
        d.addEventListener('focusout', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            const strip = t.closest('[data-dsp-strip]');
            if (strip) { clearCursor(strip); hideTip(); }
        });
        d.addEventListener('keydown', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function') return;
            if (e.key === 'Escape') {
                const filter = t.closest('.dsp-filter');
                const group = filter && filter.closest('[data-dsp-strips]');
                if (group && panelOf(group) && !panelOf(group).hidden) {
                    e.preventDefault();
                    closePanel(group, true);
                    return;
                }
            }
            const strip = t.closest('[data-dsp-strip]');
            if (!strip || strip !== t) return;
            const st = stripData(strip);
            const i = st.index < 0 ? 0 : st.index;
            const n = st.rows.length;
            const moves = {
                ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1,
                PageUp: i + 10, PageDown: i - 10, Home: 0, End: n - 1,
            };
            if (e.key in moves) {
                e.preventDefault();
                setIndex(strip, moves[e.key]);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                openScan(strip);
            }
        });
    }

    return {
        PATTERN, KIND, CHANGE,
        explainParagraphs,
        reviewNote,
        reportSectionHTML,
        stripHTML,
        ruleMapHTML,
        pairParagraphs,
        pairBodyHTML,
        compareMapHTML,
        seriesParagraphs,
        seriesBodyHTML,
        installDispersionInteractions,
        selectStripScan,
        stripScanId,
        stripsView,
        setStripsView,
        pct,
    };
}));
