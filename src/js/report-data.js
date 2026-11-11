// A report's data as the app reads it: the run summary and the findings
// across its scans, built again over the scans it includes; what an export
// keeps of it; its engines and artifacts. No state of the app's own: each
// function works on the report it is given (moved out of a11y-ui.js).

import {CANONICAL_FIELDS, SCAN_FIELDS, pickFindingFields} from './report-fields.js';

export function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export function normalizePayloadForUi(payload) {
    if (!payload || typeof payload !== 'object') return payload;

    if (Array.isArray(payload.scans) && payload.scans.length) {
        payload.scans = payload.scans.map((scan) => {
            if (!scan || typeof scan !== 'object') return scan;

            const canonical = scan.canonical && typeof scan.canonical === 'object' ? scan.canonical : null;

            // Ensure scan.summary exists because multiple UI components expect it for the scan list cards.
            // Map canonical outcomes to the existing summary counters.
            if (canonical && (!scan.summary || typeof scan.summary !== 'object')) {
                const outcomes = canonical?.summary?.outcomes || null;

                // If outcomes are not present, derive them from findings.
                const findings = Array.isArray(canonical.findings) ? canonical.findings : [];
                const derived = outcomes || findings.reduce((acc, f) => {
                    const o = f && f.outcome;
                    if (o === 'fail') acc.fail += 1;
                    else if (o === 'pass') acc.pass += 1;
                    else if (o === 'cantTell') acc.cantTell += 1;
                    else if (o === 'notApplicable') acc.notApplicable += 1;
                    return acc;
                }, {fail: 0, pass: 0, cantTell: 0, notApplicable: 0});

                scan.summary = {
                    failCount: toNumber(derived.fail, 0),
                    passesCount: toNumber(derived.pass, 0),
                    reviewCount: toNumber(derived.cantTell, 0),
                    notApplicableCount: toNumber(derived.notApplicable, 0),
                    skipped: !!scan.skipped,
                    skipInfo: scan.skipInfo || null
                };
            }

            // If there is no canonical yet, keep the object as-is (this will surface quickly in the UI).
            return scan;
        });
    }

    return payload;
}

export function stripVolatileKeysDeep(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stripVolatileKeysDeep);

    const out = {};
    for (const k of Object.keys(value)) {
        // Keys that commonly change between loads, renders, or edits
        if (
            k === 'id' || k === '_id' ||
            k === 'uid' || k === '_uid' ||
            k === 'key' || k === '_key' ||
            k === 'createdAt' || k === 'updatedAt' ||
            k === '__meta'
        ) {
            continue;
        }
        out[k] = stripVolatileKeysDeep(value[k]);
    }
    return out;
}

// -------------------- Local merge (UI) using shared workflow payload builder --------------------

export function makeHex(n, width) {
    const s = (n >>> 0).toString(16);
    return s.padStart(width, '0').slice(-width);
}

// Simple deterministic hash -> 16 hex chars (non-crypto, but stable)
export function hashHex16(text) {
    const str = String(text || '');

    // djb2
    let h1 = 5381;
    for (let i = 0; i < str.length; i++) h1 = ((h1 << 5) + h1) ^ str.charCodeAt(i);

    // sdbm
    let h2 = 0;
    for (let i = 0; i < str.length; i++) h2 = str.charCodeAt(i) + (h2 << 6) + (h2 << 16) - h2;

    return makeHex(h1, 8) + makeHex(h2, 8);
}

export function sortByOrderKey(list) {
    const arr = Array.isArray(list) ? [...list] : [];
    const keyOf = (x) => (x && typeof x === 'object' && typeof x.orderKey === 'string') ? x.orderKey : '';

    // orderKey looks like "scanIndex:artifactIndex" in your project, sort lexicographically is fine
    arr.sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka < kb) return -1;
        if (ka > kb) return 1;
        return 0;
    });
    return arr;
}

export function getOccurrenceOutcome(occ, fallbackOutcome) {
    const occOutcome = String(occ?.occurrenceOutcome || occ?.outcome || '').trim();
    if (occOutcome === 'fail' || occOutcome === 'cantTell') return occOutcome;
    if (fallbackOutcome === 'fail' || fallbackOutcome === 'cantTell') return fallbackOutcome;
    return null;
}

export function splitFindingByOccurrenceOutcome(finding) {
    const occs = Array.isArray(finding?.occurrences) ? finding.occurrences : [];
    if (!occs.length) return [finding];

    const failOccs = [];
    const cantTellOccs = [];
    for (const occ of occs) {
        const tier = getOccurrenceOutcome(occ, finding?.outcome);
        if (tier === 'fail') failOccs.push(occ);
        else if (tier === 'cantTell') cantTellOccs.push(occ);
    }

    const out = [];
    if (failOccs.length) out.push({ ...finding, outcome: 'fail', occurrences: failOccs });
    if (cantTellOccs.length) out.push({ ...finding, outcome: 'cantTell', occurrences: cantTellOccs });
    if (!out.length) out.push(finding);
    return out;
}

export function normalizeStringArray(arr) {
    return Array.isArray(arr)
        ? arr.map((v) => String(v)).filter(Boolean).sort()
        : [];
}

export function mergeOccurrencesWithPageUrl(occurrences, pageUrl, scanId) {
    const list = Array.isArray(occurrences) ? occurrences : [];

    return list.map((occ) => {
        const out = occ && typeof occ === 'object' ? { ...occ } : {};

        if (!out.pageUrl && pageUrl) out.pageUrl = pageUrl;
        if (!out.scanId && scanId) out.scanId = scanId;

        return out;
    });
}

export function makeGlobalFindingKey(f) {
    return JSON.stringify({
        outcome: f?.outcome || '',
        ruleId: f?.ruleId || f?.id || '',
        severity: f?.severity || '',
        title: f?.title || f?.help || '',
        description: f?.description || '',
        helpUrl: f?.helpUrl || '',
        wcagSc: normalizeStringArray(f?.wcag?.sc),
        wcagLevels: normalizeStringArray(f?.wcag?.levels),
        engineId: f?.provenance?.engine?.id || '',
        engineName: f?.provenance?.engine?.name || ''
    });
}

export function mergeFindingIntoMap(map, finding, { pageUrl = '', scanId = null } = {}) {
    if (!finding || typeof finding !== 'object') return;

    const key = makeGlobalFindingKey(finding);
    const incomingOccurrences = mergeOccurrencesWithPageUrl(finding.occurrences, pageUrl, scanId);

    if (!map.has(key)) {
        map.set(key, {
            ...finding,
            scanId,
            occurrences: incomingOccurrences
        });
        return;
    }

    const existing = map.get(key);

    const existingOccs = Array.isArray(existing.occurrences) ? existing.occurrences : [];
    existing.occurrences = existingOccs.concat(incomingOccurrences);

    // Merge tags defensively if they exist
    if (existing?.wcag && finding?.wcag) {
        const mergedSc = [...new Set([
            ...normalizeStringArray(existing.wcag.sc),
            ...normalizeStringArray(finding.wcag.sc)
        ])];

        const mergedLevels = [...new Set([
            ...normalizeStringArray(existing.wcag.levels),
            ...normalizeStringArray(finding.wcag.levels)
        ])];

        existing.wcag = {
            ...existing.wcag,
            ...finding.wcag,
            sc: mergedSc,
            levels: mergedLevels
        };
    }
}

export function getA11yGlobalFindings(scans) {
    const maps = {
        fail: new Map(),
        cantTell: new Map(),
        pass: new Map(),
        notApplicable: new Map()
    };

    for (const scan of (Array.isArray(scans) ? scans : [])) {
        const scanId = scan?.scanId || scan?.id || null;
        const pageUrl = scan?.canonical?.page?.url || scan?.url || '';
        const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];

        for (const original of findings) {
            const expanded = splitFindingByOccurrenceOutcome(original);
            for (const f of expanded) {
                if (!f || typeof f !== 'object') continue;

                const outcome = f.outcome;
                if (!maps[outcome]) continue;

                mergeFindingIntoMap(maps[outcome], f, { pageUrl, scanId });
            }
        }
    }

    return {
        fail: Array.from(maps.fail.values()),
        cantTell: Array.from(maps.cantTell.values()),
        pass: Array.from(maps.pass.values()),
        notApplicable: Array.from(maps.notApplicable.values())
    };
}

export function sumNumericLeaves(target, source) {
    if (!source || typeof source !== 'object') return target;

    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            target[key] = (target[key] || 0) + value;
            continue;
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const child = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
                ? target[key]
                : {};
            target[key] = sumNumericLeaves(child, value);
        }
    }

    return target;
}

// The run's summary over `scans`: the scores, coverage and statistics as
// the server builds them for a run (shared/global-summary.js), from all the
// scans' findings together, since a page on its own often has too little
// to score; with the totals and the page measurements added up here.
export function buildGlobalSummary({ scans, metricDefs = {} }) {
    const list = Array.isArray(scans) ? scans : [];

    let failFindings = 0;
    let passFindings = 0;
    let cantTellFindings = 0;
    let notApplicableFindings = 0;

    const domMetricsAgg = {};
    const a11yTotalsAgg = {};

    for (const scan of list) {
        const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];

        for (const f of findings) {
            if (f?.outcome === 'fail') failFindings += 1;
            else if (f?.outcome === 'pass') passFindings += 1;
            else if (f?.outcome === 'cantTell') cantTellFindings += 1;
            else if (f?.outcome === 'notApplicable') notApplicableFindings += 1;
        }

        if (scan?.metrics?.domMetrics && typeof scan.metrics.domMetrics === 'object') {
            sumNumericLeaves(domMetricsAgg, scan.metrics.domMetrics);
        }

        if (scan?.metrics?.a11ySummary?.totals && typeof scan.metrics.a11ySummary.totals === 'object') {
            sumNumericLeaves(a11yTotalsAgg, scan.metrics.a11ySummary.totals);
        }
    }

    const pooled = globalThis.A11Y_GLOBAL_SUMMARY.buildGlobalSummary({
        scans: list,
        options: {domP90: 90, useMinConfidence: false}
    }).a11ySummary || {};

    const totals = {
        ...a11yTotalsAgg,
        findings: failFindings + passFindings + cantTellFindings + notApplicableFindings,
        fail: failFindings,
        pass: passFindings,
        cantTell: cantTellFindings,
        notApplicable: notApplicableFindings
    };

    return {
        domMetrics: domMetricsAgg,
        a11ySummary: {
            ...pooled,
            totals
        },
        metricDefs
    };
}

export function pickMetricDefsFromPayload(payload) {
    if (payload?.metricDefs && typeof payload.metricDefs === 'object') {
        return payload.metricDefs;
    }

    if (payload?.metrics?.metricDefs && typeof payload.metrics.metricDefs === 'object') {
        return payload.metrics.metricDefs;
    }

    const scans = Array.isArray(payload?.scans) ? payload.scans : [];
    for (const scan of scans) {
        if (scan?.metrics?.metricDefs && typeof scan.metrics.metricDefs === 'object') {
            return scan.metrics.metricDefs;
        }
    }

    return {};
}

export function ensureScansIncludedFlag(payload) {
    if (!payload || !Array.isArray(payload.scans)) return payload;

    payload.scans.forEach((scan) => {
        if (!scan || typeof scan !== 'object') return;
        if (!Object.prototype.hasOwnProperty.call(scan, 'includedInReport')) {
            scan.includedInReport = true;
        }
    });

    return payload;
}

// Backfills summary.failCount / occurrenceCount on scans that lack them
// (reports exported before those fields were baked), so scan sorting reads
// the values directly instead of walking the canonical findings on every
// render. Idempotent: a scan already carrying the fields is skipped.
export function ensureScanSummaryCounts(payload) {
    const sort = globalThis.A11Y_SCAN_SORT;
    if (!sort || !payload || !Array.isArray(payload.scans)) return payload;

    payload.scans.forEach((scan) => {
        if (!scan || typeof scan !== 'object') return;
        const summary = scan.summary || (scan.summary = {});
        const needsFail = !Number.isFinite(summary.failCount);
        const needsOcc = !Number.isFinite(summary.occurrenceCount);
        if (!needsFail && !needsOcc) return;

        const values = sort.scanSortValues(scan);
        if (needsFail) summary.failCount = values.failures;
        if (needsOcc) summary.occurrenceCount = values.occurrences;
    });

    return payload;
}

export function pickMetricDefsFromStaged(okItems) {
    for (const it of (Array.isArray(okItems) ? okItems : [])) {
        const p = it?.parsed;
        if (!p) continue;

        // common locations in your payloads
        if (p.metricDefs && typeof p.metricDefs === 'object') return p.metricDefs;
        if (p.metrics?.metricDefs && typeof p.metrics.metricDefs === 'object') return p.metrics.metricDefs;

        const scans = Array.isArray(p.scans) ? p.scans : [];
        for (const s of scans) {
            if (s?.metrics?.metricDefs && typeof s.metrics.metricDefs === 'object') return s.metrics.metricDefs;
        }
    }
    return {}; // safe fallback
}

// Give a loaded report the per-scan + portfolio globals the diff reads for
// its score/confidence KPIs, computed the same way the open report is (over
// its own included scans; no view filter applies here).
export function computeReportGlobals(json) {
    ensureScansIncludedFlag(json);
    const scans = (Array.isArray(json.scans) ? json.scans : []).filter(
        (s) => s && s.includedInReport !== false
    );
    const metricDefs = pickMetricDefsFromPayload(json);
    json.a11yGlobalFindings = getA11yGlobalFindings(scans);
    json.metrics = buildGlobalSummary({ scans, metricDefs });
    return json;
}

export async function readReportFile(file) {
    return parseReportText(await file.text(), file.name);
}

export function parseReportText(text, name) {
    let json;
    try { json = JSON.parse(String(text || '')); }
    catch { throw new Error('invalid JSON'); }
    validateReportOrThrow(json, name);
    computeReportGlobals(json);
    return json;
}

// Checks a report against the published report schema, reading it, in
// place, as the current format first: an older report's scans get their
// profile and occurrence ids, as they would on any merge or save.
export function validateReportOrThrow(obj, fileLabel) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) globalThis.A11Y_REPORT_FORMAT.upgradeReport(obj);
    const problems = globalThis.A11Y_JSON_SCHEMA_CHECK.checkAgainstSchema(
        globalThis.A11Y_REPORT_SCHEMAS.openableReportSchema(), obj);
    if (problems.length) {
        const [first] = problems;
        const error = new Error(`Invalid report file${fileLabel ? ` (${fileLabel})` : ''}: ${first.path} , ${first.message}`);
        // Kept whole, so Open report can say in plain words what is wrong
        // (report-file-problem.js) instead of quoting the schema path.
        error.reportProblem = first;
        throw error;
    }
}

/**
 * The workflow screenshots, as an array whatever the payload holds.
 *
 * The app's own runs and exports always write the key, so reading it bare
 * looked safe — but the report schema requires neither it nor `scans`, and a
 * hand-written or third-party file that omits it used to take the render down
 * on `.length`. Everything else here already coerces (`getScansFromPayload`,
 * the renderers, the tag filter); this is the same rule for the other array.
 */
export function getScreenshotsFromPayload(data) {
    return Array.isArray(data?.screenshots) ? data.screenshots : [];
}

/** Compute total violations and total nodes across all scans */
export function computeTotals(scans) {
    let totalNodes = 0;

    const totalViolations = scans.reduce((acc, scan) => {
        const s = scan.summary || {};
        const scanNodes = (() => {
            const findings = scan?.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [];
            return findings.reduce((acc2, f) => {
                if (f?.outcome !== 'fail') return acc2;
                const occs = Array.isArray(f.occurrences) ? f.occurrences : [];
                return acc2 + occs.length;
            }, 0);
        })();

        totalNodes += scanNodes;

        const findings = scan?.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [];
        const failCount = findings.reduce((acc2, f) => acc2 + (f?.outcome === 'fail' ? 1 : 0), 0);
        return acc + failCount;
    }, 0);

    return {totalNodes, totalViolations};
}

export function getAllArtifactUrls(data) {
    const urls = {
        htmlReports: [],
        screenshots: []
    };

    const scans = Array.isArray(data?.scans) ? data.scans : [];
    for (const s of scans) {
        const rep = s?.report;

        // HTML report “open” link
        if (rep?.publicUrl) urls.htmlReports.push({ url: rep.publicUrl, label: s?.label || s?.id || 'Scan report' });

        // Screenshot links (prefer publicUrl, fall back to dataUrl)
        const shots = Array.isArray(s?.screenshots) ? s.screenshots : [];
        for (const sh of shots) {
            const u = sh?.publicUrl || sh?.dataUrl;
            if (u) urls.screenshots.push({ url: u, label: sh?.name || 'Screenshot' });
        }
    }

    // Workflow-level screenshots (payload.screenshots)
    const wfShots = Array.isArray(data?.screenshots) ? data.screenshots : [];
    for (const sh of wfShots) {
        const u = sh?.publicUrl || sh?.dataUrl;
        if (u) urls.screenshots.push({ url: u, label: sh?.name || 'Workflow screenshot' });
    }

    return urls;
}

export function keepOnlyKeys(obj, allowedKeys) {
    return allowedKeys.reduce((acc, key) => {
        if (key in obj) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
}

export function prepareDataForReport(data) {
    const requiredProperties = [
        'scans',
        'screenshots',
        'scenarioName',
        'reportName',
        'url',
        'timestamp'
    ];

    requiredProperties.push('metrics');
    requiredProperties.push('a11yGlobalFindings');
    // These keys must be in the allowlist so renderActionLog/renderRunDiagnostics/
    // renderCollectedMetadata receive them in the live "run" view (finalizeAndRenderAll
    // reads them directly off this object). See docs/design/workflow-collected-metadata-design.md §6.
    requiredProperties.push('actionResults');
    requiredProperties.push('runDiagnostics');
    requiredProperties.push('collectedOutputs');
    // The configuration the report ran: "Load configuration" sets it up
    // again from the report (docs/report-package.md).
    requiredProperties.push('config');
    // A reviewer's conformance verdicts (conformance-review.js): kept with
    // the report, so its downloads and a later opening carry them.
    requiredProperties.push('conformanceReview');
    // The scan groups chosen and named (scan-group-choice.js,
    // docs/design/scan-grouping-design.md §7): kept with the report likewise.
    requiredProperties.push('scanGrouping');

    const updatedData = keepOnlyKeys(data, requiredProperties);

    // ---- SCANS ----
    if (Array.isArray(updatedData.scans)) {
        updatedData.scans = updatedData.scans.map((scan) => {
            // A scan under a standard's profile saved before its results were
            // counted under the WCAG criteria they restate: its coverage made
            // again from its findings, while they are whole.
            const repaired = globalThis.A11Y_COVERAGE_SUMMARY?.repairStandardScanCoverage?.(scan);
            if (repaired) scan = {...scan, metrics: {...scan.metrics, coverageSummary: repaired}};
            const updatedScan = keepOnlyKeys(scan, SCAN_FIELDS);

            if (scan?.canonical && typeof scan.canonical === 'object') {
                const updatedCanonical = keepOnlyKeys(scan.canonical, CANONICAL_FIELDS);

                if (Array.isArray(scan.canonical.findings)) {
                    updatedCanonical.findings = scan.canonical.findings.map((finding) =>
                        pickFindingFields(finding)
                    );
                }
                if (Array.isArray(scan.canonical.bestPractices)) {
                    updatedCanonical.bestPractices = scan.canonical.bestPractices.map((finding) =>
                        pickFindingFields(finding)
                    );
                }

                updatedScan.canonical = updatedCanonical;
            }

            return updatedScan;
        });
    }

    // ---- WORKFLOW SCREENSHOTS ----
    if (Array.isArray(updatedData.screenshots)) {
        updatedData.screenshots = updatedData.screenshots.map((screenshot) =>
            keepOnlyKeys(screenshot, [
                'name',
                'publicUrl',
                'dataUrl',
                'buffer',
                'viewportRatio',
                'url'
            ])
        );
    }

    if (updatedData.runDiagnostics && typeof updatedData.runDiagnostics === 'object') {
        const sanitizedRunDiagnostics = keepOnlyKeys(
            updatedData.runDiagnostics,
            ['requestFailures', 'untrustedCertsAccepted']
        );

        if (
            (Array.isArray(sanitizedRunDiagnostics.requestFailures) &&
            sanitizedRunDiagnostics.requestFailures.length > 0) ||
            sanitizedRunDiagnostics.untrustedCertsAccepted === true
        ) {
            updatedData.runDiagnostics = sanitizedRunDiagnostics;
        } else {
            delete updatedData.runDiagnostics;
        }
    }

    return updatedData;
}

// A deep copy of report data, as the JSON round trip would make it. Faster
// than that round trip for a large report; falls back to it for anything
// structuredClone refuses.
export function cloneJsonData(value) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // fall through
        }
    }
    return JSON.parse(JSON.stringify(value));
}

// Collects the distinct accessibility engines used across a report's scans,
// formatted as "name version" (version omitted when unknown/unavailable).
// Reads canonical.engines (current shape) with a canonical.engine fallback
// for older/legacy canonical payloads.
export function collectReportEngines(data) {
    const scans = Array.isArray(data?.scans) ? data.scans : [];
    const byId = new Map();

    for (const scan of scans) {
        const canonical = scan && scan.canonical;
        if (!canonical) continue;

        const engines = Array.isArray(canonical.engines)
            ? canonical.engines
            : (canonical.engine ? [canonical.engine] : []);

        for (const eng of engines) {
            if (!eng) continue;
            const id = eng.id ? String(eng.id) : (eng.name ? String(eng.name) : null);
            if (!id || byId.has(id)) continue;
            byId.set(id, eng);
        }
    }

    return Array.from(byId.values()).map((eng) => {
        const id = eng.id ? String(eng.id).trim() : '';
        const name = eng.name ? String(eng.name).trim() : (id || 'Unknown engine');
        const version = eng.version ? String(eng.version).trim() : '';
        return { id, name, version };
    });
}
