'use strict';

import {resultGlyphEl} from './result-glyph.js';

/**
 * Floating "live totals" counter.
 *
 * A snackbar pinned to the bottom-right corner that tallies the running totals
 * across every scan that streams into the live preview during a workflow run:
 * failures, "can't tell" and passes (each in its own state colour, matching the
 * stream cards), the total number of DOM elements scanned, and how many scans
 * have completed.
 *
 * It is created lazily on the first scan and updated on every subsequent scan.
 * A dismiss button in its top-right corner is disabled while the workflow runs —
 * showing the shared spinner so the in-progress state reads at a glance — and
 * becomes active once the run finishes (`finish()`), letting the user close the
 * counter to review-then-dismiss. A new run resets it on start (`reset()`).
 * The counts come from the same scan payloads that build the live-preview cards,
 * so the tally always matches the cards on screen.
 *
 * By-tag breakdown
 * ----------------
 * When scans carry `scanTags`, the same fail / can't tell / pass tally is also
 * kept per tag. A "by tag" disclosure sits directly under the totals it breaks
 * down and opens a ledger beneath itself — one row per tag, with the state
 * counts aligned in columns for fast comparison, sorted worst (most failures)
 * first, and a synthetic "Untagged" row last for scans with no tags. A scan with
 * several tags counts toward each of them, so the per-tag rows can sum to more
 * than the grand total — that is expected, not double-counting to be corrected.
 * The disclosure only appears once at least one named tag has been seen.
 *
 * It is deliberately the same control, in the same place relative to its own
 * numbers, as the "by type" disclosure under the step bar: a detail view opens
 * below the summary it belongs to, and the card grows upward from its fixed
 * bottom edge. One habit covers both.
 *
 * Step progress
 * --------------
 * Above the scan tallies sits a progress block fed by the shared step counter
 * (src/shared/workflow-step-counter.js). It shows only what is known for sure.
 *
 * - How many steps have run, at any depth: an exact count with no "of".
 *   Loops and conditions decide at run time how many steps a workflow takes,
 *   so any total would be a guess, and a guess that moves reads as a broken
 *   promise.
 * - A bar over the workflow's own steps (the top-level list in the editor).
 *   That list is fixed: each step runs, fails or is skipped once, so "step 5
 *   of 8" is a fact, whatever the loops and branches inside it do. The track
 *   is split into one segment per step.
 * - "Now:", the step that started last, and the item of the loop it is in
 *   ("item 12", or "item 12 of 40" once the loop has said how many it has).
 *   It keeps a long loop from looking stuck while the bar stays on one step.
 *
 * A "by type" disclosure under the bar expands a compact table of how many
 * steps of each type ran.
 *
 * Visibility follows the "Run workflow" tab: `setHidden(true)` hides the whole
 * counter (display:none) when the user moves to another top-level tab, and
 * `setHidden(false)` brings it back — the accumulated totals are untouched.
 *
 * Inline
 * ------
 * `inline: true` makes the same counter part of the content it is mounted in
 * (the watch dialog's): no fixed corner, no shadow and no dismiss button, since
 * whatever holds it decides when it goes. `idPrefix` keeps its ids unique when
 * the floating counter is on the page too.
 */
export function createLiveTotals(deps = {}) {
    const doc = deps.document || (typeof document !== 'undefined' ? document : null);
    const getMount = deps.getMount || (() => (doc ? doc.body : null));
    const inline = !!deps.inline;
    const idPrefix = deps.idPrefix || 'live-totals';

    // scans: the scans the report will hold, a Merged scan once from its first
    // context; scansRun: every scan that ran, each context of a Merged scan.
    const totals = {violations: 0, incomplete: 0, passes: 0, domNodes: 0, scans: 0, scansRun: 0};
    const mergedSeen = new Set(); // Merged scans already counted, by key

    // Per-tag tallies. Keyed by the lowercased tag so casing variants merge,
    // keeping the first-seen casing for display. The untagged bucket collects
    // scans that carried no usable tags.
    const tagTotals = new Map(); // key -> {label, violations, incomplete, passes, scans}
    const untagged = {violations: 0, incomplete: 0, passes: 0, scans: 0, seen: false};

    // Last snapshot from the step counter, or null when this run has no step
    // data (nothing to show rather than an empty bar).
    let steps = null;
    let stepEls = null;
    let stepsExpanded = false;

    let el = null;              // wrapper (#live-totals)
    let panelEl = null;         // the visible totals card
    let valueEls = null;
    let dismissBtn = null;
    let tagBtn = null;          // the "by tag" tab
    let tagCountEl = null;
    let subpanelEl = null;      // the scroll box holding the ledger
    let tagWrapEl = null;       // the by-tag block: disclosure + ledger
    let ledgerBodyEl = null;
    let finished = false;
    let expanded = false;       // is the by-tag ledger open
    let hidden = false;         // hidden because another tab is active

    // Group thousands with commas. Locale-independent so tests stay stable.
    function fmt(n) {
        return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Trim, drop empties, and de-duplicate a scan's tags case-insensitively,
    // keeping the first-seen casing within the scan. Mirrors the normalisation
    // used by the report's scan-tag filter.
    function normalizeTags(scanTags) {
        const raw = Array.isArray(scanTags) ? scanTags : [];
        const out = [];
        const seen = new Set();
        for (const t of raw) {
            const clean = String(t == null ? '' : t).trim();
            if (!clean) continue;
            const key = clean.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(clean);
        }
        return out;
    }

    function buildStat(glyphKey, word, totalKey) {
        const stat = doc.createElement('span');
        stat.className = 'live-totals-stat live-totals-' + glyphKey;

        const glyph = resultGlyphEl(glyphKey, {size: 'sm'});
        if (glyph) stat.appendChild(glyph);

        const val = doc.createElement('span');
        val.className = 'live-totals-value';
        valueEls[totalKey] = val;

        stat.append(' ', val, ' ' + word);
        return stat;
    }

    function applyFinishedState() {
        if (!el) return;
        el.classList.toggle('is-finished', finished);
        if (!dismissBtn) return;
        dismissBtn.disabled = !finished;
        dismissBtn.setAttribute(
            'aria-label',
            finished ? 'Dismiss scan totals' : 'Workflow running'
        );
    }

    function applyHiddenState() {
        if (!el) return;
        el.classList.toggle('is-tab-hidden', hidden);
    }

    /* ---- step progress ------------------------------------------------- */

    // Grammatical helper: "1 loop" / "2 loops", "1 step" / "3 steps".
    function plural(n, word) {
        return `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
    }

    // The disclosure control shared by "by type" and "by tag": a quiet button
    // that opens the detail table directly beneath it. Built here rather than
    // twice so the two cannot drift apart.
    function buildDisclosure(label, controls, onToggle) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'live-totals-disclosure';
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', controls);
        btn.hidden = true; // shown once there is something to disclose

        const text = doc.createElement('span');
        text.textContent = label;

        const chev = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chev.setAttribute('class', 'live-totals-disclosure-chev');
        chev.setAttribute('viewBox', '0 0 10 10');
        chev.setAttribute('width', '9');
        chev.setAttribute('height', '9');
        chev.setAttribute('aria-hidden', 'true');
        const chevPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        chevPath.setAttribute('d', 'M1 3l4 4 4-4'); // points down: the table opens downward
        chevPath.setAttribute('fill', 'none');
        chevPath.setAttribute('stroke', 'currentColor');
        chevPath.setAttribute('stroke-width', '1.6');
        chevPath.setAttribute('stroke-linecap', 'round');
        chevPath.setAttribute('stroke-linejoin', 'round');
        chev.appendChild(chevPath);

        btn.append(text, chev);
        btn.addEventListener('click', onToggle);
        return btn;
    }

    function buildSteps() {
        stepEls = {};

        const wrap = doc.createElement('div');
        wrap.className = 'live-totals-steps';
        wrap.hidden = true;

        const head = doc.createElement('div');
        head.className = 'live-totals-steps-head';

        const label = doc.createElement('span');
        label.className = 'live-totals-steps-label';
        label.textContent = 'Steps';

        const count = doc.createElement('span');
        count.className = 'live-totals-steps-count';
        stepEls.count = count;

        head.append(label, count);
        wrap.appendChild(head);

        // The bar counts the workflow's own steps, the only total known for
        // sure. aria-valuetext says so in words, as the note under it does.
        const bar = doc.createElement('div');
        bar.className = 'live-totals-bar';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', 'Steps');
        bar.setAttribute('aria-valuemin', '0');
        stepEls.bar = bar;

        const fill = doc.createElement('div');
        fill.className = 'live-totals-bar-fill';
        stepEls.fill = fill;

        bar.append(fill);
        wrap.appendChild(bar);

        const foot = doc.createElement('div');
        foot.className = 'live-totals-steps-foot';

        const note = doc.createElement('span');
        note.className = 'live-totals-steps-note';
        stepEls.note = note;

        const byType = buildDisclosure('by type', 'live-totals-bystep', () => {
            stepsExpanded = !stepsExpanded;
            renderSteps();
        });
        stepEls.byTypeBtn = byType;

        foot.append(note, byType);
        wrap.appendChild(foot);

        // One line, cut short with an ellipsis; the full text is its title.
        const now = doc.createElement('div');
        now.className = 'live-totals-steps-now';
        now.hidden = true;
        stepEls.now = now;
        wrap.appendChild(now);

        const table = doc.createElement('table');
        table.id = `${idPrefix}-bystep`;
        table.className = 'live-totals-detail';
        table.hidden = true;

        const thead = doc.createElement('thead');
        const htr = doc.createElement('tr');
        [['Step', 'live-totals-detail-name'], ['run', 'live-totals-detail-num']]
            .forEach(([text, cls]) => {
                const th = doc.createElement('th');
                th.scope = 'col';
                th.className = cls;
                th.textContent = text;
                htr.appendChild(th);
            });
        thead.appendChild(htr);
        table.appendChild(thead);

        stepEls.tableBody = doc.createElement('tbody');
        table.appendChild(stepEls.tableBody);
        stepEls.table = table;
        wrap.appendChild(table);

        stepEls.wrap = wrap;
        return wrap;
    }

    // One row per action type that has run, the busiest first.
    function orderedStepRows() {
        if (!steps) return [];
        const doneByType = steps.doneByType || {};
        return Object.keys(doneByType)
            .map((type) => ({type, done: doneByType[type] || 0}))
            .filter((r) => r.done > 0)
            .sort((a, b) => (b.done - a.done) || a.type.localeCompare(b.type));
    }

    function renderStepTable() {
        const rows = orderedStepRows();
        if (stepEls.byTypeBtn) stepEls.byTypeBtn.hidden = rows.length === 0;

        const open = stepsExpanded && rows.length > 0;
        if (stepEls.byTypeBtn) stepEls.byTypeBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (stepEls.wrap) stepEls.wrap.classList.toggle('is-expanded', open);
        stepEls.table.hidden = !open;
        if (!open) return;

        stepEls.tableBody.textContent = '';
        for (const r of rows) {
            const tr = doc.createElement('tr');

            const th = doc.createElement('th');
            th.scope = 'row';
            th.className = 'live-totals-detail-name';
            th.textContent = r.type;
            th.title = r.type;
            tr.appendChild(th);

            const td = doc.createElement('td');
            td.className = 'live-totals-detail-num';
            td.textContent = fmt(r.done);
            tr.appendChild(td);

            stepEls.tableBody.appendChild(tr);
        }
    }

    // Past this many steps the segments would be thinner than the gaps
    // between them, so the track is drawn whole.
    const MAX_SEGMENTS = 30;

    // "Click "Next" · item 12 of 40": what is running, in the words of the
    // step's label (its type when it has none), and where its loop is.
    function nowText(current) {
        if (!current) return '';
        const name = current.label || current.type || '';
        if (!name) return '';
        const loop = current.loop;
        const item = loop && Number.isInteger(loop.index)
            ? ` · item ${fmt(loop.index + 1)}${Number.isFinite(loop.total) ? ` of ${fmt(loop.total)}` : ''}`
            : '';
        return name + item;
    }

    function renderSteps() {
        if (!stepEls) return;

        const flow = (steps && steps.workflow) || {total: 0, done: 0, at: null};
        if (!steps || (steps.done === 0 && !(flow.total > 0))) {
            stepEls.wrap.hidden = true;
            return;
        }
        stepEls.wrap.hidden = false;

        stepEls.count.textContent = `${fmt(steps.done)} run`;

        const total = flow.total || 0;
        const doneTop = Math.min(flow.done || 0, total);
        const complete = total > 0 && doneTop >= total;

        // Rounded to a tenth: the extra precision is invisible at 8px tall and
        // only makes the inline style hard to read in devtools.
        const pct = total > 0 ? Math.round((doneTop / total) * 1000) / 10 : 0;
        stepEls.fill.style.width = `${pct}%`;
        stepEls.bar.classList.toggle('is-complete', complete);
        stepEls.bar.classList.toggle('is-segmented', total > 1 && total <= MAX_SEGMENTS);
        stepEls.bar.style.setProperty('--segments', String(Math.max(1, total)));

        stepEls.bar.setAttribute('aria-valuemax', String(total));
        stepEls.bar.setAttribute('aria-valuenow', String(doneTop));

        // The step running, while one is; otherwise how many finished.
        const running = !finished && !complete && Number.isInteger(flow.at) && flow.at > doneTop;
        const note = total === 0
            ? ''
            : running
                ? `Workflow step ${fmt(flow.at)} of ${fmt(total)}`
                : complete
                    ? `All ${plural(total, 'workflow step')} done`
                    : `${fmt(doneTop)} of ${plural(total, 'workflow step')} done`;
        stepEls.note.textContent = note;
        stepEls.bar.setAttribute('aria-valuetext', note || `${plural(steps.done, 'step')} run`);

        const now = finished ? '' : nowText(steps.current);
        stepEls.now.hidden = !now;
        stepEls.now.textContent = now ? `Now: ${now}` : '';
        if (now) stepEls.now.title = now;
        else stepEls.now.removeAttribute('title');

        renderStepTable();
    }

    // The by-tag block: the disclosure and the ledger it opens, in that order,
    // sitting under the totals they break down. Kept together so the button's
    // aria-controls always points at a table that exists.
    function buildByTag() {
        const wrap = doc.createElement('div');
        wrap.className = 'live-totals-tags';
        wrap.hidden = true; // shown once a named tag has been seen

        const foot = doc.createElement('div');
        foot.className = 'live-totals-tags-foot';

        tagCountEl = doc.createElement('span');
        tagCountEl.className = 'live-totals-tags-note';

        tagBtn = buildDisclosure('by tag', 'live-totals-bytag', toggleExpanded);

        foot.append(tagCountEl, tagBtn);
        wrap.appendChild(foot);

        // Many tags would otherwise stretch the card off the top of the screen,
        // so the ledger scrolls inside a bounded box while the panel does not.
        const scroll = doc.createElement('div');
        scroll.className = 'live-totals-tagscroll';
        scroll.hidden = true;

        const table = doc.createElement('table');
        table.id = `${idPrefix}-bytag`;
        table.className = 'live-totals-detail live-totals-ledger';

        const thead = doc.createElement('thead');
        const htr = doc.createElement('tr');
        const thTag = doc.createElement('th');
        thTag.className = 'live-totals-detail-name live-totals-ledger-tag';
        thTag.scope = 'col';
        thTag.textContent = 'Tag';
        htr.appendChild(thTag);
        [['fail', 'fail'], ['cantTell', "can't tell"], ['pass', 'pass']].forEach(([glyphKey, word]) => {
            const th = doc.createElement('th');
            th.scope = 'col';
            th.className = 'live-totals-detail-num live-totals-ledger-num';
            const glyph = resultGlyphEl(glyphKey, {size: 'sm'});
            if (glyph) th.appendChild(glyph);
            const sr = doc.createElement('span');
            sr.className = 'visually-hidden';
            sr.textContent = word;
            th.appendChild(sr);
            htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);

        ledgerBodyEl = doc.createElement('tbody');
        table.appendChild(ledgerBodyEl);

        scroll.appendChild(table);
        wrap.appendChild(scroll);

        subpanelEl = scroll;
        tagWrapEl = wrap;
        return wrap;
    }

    function toggleExpanded() {
        expanded = !expanded;
        applyExpandedState();
    }

    function applyExpandedState() {
        if (!el || !tagBtn || !subpanelEl || !tagWrapEl) return;
        const hasTags = tagTotals.size > 0;
        // The ledger can only be open when there is something to show.
        const open = expanded && hasTags;
        tagWrapEl.classList.toggle('is-expanded', open);
        tagBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        subpanelEl.hidden = !open;
    }

    function ensureEl() {
        if (el || !doc) return el;

        valueEls = {};

        // Wrapper: pinned bottom-right, stacks the (optional) by-tag ledger above
        // the totals card. It carries the status semantics the tests and screen
        // readers rely on, so it is a div: an aside may not be a status.
        el = doc.createElement('div');
        el.id = idPrefix;
        el.className = inline ? 'live-totals live-totals--inline' : 'live-totals';
        // A polite status region: screen-reader users can find it by its label,
        // and updates are announced once the reader is idle rather than on every
        // single scan. aria-atomic re-reads the whole tally, not just the digit
        // that changed.
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.setAttribute('aria-label', 'Live scan totals');

        // The visible totals card.
        panelEl = doc.createElement('div');
        panelEl.className = 'live-totals-panel';

        const header = doc.createElement('div');
        header.className = 'live-totals-header';

        const title = doc.createElement('div');
        title.className = 'live-totals-title';
        const scansVal = doc.createElement('span');
        scansVal.className = 'live-totals-scans';
        valueEls.scans = scansVal;
        title.append('Totals: ', scansVal);
        header.appendChild(title);

        // Inline, whatever holds the counter closes it: no dismiss button.
        if (!inline) {
            // Dismiss button — disabled + spinner while running, an actual close
            // control once the run finishes. The spinner (the shared .tab-spinner)
            // and the ✕ glyph are swapped by the .is-finished class in CSS.
            dismissBtn = doc.createElement('button');
            dismissBtn.type = 'button';
            dismissBtn.className = 'live-totals-dismiss';
            dismissBtn.disabled = true;
            dismissBtn.setAttribute('aria-label', 'Workflow running');
            const spin = doc.createElement('span');
            spin.className = 'tab-spinner live-totals-dismiss-spinner';
            spin.setAttribute('aria-hidden', 'true');
            const close = doc.createElement('span');
            close.className = 'live-totals-dismiss-close';
            close.setAttribute('aria-hidden', 'true');
            close.textContent = '✕';
            dismissBtn.append(spin, close);
            dismissBtn.addEventListener('click', () => {
                if (finished) detach();
            });
            header.appendChild(dismissBtn);
        }

        panelEl.appendChild(header);
        panelEl.appendChild(buildSteps());

        const row = doc.createElement('div');
        row.className = 'live-totals-row';
        row.appendChild(buildStat('fail', 'fail', 'violations'));
        row.appendChild(buildStat('cantTell', "can't tell", 'incomplete'));
        row.appendChild(buildStat('pass', 'pass', 'passes'));
        panelEl.appendChild(row);

        const dom = doc.createElement('div');
        dom.className = 'live-totals-dom';
        const domVal = doc.createElement('span');
        domVal.className = 'live-totals-value';
        valueEls.domNodes = domVal;
        dom.append('DOM elements scanned: ', domVal);
        panelEl.appendChild(dom);

        panelEl.appendChild(buildByTag());

        el.appendChild(panelEl);

        applyFinishedState();
        applyHiddenState();
        applyExpandedState();

        const mount = getMount() || doc.body;
        if (mount) mount.appendChild(el);
        return el;
    }

    // Ordered rows for the ledger: named tags sorted worst-first (most
    // failures, ties broken alphabetically), then the untagged bucket last.
    function orderedTagRows() {
        const rows = Array.from(tagTotals.values()).map((e) => ({...e, untagged: false}));
        rows.sort((a, b) => (b.violations - a.violations) || a.label.localeCompare(b.label));
        if (untagged.seen) {
            rows.push({
                label: 'Untagged',
                violations: untagged.violations,
                incomplete: untagged.incomplete,
                passes: untagged.passes,
                scans: untagged.scans,
                untagged: true
            });
        }
        return rows;
    }

    function renderLedger() {
        if (!ledgerBodyEl) return;
        const rows = orderedTagRows();

        ledgerBodyEl.textContent = '';
        for (const r of rows) {
            const tr = doc.createElement('tr');
            if (r.untagged) tr.className = 'live-totals-ledger-untagged';

            const th = doc.createElement('th');
            th.scope = 'row';
            th.className = 'live-totals-detail-name live-totals-ledger-tag';
            th.textContent = r.label;
            th.title = r.label;
            tr.appendChild(th);

            [['violations', 'fail'], ['incomplete', 'cantTell'], ['passes', 'pass']].forEach(([key, state]) => {
                const td = doc.createElement('td');
                // Distinct from the panel's .live-totals-<state> stat classes so
                // querying the panel's totals never picks up a ledger cell.
                td.className = 'live-totals-detail-num live-totals-ledger-num live-totals-ledger-' + state;
                td.textContent = fmt(r[key]);
                tr.appendChild(td);
            });

            ledgerBodyEl.appendChild(tr);
        }
    }

    function render() {
        if (!el || !valueEls) return;
        valueEls.violations.textContent = fmt(totals.violations);
        valueEls.incomplete.textContent = fmt(totals.incomplete);
        valueEls.passes.textContent = fmt(totals.passes);
        valueEls.domNodes.textContent = fmt(totals.domNodes);
        valueEls.scans.textContent = totals.scans + (totals.scans === 1 ? ' scan' : ' scans')
            + (totals.scansRun > totals.scans ? ` (${totals.scansRun} before merging)` : '');

        renderSteps();

        // By-tag tab: reveal once there is at least one named tag, and keep its
        // count and ledger current.
        const namedCount = tagTotals.size;
        if (tagWrapEl) tagWrapEl.hidden = namedCount === 0;
        if (tagBtn) tagBtn.hidden = namedCount === 0;
        if (tagCountEl) {
            tagCountEl.textContent = namedCount ? `${namedCount} tag${namedCount === 1 ? '' : 's'}` : '';
        }
        renderLedger();
        applyExpandedState();
    }

    function detach() {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        el = null;
        panelEl = null;
        valueEls = null;
        dismissBtn = null;
        tagBtn = null;
        tagCountEl = null;
        subpanelEl = null;
        tagWrapEl = null;
        ledgerBodyEl = null;
        stepEls = null;
    }

    // One scan's results into (sign 1) or out of (sign -1) the totals, overall
    // and per tag.
    function fold(counts, scanTags, sign) {
        const c = counts && typeof counts === 'object' ? counts : {};
        const v = sign * toCount(c.violations);
        const i = sign * toCount(c.incomplete);
        const p = sign * toCount(c.passes);

        totals.violations += v;
        totals.incomplete += i;
        totals.passes += p;

        const tags = normalizeTags(scanTags);
        if (tags.length) {
            for (const t of tags) {
                const key = t.toLowerCase();
                let e = tagTotals.get(key);
                if (!e) {
                    e = {label: t, violations: 0, incomplete: 0, passes: 0, scans: 0};
                    tagTotals.set(key, e);
                }
                e.violations += v;
                e.incomplete += i;
                e.passes += p;
                e.scans += sign;
                if (e.scans <= 0) tagTotals.delete(key);
            }
        } else {
            untagged.violations += v;
            untagged.incomplete += i;
            untagged.passes += p;
            untagged.scans += sign;
            untagged.seen = untagged.scans > 0;
        }
    }

    return {
        /**
         * Fold one scan's results into the running totals — overall and, when the
         * scan carries `scanTags`, per tag — and reflect them in the UI, creating
         * the counter on the first call.
         */
        add({counts, domNodes, scanTags, mergedScanKey = null} = {}) {
            fold(counts, scanTags, 1);
            totals.scansRun += 1;
            if (!mergedScanKey || !mergedSeen.has(mergedScanKey)) totals.scans += 1;
            if (mergedScanKey) mergedSeen.add(mergedScanKey);
            totals.domNodes += toCount(domNodes);
            ensureEl();
            render();
        },

        /**
         * A Merged scan step's scans became one scan when the step ended: take the
         * scans it was made from back out (`removed`, each as add() counted it)
         * and count the merged scan once (`added`), so the totals end where the
         * saved result does. DOM nodes stay as counted: they were scanned.
         */
        merge({key = null, removed = [], added = null} = {}) {
            const list = Array.isArray(removed) ? removed : [];
            for (const r of list) fold(r && r.counts, r && r.scanTags, -1);
            if (added) fold(added.counts, added.scanTags, 1);
            // Counted once from its first context already; without a key (an
            // older runner), each context was counted.
            if (!key || !mergedSeen.has(key)) totals.scans += (added ? 1 : 0) - list.length;
            ensureEl();
            render();
        },

        /**
         * Show the latest step-counter snapshot (src/shared/workflow-step-counter.js).
         * Unlike add(), this creates the counter on its own: step progress is
         * worth seeing from the first action, long before any scan streams in.
         * Passing null hides the progress block without touching the tallies.
         */
        setSteps(snapshot) {
            steps = (snapshot && typeof snapshot === 'object') ? snapshot : null;
            if (!steps) {
                renderSteps();
                return;
            }
            ensureEl();
            render();
        },

        /** Zero the totals and remove the counter (start of a new run). */
        reset() {
            totals.violations = 0;
            totals.incomplete = 0;
            totals.passes = 0;
            totals.domNodes = 0;
            totals.scans = 0;
            totals.scansRun = 0;
            mergedSeen.clear();
            tagTotals.clear();
            untagged.violations = 0;
            untagged.incomplete = 0;
            untagged.passes = 0;
            untagged.scans = 0;
            untagged.seen = false;
            steps = null;
            stepsExpanded = false;
            finished = false;
            expanded = false;
            detach();
        },

        /**
         * Mark the workflow as finished: stop the spinner and enable the dismiss
         * button so the user can close the counter when ready. The counter stays
         * on screen until dismissed (or a new run resets it).
         */
        finish() {
            finished = true;
            applyFinishedState();
            renderSteps();
        },

        /**
         * Hide (or reveal) the counter without touching its totals — used to keep
         * it bound to the "Run workflow" tab. Hidden with display:none so it also
         * drops out of the tab order and the accessibility tree while away.
         */
        setHidden(next) {
            hidden = !!next;
            applyHiddenState();
        },

        /** Remove the counter immediately, regardless of state. */
        remove() {
            detach();
        },

        getTotals() {
            return {...totals};
        },

        /** The step snapshot currently on screen, or null. For tests. */
        getSteps() {
            return steps ? {...steps} : null;
        },

        /** The by-type rows as rendered, busiest first. For tests. */
        getStepRows() {
            return orderedStepRows();
        },

        /**
         * Snapshot of the per-tag tallies, worst-first with the untagged bucket
         * last. Exposed for tests and any caller that wants the breakdown.
         */
        getTagTotals() {
            return orderedTagRows();
        }
    };
}

function toCount(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}
