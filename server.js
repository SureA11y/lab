const path = require("path");
const express = require("express");

const { runA11yWorkflow, getBrowserPid } = require("./src/server-side/a11y-runner");
const { REPORTS_ROOT } = require("./src/server-side/report-paths");
const { ACTION_DEFINITIONS } = require("./src/workflow/action-definitions");
const a11yEngine = require("./src/server-side/a11y-engine");
const {
    PAYLOAD,
    envFlag,
    resolveDeterminism,
    hasEvidenceCaptureAction,
    validateUrlOrThrow,
    executeWorkflowRun
} = require("./src/server-side/workflow-run");
const { summarizeDryRun } = require("./src/server-side/dry-run-summary");
const { startRunSweeper } = require("./src/server-side/run-sweep");
const { requestCancel } = require("./src/server-side/run-cancel");
const { createRunResultStore, sendWithPayloadFile } = require("./src/server-side/run-results");
const { createRunGate, maxRunsFrom } = require("./src/server-side/run-gate");
const { createBatchImages, packResultImages } = require("./src/server-side/batch-package");
const { createProgressLog } = require("./src/server-side/progress-log");
const { createRunQueue } = require("./src/server-side/run-queue");
const { createResourceSampler } = require("./src/server-side/resource-sampler");
const { registerQueueRoutes, resolveQueueBaseDir } = require("./src/server-side/queue-routes");
const { createRequestGuard } = require("./src/server-side/request-guard");
const { proceduresForRequirements } = require("./src/server-side/procedures");
const { installedStandards } = require("./src/server-side/standard-packs");

// --------------------------- Crash guard (dev) ---------------------------

function isCancelishPuppeteerError(err) {
    const msg = String(err && err.message ? err.message : err);
    return (
        /Navigating frame was detached/i.test(msg) ||
        /LifecycleWatcher terminated/i.test(msg) ||
        /Execution context was destroyed/i.test(msg) ||
        /Target closed/i.test(msg) ||
        /Session closed/i.test(msg) ||
        /Protocol error/i.test(msg)
    );
}

// Node 24: unhandled rejections are fatal by default.
// Keep the server alive on cancellation-related Puppeteer teardown errors.
process.on('unhandledRejection', (reason) => {
    if (isCancelishPuppeteerError(reason)) {
        console.warn('[unhandledRejection] swallowed cancel-related Puppeteer error:', reason && reason.message ? reason.message : reason);
        return;
    }
    console.error('[unhandledRejection]', reason);
});

// Optional: prevent hard crash on known cancel-related uncaught exceptions.
// In production you might want to exit, but for local dev this is useful.
process.on('uncaughtException', (err) => {
    if (isCancelishPuppeteerError(err)) {
        console.warn('[uncaughtException] swallowed cancel-related Puppeteer error:', err && err.message ? err.message : err);
        return;
    }
    console.error('[uncaughtException]', err);
});

// --------------------------- Constants ---------------------------
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const DEBUG_MODE = envFlag("A11Y_DEBUG_MODE", false);

// --------------------------- App init ---------------------------
const app = express();

// Only the lab's own pages, the extension and A11Y_ALLOWED_ORIGINS may call it
// from a browser, and only by a loopback name, an address or
// A11Y_ALLOWED_HOSTS: see request-guard.js. Before the body is read.
app.use(createRequestGuard({
    host: HOST,
    allowedHosts: process.env.A11Y_ALLOWED_HOSTS,
    allowedOrigins: process.env.A11Y_ALLOWED_ORIGINS,
}).middleware);

// Large: /workflow-import takes a whole report, its screenshots included.
app.use(express.json({ limit: '200mb' }));

// Static assets
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// The app's own files; the server's, the CLI's and the scripts' stay private.
const SERVER_ONLY_DIRS = ["server-side", "cli", "scripts", "test-support", "workflow"];
app.use("/src", (req, res, next) => {
    let rel;
    try {
        rel = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, "/"));
    } catch {
        return res.sendStatus(400);
    }
    const first = (rel.split("/").filter(Boolean)[0] || "").toLowerCase();
    if (SERVER_ONLY_DIRS.includes(first)) return res.sendStatus(404);
    next();
});
const labStandaloneClientDir = path.join(__dirname, "src");
app.use("/src", express.static(labStandaloneClientDir));

// --------------------------- Lightweight responses ---------------------------

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

// ACTION_DEFINITIONS never change at runtime, so their JSON is computed once,
// on the first request, instead of on every one.
let actionDefinitionsJson = null;

app.get("/workflows/actions", (_req, res) => {
    if (!actionDefinitionsJson) {
        actionDefinitionsJson = JSON.stringify(ACTION_DEFINITIONS);
    }
    if (!res.get('Content-Type')) res.set('Content-Type', 'application/json');
    res.send(actionDefinitionsJson);
});

app.get("/api/engine/rules", (req, res) => {
    res.set("Cache-Control", "public, max-age=31536000, immutable");

    const requestedEngineId =
        (req.query && typeof req.query.engineId === "string" && req.query.engineId.trim())
            ? req.query.engineId.trim()
            : null;

    try {
        if (a11yEngine && typeof a11yEngine.getRulesCatalog === 'function') {
            return res.json(a11yEngine.getRulesCatalog(requestedEngineId));
        }
    } catch (e) {
        console.error("Failed to read engine rules catalog:", e);
    }

    return res.status(501).json({ error: "Rules catalog not available for current engine" });
});

// The rule ids the lab's engine accepts, for the step editor to check a scan
// step's typed ids against. Without engineId, the lab's engine, by its id.
app.get("/api/engine/rule-ids", (req, res) => {
    res.set("Cache-Control", "no-store");

    const requestedEngineId =
        (req.query && typeof req.query.engineId === "string" && req.query.engineId.trim())
            ? req.query.engineId.trim()
            : null;

    try {
        if (a11yEngine && typeof a11yEngine.getKnownRuleIds === "function") {
            return res.json(a11yEngine.getKnownRuleIds(requestedEngineId));
        }
    } catch (e) {
        console.error("Failed to list engine rule ids:", e);
    }

    return res.json({ engines: [] });
});

app.get("/api/engine/capabilities", (req, res) => {
    res.set("Cache-Control", "no-store");

    const requestedEngineId =
        (req.query && typeof req.query.engineId === "string" && req.query.engineId.trim())
            ? req.query.engineId.trim()
            : null;

    try {
        if (a11yEngine && typeof a11yEngine.getCapabilities === "function") {
            return res.json(a11yEngine.getCapabilities(requestedEngineId));
        }
        return res.json({
            engine: {
                id: a11yEngine?.engineId ?? null,
                name: a11yEngine?.engineName ?? null,
                version: a11yEngine?.engineVersion ?? null
            },
            engineOptions: null,
            capabilities: { actions: {} }
        });
    } catch (e) {
        console.error("Failed to get engine capabilities:", e);
        return res.status(500).json({ error: "Failed to get engine capabilities" });
    }
});

// The standards of the installed packs, besides WCAG: their keys, names,
// versions and profiles (standard-packs.js).
app.get("/api/standards", (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        return res.json({ standards: installedStandards() });
    } catch (e) {
        console.error("Failed to list the installed standards:", e);
        return res.json({ standards: [] });
    }
});

// How a person checks each requirement by hand, from core: ?ids=1.4.13,2.4.3
// and &locale=fr; EN 301 549's own, with &standard=en301549&version=V4.1.1
// (ids such as 4.2.1, 12.1 or 5). { available: false } from a core without
// them.
app.get("/api/procedures", (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        return res.json(proceduresForRequirements(req.query.ids, {
            locale: req.query.locale, standard: req.query.standard, version: req.query.version,
        }));
    } catch (e) {
        console.error("Failed to read the test procedures:", e);
        return res.json({ available: false });
    }
});

// Serve exported reports and screenshots (HTML + images) from disk.
// This is local-lab oriented. Deny dotfiles and do not auto-index.
app.use(
    "/reports",
    express.static(REPORTS_ROOT, {
        dotfiles: "deny",
        fallthrough: false,
        index: false,
        setHeaders(res) {
            // Avoid caching, these are “fresh” per run
            res.setHeader("Cache-Control", "no-store");
        }
    })
);

// --------------------------- Core endpoints ---------------------------

app.post("/workflow-scan", async (req, res) => {
    const { url, tags, actions, scenarioName, viewport, colorScheme, highContrast, language, acceptUntrustedCerts } = req.body || {};

    const debugNative =
        DEBUG_MODE ||
        req.query?.debugNative === '1' ||
        req.query?.debugNative === 'true';
    const wantReport = hasEvidenceCaptureAction(actions);
    const runScope = runScopeProblem(req.body);
    if (runScope) return res.status(400).json(runScope);

    try {
        validateUrlOrThrow(url);

        const determinism = resolveDeterminism();

        const out = await runA11yWorkflow(url, tags, {
            actions,
            viewport,
            colorScheme,
            highContrast,
            language,
            acceptUntrustedCerts: acceptUntrustedCerts === true || acceptUntrustedCerts === 'on',
            determinism,
            debugNative,
            exportReport: wantReport,
            reportsSubdir: wantReport ? scenarioName : null
        });

        const payload = PAYLOAD.buildWorkflowPayloadBase({
            url,
            scenarioName,
            actions,
            actionResults: out.actionResults,
            scans: out.scans,
            workflowScreenshots: out.screenshots,
            runDiagnostics: out.runDiagnostics,
            collectedOutputs: out.collectedOutputs,
            cancelled: !!out.cancelled,
            debugNative,
            includeScanScreenshots: true,
        });

        // Keep report export behavior here (side effects, disk writes)
        for (let i = 0; i < (out.scans || []).length; i += 1) {
            const scan = out.scans[i];
            const scanPayload = payload.scans[i];
            if (!scan || !scanPayload) continue;

            const isSkipped = !!scan.skipped || !!scan.skipInfo;

            if (!isSkipped && wantReport) {
                try {
                    const saveFn = a11yEngine && typeof a11yEngine.saveHtmlReport === 'function'
                        ? a11yEngine.saveHtmlReport
                        : null;

                    if (saveFn) {
                        const report = await saveFn({
                            runOnly: scan.runOnly || null,
                            canonical: scan.canonical || null,
                            native: scan.results || scan.nativeForReport || null
                        }, {
                            url: scan.url || url,
                            label: scan.label || null,
                            actions,
                            scenarioName,
                            screenshot: scan.screenshot || null,
                        });

                        scanPayload.report = report;

                        const childScenarioName = scenarioName
                            ? `${scenarioName} / ${scan.label || scan.id}`
                            : (scan.label || scan.id);

                        scanPayload.screenshots = PAYLOAD.stitchScreenshots(scan, report);
                    }
                } catch (reportError) {
                    console.error("Failed to save HTML report for workflow scan", scan.id, reportError);
                }
            }
        }

        PAYLOAD.finalizeWorkflowPayload(payload);
        res.json(payload);
    } catch (error) {
        console.error("Workflow scan failed:", error);
        const message = error && error.message ? error.message : "Workflow scan failed";
        const statusCode = /Invalid url|Missing url/i.test(message) ? 400 : 500;
        res.status(statusCode).json({ error: "Workflow scan failed", details: message });
    }
});


/**
 * Import precomputed scans (from one or multiple JSON objects),
 * merge them, and return the same final payload shape as a workflow run.
 *
 * Request body accepted:
 *  - { items: [ { scans: [...], screenshots?: [...] }, ... ], scenarioName?, url?, actions?, actionResults? }
 *  - OR { scans: [...], screenshots?: [...], scenarioName?, url?, actions?, actionResults? }
 *  - OR body is an array of objects: [ { scans: [...] }, ... ]
 *
 * Query params:
 *  - includeScreenshots=1 to include stitched scan screenshots + workflow screenshots in response
 */
app.post("/workflow-import", async (req, res) => {
    const debugNative =
        DEBUG_MODE ||
        req.query?.debugNative === '1' ||
        req.query?.debugNative === 'true';

    const includeScreenshots =
        req.query?.includeScreenshots === '1' ||
        req.query?.includeScreenshots === 'true';

    try {
        const body = req.body;

        const importObjs = PAYLOAD.normalizeImportObjects(body);
        if (!importObjs.length) {
            return res.status(400).json({
                error: "Import failed",
                details: "Body must include scans, or items/files/analyses containing scans"
            });
        }

        const merged = PAYLOAD.mergeImportedScansAndScreenshots(importObjs);

        if (!Array.isArray(merged.scans) || merged.scans.length === 0) {
            return res.status(400).json({
                error: "Import failed",
                details: "No scans found in provided object(s)"
            });
        }

        // Allow top-level metadata, fallback to first object if present
        const top = (body && typeof body === 'object' && !Array.isArray(body)) ? body : null;
        const first = importObjs[0] && typeof importObjs[0] === 'object' ? importObjs[0] : null;

        const url = (top && typeof top.url === 'string' && top.url) ? top.url : (first && typeof first.url === 'string' ? first.url : null);
        const scenarioName =
            (top && typeof top.scenarioName === 'string' && top.scenarioName) ? top.scenarioName
                : (first && typeof first.scenarioName === 'string' ? first.scenarioName : null);

        const actions = (top && Array.isArray(top.actions)) ? top.actions : (first && Array.isArray(first.actions) ? first.actions : null);
        const actionResults = (top && Array.isArray(top.actionResults)) ? top.actionResults : (first && Array.isArray(first.actionResults) ? first.actionResults : null);

        // If caller provides runDiagnostics, keep it, otherwise empty-ish
        const runDiagnostics =
            (top && top.runDiagnostics && typeof top.runDiagnostics === 'object') ? top.runDiagnostics
                : (first && first.runDiagnostics && typeof first.runDiagnostics === 'object') ? first.runDiagnostics
                    : undefined;

        const payload = PAYLOAD.buildWorkflowPayloadBase({
            url: url || null,
            scenarioName: scenarioName || null,
            actions: actions || null,
            actionResults: actionResults || null,
            scans: PAYLOAD.ensureUniqueImportedScanIds(
                PAYLOAD.ensureFindingUidsOnImportedScans(merged.scans)
            ),
            workflowScreenshots: includeScreenshots ? merged.screenshots : [],
            runDiagnostics,
            cancelled: false,
            debugNative,
            includeScanScreenshots: includeScreenshots,
        });

        PAYLOAD.finalizeWorkflowPayload(payload);

        return res.json({ ok: true, payload });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return res.status(500).json({ error: "Import failed", details: message });
    }
});


// --------------------------- Manual workflow endpoints ---------------------------

app.post("/manual-start", (req, res) => {
    const { scenarioName, tags } = req.body || {};

    const runId = newManualRunId();

    ManualRuns.set(runId, {
        createdAt: Date.now(),
        status: "collecting",
        logs: [],
        config: {
            scenarioName: (typeof scenarioName === "string" && scenarioName.trim()) ? scenarioName.trim() : null,
            tags: tags ?? null
        },
        scans: [],
        screenshots: [],
        runDiagnostics: null,
        result: null
    });

    return res.json({ ok: true, runId });
});

app.post("/manual-scan", async (req, res) => {
    try {
        const { runId, scan } = req.body || {};

        const run = ManualRuns.get(runId);
        if (!run) return res.status(404).json({ ok: false, error: "Unknown runId" });

        // New mode: the extension sends a fully adapted scan object
        if (!scan || typeof scan !== "object") {
            return res.status(400).json({
                ok: false,
                error: "Missing scan. Expected body: { runId, scan }"
            });
        }

        // Minimal validation, keep it lightweight, server should not rewrite
        const canonical = scan.canonical;
        if (!canonical || typeof canonical !== "object" || !Array.isArray(canonical.findings)) {
            return res.status(400).json({
                ok: false,
                error: "Invalid scan.canonical. Expected canonical.findings to be an array"
            });
        }

        const scanId =
            (typeof scan.scanId === "string" && scan.scanId.trim())
                ? scan.scanId.trim()
                : ((typeof scan.id === "string" && scan.id.trim()) ? scan.id.trim() : null);

        if (!scanId) {
            return res.status(400).json({
                ok: false,
                error: "Invalid scan. Expected scan.scanId or scan.id"
            });
        }

        run.scans.push(scan);
        run.lastActivityAt = Date.now();

        run.logs.push({
            time: new Date().toISOString(),
            type: "scan",
            message: "manual scan added",
            depth: 0,
            extra: { scanId }
        });

        return res.json({ ok: true, scanId });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

app.post("/manual-finish", (req, res) => {
    try {
        const { runId } = req.body || {};
        const run = ManualRuns.get(runId);
        if (!run) return res.status(404).json({ ok: false, error: "Unknown runId" });

        if (run.status !== "collecting") {
            return res.json({ ok: true, status: run.status });
        }

        const scenarioName = run.config?.scenarioName || null;

        const payload = PAYLOAD.buildWorkflowPayloadBase({
            url: run.scans.length ? (run.scans[0].url || null) : null,
            scenarioName,
            actions: null,
            actionResults: null,
            scans: run.scans,
            workflowScreenshots: run.screenshots,
            runDiagnostics: run.runDiagnostics,
            cancelled: false,
            debugNative: false,
            includeScanScreenshots: true, // no screenshots yet
        });

        PAYLOAD.finalizeWorkflowPayload(payload);

        run.result = payload;
        run.status = "done";

        run.logs.push({
            time: new Date().toISOString(),
            type: "info",
            message: "manual workflow finished",
            depth: 0
        });

        return res.json({ ok: true, status: run.status });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

app.get("/manual-result", (req, res) => {
    const { runId } = req.query || {};
    const run = ManualRuns.get(runId);
    if (!run) return res.status(404).json({ ok: false, error: "Unknown runId" });

    if (run.status !== "done") {
        return res.status(202).json({ status: run.status });
    }

    return res.json({ status: run.status, payload: run.result });
});

// --------------------------- Live runs manager ---------------------------

/**
 * In memory registry for live runs.
 * runId -> { createdAt, log, status, cancelled, result, finishedAt? }
 * `log` is a progress log (src/server-side/progress-log.js): every line, but
 * only the latest screenshots, so a run with hundreds of scans stays small.
 * status in {"running","cancelling","done","cancelled","error"}
 * Finished runs are removed by the sweep below.
 */
const Runs = new Map();

// --------------------------- Manual runs manager ---------------------------
// In memory registry for manual runs (extension-driven).
// runId -> { createdAt, status, logs: [], config, scans: [], screenshots: [], runDiagnostics, result, lastActivityAt?, finishedAt? }
// status in {"collecting","done","error"}
// Finished runs, and collecting runs left idle, are removed by the sweep below.
const ManualRuns = new Map();

// Drop finished runs from both registries a while after they end, so their
// results and screenshots do not stay in memory until the process exits. App
// runs go 30 minutes after they end. Extension sessions are finished and
// fetched with separate clicks, so they keep 4 hours; one that stops receiving
// scans without being finished (DevTools closed mid-capture) also goes after 4
// idle hours.
const EXTENSION_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
// How many /workflow-start runs go at once (A11Y_MAX_RUNS, default 4).
const runGate = createRunGate(maxRunsFrom(process.env.A11Y_MAX_RUNS));

// Each finished run's result, in a file until the run is swept.
const runResults = createRunResultStore();
process.on("exit", () => runResults.clear());
// Stopped by a signal, the server still exits as it did: with 128 + its number.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.once(signal, () => process.exit(code));
}

startRunSweeper([
    {
        runs: Runs,
        isFinished: (status) => status === "done" || status === "cancelled" || status === "error",
        onRemove: (run) => runResults.remove(run.resultFile),
    },
    {
        runs: ManualRuns,
        isFinished: (status) => status === "done" || status === "error",
        ttlMs: EXTENSION_SESSION_TTL_MS,
        isOpen: (status) => status === "collecting",
        idleMs: EXTENSION_SESSION_TTL_MS,
    },
]);

// A run no longer has Include or Exclude selectors: each scan step has its
// own. A request that still sends them is refused rather than run checking
// more than it asked for; the converter puts them on its scans.
function runScopeProblem(body) {
    const given = ['context', 'exclude'].filter((key) => {
        const v = body && body[key];
        return Array.isArray(v) ? v.length > 0 : (typeof v === 'string' ? v.trim() !== '' : v != null);
    });
    if (!given.length) return null;
    return {
        error: "A run has no Include or Exclude selectors",
        details: `"${given.join('" and "')}" ${given.length === 1 ? 'is' : 'are'} each scan step's now (its own context and exclude). `
            + 'node src/cli/convert-config.js <file> --write puts them on the scans, as the run applied them.'
    };
}

function newManualRunId() {
    return "manual_" + Math.random().toString(36).slice(2, 10);
}

function newRunId() {
    return "run_" + Math.random().toString(36).slice(2, 10);
}

app.post("/workflow-start", async (req, res) => {
    const { url, actions, customSteps, scenarioName, viewport, colorScheme, highContrast, language, acceptUntrustedCerts, vars } = req.body || {};
    // Dry run: every step but the scans, screenshots and evidence, and what
    // that found as a summary instead of a report (dry-run-summary.js).
    const dryRun = req.body?.dryRun === true;
    const debugNative =
        DEBUG_MODE ||
        req.query?.debugNative === '1' ||
        req.query?.debugNative === 'true';

    if (!Array.isArray(actions) || actions.length === 0) {
        return res
            .status(400)
            .json({ error: "No actions to run", details: "Define at least one action (e.g., a11yScan)." });
    }
    const runScope = runScopeProblem(req.body);
    if (runScope) return res.status(400).json(runScope);
    try {
        validateUrlOrThrow(url);

        const runId = newRunId();
        const abortController = new AbortController();

        Runs.set(runId, {
            createdAt: Date.now(),
            log: createProgressLog(),
            status: "running",
            cancelled: false,
            result: null,
            abortController,
        });

        // Fire and forget task
        (async () => {
            // A dry run's summary reads the scans it skipped from the log.
            const dryRunLog = [];
            const progress = (entry) => {
                if (dryRun) dryRunLog.push(entry);
                const target = Runs.get(runId);
                if (!target) return;
                target.log.push(entry);
            };

            // Its turn first: at most runGate.max runs go at once. One
            // cancelled while it waited ends at once when its turn comes.
            await runGate.enter((active) => progress({
                time: new Date().toISOString(),
                type: "info",
                message: `Waiting for a free slot: ${active} runs are going, and at most ${runGate.max} go at once`,
                depth: 0,
            }));
            let outcome;
            try {
                outcome = await executeWorkflowRun(
                    { url, actions, customSteps, viewport, colorScheme, highContrast, language, acceptUntrustedCerts: acceptUntrustedCerts === true || acceptUntrustedCerts === 'on', scenarioName, vars },
                    {
                        progress,
                        debugNative,
                        dryRun,
                        isCancelled: () => {
                            const r = Runs.get(runId);
                            return !!(r && r.cancelled);
                        },
                        abortSignal: Runs.get(runId)?.abortController?.signal || null,
                    }
                );
            } finally {
                runGate.leave();
            }
            const { status, payload, error } = outcome;

            const sink = Runs.get(runId);
            if (!sink) return;

            if (dryRun) sink.dryRun = summarizeDryRun({ actions, payload, status, error, logs: dryRunLog });

            const time = new Date().toISOString();

            // A run that failed before producing any scan has no payload to show.
            if (!payload) {
                sink.status = "error";
                sink.result = error;
                sink.log.push({ time, type: "error", message: error.details, depth: 0 });
                return;
            }

            // Its pictures as files the lab serves, under reports/runs/<run>/
            // images/, as element pictures already are: the result names
            // each by its link, and is its findings, not mostly its pictures.
            // A picture that could not be written stays inline.
            await packResultImages(payload, createBatchImages(path.join(REPORTS_ROOT, "runs", runId)), {
                reportsRoot: REPORTS_ROOT,
                prefix: `/reports/runs/${runId}/images/`,
            }).catch(() => null);

            // To a file, once: the result waits there to be fetched, off the
            // heap (run-results.js). One that cannot be written stays here.
            const kept = await runResults.keep(runId, payload);
            if (kept) sink.resultFile = kept.file;
            sink.result = kept ? null : payload;
            sink.status = status;

            if (status === "cancelled") {
                sink.log.push({ time, type: "info", message: "Workflow cancelled", depth: 0 });
            } else if (status === "error") {
                sink.log.push({ time, type: "error", message: "Workflow failed", depth: 0 });
                sink.log.push({
                    time,
                    type: "error",
                    message: payload.errorDetails?.message || "Workflow failed",
                    depth: 0
                });
            } else {
                sink.log.push({ time, type: "info", message: "Workflow finished", depth: 0 });
            }
        })();

        res.json({ ok: true, runId });
    } catch (error) {
        const message = error && error.message ? error.message : "Workflow start failed";
        const statusCode = /Invalid url|Missing url|Unsupported protocol/i.test(message) ? 400 : 500;
        res.status(statusCode).json({ error: "Workflow start failed", details: message });
    }
});

app.post("/workflow-cancel", (req, res) => {
    const { runId } = req.body || {};
    const run = Runs.get(runId);
    if (!run) return res.status(404).json({ error: "Unknown runId" });

    const { status } = requestCancel(run);
    res.json({ ok: true, status });
});

app.get("/workflow-progress", (req, res) => {
    const { runId, since } = req.query || {};
    const run = Runs.get(runId);
    if (!run) return res.status(404).json({ error: "Unknown runId" });

    const { logs, nextIndex } = run.log.slice(since);

    res.json({
        status: run.status,
        nextIndex,
        logs: logs.map((e) => ({
            ...e,
            extra: e.extra,
            vars: e.vars || undefined,
        })),
    });
});

app.get("/workflow-result", (req, res) => {
    const { runId } = req.query || {};
    const run = Runs.get(runId);
    if (!run) return res.status(404).json({ error: "Unknown runId" });

    if (run.status === "running" || run.status === "cancelling") {
        return res.status(202).json({ status: run.status });
    }

    const head = { status: run.status, ...(run.dryRun ? { dryRun: run.dryRun } : {}) };
    // The run's result, finished when the run ended: sent from its file.
    if (run.resultFile) return sendWithPayloadFile(res, head, run.resultFile);

    // A run that failed before producing any scan has its error, not a payload.
    const hasScans = run.result && Array.isArray(run.result.scans);
    if (run.status === "error" && !hasScans) return res.json({ status: run.status, error: run.result, ...(run.dryRun ? { dryRun: run.dryRun } : {}) });

    res.json({ ...head, payload: run.result });
});

// --------------------------- Run queue ---------------------------
// Workflows queued from the app run up to N at a time through the same
// executeWorkflowRun as /workflow-start; each result is saved under
// reports/<A11Y_QUEUE_DIR, default batches>/<session start time>/ as it
// finishes. See docs/design/workflow-queue-batch-design.md.

const QUEUE_DIR = resolveQueueBaseDir(REPORTS_ROOT, process.env.A11Y_QUEUE_DIR);
const runQueue = createRunQueue({
    baseDir: QUEUE_DIR,
    reportsRoot: REPORTS_ROOT,
    executeRun: (spec, hooks) => executeWorkflowRun(spec, { ...hooks, debugNative: DEBUG_MODE }),
    validateUrl: validateUrlOrThrow,
    // Sampled while a batch runs, for the governor that holds the next run
    // while memory is high (§5.2) and each session's metrics.jsonl (§5.1);
    // A11Y_QUEUE_METRICS=0 turns the file off, not the governor.
    resourceSampler: createResourceSampler({ browserPid: getBrowserPid }),
    writeMetrics: envFlag("A11Y_QUEUE_METRICS", true),
});
const interruptedSessions = runQueue.init();
if (interruptedSessions.length) {
    console.log(`[run-queue] ${interruptedSessions.length} queue session(s) were interrupted by the last shutdown; resume them from the queue tab.`);
}
registerQueueRoutes(app, runQueue, { reportsRoot: REPORTS_ROOT, baseDir: QUEUE_DIR });

// --------------------------- Root redirect ---------------------------

app.get("/", (req, res) => {
    // The query goes along: ?report= and ?compare= open reports in the app.
    const query = req.originalUrl.indexOf("?");
    res.redirect("/src/" + (query >= 0 ? req.originalUrl.slice(query) : ""));
});

// --------------------------- Start ---------------------------

app.listen(PORT, HOST, () => {
    console.log(`Accessibility lab server listening on http://${HOST}:${PORT}`);
});

// --------------------------- Metrics definitions ---------------------------

app.get("/api/metrics/defs", (_req, res) => {
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.json({ metricDefs: METRIC_DEFS });
});
