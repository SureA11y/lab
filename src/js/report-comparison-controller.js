'use strict';

// State machine for the Compare tab. DOM-free: it holds the loaded reports and
// the framing, and produces the HTML for the current state via an injected
// setHTML sink, so the logic is unit-tested without a browser. The a11y-ui.js
// call site owns the chrome (the framing toggle, the loader, the report chips,
// the finding-diff tab clicks) and supplies the deps.
//
// Two reports render the pairwise diff that has always been here; three or more
// render the dashboard. The framing is the user's choice either way, and it
// means the same thing at both sizes:
//
//   evolution  — one subject over time     -> pairwise 'evolution' | series 'trend'
//   ab         — variants of one subject   -> pairwise 'ab'        | series 'matrix'
//
// One question decides the rest: what are these reports of? Runs of one subject
// over time, versions in an order the reader sets, or variants of one build.
// That choice fixes the framing, the default column order, the column labels and
// the noun the sentences count in.
//
// Reports arrive in whatever order they were picked, so the arrangement starts
// out chronological whatever the context: that is the least surprising first
// guess at versions too. Order can always be overridden — timestamps say when a
// scan ran, not which version it covered. Moving a report makes the arrangement
// explicit: the first move freezes what is on screen and applies the move to
// that, so nothing jumps. From then on the hand-made arrangement is what the
// contexts that follow an arrangement (versions, variants) show, across
// switches between them; 'Runs over time' always sorts by date regardless.
//
// States: needs-more (fewer than two reports) | ready.

import { comparisonDiffHTML } from './report-comparison-renderer.js';
import { comparisonSeriesHTML } from './report-multi-renderer.js';

// The shared engines are plain scripts, so they are read at call time rather
// than when this module is evaluated.
function diffApi() {
    const api = globalThis.A11Y_REPORT_DIFF;
    if (!api) throw new Error('report-comparison-controller: load shared/report-diff.js first');
    return api;
}
function seriesApi() {
    const api = globalThis.A11Y_REPORT_MULTI_DIFF;
    if (!api) throw new Error('report-comparison-controller: load shared/report-multi-diff.js first');
    return api;
}
function dispersionApi() {
    return globalThis.A11Y_ISSUE_DISPERSION || null;
}
function identityApi() {
    const api = globalThis.A11Y_REPORT_IDENTITY;
    if (!api) throw new Error('report-comparison-controller: load shared/report-identity.js first');
    return api;
}
// Optional: prose falls back to the engine's own rule titles when the
// plain-language table has not been loaded.
function ruleLabeller() {
    const api = globalThis.A11Y_PLAIN_LANGUAGE;
    if (!api) return undefined;
    return (row) => api.plainFor(row.ruleId, row.wcag).name.toLowerCase();
}

/**
 * Whether a report can take part in a comparison at all.
 *
 * The diff is rule-level, so a report with no canonical findings on any scan
 * has nothing to line up against another and is refused rather than rendered
 * as blank columns. Exported because a caller offering a “compare this one”
 * shortcut from elsewhere in the app needs the same answer *before* it sends
 * the reader to a tab that would only refuse the report on arrival.
 */
export function canCompareReport(report) {
    if (!report || !Array.isArray(report.scans)) return false;
    return report.scans.some((s) => s && s.canonical && Array.isArray(s.canonical.findings));
}

/**
 * What a set of reports is, from the reader's side. Each context resolves to a
 * framing and a default column order; the labels and the counting noun follow.
 */
export const COMPARISON_CONTEXTS = [
    {
        id: 'time',
        label: 'Runs over time',
        mode: 'evolution',
        order: 'time',
        unit: 'run',
        description: 'One subject scanned again and again. Ordered by each report\u2019s own timestamp, '
            + 'and the headline says how long ago that was.',
    },
    {
        id: 'versions',
        label: 'Versions',
        mode: 'evolution',
        order: 'given',
        unit: 'version',
        description: 'Releases or builds, in the order you put them. Scan dates do not decide it \u2014 '
            + 'you may well have scanned them out of order.',
    },
    {
        id: 'variants',
        label: 'Variants',
        mode: 'ab',
        order: 'given',
        unit: 'run',
        description: 'Devices, locales or environments of one build. Symmetric \u2014 no winner is declared.',
    },
];

const CONTEXT_BY_ID = Object.fromEntries(COMPARISON_CONTEXTS.map((c) => [c.id, c]));

// How many reports the tab can render at once. Past this the time axis and the
// grid stay legible but the page stops being scannable, and the answer is
// selecting a window rather than drawing more columns.
export const MAX_REPORTS = 24;

export function createComparisonController({ setHTML, onState } = {}) {
    if (typeof setHTML !== 'function') throw new Error('createComparisonController: setHTML required');

    let mode = 'evolution';
    // The profiles turned off (keys from shared-profiles.js comparisonProfiles):
    // the comparison is read on the others. Empty = every profile the reports
    // share.
    let profilesOff = [];
    // null = follow the framing's default; 'time' / 'given' = the user said so.
    let orderChoice = null;
    let nextKey = 1;
    // The arrangement: chronological until the reader moves a report by hand.
    const entries = []; // { key, name, report }
    // True once the reader has moved a report. Until then new reports slot into
    // date order; after, they join the end of the arrangement they made.
    let arranged = false;

    // What this comparison is called and why it was made. Only a person knows
    // either, so both are typed and both are optional; everything else in the
    // document header is derived from the reports. `generatedAt` is stamped once
    // per set of loaded reports rather than on every render, so re-ordering the
    // columns does not keep moving the compiled date.
    const doc = { title: '', note: '', generatedAt: new Date().toISOString() };

    function documentFor() {
        return { title: doc.title, note: doc.note, generatedAt: doc.generatedAt };
    }

    function stateName() {
        return entries.length >= 2 ? 'ready' : 'needs-more';
    }

    function defaultOrder() {
        return mode === 'ab' ? 'given' : 'time';
    }
    function orderBy() {
        return orderChoice || defaultOrder();
    }

    // The order the columns will appear in. The chips must match it.
    function byTime(list) {
        const { compareByTime } = identityApi();
        return list.slice().sort((a, b) => compareByTime(a.report, b.report));
    }
    function displayEntries() {
        return orderBy() === 'time' ? byTime(entries) : entries.slice();
    }

    function identityOf(entry) {
        return identityApi().reportIdentity(entry.report);
    }

    function emptyHTML() {
        const have = entries.length;
        return `<div class="cmp2-empty" role="status">Load at least two reports to compare `
            + `(${have} loaded). Three or more open the dashboard.</div>`;
    }

    // The file name is usually the only thing separating three scans of three
    // local versions, so it is offered as the header tie-breaker.
    function fileLabel(entry) {
        return String(entry.name || '').replace(/\.(a11y-report\.)?json$/i, '');
    }
    function fallbackLabels(list) {
        return list.map(fileLabel);
    }
    function contextId() {
        if (mode === 'ab') return 'variants';
        return orderBy() === 'time' ? 'time' : 'versions';
    }
    function currentContext() {
        return CONTEXT_BY_ID[contextId()];
    }

    function pairHTML() {
        const [a, b] = displayEntries();
        const d = diffApi().diffReports(a.report, b.report, {
            mode,
            // An arrangement is the user's claim about which is the baseline, and
            // it outranks the timestamps at two reports just as it does at ten.
            order: orderBy(),
            document: documentFor(),
            profilesOff: activeProfilesOff(),
        });
        // Where the failures are, in the reports as compared: read on the
        // profiles they share, like the rest of the comparison.
        const [first, second] = d.compared || (d.swapped ? [b.report, a.report] : [a.report, b.report]);
        return comparisonDiffHTML(d, { dispersion: pairDispersion(first, second) });
    }

    function seriesHTML() {
        const list = displayEntries();
        const series = seriesApi().diffReportSeries(list.map((e) => e.report), {
            mode: mode === 'ab' ? 'matrix' : 'trend',
            order: orderBy(),
            unit: currentContext().unit,
            ruleLabel: ruleLabeller(),
            fallbackLabels: fallbackLabels(list),
            document: documentFor(),
            profilesOff: activeProfilesOff(),
        });
        const source = series.ordering && Array.isArray(series.ordering.source)
            ? series.ordering.source : list.map((_, i) => i);
        return comparisonSeriesHTML(series, {
            dispersion: seriesDispersion(series.compared || source.map((i) => list[i].report)),
        });
    }

    // How each report's failures spread across its scans. Computed here, from
    // the reports themselves, rather than inside the diff engines, whose
    // output is also written to disk by the CLI and has no use for per-scan
    // detail. Null when the dispersion module is not loaded, and when no
    // report has a failing rule: there is nothing to place.
    function analyse(report) {
        return dispersionApi().analyseDispersion(report && Array.isArray(report.scans) ? report.scans : []);
    }
    const anyFailing = (analyses) => analyses.some((r) => r.rulesFailing > 0);
    function pairDispersion(first, second) {
        if (!dispersionApi()) return null;
        const [a, b] = [analyse(first), analyse(second)];
        return anyFailing([a, b]) ? dispersionApi().compareDispersion(a, b) : null;
    }
    function seriesDispersion(reports) {
        if (!dispersionApi()) return null;
        const analyses = reports.map(analyse);
        return anyFailing(analyses) ? dispersionApi().seriesDispersion(analyses) : null;
    }

    // The profiles the loaded reports can be compared on, as switches.
    function offeredProfiles() {
        const api = globalThis.A11Y_SHARED_PROFILES;
        if (!api || typeof api.comparisonProfiles !== 'function' || entries.length < 2) return [];
        return api.comparisonProfiles(entries.map((e) => e.report));
    }
    // The choice as it applies to the reports loaded now: a profile they no
    // longer share is not off, and turning every one off turns none off.
    function activeProfilesOff() {
        const offered = offeredProfiles().map((p) => p.key);
        const off = profilesOff.filter((k) => offered.includes(k));
        return off.length >= offered.length ? [] : off;
    }

    function htmlFor(state) {
        if (state !== 'ready') return emptyHTML();
        return entries.length === 2 ? pairHTML() : seriesHTML();
    }

    function refresh() {
        const state = stateName();
        setHTML(htmlFor(state), state);
        if (typeof onState === 'function') onState(state, entries.length);
        return state;
    }

    return {
        /**
         * Add one parsed report.
         *
         * A report with no canonical findings cannot be diffed at the rule
         * level, so it is refused rather than rendered as blanks. Reports that
         * share an identity are accepted: one run exported three times filtered
         * by tag is exactly the comparison someone wants, and the caller is told
         * so it can say as much.
         *
         * `name` is what the chip is titled by — a file name from the loader, or
         * nothing at all from the in-app shortcut, which falls back to what the
         * report calls itself. It is returned either way.
         */
        addReport(report, name, { draw = true } = {}) {
            if (!canCompareReport(report)) {
                // A bare noun phrase, not a sentence: the loader reads it as
                // "could not load <file> (<reason>)" and the in-app shortcut as
                // "<these results> cannot be added \u2014 <reason>".
                return { ok: false, error: 'no scan results to compare' };
            }
            if (entries.length >= MAX_REPORTS) {
                return { ok: false, error: `the dashboard holds ${MAX_REPORTS} reports at once` };
            }

            const identity = identityApi().reportIdentity(report);
            const duplicate = entries.some((e) => {
                const other = identityOf(e);
                return other.runId === identity.runId
                    && other.scanTags.join('|') === identity.scanTags.join('|');
            });

            const entry = { key: nextKey++, name: name || identity.label, report };
            entries.push(entry);
            if (!arranged) {
                const sorted = byTime(entries);
                entries.length = 0;
                entries.push(...sorted);
            }
            // A caller adding several draws once, after the last (refresh).
            if (draw) refresh();
            // The resolved name comes back so a caller that passed none can say
            // which report it just added without re-deriving the fallback.
            return { ok: true, duplicate, count: entries.length, name: entry.name, key: entry.key };
        },

        removeReport(key) {
            const at = entries.findIndex((e) => e.key === Number(key));
            if (at === -1) return false;
            entries.splice(at, 1);
            // With nothing left there is no arrangement to keep.
            if (!entries.length) arranged = false;
            refresh();
            return true;
        },

        clear() {
            entries.length = 0;
            arranged = false;
            return refresh();
        },

        /**
         * Puts the listed reports first, in the order given, and makes that the
         * arrangement: for reports that arrive already in order, such as a
         * batch's runs in row order, which their scan times need not follow.
         */
        arrange(keys) {
            const wanted = (keys || []).map(Number);
            const picked = wanted.map((k) => entries.find((e) => e.key === k)).filter(Boolean);
            const rest = entries.filter((e) => !wanted.includes(e.key));
            entries.length = 0;
            entries.push(...picked, ...rest);
            arranged = true;
            return refresh();
        },

        /**
         * What the tab shows as chips, in the order the columns will appear.
         * `dated` is false for a report with no timestamp — it cannot take part
         * in a chronological sort, and the chip should say so.
         */
        list() {
            return displayEntries().map((entry, index) => {
                const identity = identityOf(entry);
                return {
                    key: entry.key,
                    position: index + 1,
                    name: entry.name,
                    // What this column is called: the file it came from, minus
                    // the extension.
                    columnName: fileLabel(entry),
                    label: identity.label,
                    timestamp: identity.timestamp,
                    dated: !!identity.timestamp,
                    scanTags: identity.scanTags,
                };
            });
        },

        /**
         * Move one report earlier (-1) or later (+1).
         *
         * The first move freezes the order on screen and switches to an explicit
         * arrangement, so the chip moves one place instead of the row re-sorting
         * underneath it.
         */
        moveReport(key, delta) {
            const step = Number(delta) < 0 ? -1 : 1;
            const ordered = displayEntries();
            const at = ordered.findIndex((e) => e.key === Number(key));
            const to = at + step;

            if (at === -1 || to < 0 || to >= ordered.length) return false;

            [ordered[at], ordered[to]] = [ordered[to], ordered[at]];
            entries.length = 0;
            entries.push(...ordered);
            arranged = true;
            orderChoice = 'given';
            refresh();
            return true;
        },

        /** Set what these reports are: 'time' | 'versions' | 'variants'. */
        setContext(id) {
            const context = CONTEXT_BY_ID[id];
            if (!context) return refresh();
            mode = context.mode;
            orderChoice = context.order;
            return refresh();
        },
        getContext() { return contextId(); },
        contexts() { return COMPARISON_CONTEXTS.slice(); },

        /**
         * 'time' sorts by each report's own timestamp; 'given' keeps the
         * arrangement. Passing anything else returns to the framing's default.
         */
        setOrder(next) {
            orderChoice = (next === 'time' || next === 'given') ? next : null;
            return refresh();
        },
        getOrder() { return orderBy(); },
        /** True while the order is the framing's default rather than a choice. */
        orderIsDefault() { return orderChoice === null; },
        /** Reports that cannot take part in a chronological sort. */
        undatedCount() { return entries.filter((e) => !identityOf(e).timestamp).length; },

        /**
         * The title, note and compiled date that name this comparison in the
         * view and in the file it exports to. Any may be blank; a blank title
         * falls back to what the reports call themselves.
         */
        setDocument({ title, note, generatedAt } = {}) {
            if (typeof title === 'string') doc.title = title.trim();
            if (typeof note === 'string') doc.note = note.trim();
            // Settable for the same reason a report's timestamp is: the date a
            // document states is not always the moment its tab was opened. An
            // unreadable value is ignored rather than replacing a good stamp
            // with a bad one.
            if (typeof generatedAt === 'string' && !Number.isNaN(new Date(generatedAt).getTime())) {
                doc.generatedAt = generatedAt;
            }
            return refresh();
        },
        getDocument() { return { title: doc.title, note: doc.note, generatedAt: doc.generatedAt }; },

        /**
         * Everything needed to put this comparison back: what the reports are,
         * the order chosen (null for the context's default), the name, note and
         * date, and the reports in column order with their names.
         */
        snapshot() {
            return {
                context: contextId(),
                order: orderChoice,
                profilesOff: activeProfilesOff(),
                document: documentFor(),
                reports: displayEntries().map((e) => ({ name: e.name, report: e.report })),
            };
        },

        /**
         * Replaces what is loaded with a snapshot's comparison. Reports that
         * cannot be compared are left out and listed in `failures`; the rest
         * keep their column order.
         */
        restore({ context, order = null, profilesOff: off = [], document: saved = {}, reports = [] } = {}) {
            entries.length = 0;
            arranged = false;
            const failures = [];
            for (const { name, report } of reports) {
                if (!canCompareReport(report)) { failures.push({ name, error: 'no scan results to compare' }); continue; }
                if (entries.length >= MAX_REPORTS) { failures.push({ name, error: `the dashboard holds ${MAX_REPORTS} reports at once` }); continue; }
                entries.push({ key: nextKey++, name: name || identityApi().reportIdentity(report).label, report });
            }
            // The columns were saved in the order they showed, so that order is
            // the arrangement; the context and order choice then say how they
            // are framed and whether a date sort applies, as they did.
            arranged = entries.length > 0;
            const ctx = CONTEXT_BY_ID[context] || CONTEXT_BY_ID.time;
            mode = ctx.mode;
            orderChoice = order === 'time' || order === 'given' ? order : null;
            profilesOff = Array.isArray(off) ? off.map(String) : [];
            doc.title = typeof saved.title === 'string' ? saved.title.trim() : '';
            doc.note = typeof saved.note === 'string' ? saved.note.trim() : '';
            doc.generatedAt = typeof saved.generatedAt === 'string' && !Number.isNaN(new Date(saved.generatedAt).getTime())
                ? saved.generatedAt
                : new Date().toISOString();
            refresh();
            return { count: entries.length, failures };
        },

        /**
         * The profiles the loaded reports can be compared on: [{ key, label,
         * on }], WCAG first. Fewer than two, and there is nothing to choose.
         */
        profiles() {
            const off = activeProfilesOff();
            return offeredProfiles().map((p) => ({ ...p, on: !off.includes(p.key) }));
        },
        /**
         * Turn a profile on or off. The last one on stays on: a comparison
         * of nothing has nothing to show.
         */
        setProfile(key, on) {
            const k = String(key);
            const offered = offeredProfiles().map((p) => p.key);
            if (!offered.includes(k)) return refresh();
            const next = on ? profilesOff.filter((x) => x !== k) : [...new Set([...activeProfilesOff(), k])];
            if (next.filter((x) => offered.includes(x)).length >= offered.length) return refresh();
            profilesOff = next;
            return refresh();
        },
        /** Every profile on again. */
        showAllProfiles() { profilesOff = []; return refresh(); },

        setMode(next) { mode = next === 'ab' ? 'ab' : 'evolution'; return refresh(); },
        getMode() { return mode; },
        count() { return entries.length; },
        /** Every engine and release the loaded reports ran: [{ name, version }]. */
        engines() { return identityApi().comparisonEngines(entries.map((e) => e.report)); },
        /** Which view the current load renders — the tab explains the difference. */
        shape() { return entries.length >= 3 ? 'series' : 'pair'; },
        refresh,
        getState: stateName,
    };
}
