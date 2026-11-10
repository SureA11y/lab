'use strict';

/**
 * workflow-payload-builder.js (shared)
 *
 * Goal:
 * - Put all “payload shaping” logic in one place.
 * - Works in Node (require) and in browser (globalThis).
 *
 * Usage (Node):
 *   const { createWorkflowPayloadBuilder } = require('./src/shared/workflow-payload-builder.js');
 *   const builder = createWorkflowPayloadBuilder(deps);
 *
 * Usage (Browser):
 *   const builder = globalThis.A11Y_WORKFLOW_PAYLOAD_BUILDER.createWorkflowPayloadBuilder(deps);
 */

(function factory(root, make) {
    const api = make(root);

    // Browser global
    try {
        root.A11Y_WORKFLOW_PAYLOAD_BUILDER = api;
    } catch {}

    // Node export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(globalThis, function makeApi(root) {

    // Shared report modules: in Node by require, in the browser from their globals.
    function shared(file, globalName) {
        const api = (typeof module !== 'undefined' && module.exports) ? require(file) : root[globalName];
        if (!api) throw new Error(`workflow-payload-builder: load ${file} first`);
        return api;
    }
    const reportFormat = () => shared('./report-format.js', 'A11Y_REPORT_FORMAT');
    const reportScan = () => shared('./report-scan.js', 'A11Y_REPORT_SCAN');

    function isoNow() {
        return new Date().toISOString();
    }

    /**
     * Create a builder using injected dependencies.
     *
     * deps:
     * - METRIC_DEFS: object
     * - sortByOrderKey: (arr) => arr
     * - buildGlobalSummary: ({scans, options}) => { domMetrics, a11ySummary }
     * - cryptoSha1Hex16: (text) => "16 hex chars"  (optional, required only if you call ensureFindingUidsOnImportedScans)
     */
    function createWorkflowPayloadBuilder(deps) {
        if (!deps || typeof deps !== 'object') throw new Error('createWorkflowPayloadBuilder: missing deps');

        const METRIC_DEFS = deps.METRIC_DEFS;
        const sortByOrderKey = deps.sortByOrderKey;
        const buildGlobalSummary = deps.buildGlobalSummary;

        if (!METRIC_DEFS) throw new Error('createWorkflowPayloadBuilder: deps.METRIC_DEFS missing');
        if (typeof sortByOrderKey !== 'function') throw new Error('createWorkflowPayloadBuilder: deps.sortByOrderKey missing');
        if (typeof buildGlobalSummary !== 'function') throw new Error('createWorkflowPayloadBuilder: deps.buildGlobalSummary missing');

        // A stable per-run identity for the report root, so run-to-run comparison
        // ("evolution") can name and order two reports without pairing pages.
        // Derived from the run's own timestamp + scope so it is deterministic
        // (re-importing the same report yields the same id). Uses the injected
        // hash when available, falling back to the timestamp digits so the builder
        // never hard-depends on crypto.
        function computeRunId(ts, scopeUrl, scenarioName) {
            const base = [ts || '', scopeUrl || '', scenarioName || ''].join('|');
            if (typeof deps.cryptoSha1Hex16 === 'function') {
                return 'run_' + deps.cryptoSha1Hex16(base);
            }
            const digits = String(ts || '').replace(/\D/g, '').slice(0, 17);
            return 'run_' + (digits || 'unknown');
        }

        // --------------------------- Import helpers ---------------------------

        function normalizeImportObjects(body) {
            // Supported shapes:
            //  A) { items: [ { scans: [...], screenshots: [...] }, ... ] }
            //  B) { analyses: [ { scans: [...], screenshots: [...] }, ... ] }
            //  C) { files: [ { scans: [...], screenshots: [...] }, ... ] }
            //  D) { scans: [...], screenshots: [...] }  (single object)
            //  E) [ { scans: [...], screenshots: [...] }, ... ] (body is an array)
            if (Array.isArray(body)) return body;

            if (body && typeof body === 'object') {
                if (Array.isArray(body.items)) return body.items;
                if (Array.isArray(body.analyses)) return body.analyses;
                if (Array.isArray(body.files)) return body.files;

                // single object fallback
                if (Array.isArray(body.scans) || Array.isArray(body.screenshots)) return [body];
            }
            return [];
        }

        function mergeImportedScansAndScreenshots(importObjs) {
            const scans = [];
            const screenshots = [];

            const list = Array.isArray(importObjs) ? importObjs : [];
            // Each report's scans with their own rule catalogue again
            // (version 4 names it by index in its own report), so scans of
            // several reports can sit in one.
            for (const obj of list) reportFormat().expandReport(obj);

            for (let srcIndex = 0; srcIndex < list.length; srcIndex += 1) {
                const obj = list[srcIndex];
                if (!obj || typeof obj !== 'object') continue;

                if (Array.isArray(obj.scans)) {
                    for (let scanIndex = 0; scanIndex < obj.scans.length; scanIndex += 1) {
                        const s = obj.scans[scanIndex];

                        if (s && typeof s === 'object') {
                            // deterministic import provenance, used to build unique ids
                            s._importSourceIndex = srcIndex;
                            s._importScanIndex = scanIndex;
                        }

                        scans.push(s);
                    }
                }

                if (Array.isArray(obj.screenshots)) {
                    for (const sh of obj.screenshots) screenshots.push(sh);
                }
            }

            return { scans, screenshots };
        }

        /**
         * Deterministically generate a finding uid when missing.
         * Requires deps.cryptoSha1Hex16.
         */
        function computeImportedFindingUid(finding) {
            if (typeof deps.cryptoSha1Hex16 !== 'function') {
                throw new Error('computeImportedFindingUid: deps.cryptoSha1Hex16 is required');
            }

            const f = finding && typeof finding === 'object' ? finding : {};

            const ruleId = (typeof f.ruleId === 'string' && f.ruleId.trim()) ? f.ruleId.trim() : '';
            const outcome = (typeof f.outcome === 'string' && f.outcome.trim()) ? f.outcome.trim() : '';

            const wcagSc = Array.isArray(f?.wcag?.sc)
                ? [...new Set(f.wcag.sc.map(String).map(s => s.trim()).filter(Boolean))].sort()
                : [];

            const base = [
                ruleId || 'no-rule',
                outcome || 'no-outcome',
                wcagSc.join(',') || 'no-sc'
            ].join('|');

            const hex16 = deps.cryptoSha1Hex16(base);
            return `imp_${hex16}`;
        }

        function ensureFindingUidsOnImportedScans(scans) {
            const list = Array.isArray(scans) ? scans : [];

            for (const scan of list) {
                const canonical = scan && typeof scan === 'object' ? scan.canonical : null;
                if (!canonical || typeof canonical !== 'object') continue;

                const findings = Array.isArray(canonical.findings) ? canonical.findings : null;
                if (!findings || !findings.length) continue;

                for (const f of findings) {
                    if (!f || typeof f !== 'object') continue;

                    const hasUid = (typeof f.uid === 'string' && f.uid.trim());
                    if (hasUid) continue;

                    f.uid = computeImportedFindingUid(f);
                }
            }

            return list;
        }

        function ensureUniqueImportedScanIds(scans) {
            const list = Array.isArray(scans) ? scans : [];

            // Count base ids to detect duplicates
            const counts = new Map();

            const getBase = (scan, i) => {
                const s = scan && typeof scan === 'object' ? scan : {};
                const base = (s.scanId || s.id || '').trim();
                return base || `scan_${i}`;
            };

            for (let i = 0; i < list.length; i += 1) {
                const s = list[i];
                const base = getBase(s, i);
                counts.set(base, (counts.get(base) || 0) + 1);
            }

            // Assign unique ids only if duplicated or missing
            for (let i = 0; i < list.length; i += 1) {
                const scan = list[i];
                if (!scan || typeof scan !== 'object') continue;

                const base = getBase(scan, i);
                const isDup = (counts.get(base) || 0) > 1;

                const hasId = typeof scan.id === 'string' && scan.id.trim();
                const hasScanId = typeof scan.scanId === 'string' && scan.scanId.trim();

                if (!isDup && hasId && hasScanId) continue;

                const srcIndex = Number.isFinite(Number(scan._importSourceIndex)) ? Number(scan._importSourceIndex) : 0;
                const scanIndex = Number.isFinite(Number(scan._importScanIndex)) ? Number(scan._importScanIndex) : i;

                const suffix = `__imp${String(srcIndex).padStart(3, '0')}_${String(scanIndex).padStart(5, '0')}`;
                const unique = `${base}${suffix}`;

                if (scan._originalId == null) scan._originalId = scan.id ?? null;
                if (scan._originalScanId == null) scan._originalScanId = scan.scanId ?? null;

                scan.id = unique;
                scan.scanId = unique;

                const patchShot = (shot) => {
                    if (!shot || typeof shot !== 'object') return;
                    if (typeof shot.scanId === 'string' && shot.scanId.trim()) shot.scanId = unique;
                };

                patchShot(scan.screenshot);

                if (Array.isArray(scan.screenshots)) {
                    for (const sh of scan.screenshots) patchShot(sh);
                }
                if (Array.isArray(scan.extraScreenshots)) {
                    for (const sh of scan.extraScreenshots) patchShot(sh);
                }
            }

            return list;
        }

        // --------------------------- Screenshots helpers ---------------------------

        function bufferLikeToBase64(value) {
            if (!value) return null;

            // Node
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
                return value.toString('base64');
            }
            if (typeof Buffer !== 'undefined' && value instanceof ArrayBuffer) {
                return Buffer.from(value).toString('base64');
            }
            if (typeof Buffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
                return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
            }

            // Browser: allow already-base64 string only
            return null;
        }

        /** A non-empty buffer bufferLikeToBase64 can encode (never in a browser). */
        function isBufferLike(value) {
            if (!value || typeof Buffer === 'undefined') return false;
            const bufferLike = (Buffer.isBuffer && Buffer.isBuffer(value)) || value instanceof ArrayBuffer
                || (ArrayBuffer.isView && ArrayBuffer.isView(value));
            return bufferLike && value.byteLength > 0;
        }

        // A screenshot held as a buffer gets its data URL when the result is
        // written (JSON.stringify and the queue's file writer call toJSON), not
        // when it is built: until then the image stays a buffer, outside the
        // JS heap, instead of also being held there as a string a third larger.
        // Several runs finishing together held hundreds of MB of these each.
        // The written result is the same.
        function deferredDataUrl(value) {
            if (!isBufferLike(value)) return null;
            // pictureBytes lets a queue batch keep the picture as a file
            // instead (src/server-side/batch-package.js).
            return { pictureBytes: value, toJSON: () => 'data:image/jpeg;base64,' + bufferLikeToBase64(value) };
        }

        function normalizeShotToEntry(shot, defaultName = 'Screenshot') {
            if (!shot) return null;

            const meta = (shot && typeof shot === 'object') ? {
                scanId: (typeof shot.scanId === 'string' && shot.scanId) ? shot.scanId : null,
                orderKey: (typeof shot.orderKey === 'string' && shot.orderKey) ? shot.orderKey : null,
                iterationIndex: (typeof shot.iterationIndex === 'number') ? shot.iterationIndex : null,
                artifactIndex: (typeof shot.artifactIndex === 'number') ? shot.artifactIndex : null,
                url: (typeof shot.url === 'string' && shot.url) ? shot.url : null,
                label: (typeof shot.label === 'string' && shot.label) ? shot.label : null,
                viewportRatio:
                    (typeof shot.viewportRatio === 'number' && Number.isFinite(shot.viewportRatio))
                        ? shot.viewportRatio
                        : null,
                // Only the page's top left: it was larger than a picture can
                // be (screenshot-capture.js).
                ...(shot.clipped === true ? { clipped: true } : {}),
            } : null;

            if (typeof shot === 'string') {
                if (shot.startsWith('data:')) return { name: defaultName, dataUrl: shot };
                if (/^https?:\/\//i.test(shot) || shot.startsWith('/'))
                    return { name: defaultName, publicUrl: shot };
                if (/^[A-Za-z0-9+/=]+$/.test(shot))
                    return { name: defaultName, dataUrl: 'data:image/jpeg;base64,' + shot };
                return null;
            }

            if (typeof shot === 'object') {
                if (shot.publicUrl || shot.dataUrl) {
                    return {
                        name: shot.name || defaultName,
                        publicUrl: shot.publicUrl,
                        dataUrl: shot.dataUrl,
                        ...(meta || {})
                    };
                }
                // A bare buffer first: a Node Buffer's own .buffer is the whole
                // memory block it sits in, which for a small one is shared.
                const candidates = isBufferLike(shot) ? [shot] : [shot.buffer, shot.data, shot];
                for (const c of candidates) {
                    const dataUrl = deferredDataUrl(c);
                    if (dataUrl) return { name: shot.name || defaultName, dataUrl, ...(meta || {}) };
                }
            }
            return null;
        }

        function stitchScreenshots(scan, report) {
            const out = [];

            const pushEntry = (shot, name) => {
                const entry = normalizeShotToEntry(shot, name);
                if (entry) out.push(entry);
            };

            if (Array.isArray(scan.extraScreenshots)) {
                scan.extraScreenshots.forEach((shot) => {
                    pushEntry(shot, `Screenshot ${out.length + 1}`);
                });
            }

            if (Array.isArray(scan.screenshots)) {
                scan.screenshots.forEach((shot) => {
                    pushEntry(shot, `Screenshot ${out.length + 1}`);
                });
            }

            const main = normalizeShotToEntry(scan.screenshot, 'Main screenshot');
            if (main) out.push(main);

            if (report && typeof report === 'object') {
                const extrasPublic =
                    report.extraScreenshotsPublicUrls ||
                    report.extraScreenshots ||
                    [];

                const hasMain = !!main;
                const lastIndex = out.length - 1;

                const extrasCount = hasMain ? lastIndex : out.length;
                for (let i = 0; i < extrasPublic.length && i < extrasCount; i++) {
                    const urlStr = extrasPublic[i];
                    if (typeof urlStr === 'string' && urlStr) {
                        out[i].publicUrl = urlStr;
                        delete out[i].dataUrl;
                    }
                }

                if (hasMain && typeof report.screenshotPublicUrl === 'string') {
                    out[lastIndex].publicUrl = report.screenshotPublicUrl;
                    delete out[lastIndex].dataUrl;
                }
            }

            return out;
        }

        function buildWorkflowScreenshotsPayload(workflowScreenshots) {
            if (!Array.isArray(workflowScreenshots) || !workflowScreenshots.length) return [];
            return workflowScreenshots
                .map((shot, i) => normalizeShotToEntry(shot, `Workflow screenshot ${i + 1}`))
                .filter(Boolean);
        }

        // --------------------------- Score helpers ---------------------------

        function countCanonicalOutcomes(canonical) {
            const findings = Array.isArray(canonical && canonical.findings) ? canonical.findings : [];
            let failCount = 0;
            let passesCount = 0;
            let reviewCount = 0;

            for (const f of findings) {
                const o = f && f.outcome ? String(f.outcome) : '';
                if (o === 'fail') failCount += 1;
                else if (o === 'pass') passesCount += 1;
                else if (o === 'cantTell') reviewCount += 1;
            }

            return { failCount, passesCount, reviewCount };
        }

        function computeCanonicalScore(canonical, { skipped = false } = {}) {
            if (skipped || !canonical) {
                return {
                    label: 'skipped',
                    description: 'Scan skipped. No accessibility results available.',
                    counts: { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 },
                };
            }

            const counts = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
            const findings = Array.isArray(canonical.findings) ? canonical.findings : [];

            for (const f of findings) {
                if (!f || f.outcome !== 'fail') continue;
                const impact = f.severity ? String(f.severity) : 'unknown';
                // With the elements its rule counted and did not list.
                const occ = reportFormat().occurrenceTotal(f);
                if (counts[impact] === undefined) counts.unknown += occ;
                else counts[impact] += occ;
            }

            let label = 'pass';
            let description = 'No violations detected.';

            const totalFailOcc =
                counts.critical + counts.serious + counts.moderate + counts.minor + counts.unknown;

            if (counts.critical > 0) {
                label = 'fail';
                description =
                    'Critical violations detected. These issues are likely to block users and should be fixed as a priority.';
            } else if (counts.serious > 0) {
                label = 'warning';
                description =
                    'Serious violations detected. These issues can significantly affect users and should be addressed soon.';
            } else if (totalFailOcc > 0) {
                label = 'info';
                description =
                    'Only moderate or minor violations detected. They still matter, but have lower immediate impact.';
            }

            return { label, description, counts };
        }

        // --------------------------- Ordering helpers ---------------------------

        function computeScanOrderIds(scans) {
            const list = Array.isArray(scans) ? scans : [];
            const withKeys = [];
            const withoutKeys = [];

            for (let i = 0; i < list.length; i += 1) {
                const s = list[i] || {};
                const scanId = s.scanId || s.id || null;
                const orderKey = typeof s.orderKey === 'string' ? s.orderKey : null;

                if (scanId && orderKey) {
                    const parts = orderKey.split(':');
                    const a = Number(parts[0]);
                    const b = Number(parts[1]);
                    withKeys.push({
                        scanId,
                        a: Number.isFinite(a) ? a : Number.MAX_SAFE_INTEGER,
                        b: Number.isFinite(b) ? b : Number.MAX_SAFE_INTEGER,
                        i
                    });
                } else if (scanId) {
                    withoutKeys.push({ scanId, i });
                }
            }

            withKeys.sort((x, y) => (x.a - y.a) || (x.b - y.b) || (x.i - y.i));
            return withKeys.map(x => x.scanId).concat(withoutKeys.sort((x, y) => x.i - y.i).map(x => x.scanId));
        }

        // --------------------------- Payload builders ---------------------------

        // `findingsByKind` is `findings` again, split by meta.atomic, which each
        // finding keeps. The coverage summary reads it while the run is in
        // memory; nothing reads it from a result, where it was a quarter of a
        // large result's size. A result leaves it out.
        function withoutFindingsByKind(canonical) {
            if (!canonical || typeof canonical !== 'object') return canonical || null;
            if (!Object.prototype.hasOwnProperty.call(canonical, 'findingsByKind')) return canonical;
            const { findingsByKind, ...rest } = canonical;
            return rest;
        }

        // A context of a merged scan as the report keeps it, its scan made as
        // any scan is, less what the merged scan already says: no id of its
        // own (it is the merged scan's), no pictures, no metric definitions,
        // and no rule catalogue, which is its merged scan's (one run, the
        // same engines) and the largest part of a scan by far.
        function contextPayload(context) {
            if (!context || typeof context !== 'object' || !context.scan || typeof context.scan !== 'object') return context;
            const built = buildScanPayload(context.scan);
            const { id: _id, scanId: _scanId, orderKey: _orderKey, iterationIndex: _it, scanIndex: _ix, ...scan } = built;
            if (scan.metrics) delete scan.metrics.metricDefs;
            if (scan.canonical && typeof scan.canonical === 'object') {
                const { rules: _rules, rulesCatalog: _catalog, ...canonical } = scan.canonical;
                scan.canonical = canonical;
            }
            return { ...context, scan };
        }

        function buildScanPayload(scan, { debugNative = false } = {}) {
            const isSkipped = !!scan.skipped || !!scan.skipInfo;

            const counts = isSkipped
                ? { failCount: 0, passesCount: 0, reviewCount: 0 }
                : countCanonicalOutcomes(scan.canonical);

            const score = computeCanonicalScore(scan.canonical, { skipped: isSkipped });

            // Total occurrences across failing findings: the sum of score.counts,
            // which holds fail occurrences bucketed by severity.
            const c = score && score.counts ? score.counts : {};
            const occurrenceCount = (c.critical || 0) + (c.serious || 0) + (c.moderate || 0)
                + (c.minor || 0) + (c.unknown || 0);

            const out = {
                id: scan.id,
                scanId: scan.scanId || null,
                orderKey: scan.orderKey || null,
                iterationIndex: scan.iterationIndex ?? null,
                scanIndex: scan.scanIndex ?? null,
                label: scan.label || null,
                url: scan.url || null,
                skipped: isSkipped,
                skipInfo: scan.skipInfo || null,
                context: scan.context || null,
                exclude: scan.exclude || null,
                tags: scan.tags || null,
                scanTags: Array.isArray(scan.scanTags) && scan.scanTags.length ? scan.scanTags : null,
                // What it checked against, also for a scan from an older
                // report, which named it differently (report-scan.js).
                ...reportScan().scanFields(scan),
                summary: {
                    failCount: counts.failCount,
                    passesCount: counts.passesCount,
                    reviewCount: counts.reviewCount,
                    occurrenceCount,
                    score,
                },
                runOnly: scan.runOnly || null,
                canonical: withoutFindingsByKind(scan.canonical),
                ...(debugNative ? { native: scan.results || null } : {}),
                // A Merged scan step's scans as one (docs/design/merged-scan-design.md):
                // the contexts it was made from, in the order they ran.
                // Each with its own scan when the run kept it, as a report keeps
                // a scan, so the report view can unmerge it
                // (docs/design/scan-grouping-design.md §8).
                ...(scan.mergedScan === true
                    ? { mergedScan: true, contexts: Array.isArray(scan.contexts) ? scan.contexts.map(contextPayload) : [] }
                    : {}),
            };

            const hasIncomingMetrics =
                scan && scan.metrics && typeof scan.metrics === 'object' && !Array.isArray(scan.metrics);

            out.metrics = (() => {
                const merged = hasIncomingMetrics ? { ...scan.metrics } : {};

                if (merged.domMetrics == null && scan.domMetrics != null) merged.domMetrics = scan.domMetrics;
                if (merged.a11ySummary == null && scan.a11ySummary != null) merged.a11ySummary = scan.a11ySummary;
                if (merged.coverageSummary == null && scan.coverageSummary != null) merged.coverageSummary = scan.coverageSummary;

                // Present only for a scan that ran more than one engine: the same
                // summaries again, computed per engine, so the report can be read
                // through one of them without its scores still covering both.
                if (merged.byEngine == null && scan.byEngineMetrics != null) merged.byEngine = scan.byEngineMetrics;

                merged.metricDefs = METRIC_DEFS;

                if (merged.domMetrics === undefined) merged.domMetrics = null;
                if (merged.a11ySummary === undefined) merged.a11ySummary = null;
                if (merged.coverageSummary === undefined) merged.coverageSummary = null;
                if (merged.byEngine === undefined) merged.byEngine = null;

                return merged;
            })();

            return out;
        }

        function buildWorkflowPayloadBase({
                                              url,
                                              scenarioName,
                                              actions,
                                              actionResults,
                                              scans,
                                              workflowScreenshots,
                                              runDiagnostics,
                                              collectedOutputs,
                                              iterationFailureSummary,
                                              cancelled,
                                              failed,
                                              errorDetails,
                                              debugNative = false,
                                              includeScanScreenshots = true,
                                              timestamp = null,
                                              runId = null,
                                          } = {}) {
            const ts = timestamp || isoNow();
            const payload = {
                url,
                runId: (typeof runId === 'string' && runId.trim()) ? runId.trim() : computeRunId(ts, url, scenarioName),
                timestamp: ts,
                scenarioName: scenarioName || null,
                metricDefs: METRIC_DEFS,
                actions: Array.isArray(actions) && actions.length ? actions : undefined,
                actionResults: Array.isArray(actionResults) && actionResults.length ? actionResults : undefined,
                scans: [],
                screenshots: buildWorkflowScreenshotsPayload(workflowScreenshots),
                runDiagnostics: runDiagnostics || undefined,
                collectedOutputs: Array.isArray(collectedOutputs) && collectedOutputs.length ? collectedOutputs : undefined,
                // Iterations that failed but let the run continue: without this
                // an unattended run reads as clean while having covered less.
                iterationFailureSummary: iterationFailureSummary || undefined,
            };

            if (cancelled) payload.cancelled = true;
            if (failed) payload.failed = true;
            if (errorDetails) payload.errorDetails = errorDetails;

            for (const scan of (Array.isArray(scans) ? scans : [])) {
                const scanPayload = buildScanPayload(scan, { debugNative });

                if (!Array.isArray(scanPayload.screenshots)) scanPayload.screenshots = [];

                if (includeScanScreenshots) {
                    const stitched = stitchScreenshots(scan, null);
                    if (stitched.length) scanPayload.screenshots = stitched;
                    scanPayload.viewportRatio = scan.viewportRatio;
                }

                payload.scans.push(scanPayload);
            }

            return payload;
        }

        function finalizeWorkflowPayload(payload) {
            if (!payload || typeof payload !== 'object') return payload;

            if (!Array.isArray(payload.scans)) payload.scans = [];
            if (!Array.isArray(payload.screenshots)) payload.screenshots = [];

            // The current format, also for the scans of older reports opened
            // or merged into this one. Each finding is written once, in its
            // scan: the findings by outcome are built from the scans by
            // whoever reads them (report-format.js, since version 3).
            reportFormat().upgradeReport(payload);

            const { domMetrics, a11ySummary } = buildGlobalSummary({
                scans: payload.scans,
                options: {
                    domP90: 90,
                    useMinConfidence: false
                }
            });

            payload.metrics = {
                a11ySummary,
                domMetrics,
                coverageSummary: (a11ySummary && a11ySummary.coverageSummary) || null,
                metricDefs: METRIC_DEFS
            };

            if (!Array.isArray(payload.scanOrderIds)) {
                payload.scanOrderIds = computeScanOrderIds(payload.scans);
            }

            payload.scans = sortByOrderKey(payload.scans || []);
            payload.screenshots = sortByOrderKey(payload.screenshots || []);

            // As version 4 keeps it: one rule catalogue for the scans that
            // share it; the engine's raw rollups only in a debug run, whose
            // scans carry the engine's native output too.
            reportFormat().compactReport(payload, {
                keepEngineDetail: payload.scans.some((scan) => scan && scan.native),
            });

            return payload;
        }

        return {
            // import helpers
            normalizeImportObjects,
            mergeImportedScansAndScreenshots,
            ensureFindingUidsOnImportedScans,
            ensureUniqueImportedScanIds,

            // payload builders
            buildWorkflowPayloadBase,
            finalizeWorkflowPayload,
            buildScanPayload,

            // misc helpers you already use elsewhere
            stitchScreenshots,
            normalizeShotToEntry,
            computeScanOrderIds,

            // exposed for testing/debug
            computeImportedFindingUid,
            computeCanonicalScore,
            countCanonicalOutcomes
        };
    }

    return { createWorkflowPayloadBuilder };
});