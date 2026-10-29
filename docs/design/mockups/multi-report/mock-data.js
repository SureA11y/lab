'use strict';

/**
 * Mock data for the multi-report comparison mockup.
 *
 * These are real report payloads in the shape the app exports and the diff
 * engine ingests (scans[].canonical.findings + metrics.a11ySummary.scores), so
 * the mockup is rendered by running the actual engine over them — nothing in
 * the picture is drawn by hand.
 *
 * Rule ids, titles, severities and WCAG refs are taken from the engine's own
 * vocabulary (a11y-dumps/result-a11y-core-*.json), and the occurrence shape
 * matches what the scanner emits. The counts are invented to tell a legible
 * story; everything else is authentic.
 */

const RULES = {
    'a11ycore-contrast-minimum': {
        title: 'Text meets minimum color contrast (AA)', severity: 'serious', wcag: '1.4.3',
        pages: ['/accounts', '/payments', '/cards', '/settings'],
    },
    'a11ycore-css-hidden-focus': {
        title: 'Focusable elements must not be visually hidden', severity: 'serious', wcag: '2.4.7',
        pages: ['/', '/accounts'],
    },
    'a11ycore-form-control-programmatic-label': {
        title: 'Form controls must have a programmatic label', severity: 'critical', wcag: '1.3.1',
        pages: ['/payments', '/settings'],
    },
    'a11ycore-svg-image-text-alternative-present': {
        title: 'SVG <image> must have a text alternative', severity: 'serious', wcag: '1.1.1',
        pages: ['/', '/accounts'],
    },
    'a11ycore-target-size-minimum': {
        title: 'Touch targets must be at least 24 by 24 CSS pixels', severity: 'moderate', wcag: '2.5.8',
        pages: ['/payments', '/cards'],
    },
    'a11ycore-aria-hidden-focus': {
        title: 'Focusable element inside aria-hidden content', severity: 'serious', wcag: '4.1.2',
        pages: ['/payments'],
    },
    'a11ycore-label-in-name': {
        title: 'Visible label must be part of the accessible name', severity: 'moderate', wcag: '2.5.3',
        pages: ['/settings'],
    },
    'a11ycore-links-noopener': {
        title: 'Links opening a new window must say so', severity: 'minor', wcag: '3.2.5',
        pages: ['/', '/cards'],
    },
    'a11ycore-video-poster-text-alternative-present': {
        title: '<video> poster must have a text alternative', severity: 'serious', wcag: '1.1.1',
        pages: ['/'],
    },
    'a11ycore-button-name-present': {
        title: 'Buttons must have an accessible name', severity: 'critical', wcag: '4.1.2',
        pages: ['/accounts', '/payments'],
    },
    'a11ycore-canvas-text-alternative-present': {
        title: '<canvas> must have a text alternative', severity: 'moderate', wcag: '1.1.1',
        pages: ['/accounts'],
    },
    'a11ycore-contrast-nontext': {
        title: 'Interface components must meet non-text contrast', severity: 'serious', wcag: '1.4.11',
        pages: ['/', '/payments'],
    },
    'a11ycore-reflow-no-horizontal-scroll': {
        title: 'Content must reflow without horizontal scrolling', severity: 'moderate', wcag: '1.4.10',
        pages: ['/cards'],
    },
};

const HOST = 'https://banking.example.com';

// Selector paths of the kind the scanner actually emits, cycled so an
// occurrence keeps the same key across runs where it survives.
const TARGETS = [
    '.app-shell > main > section:nth-of-type(2) > div > p',
    'button.primary-action',
    '#tx-list > li:nth-of-type(3) > a',
    '.card-grid > article:nth-of-type(1) > footer > span',
    'input#iban',
    '.modal[data-state="open"] .close',
    'nav.tab-bar > button:nth-of-type(4)',
    '.summary-tile .delta',
    'a.help-link',
    'svg.logo > image',
];

function occurrences(ruleId, count) {
    const rule = RULES[ruleId];
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const page = rule.pages[i % rule.pages.length];
        out.push({
            // Occurrence identity is page path + selector, so the index keeps
            // instances distinct the way distinct elements would.
            pageUrl: `${HOST}${page}`,
            target: [`${TARGETS[i % TARGETS.length]}:nth-of-type(${i + 1})`],
            html: `<!-- ${ruleId} instance ${i + 1} -->`,
        });
    }
    return out;
}

// Levels as the standard sets them, so the criterion table can group by
// conformance level the way a real payload lets it.
const LEVELS = {
    '1.1.1': 'A', '1.3.1': 'A', '1.4.3': 'AA', '1.4.10': 'AA', '1.4.11': 'AA',
    '2.4.7': 'AA', '2.5.3': 'A', '2.5.8': 'AA', '3.2.5': 'AAA', '4.1.2': 'A',
};

function finding(ruleId, count, outcome = 'fail') {
    const rule = RULES[ruleId];
    return {
        id: ruleId, ruleId, title: rule.title, outcome, severity: rule.severity,
        wcag: { sc: [rule.wcag], scNormative: [rule.wcag] },
        standards: {
            normativeMappings: [{
                standard: 'WCAG', version: '2.2', requirement: rule.wcag,
                conformanceLevel: LEVELS[rule.wcag] || 'AA',
            }],
        },
        occurrences: outcome === 'fail' ? occurrences(ruleId, count) : occurrences(ruleId, count).slice(0, count),
    };
}

// The criterion verdicts a real run writes onto each scan. Without these the
// comparison falls back to reading criteria off the findings, which can only
// speak about criteria some rule reached. This is what a payload from the
// runner actually carries, so the mockup exercises the same path the app does.
const PASSING_CRITERIA = ['1.3.2', '2.1.1', '2.4.2', '2.4.3', '3.1.1', '3.3.2', '4.1.3'];

function coverageSummaryFor(findings) {
    const bySc = new Map();

    for (const f of findings) {
        const sc = f.wcag.sc[0];
        const entry = bySc.get(sc) || {
            sc, level: LEVELS[sc] || 'AA', status: 'supports', verification: 'verified',
            checks: { evaluated: 1, cantTell: 0 }, failCount: 0, occurrenceCount: 0, ruleIds: [],
        };
        if (f.outcome === 'fail') {
            entry.status = 'doesNotSupport';
            entry.failCount += 1;
            entry.occurrenceCount += f.occurrences.length;
        } else if (f.outcome === 'cantTell' && entry.status !== 'doesNotSupport') {
            entry.status = 'needsReview';
            entry.checks.cantTell += 1;
        }
        entry.ruleIds.push(f.ruleId);
        bySc.set(sc, entry);
    }

    for (const sc of PASSING_CRITERIA) {
        if (bySc.has(sc)) continue;
        bySc.set(sc, {
            sc, level: LEVELS[sc] || 'A', status: 'supports', verification: 'verified',
            checks: { evaluated: 1, cantTell: 0 }, failCount: 0, occurrenceCount: 0, ruleIds: [],
        });
    }

    return { criteria: Array.from(bySc.values()) };
}

// Spread a rule's occurrences over the run's scans, so a report with more
// scans looks like a run that covered more pages.
// Per-page scores around the run's mean, deterministic and deliberately
// lopsided: the worst page sits well below the average, which is the spread a
// single headline number hides.
function pageScore(mean, index, total) {
    const offset = Math.round((index - (total - 1) / 2) * (24 / Math.max(1, total - 1)));
    return Math.max(0, Math.min(100, Math.round(mean + offset)));
}

function buildReport({
    runId, timestamp, scenarioName, counts, pages, score, confidence, scanTags,
    review, skipped = 0, failedActions = [],
}) {
    const findings = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([ruleId, n]) => finding(ruleId, n));

    // Checks that concluded nothing. Kept separate from the failures, because
    // that is exactly how the payload carries them and how the comparison has
    // to read them.
    const reviewFindings = Object.entries(review || {})
        .filter(([, n]) => n > 0)
        .map(([ruleId, n]) => finding(ruleId, n, 'cantTell'));

    const all = [...findings, ...reviewFindings];
    const coverageSummary = coverageSummaryFor(all);

    const scans = [];
    for (let i = 0; i < pages; i += 1) {
        const isSkipped = i >= pages - skipped;
        scans.push({
            id: `scan-${i + 1}`,
            url: `${HOST}${i === 0 ? '/' : '/step-' + i}`,
            scanTags: scanTags || [],
            includedInReport: true,
            ...(isSkipped
                ? { skipped: true, skipInfo: { reason: 'page exceeded the DOM size threshold' } }
                : {}),
            summary: isSkipped ? {} : { score: pageScore(score, i, pages) },
            // All findings sit on the first scan; the diff merges by rule id
            // across scans, so the rollup is identical either way.
            canonical: { findings: i === 0 ? all : [] },
            metrics: { coverageSummary: i === 0 ? coverageSummary : { criteria: [] } },
        });
    }

    return {
        runId, timestamp, scenarioName, url: `${HOST}/`,
        scans,
        ...(failedActions.length
            ? { actionResults: failedActions.map((label, i) => ({ type: 'click', status: 'failed', label, index: i })) }
            : {}),
        metrics: {
            a11ySummary: {
                scores: {
                    avgPageAccessibility: score,
                    confidence,
                    evaluationState: 'evaluated',
                },
                scanCoverage: { scansAnalyzed: pages - skipped },
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Trend: six nightly runs of one scenario over ten weeks.
// ---------------------------------------------------------------------------

const TREND_COUNTS = {
    // rule                                      r1  r2  r3  r4  r5  r6
    'a11ycore-contrast-minimum':                 [24, 24, 19, 12,  9,  6],
    'a11ycore-css-hidden-focus':                 [ 7,  7,  7,  7,  7,  7],
    'a11ycore-form-control-programmatic-label':  [11, 11,  6,  0,  0,  0],
    'a11ycore-svg-image-text-alternative-present':[3,  3,  3,  0,  0,  0],
    'a11ycore-button-name-present':              [ 6,  6,  0,  0,  0,  0],
    'a11ycore-label-in-name':                    [ 2,  2,  2,  2,  0,  0],
    'a11ycore-links-noopener':                   [ 5,  5,  5,  5,  5,  5],
    'a11ycore-video-poster-text-alternative-present': [1, 1, 1, 1, 1, 1],
    'a11ycore-aria-hidden-focus':                [ 4,  0,  4,  0,  5,  0],
    'a11ycore-canvas-text-alternative-present':  [ 0,  0,  2,  2,  2,  2],
    'a11ycore-target-size-minimum':              [ 0,  0,  0,  0,  6,  6],
};

// Scores are per-page means, so they arrive with long decimal tails — kept
// here as the scanner produces them, since rounding is the view's job.
// Checks that could not decide, run by run. The Jun 30 rise is the case the
// feature exists to catch: form labels stop failing there, and a failures-only
// reading calls that a fix when the check has only stopped being sure.
const TREND_REVIEW = {
    'a11ycore-video-poster-text-alternative-present': [1, 1, 1, 1, 1, 1],
    'a11ycore-form-control-programmatic-label':       [0, 0, 3, 3, 3, 3],
    'a11ycore-canvas-text-alternative-present':       [0, 2, 2, 0, 0, 0],
};

// One run in the window did not finish what it was asked to: two scans hit the
// size cap and an action failed. Its counts sit low for a reason that is not an
// improvement, and nothing in the findings themselves can say so.
const TREND_RUNS = [
    { label: 'Jun 2',  timestamp: '2026-06-02T02:15:00Z', pages: 7, score: 62.142857142857146, confidence: 88 },
    { label: 'Jun 16', timestamp: '2026-06-16T02:15:00Z', pages: 7, score: 63.4054945054945, confidence: 88 },
    { label: 'Jun 30', timestamp: '2026-06-30T02:15:00Z', pages: 7, score: 68.28571428571429, confidence: 90.5 },
    { label: 'Jul 14', timestamp: '2026-07-14T02:15:00Z', pages: 7, score: 76.80890052356021, confidence: 90.5,
        skipped: 2, failedActions: ['open the payments drawer'] },
    { label: 'Jul 28', timestamp: '2026-07-28T02:15:00Z', pages: 7, score: 71.33333333333333, confidence: 89.25 },
    { label: 'Aug 11', timestamp: '2026-08-11T02:15:00Z', pages: 9, score: 78.90476190476191, confidence: 84.75 },
];

function trendReports() {
    return TREND_RUNS.map((run, i) => buildReport({
        runId: `run-${i + 1}`,
        timestamp: run.timestamp,
        scenarioName: `Web Banking · ${run.label}`,
        counts: Object.fromEntries(Object.entries(TREND_COUNTS).map(([id, series]) => [id, series[i]])),
        review: Object.fromEntries(Object.entries(TREND_REVIEW).map(([id, series]) => [id, series[i]])),
        pages: run.pages,
        score: run.score,
        confidence: run.confidence,
        skipped: run.skipped || 0,
        failedActions: run.failedActions || [],
    }));
}

// ---------------------------------------------------------------------------
// Matrix: one release, exported four times filtered by scan tag.
// ---------------------------------------------------------------------------

const MATRIX_COLUMNS = [
    { label: 'Desktop', tag: 'desktop', pages: 7, score: 78.90476190476191, confidence: 86 },
    { label: 'Tablet', tag: 'tablet', pages: 7, score: 74.28571428571429, confidence: 86 },
    { label: 'Mobile', tag: 'mobile', pages: 7, score: 66.14285714285714, confidence: 85.5 },
    { label: 'High contrast', tag: 'high-contrast', pages: 7, score: 72.66666666666667, confidence: 84 },
];

const MATRIX_COUNTS = {
    // rule                                       desk tab mob  hc
    'a11ycore-css-hidden-focus':                 [  7,  7,  7,  7],
    'a11ycore-form-control-programmatic-label':  [  2,  2,  2,  2],
    'a11ycore-links-noopener':                   [  5,  5,  5,  5],
    'a11ycore-video-poster-text-alternative-present': [1, 1, 1, 1],
    'a11ycore-contrast-minimum':                 [  4,  4, 12,  0],
    'a11ycore-target-size-minimum':              [  0,  5,  9,  0],
    'a11ycore-aria-hidden-focus':                [  0,  3,  3,  0],
    'a11ycore-reflow-no-horizontal-scroll':      [  0,  0,  4,  0],
    'a11ycore-contrast-nontext':                 [  0,  0,  0,  6],
};

const MATRIX_REVIEW = {
    // rule                                       desk tab mob  hc
    'a11ycore-video-poster-text-alternative-present': [1, 1, 1, 1],
    'a11ycore-canvas-text-alternative-present':       [0, 0, 2, 0],
};

function matrixReports() {
    return MATRIX_COLUMNS.map((col, i) => buildReport({
        runId: `release-3.4-${col.tag}`,
        timestamp: '2026-08-11T02:15:00Z',
        scenarioName: col.label,
        counts: Object.fromEntries(Object.entries(MATRIX_COUNTS).map(([id, row]) => [id, row[i]])),
        review: Object.fromEntries(Object.entries(MATRIX_REVIEW).map(([id, row]) => [id, row[i]])),
        pages: col.pages,
        score: col.score,
        confidence: col.confidence,
        scanTags: [col.tag],
    }));
}

// ---------------------------------------------------------------------------
// Scale: the same scenario run nightly for a month, to check the views hold
// when the series is long rather than six columns wide.
// ---------------------------------------------------------------------------

const LONG_RULES = Object.keys(TREND_COUNTS);

function longTrendReports(n = 24) {
    const reports = [];
    for (let i = 0; i < n; i += 1) {
        // Deterministic, no randomness: a slow decline, one release-shaped jump
        // a third of the way in, and a rule that flips every third run.
        const decline = (base) => Math.max(0, Math.round(base * (1 - i / (n * 1.4))));
        const counts = {};
        LONG_RULES.forEach((id, k) => {
            const base = TREND_COUNTS[id][0] || 4;
            if (id === 'a11ycore-aria-hidden-focus') counts[id] = i % 3 === 0 ? 4 : 0;
            else if (id === 'a11ycore-target-size-minimum') counts[id] = i > n * 0.6 ? 6 : 0;
            else counts[id] = decline(base) + (i === Math.floor(n / 3) ? 6 : 0) + (k % 4 === 0 ? 1 : 0);
        });
        const day = String(i + 1).padStart(2, '0');
        const month = i < 15 ? '07' : '08';
        const dayInMonth = i < 15 ? String(i + 15).padStart(2, '0') : String(i - 14).padStart(2, '0');
        reports.push(buildReport({
            runId: `nightly-${day}`,
            timestamp: `2026-${month}-${dayInMonth}T02:15:00Z`,
            scenarioName: `Web Banking · ${month === '07' ? 'Jul' : 'Aug'} ${Number(dayInMonth)}`,
            counts,
            pages: 7,
            score: Math.min(92, 58 + Math.round((i / n) * 26)),
            confidence: 86,
        }));
    }
    return reports;
}

module.exports = { RULES, TREND_RUNS, MATRIX_COLUMNS, trendReports, matrixReports, longTrendReports };
