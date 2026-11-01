'use strict';

// N-way comparison engine — the series counterpart to report-diff.js.
//
// One pass per report builds a rule matrix (ruleId -> occurrence count per
// column); categories, stats, verdict and narrative are all derived from it.
// Chaining the pairwise diff over pairs was rejected for this reason: a
// signature like present/absent/present cannot be expressed as a set of pairs.
//
// Two framings, mirroring the two-report ones:
//  - 'trend'  — ordered oldest -> newest (the N-way 'evolution'). Rules classify
//               as resolved / new / persistent / flapping.
//  - 'matrix' — unordered variants (the N-way 'ab'). Rules classify as
//               universal / shared / unique.
//
// Robustness is inherited: the diff is rule-level, because a rule id carries no
// DOM. Occurrence detail is NOT computed across N columns — pair drill-down
// delegates to diffReports(a, b), which is the only place occurrence pairing is
// claimed.
//
// Browser: globalThis.A11Y_REPORT_MULTI_DIFF. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./report-diff.js'),
            require('./report-identity.js'),
            require('./report-conformance.js'),
            require('./run-health.js'),
        );
    } else {
        if (!root.A11Y_REPORT_DIFF || !root.A11Y_REPORT_IDENTITY
            || !root.A11Y_REPORT_CONFORMANCE || !root.A11Y_RUN_HEALTH) {
            throw new Error('report-multi-diff.js: load report-diff.js, report-identity.js, '
                + 'report-conformance.js and run-health.js first');
        }
        root.A11Y_REPORT_MULTI_DIFF = factory(
            root.A11Y_REPORT_DIFF, root.A11Y_REPORT_IDENTITY,
            root.A11Y_REPORT_CONFORMANCE, root.A11Y_RUN_HEALTH,
        );
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (diffApi, identityApi, conformanceApi, healthApi) {

    const { collectFailingRules, collectTightestMargins, failingOccurrencesByCheck, diffReports, pagePath } = diffApi;
    const { reportIdentity, compareByTime, describeComparison } = identityApi;
    const { readConformance, conformanceMatrix, sharedTarget, en301549ForTarget } = conformanceApi;
    const { assessRun, describeRunHealth } = healthApi;

    const SEV_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 };
    const SEV_ORDER = ['critical', 'serious', 'moderate', 'minor', 'unknown'];
    function sevRank(s) { return SEV_RANK[s] == null ? 4 : SEV_RANK[s]; }
    function moreSevere(a, b) { return sevRank(a) <= sevRank(b) ? a : b; }
    function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }
    function scores(report) {
        const s = report && report.metrics && report.metrics.a11ySummary && report.metrics.a11ySummary.scores;
        return s || {};
    }

    // Column headers name what the reader recognizes, which follows the framing
    // rather than the data: runs are told apart by when they ran, variants by
    // what they are. Reading it off timestamps alone mislabels variants as soon
    // as two of them are scanned a minute apart.
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function dateLabel(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    }
    function dateTimeLabel(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        return `${dateLabel(iso)} ${hh}:${mm}`;
    }
    function distinct(labels) {
        return labels.every(Boolean) && new Set(labels).size === labels.length;
    }

    // A list of tags short enough for a header: past three, the first two and
    // how many more.
    function tagList(tags) {
        return tags.length > 3 ? `${tags.slice(0, 2).join(' / ')} / +${tags.length - 2} more` : tags.join(' / ');
    }

    // Variants: the report's own name, else its scan tags, else its date.
    // Repeated names are qualified by tag when each has tags of its own — that
    // is what separates several exports of one run.
    function variantLabels(identities) {
        const base = identities.map((identity) => (
            identity.scenarioName
            || (identity.scanTags.length ? tagList(identity.scanTags) : null)
            || dateLabel(identity.timestamp)
            || identity.label
        ));
        if (distinct(base)) return base;
        return qualifyRepeated(base, identities, [ownTagsOf], { partial: false }).labels;
    }

    // The tags a report does not share with the rest of `group`, or null.
    function ownTagsOf(identities, group, i) {
        const shared = group
            .map((j) => identities[j].scanTags)
            .reduce((common, tags) => common.filter((t) => tags.includes(t)));
        const own = identities[i].scanTags.filter((t) => !shared.includes(t));
        return own.length ? tagList(own) : null;
    }
    function dayOf(identities, group, i) {
        return dateLabel(identities[i].timestamp);
    }

    /**
     * Labels repeated in `labels` qualified as "name · qualifier", trying each
     * of `qualifiers` in turn per group of repeats and keeping the first that
     * tells the group apart. With `partial`, a qualifier may leave one of the
     * group as it is (the untagged copy of a tagged one); without, every one
     * needs its own. `dated[i]` is the unqualified name where the day did it,
     * for a place that shows the date beside the label anyway; else null.
     */
    function qualifyRepeated(labels, identities, qualifiers, { partial = true, skip = [] } = {}) {
        const out = labels.slice();
        const dated = labels.map(() => null);
        for (const name of new Set(labels)) {
            const group = labels.map((l, i) => (l === name && !skip[i] ? i : -1)).filter((i) => i !== -1);
            if (group.length < 2) continue;
            for (const qualify of qualifiers) {
                const parts = group.map((i) => qualify(identities, group, i));
                if (!partial && !parts.every(Boolean)) continue;
                const named = group.map((i, k) => (parts[k] && parts[k] !== name ? `${name} · ${parts[k]}` : name));
                if (!distinct(named)) continue;
                group.forEach((i, k) => {
                    out[i] = named[k];
                    dated[i] = qualify === dayOf && named[k] !== name ? name : null;
                });
                break;
            }
        }
        return { labels: out, dated };
    }

    // A timeline: the date, with the clock added when several runs share a day.
    function timelineLabels(identities) {
        const dates = identities.map((identity) => dateLabel(identity.timestamp));
        if (distinct(dates)) return dates;

        const stamped = identities.map((identity) => dateTimeLabel(identity.timestamp));
        if (distinct(stamped)) return stamped;

        // Undated or same-minute runs fall back to what they call themselves.
        const names = variantLabels(identities);
        return identities.map((identity, i) => (stamped[i] && distinct(stamped) ? stamped[i] : names[i]));
    }

    // Headers must be distinct. Three scans of three local versions can share
    // every field in the payload, so the caller may pass what it knows them as
    // (usually a file name) to break the tie; failing that, position does.
    // Explicit names win over anything derived from the payload. Nothing in the
    // app passes these yet; they are the hook for a caller that knows what its
    // columns are (a version field written at run time, say).
    function applyOverrides(labels, overrides) {
        return labels.map((label, i) => (overrides[i] || label));
    }

    function ensureDistinct(labels, fallbacks, overrides, identities) {
        const plain = { labels, dated: labels.map(() => null) };
        if (distinct(labels)) return plain;

        // Only columns the reader has not named are rewritten: a typed name
        // survives its neighbours needing a fallback.
        const withFallback = labels.map((l, i) => (overrides[i] ? l : (fallbacks[i] || l)));
        if (distinct(withFallback)) return { ...plain, labels: withFallback };

        // No file names to tell them apart: what the reports say of
        // themselves, the day they ran, else the tags only some carry.
        const qualified = qualifyRepeated(labels, identities, [dayOf, ownTagsOf], { skip: overrides.map(Boolean) });
        if (distinct(qualified.labels)) return qualified;

        return { ...plain, labels: withFallback.map((l, i) => (overrides[i] ? l : `${i + 1}. ${l}`)) };
    }

    // Dated headers only where dates put the columns in order. A hand-arranged
    // series is versions, not moments, so its columns take the reports' names.
    // Variants keep their names in any order — sorting them by date is a
    // convenience, not a claim about them.
    function columnLabels(identities, mode, orderBy, { fallbacks, overrides }) {
        const timeline = mode === 'trend' && orderBy === 'time';
        const labels = timeline ? timelineLabels(identities) : variantLabels(identities);
        return ensureDistinct(applyOverrides(labels, overrides), fallbacks, overrides, identities);
    }

    // Order oldest -> newest. compareByTime is already a total order, so the
    // N-way case is a sort, not new logic. Reports carrying no timestamp sort
    // last rather than being guessed at.
    function orderReportsByTime(reports) {
        return reports.slice().sort(compareByTime);
    }

    // How many of these reports have no timestamp to sort on. Sorting by date
    // with undated reports in the set is legal but worth saying out loud: their
    // position is alphabetical, not chronological.
    function countUndated(reports) {
        return reports.filter((r) => !reportIdentity(r).timestamp).length;
    }

    // ---- per-column stats -------------------------------------------------

    // Scans that actually ran. `pages` counts every scan the report declares,
    // which is what the N-gate compares; a run that skipped two of them looked
    // at less of the site than that number claims, so both travel.
    function analyzedScans(report) {
        return (Array.isArray(report && report.scans) ? report.scans : [])
            .filter((scan) => scan && !scan.skipped && !scan.skipInfo);
    }

    // Per-page scores, so a column can say more than its mean. An average that
    // rose while its worst page fell is the case a single number hides, and the
    // payload has carried the per-scan score all along.
    function pageScoreSpread(report) {
        const points = [];
        for (const scan of analyzedScans(report)) {
            const own = scan.summary && num(scan.summary.score);
            const metric = scan.metrics && scan.metrics.a11ySummary && scan.metrics.a11ySummary.scores;
            const value = own != null ? own : (metric ? num(metric.avgPageAccessibility) : null);
            if (value == null) continue;
            points.push({ score: value, url: scan.url || null, label: scan.label || null });
        }
        if (!points.length) return null;

        const sorted = points.slice().sort((a, b) => a.score - b.score);
        const mid = Math.floor(sorted.length / 2);
        return {
            n: sorted.length,
            min: sorted[0].score,
            max: sorted[sorted.length - 1].score,
            median: sorted.length % 2 ? sorted[mid].score : (sorted[mid - 1].score + sorted[mid].score) / 2,
            worst: sorted[0],
            best: sorted[sorted.length - 1],
            scores: sorted.map((p) => p.score),
        };
    }

    function columnStats(report, rules, reviewRules) {
        let failures = 0;
        const severity = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
        // A failure is one element on one page for one rule (a criterion,
        // in a report read by criterion), so an unlabelled input that breaks
        // 1.3.1, 3.3.2 and 4.1.2 is three. The elements themselves, each
        // once whatever it breaks, are what a reader pictures as "how much
        // is broken".
        const elements = new Set();
        for (const rule of rules.values()) {
            failures += rule.occ.size;
            severity[rule.severity] += rule.occ.size;
            for (const key of rule.occ.keys()) elements.add(key);
        }

        // Checks that concluded nothing and handed the question to a person.
        // Left out of every failure count, because they are not failures, but never
        // left out of the picture: a rule that stops failing and starts needing
        // review has moved, not gone.
        let reviewOcc = 0;
        for (const rule of reviewRules.values()) reviewOcc += rule.occ.size;

        const sc = scores(report);
        const scans = Array.isArray(report && report.scans) ? report.scans : [];
        return {
            pages: scans.length,
            analyzed: analyzedScans(report).length,
            rules: rules.size,
            failures,
            elements: elements.size,
            seriousCritical: severity.critical + severity.serious,
            severity,
            review: reviewRules.size,
            reviewOccurrences: reviewOcc,
            score: num(sc.avgPageAccessibility),
            confidence: num(sc.confidence),
            // Withheld rather than absent: a run that evaluated nothing reports
            // no score, and a series must break its line there rather than draw
            // through it. (R4 of the design notes.)
            scoreState: typeof sc.evaluationState === 'string' ? sc.evaluationState : null,
            pageScores: pageScoreSpread(report),
        };
    }

    // Whether a column can be read at face value. A run that skipped scans, lost
    // iterations or failed an action found less because it did less, so its
    // lower count is not an improvement. That is the one failure mode a comparison of
    // findings alone cannot see.
    function columnHealth(report) {
        const health = assessRun(report);
        return {
            ok: health.ok,
            degraded: health.degraded,
            cancelled: health.cancelled,
            failed: health.failed,
            reasons: describeRunHealth(health),
            skippedScans: health.skippedScans.length,
            failedActions: health.failedActions.length,
            iterationFailures: health.iterationFailures,
        };
    }

    // ---- lifecycle over an ordered presence signature ----------------------

    // transitions counts how many times presence flips across the series. One
    // flip is a fix or a regression; two or more is a rule that keeps coming
    // back. At N = 2 that signal does not exist: a flapping rule reads as a
    // clean fix or a clean regression depending on which two runs were loaded.
    function lifecycle(present) {
        let transitions = 0;
        for (let i = 1; i < present.length; i += 1) if (present[i] !== present[i - 1]) transitions += 1;

        const firstSeen = present.indexOf(true);
        let lastSeen = -1;
        for (let i = present.length - 1; i >= 0; i -= 1) if (present[i]) { lastSeen = i; break; }

        // How many columns the current presence state has held, counting back
        // from the newest.
        let streak = 1;
        for (let i = present.length - 1; i > 0; i -= 1) {
            if (present[i] === present[i - 1]) streak += 1; else break;
        }

        // Times it came back after being gone. More useful than the flip count.
        let returns = 0;
        for (let i = 1; i < present.length; i += 1) if (present[i] && !present[i - 1]) returns += 1;

        return { transitions, returns, firstSeen, lastSeen, streak, flapping: transitions >= 2 };
    }

    // Direction for a rule present in every column: does its count move?
    function countTrend(counts) {
        const first = counts[0];
        const last = counts[counts.length - 1];
        if (last < first) return 'improving';
        if (last > first) return 'worsening';
        return 'flat';
    }

    function trendCategory(present, life) {
        if (life.flapping) return 'flapping';
        if (present.every(Boolean)) return 'persistent';
        return present[present.length - 1] ? 'new' : 'resolved';
    }

    function matrixCategory(present) {
        const hits = present.filter(Boolean).length;
        if (hits === present.length) return 'universal';
        if (hits === 1) return 'unique';
        return 'shared';
    }

    // ---- reach, age and flow -----------------------------------------------

    // How far a rule reaches inside one column: distinct pages, not instances.
    // Twelve instances on one page is a component someone owns; two instances on
    // twelve pages is the design system, and the same total cannot tell those
    // apart. Pages are counted by path, the one part of an occurrence that no
    // markup change rewrites.
    function pagesOf(entry) {
        if (!entry) return 0;
        const set = new Set();
        for (const occ of entry.occ.values()) set.add(pagePath(occ.pageUrl));
        return set.size;
    }

    // Thresholds, not truths: a rule on most of the pages a run reached is a
    // pattern, one on a couple of them is a place. Named so the reading is a
    // word rather than a ratio the reader has to interpret.
    function scopeOf(pages, analyzed) {
        if (!pages || !analyzed) return null;
        const share = pages / analyzed;
        if (share >= 0.6) return 'systemic';
        if (share >= 0.25) return 'partial';
        return 'local';
    }

    // How long a problem that is failing NOW has been failing. Not when it first
    // appeared: a rule fixed in March and back in June has been broken since
    // June, and dating it to March would overstate the neglect. A rule that is
    // clean in the latest column has no age; it has a last-seen instead.
    function ageOf(present, timestamps, orderBy) {
        const last = present.length - 1;
        if (!present[last]) return null;

        let since = last;
        while (since > 0 && present[since - 1]) since -= 1;

        let spanMs = null;
        if (orderBy === 'time' && timestamps[since] && timestamps[last]) {
            const ms = new Date(timestamps[last]).getTime() - new Date(timestamps[since]).getTime();
            if (Number.isFinite(ms) && ms > 0) spanMs = ms;
        }
        return {
            sinceIndex: since,
            runs: last - since + 1,
            spanMs,
            // Present from the very first column: it may be older than the
            // window, so the window is a floor on its age, not a measurement.
            fromStart: since === 0,
        };
    }

    // What moved between each pair of neighbouring columns, in both directions
    // at once. A net of -3 can be six fixes and three regressions, and a team
    // that shipped six fixes deserves to see six, not three.
    //
    // Bookkeeping is per rule, per step: a rule going 5 -> 3 counts two fixed.
    // Occurrences are NOT paired across columns (that identity is only claimed
    // in the two-report drill-down), so a rule that fixed two instances and
    // gained two others in one step reads as no movement. The floor is honest;
    // the ceiling would need element identity that does not survive markup.
    function buildFlow(columns, rows) {
        const steps = [];
        for (let i = 1; i < columns.length; i += 1) {
            let fixed = 0;
            let introduced = 0;
            let rulesFixed = 0;
            let rulesNew = 0;

            for (const row of rows) {
                const move = row.counts[i] - row.counts[i - 1];
                if (move < 0) fixed += -move; else introduced += move;
                if (row.present[i - 1] && !row.present[i]) rulesFixed += 1;
                if (!row.present[i - 1] && row.present[i]) rulesNew += 1;
            }

            steps.push({
                from: i - 1, to: i,
                fromLabel: columns[i - 1].label, toLabel: columns[i].label,
                fixed, introduced, net: introduced - fixed, rulesFixed, rulesNew,
            });
        }

        const totals = steps.reduce((acc, step) => ({
            fixed: acc.fixed + step.fixed,
            introduced: acc.introduced + step.introduced,
            rulesFixed: acc.rulesFixed + step.rulesFixed,
            rulesNew: acc.rulesNew + step.rulesNew,
        }), { fixed: 0, introduced: 0, rulesFixed: 0, rulesNew: 0 });

        return { steps, totals };
    }

    // Rules that stopped failing and started needing a human instead. The one
    // movement a failure count reads as a fix and a person would not: nothing
    // was repaired, the check just stopped being sure.
    function movedToReview(rows, reviewByColumn) {
        const last = reviewByColumn.length - 1;
        return rows.filter((row) => (
            !row.present[last]
            && row.present.some(Boolean)
            && reviewByColumn[last].has(row.ruleId)
        ));
    }

    // ---- the matrix --------------------------------------------------------

    function buildMatrix(perColumnRules, mode, context = {}) {
        const ids = new Set();
        for (const rules of perColumnRules) for (const id of rules.keys()) ids.add(id);

        const rows = [];
        for (const ruleId of ids) {
            const counts = perColumnRules.map((rules) => {
                const rule = rules.get(ruleId);
                return rule ? rule.occ.size : 0;
            });
            const present = counts.map((c) => c > 0);

            // Metadata from any column that carries the rule; severity takes the
            // worst seen, so a rule that is critical in one variant is not
            // softened by a milder reading elsewhere.
            let title = ruleId;
            let titleLang = null;
            let wcag = '';
            let severity = 'unknown';
            const rgaa = [];
            let standards = null;
            for (const rules of perColumnRules) {
                const rule = rules.get(ruleId);
                if (!rule) continue;
                if (title === ruleId) { title = rule.title; titleLang = rule.titleLang || null; }
                if (!wcag) wcag = rule.wcag;
                severity = moreSevere(severity, rule.severity);
                for (const c of (Array.isArray(rule.rgaa) ? rule.rgaa : [])) if (!rgaa.includes(c)) rgaa.push(c);
                if (rule.standards) standards = diffApi.mergeStandards(standards || [], rule.standards);
            }
            rgaa.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            // Distinct pages per column, and the reading taken where the rule
            // is at its worst, because that is the column that says what kind of
            // problem it is.
            const pages = perColumnRules.map((rules) => pagesOf(rules.get(ruleId)));
            const peak = counts.indexOf(Math.max(...counts));
            const analyzedAtPeak = (context.analyzed || [])[peak] || 0;

            const row = {
                ruleId, title, titleLang, severity, wcag, rgaa,
                ...(standards ? { standards } : {}),
                counts, present,
                total: counts.reduce((a, b) => a + b, 0),
                columns: present.filter(Boolean).length,
                pages,
                reach: {
                    pages: pages[peak] || 0,
                    of: analyzedAtPeak,
                    column: peak,
                    scope: scopeOf(pages[peak], analyzedAtPeak),
                },
            };

            if (mode === 'matrix') {
                row.category = matrixCategory(present);
            } else {
                row.lifecycle = lifecycle(present);
                row.category = trendCategory(present, row.lifecycle);
                row.direction = row.category === 'persistent' ? countTrend(counts) : null;
                row.delta = counts[counts.length - 1] - counts[0];
                row.age = ageOf(present, context.timestamps || [], context.orderBy);
            }
            rows.push(row);
        }

        rows.sort((x, y) =>
            sevRank(x.severity) - sevRank(y.severity)
            || y.total - x.total
            || x.ruleId.localeCompare(y.ruleId));
        return rows;
    }

    // ---- verdicts ----------------------------------------------------------

    function steps(columns) {
        let biggest = null;
        let rise = null;
        for (let i = 1; i < columns.length; i += 1) {
            const move = columns[i].stats.failures - columns[i - 1].stats.failures;
            if (!biggest || Math.abs(move) > Math.abs(biggest.move)) biggest = { from: i - 1, to: i, move };
            // The largest single regression, tracked separately: it is worth
            // flagging even in a window that improved overall.
            if (move > 0 && (!rise || move > rise.move)) rise = { from: i - 1, to: i, move };
        }
        return { biggest, rise };
    }

    // How far back the window reaches. Elapsed time reads better than a column
    // count ("four months ago" rather than "six runs ago"), but it is only used
    // when dates ordered the series: a timestamp records when a scan ran, not
    // which version it covered.
    function humanDuration(ms) {
        const minutes = ms / 60000;
        if (minutes < 90) return `${Math.max(1, Math.round(minutes))} minutes`;

        const hours = ms / 3600000;
        if (hours < 24) return hours < 1.5 ? 'an hour' : `${Math.round(hours)} hours`;

        const days = ms / 86400000;
        if (days < 14) return days < 1.5 ? 'a day' : `${Math.round(days)} days`;
        if (days < 14) return `${Math.round(days)} days`;
        if (days < 70) {
            const weeks = Math.round(days / 7);
            return weeks === 1 ? 'a week' : `${weeks} weeks`;
        }
        if (days < 730) {
            const months = Math.round(days / 30.44);
            return months === 1 ? 'a month' : `${months} months`;
        }
        const years = Math.round(days / 365.25);
        return years === 1 ? 'a year' : `${years} years`;
    }

    function describeSpan(columns, unit, orderBy) {
        const from = columns[0].identity.timestamp;
        const to = columns[columns.length - 1].identity.timestamp;

        if (orderBy === 'time' && from && to) {
            const ms = new Date(to).getTime() - new Date(from).getTime();
            if (Number.isFinite(ms) && ms > 0) return humanDuration(ms);
        }

        // Steps between the ends, not the column count: six columns span five
        // steps.
        const steps = Math.max(1, columns.length - 1);
        return `${steps} ${steps === 1 ? unit.one : unit.many}`;
    }

    // The longest-standing problem still failing. "Broken since March" is a
    // number a reader acts on; "present in 6 of 6 runs" is one they have to
    // translate first.
    function oldestOpen(rows) {
        const open = rows.filter((row) => row.age && row.counts[row.counts.length - 1] > 0);
        if (!open.length) return null;
        return open.slice().sort((a, b) => (
            a.age.sinceIndex - b.age.sinceIndex
            || sevRank(a.severity) - sevRank(b.severity)
            || b.counts[b.counts.length - 1] - a.counts[a.counts.length - 1]
        ))[0];
    }

    function trendVerdict(columns, rows, unit, orderBy, extras = {}) {
        const first = columns[0].stats.failures;
        const last = columns[columns.length - 1].stats.failures;
        const net = last - first;

        const failures = columns.map((c) => c.stats.failures);
        const bestIndex = failures.indexOf(Math.min(...failures));
        const worstIndex = failures.indexOf(Math.max(...failures));
        const fromBest = last - failures[bestIndex];

        const count = (cat) => rows.filter((r) => r.category === cat).length;
        const flapping = count('flapping');

        const tone = net < 0 ? 'good' : (net > 0 ? 'bad' : 'neutral');
        const headline = net < 0 ? 'trending down' : (net > 0 ? 'trending up' : 'flat');
        const badge = net < 0 ? 'Net improvement over the window'
            : (net > 0 ? 'Net regression over the window' : 'No net change over the window');

        const span = describeSpan(columns, unit, orderBy);
        const lead = `${Math.abs(net)} ${net <= 0 ? 'fewer' : 'more'} failures than ${span} ago. `
            + `${count('resolved')} ${count('resolved') === 1 ? 'rule was' : 'rules were'} fixed and stayed fixed, `
            + `${count('new')} appeared and ${count('new') === 1 ? 'has' : 'have'} not gone away, `
            + `${count('persistent')} never left`
            + (flapping ? `, and ${flapping} ${flapping === 1 ? 'keeps' : 'keep'} coming back.` : '.');

        return {
            mode: 'trend', tone, badge, headline, lead, net, span,
            resolved: count('resolved'), added: count('new'),
            persistent: count('persistent'), flapping,
            bestIndex, worstIndex, fromBest,
            step: steps(columns).biggest,
            rise: steps(columns).rise,
            // Gross movement, not the net one: the work done and the ground
            // lost are two numbers, and a single delta shows neither.
            churn: extras.flow ? extras.flow.totals : null,
            oldest: oldestOpen(rows),
            movedToReview: (extras.review || []).length,
        };
    }

    function matrixVerdict(columns, rows) {
        const universal = rows.filter((r) => r.category === 'universal');
        const shared = rows.filter((r) => r.category === 'shared');
        const unique = rows.filter((r) => r.category === 'unique');

        const uniqueByColumn = columns.map((_, i) => unique.filter((r) => r.present[i]).length);
        const outlier = uniqueByColumn.indexOf(Math.max(...uniqueByColumn));
        const failures = columns.map((c) => c.stats.failures);
        const cleanest = failures.indexOf(Math.min(...failures));

        const universalOcc = universal.reduce((total, r) => total + Math.max(...r.counts), 0);
        // Of the shared backlog, how much of it is spread across pages rather
        // than sitting in one place: the part a component fix would move.
        const universalSystemic = universal.filter((r) => r.reach && r.reach.scope === 'systemic').length;
        const spread = Math.max(...failures) - Math.min(...failures);

        return {
            mode: 'matrix', tone: 'neutral',
            badge: 'Standings · no winner declared',
            headline: universal.length
                ? `${universal.length} ${universal.length === 1 ? 'rule fails' : 'rules fail'} everywhere`
                : 'No rule fails on every variant',
            lead: `${universal.length} ${universal.length === 1 ? 'rule' : 'rules'} fail on all `
                + `${columns.length} variants (~${universalOcc} failures — fix once, wins everywhere), `
                + `${shared.length} fail on some, and ${unique.length} on exactly one.`,
            universal: universal.length, shared: shared.length, unique: unique.length,
            universalOcc, universalSystemic, spread, uniqueByColumn, outlier, cleanest,
            worst: failures.indexOf(Math.max(...failures)),
        };
    }

    // ---- narrative ---------------------------------------------------------

    // One sentence per thing worth saying, and only when the numbers say it.
    // Everything here is derived from the matrix: no second source of truth,
    // and nothing that reads as a claim the figures do not support.
    function trendNarrative(columns, rows, verdict, gate, ruleLabel, unit, extras = {}) {
        const out = [];
        const step = verdict.step;
        if (step && step.move !== 0) {
            const dir = step.move < 0 ? 'dropped' : 'rose';
            out.push(`The window is not a smooth line. Failures ${dir} by ${Math.abs(step.move)} between `
                + `${columns[step.from].label} and ${columns[step.to].label}`
                + (verdict.rise && verdict.rise.move > 0 && step.move < 0
                    ? `, then gave ${verdict.rise.move} back between ${columns[verdict.rise.from].label} `
                      + `and ${columns[verdict.rise.to].label}.`
                    : ' — that step is where to look first.'));
        }
        const flappers = rows.filter((r) => r.category === 'flapping');
        if (flappers.length) {
            out.push(`${flappers.length === 1 ? 'One problem comes and goes' : `${flappers.length} problems come and go`} across the window `
                + `(${flappers.slice(0, 3).map(ruleLabel).join(', ')}). Comparing any two ${unit.many} would have called `
                + `${flappers.length === 1 ? 'it' : 'each of them'} either fixed or new, depending on which two runs were loaded.`);
        }
        if (verdict.fromBest > 0) {
            out.push(`The latest ${unit.one} is ${verdict.fromBest} failures worse than the best ${unit.one} in the window `
                + `(${columns[verdict.bestIndex].label}), even though it is better than where the window started.`);
        }
        // Gross movement. A net figure is the difference between two numbers
        // people worked hard on, and it credits neither.
        const churn = verdict.churn;
        if (churn && (churn.fixed || churn.introduced)) {
            out.push(`Across the window ${churn.fixed} ${churn.fixed === 1 ? 'failure was' : 'failures were'} `
                + `cleared and ${churn.introduced} ${churn.introduced === 1 ? 'was' : 'were'} introduced`
                + (churn.introduced && churn.fixed
                    ? `. The net figure above is the difference between those two, so a quiet window is not `
                      + `necessarily an idle one.`
                    : '.'));
        }

        // Named in the view rather than here: the age is the engine's to
        // compute, the rule's name is the reader's language and belongs to
        // whoever is doing the reading.
        const oldest = verdict.oldest;
        if (oldest && oldest.age && oldest.age.runs > 1) {
            const since = columns[oldest.age.sinceIndex].label;
            out.push(`The longest-standing problem still open has been failing without a break since ${since}`
                + `${oldest.age.fromStart ? `, the first ${unit.one} in the window, so possibly longer than that` : ''}. `
                + `Age is the argument for it, not size: it has survived every ${unit.one} since.`);
        }

        // The movement a failure count reads as a fix.
        const review = extras.review || [];
        if (review.length) {
            out.push(`${review.length} ${review.length === 1 ? 'rule' : 'rules'} stopped failing but now `
                + `${review.length === 1 ? 'needs' : 'need'} a human to confirm what happened `
                + `(${review.slice(0, 3).map(ruleLabel).join(', ')}). That is not the same as fixed, and a `
                + `failure count on its own cannot tell the two apart.`);
        }

        // A run that did less found less. Said before the counts are read, not
        // after.
        const unhealthy = columns.filter((c) => c.health && !c.health.ok);
        if (unhealthy.length) {
            const detail = unhealthy.length === 1
                ? `${unhealthy[0].label} did not complete cleanly: ${unhealthy[0].health.reasons[0] || 'the run reported a problem'}`
                : `${unhealthy.length} ${unit.many} did not complete cleanly `
                  + `(${unhealthy.slice(0, 2).map((c) => `${c.label}: ${c.health.reasons[0] || 'a problem was reported'}`).join('; ')})`;
            out.push(`${detail}. A ${unit.one} that covered less had less to find, so its lower count is `
                + `not an improvement.`);
        }

        if (!gate.comparable) {
            // Spelled out while the window is short enough to read; past that
            // the range says the same thing without a wall of numbers.
            const spread = gate.pages.length <= 8
                ? `${gate.pages.join(' → ')}`
                : `${Math.min(...gate.pages)} to ${Math.max(...gate.pages)}`;
            out.push(`Pages analyzed changed across the window (${spread}), so the absolute counts are `
                + `context, not verdict; read the direction from the rule categories.`);
        }
        return out;
    }

    function matrixNarrative(columns, rows, verdict, ruleLabel) {
        const out = [];
        const universal = rows.filter((r) => r.category === 'universal');
        if (universal.length) {
            out.push(`Shared backlog: ${universal.slice(0, 3).map(ruleLabel).join(', ')}`
                + `${universal.length > 3 ? ', …' : ''}. These are design-system-level, not variant-level — `
                + `one fix moves every column.`);
        }
        const outlierUnique = rows.filter((r) => r.category === 'unique' && r.present[verdict.outlier]);
        if (outlierUnique.length) {
            out.push(`${columns[verdict.outlier].label} carries ${outlierUnique.length} failure`
                + `${outlierUnique.length === 1 ? '' : 's'} no other variant has `
                + `(${outlierUnique.slice(0, 3).map(ruleLabel).join(', ')}) — that is a variant-specific bug, `
                + `not a shared one.`);
        }
        const shared = rows.filter((r) => r.category === 'shared');
        if (shared.length) {
            out.push(`${shared.length} ${shared.length === 1 ? 'rule fails' : 'rules fail'} on a subset — worth reading `
                + `which columns they share, because the subset usually names the cause (a breakpoint, a theme, a locale).`);
        }

        // Where the shared backlog lives. A systemic rule is a component, and
        // one component fix moves every column at once.
        const systemic = universal.filter((r) => r.reach && r.reach.scope === 'systemic');
        if (systemic.length) {
            out.push(`${systemic.length} of the shared ${systemic.length === 1 ? 'problem reaches' : 'problems reach'} most of the `
                + `pages each variant covered, so ${systemic.length === 1 ? 'it lives' : 'they live'} in something every page uses `
                + `rather than in one screen. One component, not one page, is the unit of work.`);
        }

        const unhealthy = columns.filter((c) => c.health && !c.health.ok);
        if (unhealthy.length) {
            out.push(`${unhealthy.map((c) => c.label).join(', ')} did not complete cleanly `
                + `(${unhealthy[0].health.reasons[0] || 'the run reported a problem'}). A variant that covered less `
                + `looks cleaner than it is, so read those columns as incomplete rather than better.`);
        }
        return out;
    }

    // The rule vocabulary, applied to criteria. Presence here is "does this
    // criterion fail in this column", which is the same shape as a rule's
    // presence signature, so the same two classifiers do the work.
    function classifyConformance(rows, mode) {
        return rows.map((row) => {
            if (mode === 'matrix') return { ...row, category: matrixCategory(row.failing) };
            const life = lifecycle(row.failing);
            return { ...row, lifecycle: life, category: trendCategory(row.failing, life) };
        });
    }

    // Reports in one set can come from different exports, and a criterion read
    // off findings is a narrower claim than one the runner concluded. Mixing
    // them is allowed; hiding that they are mixed is not.
    function conformanceSource(columns) {
        const kinds = new Set(columns.map((c) => c.conformance.source).filter((s) => s !== 'none'));
        if (!kinds.size) return 'none';
        if (kinds.size === 1) return Array.from(kinds)[0];
        return 'mixed';
    }

    // ---- public API --------------------------------------------------------

    /**
     * Compare N reports at once.
     *
     * @param {object[]} reports  two or more parsed reports
     * @param {{mode?: 'trend'|'matrix', order?: 'time'|'given', ruleLabel?: (row) => string,
     *          fallbackLabels?: string[], labels?: string[], unit?: 'run'|'version'}} options
     * @returns {object} columns, rows (the matrix), verdict, narrative, gate
     */
    // Room before failing across the columns: for each measuring rule, the
    // pass with the least room in each report (null where the rule passed
    // nowhere), and, in a timeline, whether the room shrank between the
    // first and the last column that measured it. A change smaller than
    // what is shown (a hundredth of a ratio, half a pixel) reads as the same.
    function seriesMargins(reports, mode) {
        if (typeof collectTightestMargins !== 'function') return [];
        const perColumn = reports.map((r) => collectTightestMargins(r));
        const failing = typeof failingOccurrencesByCheck === 'function' ? reports.map((r) => failingOccurrencesByCheck(r)) : null;
        const ids = Array.from(new Set(perColumn.flatMap((m) => Array.from(m.keys()))));
        const rank = { failsMore: 0, closer: 1, same: 2, further: 3 };
        return ids.map((ruleId) => {
            const cells = perColumn.map((m) => m.get(ruleId) || null);
            const present = cells.filter(Boolean);
            const latest = present[present.length - 1];
            let change = null;
            if (mode !== 'matrix' && present.length >= 2) {
                const delta = latest.headroom - present[0].headroom;
                const step = latest.unit === 'px' ? 0.5 : 0.01;
                change = Math.abs(delta) < step ? 'same' : (delta < 0 ? 'closer' : 'further');
            }
            // Elements that passed and now fail leave another element as the
            // closest pass, whose room says nothing about the change.
            if (mode !== 'matrix' && failing
                && (failing[failing.length - 1].get(ruleId) || 0) > (failing[0].get(ruleId) || 0)) {
                change = 'failsMore';
            }
            return {
                ruleId, title: latest.title, unit: latest.unit, limit: latest.limit, threshold: latest.threshold,
                cells, change,
                leastRoom: Math.min(...present.map((m) => m.headroom)),
            };
        }).sort((a, b) => ((rank[a.change] ?? 1) - (rank[b.change] ?? 1))
            || (a.leastRoom - b.leastRoom)
            || a.ruleId.localeCompare(b.ruleId));
    }

    function diffReportSeries(reports, {
        mode = 'trend', order, ruleLabel, fallbackLabels, labels, unit, document,
    } = {}) {
        const list = Array.isArray(reports) ? reports.filter(Boolean) : [];
        if (list.length < 2) throw new Error('diffReportSeries: at least two reports are required');

        // Labels belong to their report, so they travel through the sort with
        // it rather than being applied to sorted positions.
        const names = Array.isArray(fallbackLabels) ? fallbackLabels : [];
        const given = Array.isArray(labels) ? labels : [];
        const tagged = list.map((report, i) => ({
            report, fallback: names[i] || null, override: given[i] || null,
        }));

        // The noun the sentences count in: releases count in versions.
        const counted = unit === 'version'
            ? { one: 'version', many: 'versions' }
            : { one: 'run', many: 'runs' };

        // Column order. A timeline defaults to the reports' timestamps; variants
        // have no inherent order, so they keep the order given. Either default
        // can be overridden: the caller may have its own arrangement, and
        // undated reports make a date sort meaningless.
        const orderBy = order === 'given' || order === 'time'
            ? order
            : (mode === 'trend' ? 'time' : 'given');
        const orderedPairs = orderBy === 'time'
            ? tagged.slice().sort((x, y) => compareByTime(x.report, y.report))
            : tagged.slice();
        const ordered = orderedPairs.map((pair) => pair.report);

        const perColumnRules = ordered.map((r) => collectFailingRules(r));
        // The same ingest again for the checks that concluded nothing. Cheap
        // (one more linear pass) and it closes the blind spot a failure-only
        // reading has: fail -> cantTell looks exactly like fail -> fixed.
        const perColumnReview = ordered.map((r) => collectFailingRules(r, { outcome: 'cantTell' }));
        const identities = ordered.map((r) => reportIdentity(r));
        const { labels: columnNames, dated } = columnLabels(identities, mode, orderBy, {
            fallbacks: orderedPairs.map((p) => p.fallback),
            overrides: orderedPairs.map((p) => p.override),
        });
        const columns = ordered.map((report, i) => ({
            index: i,
            identity: identities[i],
            label: columnNames[i],
            // The label without the day added to tell it from a report of the
            // same name, for a place that shows the date beside it; else null.
            undatedLabel: dated[i],
            stats: columnStats(report, perColumnRules[i], perColumnReview[i]),
            // Whether the run behind this column finished what it set out to do.
            health: columnHealth(report),
            // What the run concluded about WCAG itself, criterion by criterion.
            conformance: readConformance(report),
        }));

        // N-gating (design notes §5, generalized): absolute counts are only
        // comparable across columns that analyzed the same number of scans.
        const pages = columns.map((c) => c.stats.pages);
        const gate = {
            pages,
            comparable: pages.every((p) => p === pages[0]),
            // Two further reasons a column may not be readable at face value,
            // kept beside the page gate because a reader weighs them together.
            healthy: columns.every((c) => c.health.ok),
            degraded: columns.filter((c) => !c.health.ok).map((c) => c.index),
            scored: columns.every((c) => c.stats.score != null),
        };

        const target = sharedTarget(columns.map((c) => c.conformance));

        const rows = buildMatrix(perColumnRules, mode, {
            analyzed: columns.map((c) => c.stats.analyzed),
            timestamps: identities.map((identity) => identity.timestamp),
            orderBy,
        });

        // Trend-only readings: both need an order to mean anything.
        const flow = mode === 'matrix' ? null : buildFlow(columns, rows);
        const review = mode === 'matrix'
            ? []
            : movedToReview(rows, perColumnReview.map((rules) => new Set(rules.keys())));

        const verdict = mode === 'matrix'
            ? matrixVerdict(columns, rows)
            : trendVerdict(columns, rows, counted, orderBy, { flow, review });

        const groups = {};
        for (const row of rows) (groups[row.category] = groups[row.category] || []).push(row);

        // How a rule is named in prose is a presentation choice: the CLI wants
        // the engine's own title, the dashboard wants the plain-language one.
        const nameRule = typeof ruleLabel === 'function' ? ruleLabel : ((row) => row.title);

        // What this comparison is, as a document: a typed title and note, plus
        // what can be derived about the set. It travels with the rendered view
        // into the exported file, which is where it matters.
        const doc = describeComparison(ordered, {
            ...(document || {}),
            // Columns are variants in matrix mode whatever the sentences count
            // in, and the header names the columns.
            unit: mode === 'matrix' ? { one: 'variant', many: 'variants' } : counted,
            framing: mode === 'matrix' ? 'matrix' : (orderBy === 'time' ? 'trend' : 'versions'),
            ordered: orderBy === 'time',
        });

        return {
            mode, columns, rows, groups, gate, verdict, document: doc,
            // What decided the column order, so the view can state it, and
            // where each column came from in the list given (indices), so a
            // caller holding the reports can line them up with the columns.
            ordering: {
                by: orderBy,
                undated: orderBy === 'time' ? countUndated(list) : 0,
                source: orderedPairs.map((pair) => tagged.indexOf(pair)),
            },
            unit: counted,
            severityOrder: SEV_ORDER,
            // Room before failing, rule by rule and column by column; empty
            // when no report has margins (other engines, or an older surea11y).
            margins: seriesMargins(ordered, mode),
            // Rules that stopped failing and started needing a human instead.
            // Empty in matrix mode, where "latest" means nothing.
            review,
            // Fixes and regressions per step. Null in matrix mode for the same
            // reason: unordered columns have no steps between them.
            flow,
            // WCAG criterion by column, in the standard's own vocabulary, which is
            // the one an audit, a VPAT and a deadline are written in.
            conformance: {
                // Criteria are classified with the same vocabulary as rules:
                // a reader who has learned "keeps coming back" once should not
                // have to learn a second word for it one section later.
                // EN 301 549 clauses follow the standard every scan in the set
                // checked against, as they do in each report's own tables.
                rows: classifyConformance(conformanceMatrix(columns.map((c) => c.conformance)), mode)
                    .map((row) => ({ ...row, en301549: en301549ForTarget(row.en301549, target) })),
                // 'coverage' when the reports carried per-criterion verdicts,
                // 'derived' when they had to be read off the findings, 'mixed'
                // when the set does both, which is worth saying, because the
                // two are not measured the same way.
                source: conformanceSource(columns),
            },
            narrative: mode === 'matrix'
                ? matrixNarrative(columns, rows, verdict, nameRule)
                : trendNarrative(columns, rows, verdict, gate, nameRule, counted, { review }),
        };
    }

    /**
     * Drill down from the series to the shipped two-report view. Occurrence
     * pairing is only ever claimed here, between two named columns.
     */
    function pairFromSeries(reports, i, j, { mode = 'evolution' } = {}) {
        return diffReports(reports[i], reports[j], { mode });
    }

    return { diffReportSeries, pairFromSeries, orderReportsByTime };
}));
