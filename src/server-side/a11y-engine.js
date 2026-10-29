'use strict';

/**
 * Accessibility Engine Facade
 *
 * Contract:
 * - Runner, server, workflow, and UI talk ONLY to this module.
 * - This module returns the CANONICAL result model.
 * - Swapping engines should not require changes outside engine adapter modules.
 *
 * The engine is surea11y, @surea11y/core, the one engine the lab runs; its
 * adapter is in ./engines.
 */

const DEFAULT_ENGINE_NAME = 'surea11y';

function normalizeEngineId(id) {
    const s = String(id || '').trim().toLowerCase();
    if (!s) return null;
    // Avoid path traversal and keep ids predictable.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) return null;
    return s;
}

function normalizeEngineKey(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return null;
    // allow spaces for names, but keep it safe
    if (!/^[a-z0-9][a-z0-9 _-]*$/.test(s)) return null;
    return s.replace(/\s+/g, ' '); // collapse whitespace
}

const fs = require('fs');
const path = require('path');
const { annotateEn301549, en301549FromMappings } = require('./canonical/en301549');
const { selectionFromRunOnly, outcomeCounts, separateBestPractices, scanTargetsFor } = require('./conformance-targets');

function isDumpEnabled() {
    const v = String(process.env.A11Y_DUMP_RESULT_JSON || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function safeJsonReplacer() {
    const seen = new WeakSet();
    return function replacer(key, value) {
        if (typeof value === 'bigint') return String(value);
        if (typeof value === 'function') return undefined;
        if (value && typeof value === 'object') {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    };
}

async function dumpResultJson({ result, bundle, engineIds }) {
    if (!isDumpEnabled()) return;

    const dir = process.env.A11Y_DUMP_DIR
        ? path.resolve(process.env.A11Y_DUMP_DIR)
        : path.join(process.cwd(), 'a11y-dumps');

    await fs.promises.mkdir(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const enginesPart = Array.isArray(engineIds) && engineIds.length
        ? engineIds.join('+')
        : (bundle && bundle.id ? bundle.id : 'engine');

    const file = path.join(dir, `result-${enginesPart}-${ts}.json`);

    const payload = {
        dumpedAt: new Date().toISOString(),
        engine: bundle ? { id: bundle.id, name: bundle.name, version: bundle.version } : null,
        enginesRequested: engineIds || null,
        result
    };

    await fs.promises.writeFile(
        file,
        JSON.stringify(payload, safeJsonReplacer(), 2),
        'utf8'
    );

    // Optional: log where it went (keep quiet by default)
    if (String(process.env.A11Y_DUMP_LOG || '').trim()) {
        // eslint-disable-next-line no-console
        console.log(`[a11y] dumped result to ${file}`);
    }
}

/** The engine's adapter module, in ./engines. */
function listEngineCandidateFiles() {
    const out = [];
    for (const dir of [path.join(__dirname, 'engines')]) {
        let files = [];
        try {
            files = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const f of files.filter((name) => /-engine\.js$/i.test(name)).sort()) out.push(path.join(dir, f));
    }
    return out;
}

function loadEnginesRegistry() {
    const files = listEngineCandidateFiles();

    const byId = new Map();   // key: engineId (normalized by normalizeEngineId)
    const byName = new Map(); // key: engineName (normalized by normalizeEngineKey)
    const errors = [];

    for (const full of files) {
        const file = path.relative(path.join(__dirname, '..', '..'), full);

        let mod = null;
        try {
            // eslint-disable-next-line global-require, import/no-dynamic-require
            mod = require(full);
        } catch (e) {
            errors.push({ file, error: String(e?.message || e) });
            continue;
        }

        const rawId = mod && typeof mod.engineId === 'string' ? mod.engineId : null;
        const rawName = mod && typeof mod.engineName === 'string' ? mod.engineName : null;

        const id = normalizeEngineId(rawId) || null;
        const nameKey = normalizeEngineKey(rawName) || null;

        if (!id) {
            errors.push({ file, error: 'engineId missing or invalid' });
            continue;
        }

        const bundle = {
            id,
            name: (rawName && String(rawName).trim()) ? String(rawName).trim() : id,
            version: (mod && typeof mod.engineVersion === 'string' && mod.engineVersion.trim()) ? mod.engineVersion.trim() : null,
            mod
        };

        // id must be unique
        if (byId.has(id)) {
            errors.push({ file, error: `Duplicate engineId "${id}"` });
            continue;
        }
        byId.set(id, bundle);

        // name is optional, but if present it should not collide with another name
        if (nameKey) {
            if (byName.has(nameKey)) {
                // Do not overwrite, report collision
                errors.push({ file, error: `Duplicate engineName "${rawName}" (normalized: "${nameKey}")` });
            } else {
                byName.set(nameKey, bundle);
            }
        }
    }

    return { byId, byName, errors };
}

// Build once at module load
const _enginesRegistry = loadEnginesRegistry();

function readEngineConfigFromConfigFile() {
    // Reads a11y-engine.config.json (if present) and returns a normalized config object:
    // { validateCanonical?, engineOptions? }
    const candidates = [
        path.join(process.cwd(), 'a11y-engine.config.json'),
        path.join(__dirname, 'a11y-engine.config.json'),
    ];

    for (const p of candidates) {
        try {
            if (!fs.existsSync(p)) continue;
            const raw = fs.readFileSync(p, 'utf-8');
            const obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') continue;

            const validateCanonical =
                obj.validateCanonical === true ||
                obj.validateCanonical === 'true' ||
                obj.validateCanonical === 1;

            const engineOptions = (obj.engineOptions && typeof obj.engineOptions === 'object') ? obj.engineOptions : null;

            return { validateCanonical, engineOptions };
        } catch {
            // ignore invalid config
        }
    }

    return null;
}


function readRequestedEngineId() {
    return DEFAULT_ENGINE_NAME;
}

function resolveEngineBundle(requestedRaw) {
    const asId = normalizeEngineId(requestedRaw);
    if (asId && _enginesRegistry.byId.has(asId)) return _enginesRegistry.byId.get(asId);

    const asName = normalizeEngineKey(requestedRaw);
    if (asName && _enginesRegistry.byName.has(asName)) return _enginesRegistry.byName.get(asName);

    // fallback, allow legacy filename-based loading only if you still want it:
    return null;
}

function loadEngineAdapterByIdOrName(explicit) {
    const requested = explicit || DEFAULT_ENGINE_NAME;

    const bundle = resolveEngineBundle(requested);
    if (bundle && bundle.mod && typeof bundle.mod.runOnPage === 'function') return bundle;

    // If not found, throw a helpful error
    const known = Array.from(_enginesRegistry.byId.values()).map(b => ({
        id: b.id,
        name: b.name,
        version: b.version
    }));

    const hint = known.length
        ? `Known engines: ${known.map(k => `${k.id} (${k.name})`).join(', ')}`
        : 'No engines discovered in ./engines';

    throw new Error(`The lab runs surea11y only; "${requested}" is not an engine it has. ${hint}`);
}

const loaded = loadEngineAdapterByIdOrName(readRequestedEngineId());
const adapter = loaded.mod;

const engineId = loaded.id || 'unknown';
const engineName = loaded.name || engineId;
const engineVersion = loaded.version || null;

function isCanonicalValidationEnabled() {
    // 1) Environment variable
    const env = String(process.env.A11Y_VALIDATE_CANONICAL || '').trim().toLowerCase();
    if (env === '1' || env === 'true' || env === 'yes' || env === 'on') return true;

    // 2) CLI flags
    const args = Array.isArray(process.argv) ? process.argv.slice(2) : [];
    if (args.includes('--validate-canonical') || args.includes('--a11y-validate-canonical')) {
        return true;
    }

    // 3) Config file (reuse the same config file as engine selection)
    try {
        const fs = require('fs');
        const path = require('path');

        const candidates = [
            path.join(process.cwd(), 'a11y-engine.config.json'),
            path.join(__dirname, 'a11y-engine.config.json'),
        ];

        for (const p of candidates) {
            if (!fs.existsSync(p)) continue;
            const raw = fs.readFileSync(p, 'utf-8');
            const cfg = JSON.parse(raw);
            if (cfg && cfg.validateCanonical === true) return true;
        }
    } catch {
        // ignore config errors, validation stays off
    }

    return false;
}

function getRulesCatalog(engineIdOverride = null) {
    const bundle = getAdapterBundle(engineIdOverride);
    const active = bundle?.mod || adapter;

    if (!active || typeof active.getRulesCatalog !== 'function') {
        return {
            engines: [{
                id: bundle?.id || engineId,
                name: bundle?.name || engineName,
                version: bundle?.version || engineVersion
            }],
            version: bundle?.version || engineVersion || null,
            rules: [],
            error: 'Rules catalog not available for this engine'
        };
    }

    const out = active.getRulesCatalog();

    // Best-effort normalization wrapper, without breaking existing engine payloads.
    // Keep engine-provided fields, just add engine metadata in a consistent place.
    if (out && typeof out === 'object') {
        return {
            engines: [{ id: bundle.id, name: bundle.name, version: bundle.version }],
            ...out
        };
    }

    return {
        engines: [{ id: bundle.id, name: bundle.name, version: bundle.version }],
        version: bundle.version || null,
        rules: []
    };
}

const _adapterCache = new Map();
// Seed cache with the default selected adapter.
try {
    _adapterCache.set(String(engineId), { id: String(engineId), mod: adapter, name: engineName, version: engineVersion });
} catch {}

function getAdapterBundle(engineIdOverride = null) {
    const overrideBundle = engineIdOverride ? resolveEngineBundle(engineIdOverride) : null;

    if (!overrideBundle || overrideBundle.id === String(engineId)) {
        return { id: String(engineId), mod: adapter, name: engineName, version: engineVersion };
    }

    const cached = _adapterCache.get(overrideBundle.id);
    if (cached && cached.mod) return cached;

    const loadedOther = loadEngineAdapterByIdOrName(overrideBundle.id); // id is now canonical
    const bundle = { id: loadedOther.id, mod: loadedOther.mod, name: loadedOther.name, version: loadedOther.version };
    _adapterCache.set(bundle.id, bundle);
    return bundle;
}

/**
 * The rule ids each selected engine accepts in a scan step, for the step
 * editor to check typed ids against: [{ id, ruleIds }], with ruleIds null
 * for an engine that publishes no rule list (nothing can be said about it).
 * An adapter may add ids its catalog leaves out, such as rollups or a
 * prefixed form, through getSelectableRuleIds().
 */
function getKnownRuleIds(engineIdOverride = null) {
    const ids = normalizeEngineIdList(engineIdOverride) || [String(engineId)];
    return {
        engines: ids.map((id) => {
            let ruleIds = null;
            try {
                const bundle = getAdapterBundle(id);
                const mod = bundle && bundle.mod ? bundle.mod : null;
                const catalog = mod && typeof mod.getRulesCatalog === 'function' ? mod.getRulesCatalog() : null;
                const rules = catalog && Array.isArray(catalog.rules) ? catalog.rules : [];
                const set = new Set(rules.map((r) => String((r && (r.ruleId || r.id)) || '').trim()).filter(Boolean));
                if (mod && typeof mod.getSelectableRuleIds === 'function') {
                    for (const extra of mod.getSelectableRuleIds() || []) if (extra) set.add(String(extra));
                }
                ruleIds = set.size ? Array.from(set).sort() : null;
            } catch {
                ruleIds = null;
            }
            return { id, ruleIds };
        })
    };
}

function normalizeEngineIdList(engineIdOverride) {
    if (!engineIdOverride) return null;

    const parts = Array.isArray(engineIdOverride)
        ? engineIdOverride
        : (typeof engineIdOverride === 'string' ? engineIdOverride.split(',') : [engineIdOverride]);

    const out = [];
    for (const p of parts) {
        const token = String(p || '').trim();
        if (!token) continue;

        const bundle = resolveEngineBundle(token);
        if (bundle && bundle.id) out.push(bundle.id);
    }

    return out.length ? Array.from(new Set(out)) : null;
}

function cloneCanonicalFindingWithProvenance(finding, engineMeta) {
    const f = (finding && typeof finding === 'object') ? finding : {};
    const uidRaw = (typeof f.uid === 'string' && f.uid) ? f.uid : '';
    const engineId = engineMeta && engineMeta.id ? String(engineMeta.id) : 'unknown';

    // Idempotent uid prefixing: if it's already prefixed with "<engineId>|", keep it
    const mergedUid =
        uidRaw && uidRaw.startsWith(`${engineId}|`)
            ? uidRaw
            : (uidRaw ? `${engineId}|${uidRaw}` : `${engineId}|`);


    // Note: preserve everything else, only add provenance fields and adjust uid
    return {
        ...f,
        uid: mergedUid,
        engineId,
        provenance: {
            ...(f.provenance && typeof f.provenance === 'object' ? f.provenance : null),
            engine: {
                id: engineId,
                name: engineMeta && engineMeta.name ? String(engineMeta.name) : engineId,
                version: engineMeta && engineMeta.version ? String(engineMeta.version) : null
            }
        }
    };
}

function applyProvenanceToCanonical(canonical, engineMeta) {
    if (!canonical || typeof canonical !== 'object') return canonical;

    const out = canonical;

    // Findings: ensure each finding has engine provenance + engine-prefixed uid
    const findings = Array.isArray(out.findings) ? out.findings : [];
    if (findings.length) {
        out.findings = findings.map((f) => cloneCanonicalFindingWithProvenance(f, engineMeta));
        // Rebuilt over the stamped clones, as a merge of engines does: the
        // engine's own copy holds the originals, with their unprefixed uids.
        out.findingsByKind = {
            composite: out.findings.filter((f) => f && f.meta && f.meta.atomic === false),
            atomic: out.findings.filter((f) => !f || !f.meta || f.meta.atomic !== false)
        };
    }

    return out;
}

async function ensureInjected(page, engineIdOverride = null) {
    const bundle = getAdapterBundle(engineIdOverride);
    const active = bundle?.mod || adapter;
    if (typeof active.ensureInjected === 'function') return active.ensureInjected(page);
}

// `options` ({ wcagLevel, engineOptions }) are the scan's own, so an adapter
// that reads them (surea11y's, for its conformance target) lists the rules
// the scan ran; others ignore them.
async function getRulesForRunOnly(page, runOnly, engineIdOverride = null, options = {}) {
    const bundle = getAdapterBundle(engineIdOverride);
    const active = bundle?.mod || adapter;
    if (typeof active.getRulesForRunOnly === 'function') return active.getRulesForRunOnly(page, runOnly, options);
    return [];
}

function saveHtmlReport(reportModel, meta = {}, engineIdOverride = null) {
    const bundle = getAdapterBundle(engineIdOverride);
    const active = bundle?.mod || adapter;
    if (typeof active.saveHtmlReport !== 'function') {
        throw new Error(`Engine "${bundle?.id || engineId}" does not support saveHtmlReport`);
    }
    return active.saveHtmlReport(reportModel, meta);
}

/**
 * Runs the selected engine and returns the canonical model.
 * Native data may be returned only when explicitly requested by the caller (debug/export switches).
 */
async function runOnPage(
    page,
    { selection, runOnly, wcagLevel, contextSelector, excludeSelectors, engineOptions, postProcess, elementScreenshots = null } = {},
    engineIdOverride = null
) {
    const engineIds = normalizeEngineIdList(engineIdOverride);
    // A scan runs one engine. Several engines on one page are several scans,
    // which a Merged scan step reports as one.
    if (engineIds && engineIds.length > 1) {
        throw new Error(`A scan runs one engine, not ${engineIds.join(', ')}: add a scan for each, in a Merged scan to report them as one.`);
    }
    // What the scan checks against, which each adapter maps to its own terms.
    // A caller that gives none gives tags and a level instead.
    const scanSelection = selection !== undefined
        ? selection
        : selectionFromRunOnly({ runOnly, wcagLevel, profile: engineOptions && engineOptions.profile });

    const bundle = getAdapterBundle(engineIds && engineIds.length === 1 ? engineIds[0] : null);
    const active = bundle && bundle.mod ? bundle.mod : adapter;

    const result = await active.runOnPage(page, {
        selection: scanSelection,
        runOnly,
        wcagLevel,
        contextSelector,
        excludeSelectors,
        engineOptions,
        postProcess,
        // Pictures of flagged elements: only an engine that takes them
        // (surea11y, through its binding) reads it.
        elementScreenshots
    });

    await dumpResultJson({ result, bundle, engineIds });

    if (result && result.canonical && typeof result.canonical === 'object') {
        const engineMeta = { id: bundle.id, name: bundle.name, version: bundle.version };

        result.canonical.engines = [engineMeta];
        result.canonical.primaryEngineId = engineMeta.id;

        if ('engine' in result.canonical) delete result.canonical.engine; // hard break

        // Always apply provenance.
        applyProvenanceToCanonical(result.canonical, engineMeta);
        // EN 301 549's clauses on an EN 301 549 scan: surea11y's as core
        // names them, under its profile; for an engine that cannot name them,
        // those of the version the scan targeted.
        if (bundle.id === 'surea11y') en301549FromMappings(result.canonical);
        else annotateEn301549(result.canonical, { profile: scanSelection && scanSelection.profile });
        separateBestPractices(result.canonical);
    }

    if (isCanonicalValidationEnabled()) {
        const { validateCanonicalOrThrow } = require('./canonical/validate-canonical');
        validateCanonicalOrThrow(result && result.canonical, { engineId: bundle.id, engineVersion: bundle.version });
    }

    return result;
}

/**
 * The engine a scan step names, or the default engine without one:
 * { id, name, version, selectsBy }. Throws, naming the engines there are, for
 * one that is not installed.
 */
function describeEngine(engineIdOverride = null) {
    const bundle = engineIdOverride ? loadEngineAdapterByIdOrName(engineIdOverride) : getAdapterBundle(null);
    const caps = bundle && bundle.mod && bundle.mod.capabilities && typeof bundle.mod.capabilities === 'object'
        ? bundle.mod.capabilities
        : {};
    return { id: bundle.id, name: bundle.name, version: bundle.version, selectsBy: caps.selectsBy || null };
}

function getCapabilities(engineIdOverride = null) {
    const overrideBundle = engineIdOverride ? resolveEngineBundle(engineIdOverride) : null;

    let capsAdapter = adapter;
    let capsEngineId = engineId;
    let capsEngineName = engineName;
    let capsEngineVersion = engineVersion;

    if (overrideBundle && overrideBundle.id && overrideBundle.id !== engineId) {
        // ensure it is loadable
        const loadedOther = loadEngineAdapterByIdOrName(overrideBundle.id);
        capsAdapter = loadedOther.mod;
        capsEngineId = loadedOther.id;
        capsEngineName = loadedOther.name;
        capsEngineVersion = loadedOther.version;
    }

    const caps =
        (capsAdapter && typeof capsAdapter === 'object' && capsAdapter.capabilities && typeof capsAdapter.capabilities === 'object')
            ? capsAdapter.capabilities
            : { actions: {} };

    const cfg = readEngineConfigFromConfigFile();
    const engineOptions = (cfg && cfg.engineOptions && typeof cfg.engineOptions === 'object') ? cfg.engineOptions : null;

    return {
        engines: [{ id: capsEngineId, name: capsEngineName, version: capsEngineVersion }],
        engineOptions,
        capabilities: caps,
        // The conformance targets a scan step with this engine can choose.
        conformanceTargets: scanTargetsFor(caps.selectsBy)
    };
}

function listEngines() {
    const engines = Array.from(_enginesRegistry.byId.values())
        .map((b) => ({
            id: b.id,
            name: b.name,
            version: b.version,
            loadable: true,
            error: null
        }));

    return {
        engines,
        defaultEngineId: readRequestedEngineId(),
        selectedEngineId: engineId
    };
}

module.exports = {
    // metadata (useful for reporting)
    engineId,
    engineName,
    engineVersion,

    // per-run helpers (used by runner)

    // execution helpers (override-aware)
    ensureInjected,
    runOnPage,

    // optional, preserved for compatibility
    postProcessResults: adapter.postProcessResults,
    getRulesForRunOnly, // override-aware

    // optional report export, override-aware
    saveHtmlReport,
    supportsHtmlReport: typeof adapter.saveHtmlReport === 'function',

    // optional metadata/catalog (override-aware)
    getRulesCatalog,
    getKnownRuleIds,

    // capabilities (metadata for UI)
    getCapabilities,
    describeEngine,
    supportsCapabilities: !!(adapter && adapter.capabilities),

    // engine discovery (for UI)
    listEngines
};
