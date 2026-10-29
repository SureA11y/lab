'use strict';

// Definitions come from the single shared source: a copy here had already drifted,
// losing one definition outright and turning an Infinity bound into null.
const METRIC_DEFS = (function () {
    if (typeof module === 'object' && module.exports) {
        return require('./a11y-metric-defs.js').METRIC_DEFS;
    }
    const shared = (typeof globalThis !== 'undefined') ? globalThis.A11Y_METRIC_DEFS : null;
    if (!shared || !shared.METRIC_DEFS) {
        throw new Error('workflow-payload-deps.js: load a11y-metric-defs.js before this file');
    }
    return shared.METRIC_DEFS;
})();


/**
 * workflow-payload-deps.js (shared, browser-friendly)
 *
 * Provides the small dependency functions needed by workflow-payload-builder.js
 * when running in the browser/extension.
 *
 * Exposes:
 *   globalThis.A11Y_WORKFLOW_DEPS = {
 *     sortByOrderKey,
 *     findingsByOutcome,
 *     getA11yGlobalFindings,
 *     buildGlobalSummary,
 *     cryptoSha1Hex16
 *   }
 */
(() => {

    function makeHex(n, len) {
        const x = (n >>> 0).toString(16);
        return x.padStart(len, '0').slice(-len);
    }

    // Fast, deterministic 16-hex "hash" (NOT cryptographic).
    // Matches the helper used in the app UI for imported finding uids.
    function cryptoSha1Hex16(text) {
        const str = String(text || '');

        // djb2
        let h1 = 5381;
        for (let i = 0; i < str.length; i += 1) h1 = ((h1 << 5) + h1) ^ str.charCodeAt(i);

        // sdbm
        let h2 = 0;
        for (let i = 0; i < str.length; i += 1) h2 = str.charCodeAt(i) + (h2 << 6) + (h2 << 16) - h2;

        return makeHex(h1, 8) + makeHex(h2, 8);
    }

    function sortByOrderKey(list) {
        const arr = Array.isArray(list) ? [...list] : [];
        const keyOf = (x) => (x && typeof x === 'object' && typeof x.orderKey === 'string') ? x.orderKey : '';

        // orderKey looks like "scanIndex:artifactIndex" in your project, lexicographic is fine
        arr.sort((a, b) => {
            const ka = keyOf(a);
            const kb = keyOf(b);
            if (ka < kb) return -1;
            if (ka > kb) return 1;
            return 0;
        });

        return arr;
    }

    function findingsByOutcome(scans) {
        const out = { fail: [], pass: [], cantTell: [], notApplicable: [] };

        for (const scan of (Array.isArray(scans) ? scans : [])) {
            const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
            for (const f of findings) {
                const o = f?.outcome;
                if (o === 'fail') out.fail.push(f);
                else if (o === 'pass') out.pass.push(f);
                else if (o === 'cantTell') out.cantTell.push(f);
                else if (o === 'notApplicable') out.notApplicable.push(f);
            }
        }
        return out;
    }

    function getA11yGlobalFindings(scans) {
        // Flatten, preserve scanId for debugging and UI use
        const out = [];
        for (const scan of (Array.isArray(scans) ? scans : [])) {
            const scanId = scan?.scanId || scan?.id || null;
            const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
            for (const f of findings) out.push({ ...f, scanId });
        }
        return out;
    }

    function sumNumericFields(dst, src) {
        if (!dst || typeof dst !== 'object' || !src || typeof src !== 'object') return dst;
        for (const [k, v] of Object.entries(src)) {
            if (typeof v === 'number' && Number.isFinite(v)) {
                if (typeof dst[k] !== 'number' || !Number.isFinite(dst[k])) dst[k] = 0;
                dst[k] += v;
            }
        }
        return dst;
    }

    function percentile(sorted, p) {
        if (!sorted || !sorted.length) return null;
        const n = sorted.length;
        const idx = (n - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        const t = idx - lo;
        return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
    }

    function calcStats(values) {
        const arr = (Array.isArray(values) ? values : [])
            .filter((v) => typeof v === 'number' && Number.isFinite(v))
            .slice()
            .sort((a, b) => a - b);

        const n = arr.length;
        if (!n) return null;

        const min = arr[0];
        const max = arr[n - 1];
        const mean = arr.reduce((acc, v) => acc + v, 0) / n;
        const median = percentile(arr, 0.5);
        const p10 = percentile(arr, 0.10);
        const p25 = percentile(arr, 0.25);
        const p75 = percentile(arr, 0.75);
        const p90 = percentile(arr, 0.90);
        const iqr = (p75 != null && p25 != null) ? (p75 - p25) : null;

        let variance = 0;
        for (const v of arr) variance += (v - mean) * (v - mean);
        variance = variance / n;
        const stddev = Math.sqrt(variance);

        // Keep numeric output stable and compact (matches how the app JSON looks).
        const r = (x) => (x == null ? null : Math.round(x));
        const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

        return {
            n,
            min: r(min),
            max: r(max),
            mean: r(mean),
            median: r(median),
            p10: r(p10),
            p25: r(p25),
            p75: r(p75),
            p90: r(p90),
            iqr: r2(iqr),
            stddev: r2(stddev)
        };
    }

    function withStats(a11ySummary, scans) {
        const out = (a11ySummary && typeof a11ySummary === 'object') ? { ...a11ySummary } : {};

        // The UI gauges and imported-report viewer expect a stats block for pageAccessibility.
        // In your data model this aligns with the per-scan avgPageAccessibility score.
        const vals = [];
        for (const s of (Array.isArray(scans) ? scans : [])) {
            const as = s?.metrics?.a11ySummary || s?.a11ySummary;
            const v = as?.scores?.avgPageAccessibility;
            if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
        }

        const st = calcStats(vals);
        if (st) {
            out.stats = {
                ...(out.stats && typeof out.stats === 'object' ? out.stats : null),
                pageAccessibility: st
            };
        }

        return out;
    }
    function buildGlobalSummary(arg) {
        // Support both call shapes, matching the full server-side builder this
        // is a lightweight, browser-safe stand-in for:
        //   buildGlobalSummary(scans)
        //   buildGlobalSummary({ scans, options })
        const scans = Array.isArray(arg) ? arg : (arg && arg.scans);
        const list = Array.isArray(scans) ? scans : [];

        // ---------------- Dom metrics aggregate ----------------
        // Aggregates only the small subset used in the UI.
        let hasAnyDom = false;
        const domMetrics = {
            totalElements: 0,
            depthMax: 0,
            counts: {},
            timings: { totalMs: 0 }
        };

        // ---------------- A11y summary aggregate ----------------
        let failFindings = 0;
        let passFindings = 0;
        let cantTellFindings = 0;

        const scoreAcc = {
            evidence: [],
            readiness: [],
            confidence: [],
            adjusted: [],
            avgPageAccessibility: []
        };

        const inputsAcc = {
            domTotal: []
        };

        let manualReviewNeeded = false;

        for (const scan of list) {
            // Dom metrics
            const dm = scan?.metrics?.domMetrics || scan?.domMetrics;
            if (dm && typeof dm === 'object') {
                hasAnyDom = true;
                if (typeof dm.totalElements === 'number' && Number.isFinite(dm.totalElements)) domMetrics.totalElements += dm.totalElements;
                if (typeof dm.depthMax === 'number' && Number.isFinite(dm.depthMax)) domMetrics.depthMax = Math.max(domMetrics.depthMax, dm.depthMax);

                const counts = dm.counts && typeof dm.counts === 'object' ? dm.counts : null;
                if (counts) {
                    for (const [k, v] of Object.entries(counts)) {
                        const n = (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
                        domMetrics.counts[k] = (domMetrics.counts[k] || 0) + n;
                    }
                }

                const t = dm.timings && typeof dm.timings === 'object' ? dm.timings : null;
                if (t && typeof t.totalMs === 'number' && Number.isFinite(t.totalMs)) {
                    domMetrics.timings.totalMs += t.totalMs;
                }
            }

            // Findings totals
            const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
            for (const f of findings) {
                if (f?.outcome === 'fail') failFindings += 1;
                else if (f?.outcome === 'pass') passFindings += 1;
                else if (f?.outcome === 'cantTell') cantTellFindings += 1;
            }

            // Score signals for gauges
            const as = scan?.metrics?.a11ySummary || scan?.a11ySummary;
            const scores = as?.scores && typeof as.scores === 'object' ? as.scores : null;
            if (scores) {
                for (const k of Object.keys(scoreAcc)) {
                    const v = scores[k];
                    if (typeof v === 'number' && Number.isFinite(v)) scoreAcc[k].push(v);
                }
            }

            const inputs = as?.inputs && typeof as.inputs === 'object' ? as.inputs : null;
            if (inputs) {
                const domTotal = inputs.domTotal;
                if (typeof domTotal === 'number' && Number.isFinite(domTotal)) inputsAcc.domTotal.push(domTotal);
            }

            if (as?.flags?.manualReviewNeeded) manualReviewNeeded = true;
        }

        function meanOf(arr) {
            if (!arr || !arr.length) return null;
            const s = arr.reduce((acc, v) => acc + v, 0);
            return s / arr.length;
        }

        const scoresOut = {};
        for (const k of Object.keys(scoreAcc)) {
            const m = meanOf(scoreAcc[k]);
            if (m != null) scoresOut[k] = Math.round(m);
        }

        const a11ySummary = {
            inputs: inputsAcc.domTotal.length ? { domTotal: Math.round(meanOf(inputsAcc.domTotal)) } : undefined,
            scores: Object.keys(scoresOut).length ? scoresOut : undefined,
            flags: { manualReviewNeeded: !!manualReviewNeeded },
            totals: {
                findings: failFindings + passFindings + cantTellFindings,
                fail: failFindings,
                pass: passFindings,
                cantTell: cantTellFindings
            }
        };

        return {
            domMetrics: hasAnyDom ? domMetrics : null,
            a11ySummary: withStats(a11ySummary, list),
            metricDefs: METRIC_DEFS
        };
    }

    globalThis.A11Y_WORKFLOW_DEPS = {
        METRIC_DEFS,
        sortByOrderKey,
        findingsByOutcome,
        getA11yGlobalFindings,
        buildGlobalSummary,
        cryptoSha1Hex16
    };
})();
