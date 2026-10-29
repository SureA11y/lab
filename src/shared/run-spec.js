'use strict';

/**
 * run-spec.js (shared)
 *
 * The run spec is what a workflow run needs and nothing else: the app posts it,
 * the config saver stores it, the headless runner reads it. Keeping one shape
 * here is what stops a saved run from meaning something different than the run
 * the app performed.
 *
 * Browser: available as globalThis.A11Y_RUN_SPEC.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_RUN_SPEC = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const SPEC_TYPE = 'a11y-run-spec';
    const SPEC_VERSION = 1;
    const UI_CONFIG_TYPE = 'a11y-ui-src-config';
    const LEGACY_UI_CONFIG_TYPE = 'a11y-ui-config';

    // What a scan without a profile of its own checks against: each scan step
    // chooses its profile, and a run has none.
    const DEFAULT_PROFILE = 'wcag22-aa';

    const KNOWN_SPEC_KEYS = new Set([
        '$schema', 'specVersion', 'version', 'type', 'url', 'scenarioName', 'actions', 'customSteps',
        'viewport', 'colorScheme', 'highContrast', 'language',
        'metadata', 'groupScans', 'vars'
    ]);

    // A run's Include and Exclude selectors, which each scan step now has
    // on its own: a spec's keys, and the app's form ids for them.
    const RUN_SCOPE_KEYS = ['context', 'exclude'];
    const RUN_SCOPE_STATE_KEYS = ['scan-context', 'exclude-selectors-global', 'scan-exclude'];

    // Starting variables, read by the workflow as {var:name}. A name the
    // engine's strict tokens accept: a letter or underscore, then letters,
    // digits, underscores or dashes. Values are plain text, numbers or booleans.
    const VAR_NAME_RE = /^[A-Za-z_][\w-]*$/;

    // Fields a spec used to choose WCAG with, before profiles replaced them.
    const REPLACED_BY_PROFILE = ['wcag', 'tags'];

    // Fields a run had and no longer has: its profile, which each scan step
    // now chooses, and its evidence format (a scan no longer saves evidence;
    // the Save evidence step does). The app's form ids too.
    const RUN_PROFILE_STATE_KEY = 'run-profile';
    const RETIRED_RUN_FIELDS = ['globalEvidenceFormat'];

    // The saved config keys these read are element ids in the app's form. Older
    // configs carry camelCase variants of two of them.
    const UI_STATE_KEYS = {
        url: ['url-input'],
        scenarioName: ['scenario-name', 'scenarioName'],
        actions: ['actions-workflow'],
        customSteps: ['custom-steps-json'],
        viewport: ['viewport-preset', 'viewportPreset'],
        colorScheme: ['run-color-scheme'],
        highContrast: ['run-high-contrast'],
    };

    // The language field: a select of languages, whose "Other…" shows a text
    // field for any other tag (or a variable, {var:lang}).
    const LANGUAGE_STATE_KEY = 'run-language';
    const LANGUAGE_OTHER_STATE_KEY = 'run-language-other';
    const LANGUAGE_OTHER = 'other';

        function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function trimmedString(v) {
        return typeof v === 'string' && v.trim() ? v.trim() : null;
    }

    /**
     * A config saved by the app. The app's own loader only asks for a state
     * object, so configs from before the type was renamed still open there and
     * have to run here too.
     */
    function isUiConfig(raw) {
        if (!isPlainObject(raw)) return false;
        if (raw.type === UI_CONFIG_TYPE || raw.type === LEGACY_UI_CONFIG_TYPE) return true;
        return raw.type !== SPEC_TYPE && isPlainObject(raw.state);
    }

    function isRunSpec(raw) {
        return isPlainObject(raw) && raw.type === SPEC_TYPE;
    }

    /**
     * Shape a spec from values that are already resolved: viewport measured.
     * Empty fields are left out so a saved spec shows only what the run
     * actually sets.
     */
    function buildRunSpec(input = {}) {
        const spec = {
            type: SPEC_TYPE,
            specVersion: SPEC_VERSION,
            url: trimmedString(input.url),
            actions: Array.isArray(input.actions) ? input.actions : [],
        };

        const scenarioName = trimmedString(input.scenarioName);
        if (scenarioName) spec.scenarioName = scenarioName;

        if (Array.isArray(input.customSteps) && input.customSteps.length) {
            spec.customSteps = input.customSteps;
        }

        if (isPlainObject(input.viewport)) spec.viewport = input.viewport;

        // How the page is shown as the run starts; the browser's own is left out.
        const colorScheme = trimmedString(input.colorScheme);
        if (colorScheme === 'light' || colorScheme === 'dark') spec.colorScheme = colorScheme;
        if (input.highContrast === true || trimmedString(input.highContrast) === 'on') spec.highContrast = 'on';
        const language = trimmedString(input.language);
        if (language && language !== 'default') spec.language = language;

        if (isPlainObject(input.vars) && Object.keys(input.vars).length) spec.vars = { ...input.vars };

        return spec;
    }

    /** Read the app's saved form state as spec fields. */
    function runSpecFromUiConfig(raw) {
        const state = isPlainObject(raw && raw.state) ? raw.state : {};
        const pick = (keys) => {
            for (const key of keys) {
                const value = state[key];
                if (value !== undefined && value !== null && value !== '') return value;
            }
            return undefined;
        };

        const spec = { type: SPEC_TYPE, specVersion: SPEC_VERSION };

        for (const field of Object.keys(UI_STATE_KEYS)) {
            const value = pick(UI_STATE_KEYS[field]);
            if (value !== undefined) spec[field] = value;
        }

        // The language: one from the list, or the one typed with "Other…".
        const language = state[LANGUAGE_STATE_KEY] === LANGUAGE_OTHER
            ? pick([LANGUAGE_OTHER_STATE_KEY])
            : pick([LANGUAGE_STATE_KEY]);
        if (language !== undefined) spec.language = language;
        // Off is the browser's own: nothing to say.
        if (spec.highContrast === 'off') delete spec.highContrast;

        if (spec.url === undefined && raw && raw.url) spec.url = raw.url;

        return spec;
    }

    /**
     * A spec as the app's form state, for opening it in the app: the reverse
     * of runSpecFromUiConfig. What the form has no place for is not dropped
     * silently: each such field gets a note to show when the file opens.
     *
     * viewportPresets: the preset table ({ key: { width, height } }), to find
     * the preset a measured viewport is.
     * -> { config, batchRows, notes }: config is what applyConfig takes;
     *    batchRows is the Batch section's row for the spec's vars, or null.
     */
    function uiConfigFromRunSpec(raw, { viewportPresets = {}, languages = null } = {}) {
        const spec = isPlainObject(raw) ? raw : {};
        const notes = [];
        const first = (field) => UI_STATE_KEYS[field][0];
        // Every field the form has, so what the spec leaves out goes back to
        // its default instead of keeping what the form held before.
        const state = {
            [first('scenarioName')]: '',
            [first('viewport')]: 'default',
            [first('colorScheme')]: '',
            [first('highContrast')]: 'off',
            [LANGUAGE_STATE_KEY]: '',
            [LANGUAGE_OTHER_STATE_KEY]: '',
            [first('customSteps')]: '',
        };

        const url = trimmedString(spec.url);
        if (url) state[first('url')] = url;
        const scenarioName = trimmedString(spec.scenarioName);
        if (scenarioName) state[first('scenarioName')] = scenarioName;
        state[first('actions')] = Array.isArray(spec.actions) ? spec.actions : [];
        if (Array.isArray(spec.customSteps) && spec.customSteps.length) {
            state[first('customSteps')] = JSON.stringify(spec.customSteps);
        }

        // A spec in an older format is brought up to date before it gets here
        // (config-upgrade.js): its run profile is on its scans by then.
        if (trimmedString(spec.profile)) {
            notes.push(`Its profile "${trimmedString(spec.profile)}" is not read any more: each scan step chooses its own.`);
        }

        if (typeof spec.viewport === 'string' && spec.viewport.trim()) {
            const key = spec.viewport.trim();
            if (Object.prototype.hasOwnProperty.call(viewportPresets, key)) state[first('viewport')] = key;
            else notes.push(`Its viewport "${key}" is not a preset, so the run settings keep theirs.`);
        } else if (isPlainObject(spec.viewport)) {
            const { width, height } = spec.viewport;
            const key = Object.keys(viewportPresets)
                .find((k) => viewportPresets[k].width === Number(width) && viewportPresets[k].height === Number(height));
            if (key) state[first('viewport')] = key;
            else notes.push(`Its viewport, ${width} × ${height}, is not a preset, so the run settings keep theirs: add a Set viewport step for that size.`);
        }

        const colorScheme = trimmedString(spec.colorScheme);
        if (colorScheme === 'light' || colorScheme === 'dark') state[first('colorScheme')] = colorScheme;
        if (spec.highContrast === true || trimmedString(spec.highContrast) === 'on') state[first('highContrast')] = 'on';
        // A language the list has is chosen there; any other, with "Other…".
        const language = trimmedString(spec.language);
        if (language && language !== 'default') {
            if (Array.isArray(languages) && languages.includes(language)) {
                state[LANGUAGE_STATE_KEY] = language;
            } else {
                state[LANGUAGE_STATE_KEY] = LANGUAGE_OTHER;
                state[LANGUAGE_OTHER_STATE_KEY] = language;
            }
        }


        for (const key of REPLACED_BY_PROFILE) {
            if (spec[key] !== undefined) notes.push(`Its "${key}" is not read any more: each scan step chooses its profile.`);
        }

        // The app keeps a run's starting variables in a Batch row, as it does
        // for a run loaded from the queue.
        const vars = isPlainObject(spec.vars) && Object.keys(spec.vars).length ? { ...spec.vars } : null;
        const batchRows = vars ? [{ name: scenarioName || 'Run', ...(url ? { url } : {}), vars }] : null;

        return {
            config: { version: 1, type: UI_CONFIG_TYPE, ...(url ? { url } : {}), state },
            batchRows,
            notes,
        };
    }

    function normalizeCustomSteps(raw, errors) {
        if (raw == null || raw === '') return [];
        if (Array.isArray(raw)) return raw;

        if (typeof raw === 'string') {
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                errors.push(`customSteps is not valid JSON: ${e.message}`);
                return [];
            }
            if (!Array.isArray(parsed)) {
                errors.push('customSteps must be an array');
                return [];
            }
            return parsed;
        }

        errors.push('customSteps must be an array or a JSON string');
        return [];
    }

    function normalizeViewport(raw, buildViewportFromPreset, errors, warnings) {
        if (raw == null || raw === '') return null;

        if (typeof raw === 'string') {
            const viewport = typeof buildViewportFromPreset === 'function'
                ? buildViewportFromPreset(raw)
                : null;
            // The app resolves an unknown preset to no viewport rather than failing.
            if (!viewport) warnings.push(`Unknown viewport preset "${raw}", using the browser default`);
            return viewport || null;
        }

        if (isPlainObject(raw)) {
            const width = Number(raw.width);
            const height = Number(raw.height);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                errors.push('viewport must have positive numeric width and height');
                return null;
            }
            return { width, height };
        }

        errors.push('viewport must be a preset name or {width, height}');
        return null;
    }

    /**
     * A run profile, which runs no longer have: harmless when it was the
     * default every scan has anyway, an error otherwise, as its scans would
     * check something else than they did. The converter puts it on them.
     */
    function checkRunProfile(raw, errors, warnings) {
        if (raw == null || raw === '') return;
        const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (id === DEFAULT_PROFILE) {
            warnings.push(`"profile" is not read any more: each scan step chooses its profile, ${DEFAULT_PROFILE} unless it says otherwise`);
            return;
        }
        errors.push(`"profile" ${JSON.stringify(raw)} is not read any more: each scan step chooses its profile, ${DEFAULT_PROFILE} unless it says otherwise. `
            + 'node src/cli/convert-config.js <file> --write puts it on the scans that have none');
    }

    /**
     * How the page is shown as the run starts: { colorScheme, highContrast,
     * language }, each null for the browser's own. A language may be a
     * variable ({var:lang}), read once the run's variables are known; any
     * other is taken in its canonical form.
     */
    function normalizeRunConditions(source, errors) {
        const out = { colorScheme: null, highContrast: false, language: null };

        const scheme = source.colorScheme;
        if (scheme != null && scheme !== '' && scheme !== 'default') {
            if (scheme === 'light' || scheme === 'dark') out.colorScheme = scheme;
            else errors.push(`colorScheme ${JSON.stringify(scheme)} is not a color scheme: use light or dark, or leave it out for the browser's own`);
        }

        const contrast = source.highContrast;
        if (contrast === true || contrast === 'on') out.highContrast = true;
        else if (!(contrast == null || contrast === false || contrast === '' || contrast === 'off')) {
            errors.push(`highContrast ${JSON.stringify(contrast)} is not a high contrast setting: use on or off`);
        }

        const language = trimmedString(source.language);
        if (language && language !== 'default') {
            if (language.includes('{')) {
                out.language = language;
            } else {
                let canonical = null;
                try { canonical = Intl.getCanonicalLocales(language)[0] || null; } catch { canonical = null; }
                if (canonical) out.language = canonical;
                else errors.push(`language ${JSON.stringify(language)} is not a language tag: use one such as es-ES, de or pt-BR`);
            }
        } else if (source.language != null && typeof source.language !== 'string') {
            errors.push('language must be a language tag, such as es-ES');
        }

        return out;
    }

    /**
     * A run's Include or Exclude selectors, which runs no longer have: an
     * error, as its scans would check more than they did. The converter puts
     * them on the scans, as the run applied them.
     */
    function checkRunScope(values, errors) {
        const set = values.some((v) => (Array.isArray(v) ? v.length > 0 : (typeof v === 'string' ? v.trim() !== '' : v != null)));
        if (!set) return;
        errors.push('A run has no Include or Exclude selectors any more ("context" and "exclude"): each scan step has its own. '
            + 'node src/cli/convert-config.js <file> --write puts them on the scans, as the run applied them');
    }

    /** `vars` checked and copied; `where` prefixes each problem found. */
    function normalizeVars(raw, errors, where = 'vars') {
        if (raw == null) return {};
        if (!isPlainObject(raw)) {
            errors.push(`${where} must be an object of name: value pairs`);
            return {};
        }
        const out = {};
        for (const [name, value] of Object.entries(raw)) {
            if (!VAR_NAME_RE.test(name)) {
                errors.push(`${where}: "${name}" is not a usable variable name (letters, digits, _ and -, not starting with a digit)`);
                continue;
            }
            if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
                errors.push(`${where}.${name} must be text, a number or true/false`);
                continue;
            }
            out[name] = value;
        }
        return out;
    }

    /**
     * Validate and fill in a spec, a saved config carrying one, or the form
     * state of a config saved before specs existed.
     *
     * Dependencies are injected so this file stays loadable as a plain script:
     * validateUrl and buildViewportFromPreset. Without validateUrl only the
     * presence of a url is checked.
     */
    function normalizeRunSpec(raw, deps = {}) {
        const { validateUrl = null, buildViewportFromPreset = null } = deps;
        const errors = [];
        const warnings = [];

        if (!isPlainObject(raw)) {
            return { ok: false, spec: null, errors: ['Spec must be a JSON object'], warnings };
        }

        const embedded = isUiConfig(raw) && isRunSpec(raw.runSpec) ? raw.runSpec : null;
        const fromState = !embedded && isUiConfig(raw);
        const source = embedded || (fromState ? runSpecFromUiConfig(raw) : raw);

        if (!fromState) {
            const declaredVersion = source.specVersion ?? source.version;
            if (declaredVersion != null && Number(declaredVersion) !== SPEC_VERSION) {
                warnings.push(`Spec version ${declaredVersion} is not ${SPEC_VERSION}, reading it anyway`);
            }
            for (const key of Object.keys(source)) {
                if (REPLACED_BY_PROFILE.includes(key)) {
                    errors.push(`"${key}" is not read any more: each scan step chooses its WCAG version and level with its "profile" (${DEFAULT_PROFILE} unless it says otherwise)`);
                } else if (key === 'profile' || RUN_SCOPE_KEYS.includes(key)) {
                    // checkRunProfile and checkRunScope, below, for specs and
                    // saved configs alike.
                } else if (RETIRED_RUN_FIELDS.includes(key)) {
                    warnings.push(`"${key}" is not read any more: a scan no longer saves evidence; add a Save evidence step where you want one`);
                } else if (key === 'scanEngine') {
                    warnings.push('"scanEngine" is not read any more: each scan step names its engine (its "engine" field), and a step without one runs with the default engine');
                } else if (!KNOWN_SPEC_KEYS.has(key)) {
                    warnings.push(`Unknown spec field "${key}" ignored`);
                }
            }
        }

        const url = trimmedString(source.url);
        if (!url) {
            errors.push('Spec must have a url');
        } else if (typeof validateUrl === 'function') {
            try {
                validateUrl(url);
            } catch (e) {
                errors.push(e.message);
            }
        }

        const actions = Array.isArray(source.actions) ? source.actions : null;
        if (!actions) {
            errors.push('Spec must have an actions array');
        } else if (actions.length === 0) {
            errors.push('Spec has no actions to run, define at least one (e.g. a11yScan)');
        }

        checkRunProfile(fromState ? (raw.state || {})[RUN_PROFILE_STATE_KEY] : source.profile, errors, warnings);
        checkRunScope(fromState ? RUN_SCOPE_STATE_KEYS.map((k) => (raw.state || {})[k]) : RUN_SCOPE_KEYS.map((k) => source[k]), errors);

        const spec = {
            url,
            actions: actions || [],
            customSteps: normalizeCustomSteps(source.customSteps, errors),
            viewport: normalizeViewport(source.viewport, buildViewportFromPreset, errors, warnings),
            ...normalizeRunConditions(source, errors),
            scenarioName: trimmedString(source.scenarioName),
        };

        // Only a spec that sets variables carries them.
        const vars = normalizeVars(source.vars, errors);
        if (Object.keys(vars).length) spec.vars = vars;

        return { ok: errors.length === 0, spec: errors.length ? null : spec, errors, warnings };
    }

    return {
        SPEC_TYPE,
        SPEC_VERSION,
        UI_CONFIG_TYPE,
        LEGACY_UI_CONFIG_TYPE,
        DEFAULT_PROFILE,
        VAR_NAME_RE,
        LANGUAGE_OTHER,
        KNOWN_SPEC_KEYS: Array.from(KNOWN_SPEC_KEYS),
        isUiConfig,
        isRunSpec,
        buildRunSpec,
        runSpecFromUiConfig,
        uiConfigFromRunSpec,
        normalizeRunSpec,
        normalizeVars,
    };
}));
