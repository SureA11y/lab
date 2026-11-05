'use strict';

(function (root) {
    const ENGINE_ID = '@surea11y';
    const ENGINE_NAME = 'surea11y';
    const ENGINE_VERSION = null;
    const DEFAULT_LOCALE = 'en';
    const DEFAULT_VENDOR_FILE = 'engines/vendor/surea11y.browser.min.js';
    const PACKS_VENDOR_FILE = 'engines/vendor/surea11y-packs.js';
    // As the lab's scan step: how long to wait for the page to finish loading.
    const DEFAULT_PAGE_READY_TIMEOUT_MS = 3000;

    // Read at call time: shared/scan-notes.js is loaded by the panel and the
    // popup, where results are canonicalized, not by the background worker.
    function scanNotes() {
        return root.A11Y_SCAN_NOTES || null;
    }

    const SHARED = root.A11Y_CANONICAL || {};
    const isoNow = typeof SHARED.isoNow === 'function'
        ? SHARED.isoNow
        : function () { return new Date().toISOString(); };
    const CANON_VERSION = SHARED.CANON_VERSION || '1.0.0';

    function resolveSurea11yRuntimeVersion() {
        const candidates = [
            root.__SUREA11Y_BROWSER__,
            root.SUREA11Y_BROWSER,
            root.surea11y,
            root.SureA11y,
            root.A11Y_LABS
        ];
        for (const api of candidates) {
            if (!api) continue;
            const version = api.version || api.VERSION;
            if (version == null) continue;
            const resolved = String(version).trim();
            if (resolved) return resolved;
        }
        return null;
    }

    function normalizeStringList(input) {
        if (!input) return [];
        if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
        if (typeof input === 'string') return input.split(',').map((s) => s.trim()).filter(Boolean);
        return [];
    }

    function normalizeObjectArray(list) {
        return Array.isArray(list) ? list.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : [];
    }

    function normalizeIncludeMode(v) {
        const s = String(v || '').trim().toLowerCase();
        if (s === 'and' || s === 'intersection') return 'and';
        if (s === 'or' || s === 'union') return 'or';
        return null;
    }

    // The runOnly core reads, with only the keys it knows: tags to include go
    // in `tags` (an `includeTags` given here joins them), and an empty list or
    // an unset option is left out. Core warns about a key it doesn't read,
    // once per scan.
    function normalizeRunOnlyInput(runOnly) {
        if (!runOnly || typeof runOnly !== 'object') return null;

        const given = runOnly.type === 'tag'
            ? (Array.isArray(runOnly.values)
                ? runOnly.values
                : typeof runOnly.values === 'string' ? String(runOnly.values).split(',') : [])
            : runOnly.tags;
        const tags = Array.from(new Set([
            ...normalizeStringList(given),
            ...normalizeStringList(runOnly.includeTags)
        ]));
        const lists = {
            excludeTags: normalizeStringList(runOnly.excludeTags),
            includeRuleIds: normalizeStringList(runOnly.includeRuleIds),
            excludeRuleIds: normalizeStringList(runOnly.excludeRuleIds)
        };
        const includeMode = normalizeIncludeMode(runOnly.includeMode);
        // Core's own conformance target and best-practice switch, passed through.
        const wcag = runOnly.type === 'tag' ? null : normalizeWcagTarget(runOnly.wcag);
        const bestPractices = runOnly.type !== 'tag' && runOnly.bestPractices === true;

        // A tag selection is kept even when empty: a standard picked later
        // empties it on purpose.
        if (runOnly.type !== 'tag' && !wcag && !bestPractices && !tags.length &&
            !Object.values(lists).some((l) => l.length)) {
            return null;
        }

        const out = { tags };
        for (const [key, list] of Object.entries(lists)) if (list.length) out[key] = list;
        if (includeMode) out.includeMode = includeMode;
        if (wcag) out.wcag = wcag;
        if (bestPractices) out.bestPractices = true;
        return out;
    }

    function normalizeWcagTarget(v) {
        if (!v || typeof v !== 'object') return null;
        const version = v.version == null ? '' : String(v.version).trim();
        const level = v.level == null ? '' : String(v.level).trim().toUpperCase();
        return (version || level) ? { version, level } : null;
    }

    // The packs this build has (engines/vendor/standards.json), or null when
    // that can't be read, once.
    let builtPackKeysPromise = null;
    function builtPackKeys(helpers) {
        const api = helpers && helpers.api;
        const url = api && api.runtime && typeof api.runtime.getURL === 'function'
            ? api.runtime.getURL('engines/vendor/standards.json')
            : null;
        if (!url || typeof fetch !== 'function') return Promise.resolve(null);
        if (!builtPackKeysPromise) {
            builtPackKeysPromise = (async () => {
                try {
                    const res = await fetch(url);
                    const json = res && res.ok ? await res.json() : null;
                    return json && Array.isArray(json.packs) ? json.packs.map(String) : null;
                } catch {
                    return null;
                }
            })();
        }
        return builtPackKeysPromise;
    }

    async function ensureInjected(tabId, helpers = {}) {

        const execInTab = helpers && helpers.execInTab;
        const injectFile = helpers && helpers.injectFile;
        if (typeof execInTab !== 'function' || typeof injectFile !== 'function') {
            throw new Error('execInTab and injectFile helpers are required for the surea11y extension adapter');
        }

        const [alreadyThere] = await execInTab(tabId, {
            func: () => {
                try {
                    return !!(
                        globalThis.A11Y_LABS_BROWSER ||
                        globalThis.runa11yCoreInPage ||
                        (globalThis.a11yLabs && (globalThis.a11yLabs.runInPage || globalThis.a11yLabs.runa11yCoreInPage))
                    );
                } catch {
                    return false;
                }
            },
            args: []
        }).catch((e) => {
            console.error('[surea11y adapter] ensureInjected probe failed', e);
            return [false];
        });

        if (alreadyThere) {
            console.log('[surea11y adapter] runtime already present in page');
        } else {
            try {
                await injectFile(tabId, DEFAULT_VENDOR_FILE);
            } catch (e) {
                console.error('[surea11y adapter] vendor injection failed', {
                    file: DEFAULT_VENDOR_FILE,
                    message: String(e && e.message ? e.message : e),
                    error: e
                });
                throw e;
            }
        }
        // The installed packs, registered in the page after the engine
        // (build:extension-shared writes the script), also when the engine
        // was already there: a page scanned before the extension was rebuilt
        // keeps its engine and has none of this build's packs. A build
        // without packs has none, and scans with core's own profiles.
        // This build's packs by the name the registry keeps them under
        // ("@surea11y/pack-en301549@1.1.0"): a page holding another build's
        // packs gets these too.
        const wanted = await builtPackKeys(helpers);
        const [registered] = await execInTab(tabId, {
            func: (keys) => {
                try {
                    const registry = globalThis[Symbol.for('surea11y.packs')];
                    if (!registry) return false;
                    // One script of several packs keeps them under their names joined.
                    const have = Object.keys(registry).flatMap((k) => k.split(','));
                    return Array.isArray(keys) ? keys.every((k) => have.includes(k)) : have.length > 0;
                } catch {
                    return false;
                }
            },
            args: [wanted]
        }).catch(() => [false]);
        if (registered) return;
        try {
            await injectFile(tabId, PACKS_VENDOR_FILE);
        } catch {
            // No packs in this build.
        }
    }

    async function runInTab(tabId, options = {}, helpers = {}) {
        const execInTab = helpers && helpers.execInTab;
        if (typeof execInTab !== 'function') {
            throw new Error('execInTab helper is required for the surea11y extension adapter');
        }

        const opts = (options && typeof options === 'object') ? { ...options } : {};
        const ctxSelector = typeof opts.contextSelector === 'string' && opts.contextSelector.trim()
            ? opts.contextSelector.trim()
            : null;
        const excludeSelectors = normalizeStringList(opts.excludeSelectors);
        const normalizedRunOnly = normalizeRunOnlyInput(opts.runOnly);
        let effectiveRunOnly = normalizedRunOnly ? { ...normalizedRunOnly } : null;

        const engineOptions = (opts.engineOptions && typeof opts.engineOptions === 'object')
            ? { ...opts.engineOptions }
            : {};
        if (!engineOptions.locale || !String(engineOptions.locale).trim()) {
            engineOptions.locale = DEFAULT_LOCALE;
        } else {
            engineOptions.locale = String(engineOptions.locale).trim();
        }

        if (excludeSelectors.length) {
            const existing = normalizeStringList(engineOptions.excludeSelectors);
            engineOptions.excludeSelectors = Array.from(new Set([...existing, ...excludeSelectors]));
        }

        // The scan's selection ({ version, level, profile, bestPractices }), as
        // the lab's server adapter takes it: a standard goes to core as its
        // profile, anything else as core's WCAG target and best-practice
        // switch. A caller with no selection may give WCAG tags and a level.
        const targets = root.A11Y_CONFORMANCE_TARGETS;
        const scanLevel = typeof opts.wcagLevel === 'string' ? opts.wcagLevel.trim().toUpperCase() : '';
        const selection = opts.selection !== undefined
            ? opts.selection
            : (targets ? targets.selectionFromRunOnly({ runOnly: opts.runOnly, wcagLevel: opts.wcagLevel, profile: engineOptions.profile }) : null);
        if (selection && targets) {
            if (!effectiveRunOnly) effectiveRunOnly = normalizeRunOnlyInput({ wcag: selection });
            effectiveRunOnly.tags = targets.tagsBesideSelection({ tags: effectiveRunOnly.tags });
            effectiveRunOnly.wcag = { version: selection.version, level: selection.level };
            effectiveRunOnly.bestPractices = selection.bestPractices === true;
            // Several profiles: core scans every one, the WCAG level among them.
            if (Array.isArray(selection.profiles) && selection.profiles.length > 1) engineOptions.profile = selection.profiles.slice();
            else if (selection.profile) engineOptions.profile = selection.profile;
        } else if (effectiveRunOnly && effectiveRunOnly.wcag && ['A', 'AA', 'AAA'].includes(scanLevel)) {
            // A caller's own runOnly.wcag, the scan's level setting its level.
            effectiveRunOnly.wcag = { ...effectiveRunOnly.wcag, level: scanLevel };
        }

        // The rules and tags a caller includes are the ones it runs, as in the
        // lab's server adapter: beside a target, core would add them to its
        // rules (and the best practices with them). The target's version and
        // level stay the ones the scan is judged by.
        if (effectiveRunOnly && effectiveRunOnly.wcag
            && ((effectiveRunOnly.includeRuleIds || []).length || (effectiveRunOnly.tags || []).length)) {
            if (!engineOptions.wcagVersion) engineOptions.wcagVersion = effectiveRunOnly.wcag.version;
            if (!engineOptions.wcagLevel && effectiveRunOnly.wcag.level) engineOptions.wcagLevel = effectiveRunOnly.wcag.level;
            effectiveRunOnly.wcag = null;
            effectiveRunOnly.bestPractices = false;
        }

        // A standard (engineOptions.profile) replaces the target: core applies
        // a profile only when nothing in runOnly includes rules of its own;
        // best-practices add to it. Its WCAG tags are kept aside in case this
        // core release lacks the profile.
        let profileFallbackTags = null;
        let listFallbackRunOnly = null;
        const hasIncludes = effectiveRunOnly && Array.isArray(effectiveRunOnly.includeRuleIds) && effectiveRunOnly.includeRuleIds.length > 0;
        if (typeof engineOptions.profile === 'string' && engineOptions.profile.trim() && effectiveRunOnly && !hasIncludes) {
            const std = targets && targets.CONFORMANCE_TARGETS[engineOptions.profile.trim().toLowerCase()];
            profileFallbackTags = std ? std.tags.slice() : [];
            effectiveRunOnly.tags = [];
            effectiveRunOnly.wcag = null;
        } else if (Array.isArray(engineOptions.profile) && engineOptions.profile.length && effectiveRunOnly && !hasIncludes) {
            // A scan of several profiles names each one that did not run
            // (engine.profilesNotRun) rather than scanning again. A core that
            // scans one profile at a time ignores the list: the page then
            // scans again at the WCAG target (listFallbackRunOnly), and says so.
            listFallbackRunOnly = { ...effectiveRunOnly };
            effectiveRunOnly.tags = [];
            effectiveRunOnly.wcag = null;
        }
        // The packs the extension was built with (engines/vendor/
        // surea11y-packs.js, injected with the bundle), by name: a pack's
        // profile needs its pack in the scan.
        const packNames = normalizeStringList(opts.packs);
        if (packNames.length) engineOptions.packs = packNames;

        const [result] = await execInTab(tabId, {
            func: async (payload) => {
                function normalizeStringListLocal(input) {
                    if (!input) return [];
                    if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
                    if (typeof input === 'string') return input.split(',').map((s) => s.trim()).filter(Boolean);
                    return [];
                }

                function pickBrowserApi() {
                    if (globalThis.A11Y_LABS_BROWSER && typeof globalThis.A11Y_LABS_BROWSER === 'object') {
                        return globalThis.A11Y_LABS_BROWSER;
                    }
                    if (globalThis.a11yLabs && typeof globalThis.a11yLabs === 'object') {
                        return globalThis.a11yLabs;
                    }
                    return globalThis;
                }

                const api = pickBrowserApi();
                const runner = api.runa11yCoreInPage || api.runA11yCoreInPage || api.runInPage;
                if (typeof runner !== 'function') {
                    throw new Error('surea11y browser runtime was not found in the page context');
                }

                const pageUrl = location.href;
                const pageTitle = document.title || null;
                const cfg = (payload.engineOptions && typeof payload.engineOptions === 'object') ? { ...payload.engineOptions } : {};
                if (!cfg.locale || !String(cfg.locale).trim()) {
                    cfg.locale = 'en';
                } else {
                    cfg.locale = String(cfg.locale).trim();
                }
                // The results table names EN 301 549 clauses next to the WCAG
                // criteria, and core adds them to results only when asked.
                // Versions of core before the opt-in add them anyway and
                // ignore the option.
                const requestedMappings = Array.isArray(cfg.mappings)
                    ? cfg.mappings.map(String)
                    : (typeof cfg.mappings === 'string' && cfg.mappings.trim() ? [cfg.mappings.trim()] : []);
                if (!requestedMappings.some((m) => /^en301549\b/i.test(m))) requestedMappings.push('en301549');
                cfg.mappings = requestedMappings;
                if (payload.excludeSelectors && payload.excludeSelectors.length) {
                    const existing = normalizeStringListLocal(cfg.excludeSelectors);
                    cfg.excludeSelectors = Array.from(new Set([...existing, ...payload.excludeSelectors]));
                }

                // Whether the page had finished loading: an image that arrives
                // later can move what layout rules measured. Never rejects.
                const waitForPageReady = api.waitForPageReady || (api.raw && api.raw.waitForPageReady);
                let pageReadiness = null;
                if (typeof waitForPageReady === 'function') {
                    try { pageReadiness = await waitForPageReady({ timeoutMs: payload.pageReadyTimeoutMs }); } catch { pageReadiness = null; }
                }

                let engineOutput = runner(pageUrl || null, payload.contextSelector || null, cfg, payload.runOnly || null) || {};

                // A core release without the requested standard ignores the
                // profile and, with no tags left, runs every rule. Scan again
                // with the standard's WCAG tags, and say so.
                let profileUnavailable = null;
                // A core that scans one profile at a time ignored the list.
                let profilesUnsupported = null;
                if (Array.isArray(cfg.profile) && payload.listFallbackRunOnly
                    && !(engineOutput.engine && Array.isArray(engineOutput.engine.profiles))) {
                    profilesUnsupported = cfg.profile.slice();
                    delete cfg.profile;
                    engineOutput = runner(pageUrl || null, payload.contextSelector || null, cfg, payload.listFallbackRunOnly) || {};
                }
                const appliedProfile = engineOutput.engine && engineOutput.engine.profile;
                if (cfg.profile && appliedProfile !== cfg.profile && Array.isArray(payload.profileFallbackTags)) {
                    profileUnavailable = cfg.profile;
                    delete cfg.profile;
                    engineOutput = runner(pageUrl || null, payload.contextSelector || null, cfg,
                        { ...(payload.runOnly || {}), tags: payload.profileFallbackTags }) || {};
                }

                const getChecksCatalog = api.getChecksCatalog || api.coreGetRulesCatalog || api.getRulesCatalog;
                const getCompositeRulesCatalog = api.getCompositeRulesCatalog || api.coreGetCompositeRulesCatalog;
                const engineTag = api.ENGINE_TAG || '@surea11y';

                return {
                    engineId: '@surea11y',
                    engineName: 'Surea11y',
                    // The release that produced this result, which core puts
                    // on every result; the bundle's own version before that.
                    engineVersion: (engineOutput.engine && engineOutput.engine.version) || api.version || api.VERSION || null,
                    engineTag,
                    engine: engineOutput.engine || null,
                    url: engineOutput.url || pageUrl || null,
                    title: engineOutput.title || pageTitle || null,
                    timestamp: engineOutput.timestamp || new Date().toISOString(),
                    contextSelector: engineOutput.contextSelector || payload.contextSelector || null,
                    // { elementCount, unmatchedSelectors } from core; null without a scope.
                    contextMatch: engineOutput.contextMatch || null,
                    pageReadiness,
                    profileUnavailable,
                    profilesUnsupported,
                    // The WCAG target core selected rules by, or null.
                    wcagTarget: (!cfg.profile && ((profilesUnsupported && payload.listFallbackRunOnly.wcag)
                        || (payload.runOnly && payload.runOnly.wcag))) || null,
                    // The page's frames, which the extension does not scan:
                    // the scan says so rather than read as the whole page.
                    frameCount: (() => {
                        try {
                            return document.querySelectorAll('iframe, frame').length;
                        } catch {
                            return 0;
                        }
                    })(),
                    // The packs core did not run, and why (another core's, say).
                    skippedPacks: Array.isArray(engineOutput.skippedPacks) ? engineOutput.skippedPacks : null,
                    excludeSelectors: normalizeStringListLocal(cfg.excludeSelectors),
                    checksResults: Array.isArray(engineOutput.checksResults) ? engineOutput.checksResults : [],
                    rulesResults: Array.isArray(engineOutput.rulesResults) ? engineOutput.rulesResults : [],
                    // With the run's options, so titles and descriptions come in
                    // the same language as the findings.
                    ruleCatalog: typeof getChecksCatalog === 'function' ? (getChecksCatalog(cfg) || []) : [],
                    compositeCatalog: typeof getCompositeRulesCatalog === 'function' ? (getCompositeRulesCatalog() || []) : []
                };
            },
            args: [{
                contextSelector: ctxSelector,
                excludeSelectors,
                engineOptions,
                runOnly: effectiveRunOnly,
                profileFallbackTags,
                listFallbackRunOnly,
                pageReadyTimeoutMs: Number.isFinite(opts.pageReadyTimeoutMs) && opts.pageReadyTimeoutMs >= 0
                    ? opts.pageReadyTimeoutMs
                    : DEFAULT_PAGE_READY_TIMEOUT_MS
            }]
        });

        // None of a list's profiles ran (their packs didn't load, say): core
        // then ran every rule, AAA and best practices among them, which no
        // one chose. Stop, naming why, rather than save it as a scan of them.
        const ran = result && result.engine && Array.isArray(result.engine.profiles) ? result.engine.profiles : null;
        if (Array.isArray(engineOptions.profile) && engineOptions.profile.length && ran && !ran.length) {
            const notRun = profilesNotRunOf(result);
            const why = notRun.map((p) => (NOT_RUN_REASONS[p.reason] || ((label) => `The scan did not check against ${label}.`))(p.label));
            const error = new Error(`None of the scan's profiles ran, so it checked against none of them. ${why.join(' ')}`.trim());
            error.code = 'profiles-not-run';
            throw error;
        }
        return result || {};
    }

    function mapConfidenceNumeric(confString, outcome) {
        const c = typeof confString === 'string' ? confString.toLowerCase() : null;
        if (c === 'high') return 0.95;
        if (c === 'medium') return 0.75;
        if (c === 'low') return 0.4;
        if (outcome === 'cantTell') return 0.6;
        if (outcome === 'notApplicable') return 0.9;
        return 0.9;
    }

    function deriveWcagScFromMappings(metaOrDef, options = {}) {
        const includeInformative = !!(options && options.includeInformative);
        const nm = normalizeObjectArray(metaOrDef && metaOrDef.normativeMappings);
        const ir = normalizeObjectArray(metaOrDef && metaOrDef.informativeReferences);
        const out = [];

        for (const m of nm) {
            if (String(m.standard || '').toUpperCase() === 'WCAG' && m.requirement) {
                out.push(String(m.requirement).trim());
            }
        }

        if (includeInformative) {
            for (const r of ir) {
                if (String(r.standard || '').toUpperCase() === 'WCAG' && r.requirement) {
                    out.push(String(r.requirement).trim());
                }
            }
        }

        const seen = new Set();
        const uniq = [];
        for (const sc of out) {
            const key = sc.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                uniq.push(sc);
            }
        }
        uniq.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        return uniq;
    }

    function normalizeOutcome(outcome) {
        const o = String(outcome || '').toLowerCase();
        if (o === 'fail' || o === 'failed' || o === 'violation' || o === 'violations') return 'fail';
        if (o === 'canttell' || o === 'cant_tell' || o === 'incomplete') return 'cantTell';
        if (o === 'pass' || o === 'passes') return 'pass';
        if (o === 'notapplicable' || o === 'not_applicable' || o === 'inapplicable') return 'notApplicable';
        return 'unknown';
    }

    // One element of a rollup, whatever the number of its checks that flagged
    // it: its page, shadow hosts, selector and outcome (the app's
    // a11y-labs-engine.js does the same).
    function elementKey(occ) {
        const pageUrl = occ && occ.pageUrl ? String(occ.pageUrl) : '';
        const target = occ && Array.isArray(occ.target) ? occ.target.map(String).join('||') : '';
        const hosts = occ && Array.isArray(occ.shadowHostSelectors) ? occ.shadowHostSelectors.map(String).join('>') : '';
        const html = target ? '' : (occ && occ.html ? String(occ.html) : '');
        const tier = occ && occ.occurrenceOutcome ? String(occ.occurrenceOutcome) : '';
        return `${pageUrl}::${hosts}::${target}::${html}::${tier}`;
    }

    const CHECK_FIELDS = ['failureSummary', 'details', 'hint', 'uncertainty', 'lean', 'howToCheck'];

    function checkEntryOf(occ, checkId) {
        const entry = { checkId };
        for (const k of CHECK_FIELDS) {
            if (occ && occ[k] !== undefined && occ[k] !== null && occ[k] !== '') entry[k] = occ[k];
        }
        return entry;
    }

    function buildRuleCatalogMap(native) {
        const map = new Map();
        const list = Array.isArray(native && native.ruleCatalog) ? native.ruleCatalog : [];
        for (const item of list) {
            if (!item || !item.ruleId) continue;
            map.set(String(item.ruleId), item);
        }
        return map;
    }

    // Same shape as the server adapter: the category code plus, when the rule
    // gave one, what a person needs to check to settle the occurrence.
    function normalizeUncertainty(u) {
        if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
        const code = typeof u.code === 'string' ? u.code.trim() : '';
        if (!code) return null;
        const out = { code };
        if (typeof u.needed === 'string' && u.needed.trim()) out.needed = u.needed.trim();
        return out;
    }

    const textOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    // Same shape as the server adapter: which way a question's evidence
    // points (core 1.14), why, the signals it read, its caution, and how
    // often a lean of its kind was right once core counted it.
    function normalizeLean(lean) {
        if (!lean || typeof lean !== 'object' || Array.isArray(lean)) return null;
        if (lean.toward !== 'fail' && lean.toward !== 'pass') return null;
        const out = { toward: lean.toward };
        const why = textOrNull(lean.why);
        if (why) out.why = why;
        const caution = textOrNull(lean.caution);
        if (caution) out.caution = caution;
        const signals = Array.isArray(lean.signals) ? lean.signals.map(textOrNull).filter(Boolean) : [];
        if (signals.length) out.signals = signals;
        const m = lean.measured;
        if (m && Number.isInteger(m.agreed) && Number.isInteger(m.cases) && m.cases > 0) {
            out.measured = { agreed: m.agreed, cases: m.cases };
        }
        return out;
    }

    // The steps that answer a question, as addHowToCheck() adds them.
    function normalizeHowToCheck(h) {
        if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
        const steps = Array.isArray(h.steps) ? h.steps.map(textOrNull).filter(Boolean) : [];
        const passWhen = textOrNull(h.passWhen);
        const failWhen = textOrNull(h.failWhen);
        if (!steps.length && !passWhen && !failWhen) return null;
        return { steps, ...(passWhen ? { passWhen } : {}), ...(failWhen ? { failWhen } : {}) };
    }

    // The review dictionaries the extension ships (engines/vendor/review),
    // fetched once each, by locale: English, the language it scans in.
    const REVIEW_LOCALES = ['en'];
    const reviewDictionaries = new Map();

    function defaultFetchJson(file) {
        const url = (root.chrome && root.chrome.runtime && typeof root.chrome.runtime.getURL === 'function')
            ? root.chrome.runtime.getURL(file)
            : file;
        return fetch(url).then((r) => (r.ok ? r.json() : null));
    }

    function reviewDictionary(locale, fetchJson) {
        if (!reviewDictionaries.has(locale)) {
            reviewDictionaries.set(locale, Promise.resolve()
                .then(() => fetchJson(`engines/vendor/review/${locale}.json`))
                .catch(() => null));
        }
        return reviewDictionaries.get(locale);
    }

    /**
     * A copy of the scan's result in which each question of a core rule
     * carries its steps (howToCheck), in the scan's locale, with English
     * where it lacks one: the in-page engine leaves them out, and core's
     * browser entry adds them from its review dictionaries. The result as it
     * was when the entry or the dictionaries can't be loaded.
     */
    async function addHowToCheck(native, helpers = {}) {
        const howToCheck = root.A11Y_HOW_TO_CHECK;
        if (!native || !Array.isArray(native.checksResults) || !howToCheck || typeof howToCheck.applyHowToCheck !== 'function') {
            return native;
        }
        const fetchJson = typeof helpers.fetchJson === 'function' ? helpers.fetchJson : defaultFetchJson;
        const loc = native.engine && native.engine.locale;
        const tag = String((loc && typeof loc === 'object' ? loc.resolved : loc) || 'en').trim().toLowerCase();
        const base = tag.split('-')[0];
        const locales = Array.from(new Set(['en', base])).filter((l) => REVIEW_LOCALES.includes(l));
        const dictionaries = {};
        for (const locale of locales) {
            const dict = await reviewDictionary(locale, fetchJson);
            if (dict && typeof dict === 'object') dictionaries[locale] = dict;
        }
        if (!dictionaries.en) return native;
        try {
            const withSteps = howToCheck.applyHowToCheck(
                { checksResults: native.checksResults, rulesResults: native.rulesResults || [], engine: native.engine || {} },
                dictionaries
            );
            return { ...native, checksResults: withSteps.checksResults };
        } catch (e) {
            console.warn('[surea11y adapter] could not add how-to-check steps', e);
            return native;
        }
    }

    // `ruleOutcome` is the tier of an occurrence that names none of its own,
    // as the server adapter reads it.
    const VERDICT_RANK = { notApplicable: 0, pass: 1, cantTell: 2, fail: 3 };

    /** A result's or element's verdict per profile, { [profile]: outcome }, or null. */
    function verdictsOf(x) {
        const v = x && x.verdicts;
        if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
        const out = {};
        for (const [id, outcome] of Object.entries(v)) {
            if (Object.prototype.hasOwnProperty.call(VERDICT_RANK, outcome)) out[String(id)] = outcome;
        }
        return Object.keys(out).length ? out : null;
    }

    /**
     * The worst of an element's verdicts under some profiles, as an
     * occurrence's outcome, or null: what a rollup's own profiles make of it,
     * not the worst of every profile's, as the lab's server adapter reads it.
     */
    function ownVerdict(verdicts, profiles) {
        if (!verdicts || !Array.isArray(profiles) || !profiles.length) return null;
        let worst = null;
        for (const p of profiles) {
            const v = verdicts[p];
            if (VERDICT_RANK[v] === undefined) continue;
            if (!worst || VERDICT_RANK[v] > VERDICT_RANK[worst]) worst = v;
        }
        return worst === 'fail' || worst === 'cantTell' || worst === 'pass' ? worst : null;
    }

    function makeAtomicOccurrence(native, occ, fallbackTitle, ruleId, ruleOutcome) {
        const selector = occ && occ.selector ? String(occ.selector) : null;
        const htmlSnippet = occ && occ.html ? String(occ.html) : '';
        const failureSummary = occ && occ.summary ? String(occ.summary) : (fallbackTitle || ruleId);
        const pageUrl = native && native.url ? native.url : null;
        const occurrenceOutcomeRaw = occ && (occ.occurrenceOutcome || occ.outcome) ? (occ.occurrenceOutcome || occ.outcome) : null;
        const occurrenceOutcome = normalizeOutcome(occurrenceOutcomeRaw);
        const hint = occ && typeof occ.hint === 'string' && occ.hint.trim() ? occ.hint.trim() : null;
        const tier = (occurrenceOutcome === 'fail' || occurrenceOutcome === 'cantTell') ? occurrenceOutcome : ruleOutcome;
        const uncertainty = tier === 'cantTell' ? normalizeUncertainty(occ && occ.uncertainty) : null;
        const lean = tier === 'cantTell' ? normalizeLean(occ && occ.lean) : null;
        const howToCheck = tier === 'cantTell' ? normalizeHowToCheck(occ && occ.howToCheck) : null;
        const notes = scanNotes();
        const details = notes ? notes.normalizeOccurrenceDetails(occ && occ.data && occ.data.details) : null;
        const shadowHostSelectors = notes ? notes.shadowHostsOf(occ) : null;
        return {
            pageUrl,
            target: selector ? [selector] : [],
            html: htmlSnippet,
            failureSummary,
            summary: failureSummary,
            occurrenceOutcome: (occurrenceOutcome === 'fail' || occurrenceOutcome === 'cantTell') ? occurrenceOutcome : undefined,
            ...(hint ? { hint } : {}),
            ...(uncertainty ? { uncertainty } : {}),
            ...(lean ? { lean } : {}),
            ...(howToCheck ? { howToCheck } : {}),
            ...(details ? { details } : {}),
            ...(shadowHostSelectors ? { shadowHostSelectors } : {}),
            // A scan of several profiles: what each makes of this element.
            ...(verdictsOf(occ) ? { verdicts: verdictsOf(occ) } : {}),
            evidence: {
                engineNode: {
                    pageUrl,
                    target: selector ? [selector] : [],
                    html: htmlSnippet,
                    failureSummary
                }
            }
        };
    }

    function toCompositeCanonicalFinding(cr, options = {}) {
        const details = cr && cr.data && cr.data.details && typeof cr.data.details === 'object' ? cr.data.details : {};
        const contributors = Array.isArray(options.contributorsOverride)
            ? options.contributorsOverride.slice()
            : (Array.isArray(details.contributors) ? details.contributors.slice() : []);
        const checksIds = Array.isArray(options.checksIdsOverride)
            ? options.checksIdsOverride.slice()
            : (Array.isArray(details.checksIds) ? details.checksIds.slice() : contributors.map((x) => x && x.testId ? String(x.testId).trim() : '').filter(Boolean));

        const ruleId = String(cr && cr.ruleId ? cr.ruleId : '').trim();
        if (!ruleId) return null;

        const outcome = options.outcomeOverride || normalizeOutcome(cr && cr.outcome);
        const confidenceLabel = typeof cr.confidence === 'string' ? cr.confidence : 'medium';

        return {
            id: ruleId,
            uid: `${ENGINE_ID}:${outcome}:${ruleId}`,
            ruleId,
            provenance: {
                engineId: ENGINE_ID,
                engineName: ENGINE_NAME,
                engineVersion: ENGINE_VERSION
            },
            title: cr.title || ruleId,
            description: cr.description || null,
            helpUrl: cr.helpUrl || null,
            outcome,
            severity: cr.severity || 'moderate',
            confidence: mapConfidenceNumeric(confidenceLabel, outcome),
            confidenceLabel,
            type: cr.type || 'automatic',
            tags: Array.isArray(cr.tags) ? cr.tags.slice() : [ENGINE_ID],
            wcag: {
                sc: deriveWcagScFromMappings(cr && cr.meta ? cr.meta : cr, { includeInformative: true })
            },
            standards: {
                normativeMappings: normalizeObjectArray(cr && cr.meta ? cr.meta.normativeMappings : cr && cr.normativeMappings),
                informativeReferences: normalizeObjectArray(cr && cr.meta ? cr.meta.informativeReferences : cr && cr.informativeReferences)
            },
            occurrences: [],
            evidence: {
                rollup: {
                    reasonCode: details.reasonCode || null,
                    // A scan of several profiles: those that gave this rollup.
                    ...(Array.isArray(cr && cr.profiles) && cr.profiles.length ? { profiles: cr.profiles.map(String) } : {}),
                    checksIds,
                    contributors: contributors
                        .map((x) => ({
                            testId: String(x && x.testId ? x.testId : '').trim(),
                            outcome: String(x && x.outcome ? x.outcome : '').trim()
                        }))
                        .filter((x) => x.testId)
                }
            },
            i18n: cr.i18n || null,
            meta: Object.assign({}, cr && cr.meta && typeof cr.meta === 'object' ? cr.meta : {}, { atomic: false })
        };
    }

    function attachCompositeOccurrencesFromAtomicFindings(compositeFindings, atomicFindings) {
        if (!Array.isArray(compositeFindings) || !compositeFindings.length) return;
        if (!Array.isArray(atomicFindings) || !atomicFindings.length) return;

        const atomicByRuleId = new Map();
        for (const f of atomicFindings) {
            if (!f || !f.ruleId) continue;
            atomicByRuleId.set(String(f.ruleId), f);
        }

        for (const finding of compositeFindings) {
            if (!finding || !finding.evidence || !finding.evidence.rollup) continue;
            const checksIds = Array.isArray(finding.evidence.rollup.checksIds) ? finding.evidence.rollup.checksIds : [];
            if (!checksIds.length) continue;

            // An element two checks flagged is one occurrence naming both,
            // with what each said in `checks`.
            const out = [];
            const byElement = new Map();
            for (const id of checksIds) {
                const atomic = atomicByRuleId.get(String(id));
                if (!atomic || !Array.isArray(atomic.occurrences)) continue;
                const checkId = atomic.ruleId ? String(atomic.ruleId) : String(id);
                for (const occ of atomic.occurrences) {
                    const occ2 = Object.assign({}, occ, {
                        outcome: finding.outcome || undefined,
                        atomicCheckId: checkId,
                        sourceAtomicRules: [checkId]
                    });
                    // A scan of several profiles: the element as this
                    // rollup's own profiles judge it.
                    const own = ownVerdict(occ.verdicts, finding.evidence.rollup.profiles);
                    if (own === 'fail' || own === 'cantTell') occ2.occurrenceOutcome = own;
                    else if (own === 'pass') delete occ2.occurrenceOutcome;
                    const key = elementKey(occ2);
                    const seen = byElement.get(key);
                    if (!seen) {
                        byElement.set(key, { occ: occ2, first: occ2 });
                        out.push(occ2);
                        continue;
                    }
                    const base = seen.occ;
                    if (base.sourceAtomicRules.includes(checkId)) continue;
                    if (!base.checks) base.checks = [checkEntryOf(seen.first, base.atomicCheckId)];
                    base.checks.push(checkEntryOf(occ2, checkId));
                    base.sourceAtomicRules = base.sourceAtomicRules.concat(checkId);
                }
            }
            finding.occurrences = out;
        }
    }

    function profileLabel(id) {
        const targets = root.A11Y_CONFORMANCE_TARGETS;
        return (targets && targets.targetLabel(id)) || id;
    }

    /** The profiles a scan of several ran, [{ id, label }], or null for a scan of one. */
    function appliedProfiles(native) {
        const list = native && native.engine && Array.isArray(native.engine.profiles)
            ? native.engine.profiles.filter((id) => typeof id === 'string' && id)
            : [];
        return list.length > 1 ? list.map((id) => ({ id, label: profileLabel(id) })) : null;
    }

    /** The profiles a scan of several did not run, [{ id, label, reason }]. */
    function profilesNotRunOf(native) {
        const raw = native && native.engine && Array.isArray(native.engine.profilesNotRun) ? native.engine.profilesNotRun : [];
        return raw
            .filter((p) => p && typeof p.profile === 'string')
            .map((p) => ({ id: p.profile, label: profileLabel(p.profile), reason: typeof p.reason === 'string' ? p.reason : null }));
    }

    const NOT_RUN_REASONS = {
        'unknown-profile': (label) => `This surea11y release has no ${label} profile, so the scan did not check against it.`,
        'pack-skipped': (label) => `${label}'s pack did not load, so the scan did not check against it.`,
        'overridden-by-selection': (label) => `The scan's own rules or tags chose what ran, so it did not check against ${label}.`
    };

    function appliedConformanceProfile(native) {
        const id = native && native.engine && typeof native.engine.profile === 'string' ? native.engine.profile : null;
        if (!id) return null;
        const targets = root.A11Y_CONFORMANCE_TARGETS;
        return { id, label: (targets && targets.targetLabel(id)) || id };
    }

    function canonicalize(native, meta = {}) {
        if (native && native.canonical && typeof native.canonical === 'object') {
            return native.canonical;
        }

        const pageUrl = (meta.page && meta.page.url) || (native && native.url) || null;
        const pageTitle = (meta.page && meta.page.title) || (native && native.title) || null;
        const contextSelector = (native && native.contextSelector) || (meta.scope && Array.isArray(meta.scope.include) && meta.scope.include[0]) || null;
        const excludeSelectors = Array.isArray(native && native.excludeSelectors)
            ? native.excludeSelectors.slice()
            : (meta.scope && Array.isArray(meta.scope.exclude) ? meta.scope.exclude.slice() : []);

        // The release named on the result wins: the caller's engine metadata
        // comes from the background, which cannot see the bundle in the page.
        const engine = {
            id: ENGINE_ID,
            name: ENGINE_NAME,
            ...(meta.engine || {}),
            version: (native && native.engineVersion) || (meta.engine && meta.engine.version) || ENGINE_VERSION
        };

        const findingsSource = (meta.runOptions && meta.runOptions.engineOptions && typeof meta.runOptions.engineOptions.findingsSource === 'string')
            ? meta.runOptions.engineOptions.findingsSource.trim().toLowerCase()
            : 'composite';
        const wantAtomic = (findingsSource === 'atomic' || findingsSource === 'both');
        const wantComposite = (findingsSource === 'composite' || findingsSource === 'both');

        const findings = [];
        const atomicFindings = [];
        const ruleCatalogMap = buildRuleCatalogMap(native);
        const checksResults = Array.isArray(native && native.checksResults) ? native.checksResults : [];
        const rulesResults = Array.isArray(native && native.rulesResults) ? native.rulesResults : [];

        for (const ruleResult of checksResults) {
            const ruleId = String(ruleResult && ruleResult.ruleId ? ruleResult.ruleId : '').trim();
            if (!ruleId) continue;

            const metaDef = ruleCatalogMap.get(ruleId) || {
                ruleId,
                title: ruleId,
                description: null,
                helpUrl: null,
                tags: [native && native.engineTag ? native.engineTag : ENGINE_ID],
                normativeMappings: [],
                informativeReferences: [],
                defaultSeverity: 'moderate',
                type: 'automatic',
                defaultConfidence: 'medium'
            };

            const outcome = normalizeOutcome(ruleResult && ruleResult.outcome);
            const severity = ruleResult && ruleResult.severity ? String(ruleResult.severity) : (metaDef.defaultSeverity || 'moderate');
            const confidenceLabel = typeof (ruleResult && ruleResult.confidence) === 'string'
                ? ruleResult.confidence
                : (metaDef.defaultConfidence || 'medium');
            const occs = Array.isArray(ruleResult && ruleResult.occurrences) ? ruleResult.occurrences : [];
            const canonicalOccs = occs.map((occ) => makeAtomicOccurrence(native, occ, metaDef.title, ruleId, outcome));

            const canonicalFinding = {
                id: ruleId,
                uid: `${ENGINE_ID}:${outcome}:${ruleId}`,
                ruleId,
                provenance: {
                    engineId: ENGINE_ID,
                    engineName: ENGINE_NAME,
                    engineVersion: (native && native.engineVersion) || ENGINE_VERSION
                },
                title: metaDef.title || ruleId,
                description: metaDef.description || null,
                helpUrl: metaDef.helpUrl || null,
                outcome,
                severity,
                confidence: mapConfidenceNumeric(confidenceLabel, outcome),
                confidenceLabel,
                type: metaDef.type || 'automatic',
                tags: Array.isArray(metaDef.tags) ? metaDef.tags.slice() : [native && native.engineTag ? native.engineTag : ENGINE_ID],
                wcag: {
                    sc: deriveWcagScFromMappings(metaDef, { includeInformative: true })
                },
                standards: {
                    // The result's own mappings first: they are the ones this
                    // run asked for, which the static catalog entry cannot know.
                    normativeMappings: normalizeObjectArray(
                        ruleResult && ruleResult.meta && Array.isArray(ruleResult.meta.normativeMappings)
                            ? ruleResult.meta.normativeMappings
                            : metaDef.normativeMappings
                    ),
                    informativeReferences: normalizeObjectArray(metaDef.informativeReferences)
                },
                occurrences: canonicalOccs,
                meta: { atomic: true }
            };
            // A scan of several profiles: each one's verdict, and the rule's own.
            const verdicts = verdictsOf(ruleResult);
            if (verdicts) {
                canonicalFinding.verdicts = verdicts;
                if (VERDICT_RANK[ruleResult.checkOutcome] !== undefined) canonicalFinding.checkOutcome = ruleResult.checkOutcome;
            }
            // As the lab's server adapter: a best-practice rule tests no WCAG criterion.
            if (canonicalFinding.tags.includes('best-practice')) canonicalFinding.bestPractice = true;

            atomicFindings.push(canonicalFinding);
            // The best practices roll up into no criterion, so a criteria view
            // lists them as they are.
            if (wantAtomic || (wantComposite && canonicalFinding.bestPractice)) findings.push(canonicalFinding);
        }

        if (wantComposite && rulesResults.length) {
            const atomicOutcomeByRuleId = new Map();
            for (const f of atomicFindings) {
                atomicOutcomeByRuleId.set(String(f.ruleId), String(f.outcome || ''));
            }

            function normCompositeOutcome(v) {
                const s = String(v || '').trim();
                return (s === 'fail' || s === 'cantTell' || s === 'pass' || s === 'notApplicable') ? s : null;
            }

            for (const cr of rulesResults) {
                const details = cr && cr.data && cr.data.details && typeof cr.data.details === 'object' ? cr.data.details : {};
                const contributors = Array.isArray(details.contributors) ? details.contributors : [];
                const failContrib = [];
                const cantTellContrib = [];
                const passContrib = [];
                const notApplicableContrib = [];

                for (const c of contributors) {
                    const testId = String(c && c.testId ? c.testId : '').trim();
                    if (!testId) continue;
                    const direct = normCompositeOutcome(c && c.outcome);
                    const fallback = normCompositeOutcome(atomicOutcomeByRuleId.get(testId));
                    const outcome = direct || fallback;
                    if (outcome === 'fail') failContrib.push(c);
                    else if (outcome === 'cantTell') cantTellContrib.push(c);
                    else if (outcome === 'pass') passContrib.push(c);
                    else if (outcome === 'notApplicable') notApplicableContrib.push(c);
                }

                const failIds = failContrib.map((c) => String(c.testId).trim()).filter(Boolean);
                const cantTellIds = cantTellContrib.map((c) => String(c.testId).trim()).filter(Boolean);
                const passIds = passContrib.map((c) => String(c.testId).trim()).filter(Boolean);
                const notApplicableIds = notApplicableContrib.map((c) => String(c.testId).trim()).filter(Boolean);

                if (failIds.length) {
                    const f = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'fail',
                        checksIdsOverride: failIds,
                        contributorsOverride: failContrib
                    });
                    if (f) findings.push(f);
                }
                if (cantTellIds.length) {
                    const f = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'cantTell',
                        checksIdsOverride: cantTellIds,
                        contributorsOverride: cantTellContrib
                    });
                    if (f) findings.push(f);
                }

                // Split pass/notApplicable the same way as fail/cantTell above, so a
                // composite (WCAG SC rollup) whose contributors all passed (or were
                // inapplicable) still surfaces in `findings` under the default 'composite'
                // findingsSource. Mirrors the server-side a11y-labs engine.
                if (passIds.length) {
                    const f = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'pass',
                        checksIdsOverride: passIds,
                        contributorsOverride: passContrib
                    });
                    if (f) findings.push(f);
                }
                if (notApplicableIds.length) {
                    const f = toCompositeCanonicalFinding(cr, {
                        outcomeOverride: 'notApplicable',
                        checksIdsOverride: notApplicableIds,
                        contributorsOverride: notApplicableContrib
                    });
                    if (f) findings.push(f);
                }
            }
        }

        if (wantComposite) {
            attachCompositeOccurrencesFromAtomicFindings(findings.filter((f) => f && f.meta && f.meta.atomic === false), atomicFindings);
        }

        // Outcome counts come from atomicFindings (the complete
        // fail/cantTell/pass/notApplicable picture), not the client-facing `findings`
        // array — that array is gated by wantAtomic/wantComposite, so counts taken from
        // it would read "pass"/"notApplicable" as zero under the default 'composite' source.
        // The requirements' counts leave the best practices out; theirs are kept apart.
        const summary = root.A11Y_CONFORMANCE_TARGETS.splitOutcomeCounts(atomicFindings);

        const standardTags = Array.isArray(meta.runOptions && meta.runOptions.standardTags)
            ? meta.runOptions.standardTags.slice()
            : [];

        // The language core wrote the findings in, which is English when the
        // requested one has no translation. The panel is in English, so other
        // languages are marked on each finding for screen readers.
        const coreLocale = native && native.engine ? native.engine.locale : null;
        const resolvedLocale = String((coreLocale && typeof coreLocale === 'object' ? coreLocale.resolved : coreLocale) || '').trim();
        if (resolvedLocale && resolvedLocale !== DEFAULT_LOCALE) {
            for (const f of findings) {
                if (f && typeof f === 'object') f.lang = resolvedLocale;
            }
        }

        // Notes on how the scan ran, and how close each measuring rule's
        // passes came to failing, as the lab's server adapter gives them.
        const notes = scanNotes();
        const notices = [];
        const margins = [];
        if (notes) {
            const readiness = notes.readinessNotice(native && native.pageReadiness);
            if (readiness) notices.push(readiness);
            notices.push(...notes.contextMatchNotices(native && native.contextMatch, contextSelector, ENGINE_ID));
        }
        if (native && Number(native.frameCount) > 0) {
            const n = Number(native.frameCount);
            notices.push({
                engineId: ENGINE_ID,
                code: 'frames-not-scanned',
                message: `This page has ${n} frame${n === 1 ? '' : 's'} (iframe), which the extension does not scan: their content is not in these results. The lab's scan step scans them.`
            });
        }
        if (native && Array.isArray(native.profilesUnsupported) && native.profilesUnsupported.length) {
            const names = native.profilesUnsupported.map(profileLabel);
            notices.push({
                engineId: ENGINE_ID,
                code: 'profiles-unsupported',
                message: `This surea11y release scans one profile at a time, so it checked the scan's WCAG target alone, not ${names.join(' + ')}. Rebuild the extension with a newer one.`
            });
        }
        for (const p of profilesNotRunOf(native)) {
            notices.push({
                engineId: ENGINE_ID,
                code: 'profile-not-run',
                profile: p.id,
                message: (NOT_RUN_REASONS[p.reason] || ((label) => `The scan did not check against ${label}.`))(p.label)
            });
        }
        if (native && native.profileUnavailable) {
            const targets = root.A11Y_CONFORMANCE_TARGETS;
            const name = (targets && targets.targetLabel(native.profileUnavailable)) || native.profileUnavailable;
            // Its pack did not load (prepared for another core, say), or
            // this core has no such profile.
            const skipped = Array.isArray(native.skippedPacks) ? native.skippedPacks.filter((p) => p && p.name) : [];
            notices.push({
                engineId: ENGINE_ID,
                code: 'profile-unavailable',
                message: (skipped.length
                    ? `${name}'s pack did not load (${skipped.map((p) => `${p.name}: ${p.reason}`).join('; ')}), so it checked the standard's `
                    : `This surea11y release has no ${name} profile, so it checked the standard's `)
                    + 'WCAG criteria only: none of the rules or criteria the standard adds were run.'
            });
        }
        if (notes) {
            margins.push(...notes.collectMargins(checksResults, (ruleId) => {
                const def = ruleCatalogMap.get(ruleId);
                return def && def.title;
            }));
        }

        const canonical = {
            version: CANON_VERSION,
            engine,
            page: {
                url: pageUrl,
                title: pageTitle,
                viewport: meta.page ? (meta.page.viewport || null) : null,
                timestamp: (native && native.timestamp) || (meta.page && meta.page.timestamp) || isoNow()
            },
            scope: {
                include: contextSelector ? [contextSelector] : ['html'],
                exclude: excludeSelectors
            },
            runOptions: {
                standardTags,
                wcagTarget: (native && native.wcagTarget) || null,
                includeRuleIds: Array.isArray(meta.runOptions && meta.runOptions.includeRuleIds) ? meta.runOptions.includeRuleIds.slice() : [],
                excludeRuleIds: Array.isArray(meta.runOptions && meta.runOptions.excludeRuleIds) ? meta.runOptions.excludeRuleIds.slice() : [],
                includeBestPractice: !!(meta.runOptions && meta.runOptions.includeBestPractice),
                engineOptions: (meta.runOptions && meta.runOptions.engineOptions && typeof meta.runOptions.engineOptions === 'object')
                    ? meta.runOptions.engineOptions
                    : {},
                // The standard core applied, as the lab's server adapter
                // records it; null when it applied none.
                conformanceProfile: appliedConformanceProfile(native),
                // A scan of several profiles: those that ran, and those that
                // did not and why, as the lab's server adapter records them.
                ...(appliedProfiles(native) ? { conformanceProfiles: appliedProfiles(native) } : {}),
                ...(profilesNotRunOf(native).length ? { profilesNotRun: profilesNotRunOf(native) } : {})
            },
            notices,
            margins,
            summary,
            findings,
            rules: Array.isArray(native && native.ruleCatalog) ? native.ruleCatalog : [],
            diagnostics: {
                durationMs: 0,
                estimatedNodes: 0,
                warnings: [],
                errors: [],
                environment: (native && native.engine && native.engine.environment) || null,
                pageReadiness: (native && native.pageReadiness) || null
            }
        };

        return canonical;
    }

    root.A11Y_EXTENSION_A11Y_LABS_ENGINE = {
        engineId: ENGINE_ID,
        engineName: ENGINE_NAME,
        get engineVersion() {
            return resolveSurea11yRuntimeVersion() || ENGINE_VERSION;
        },
        ensureInjected,
        runInTab,
        addHowToCheck,
        canonicalize
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
