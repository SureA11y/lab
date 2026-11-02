'use strict';

/**
 * config-upgrade.js (shared)
 *
 * Brings a saved configuration or run spec in the older format up to the
 * current one, which the runner and the app no longer read the older one of:
 *
 * - a scan's wcagLevel, a bare level ("AA") or a target, and its separate
 *   conformanceProfile, become its profile;
 * - a scan's timeout, which was both Wait for's timeout and the limit on each
 *   stage, becomes waitTimeout (and stageTimeout, when it gave more than the
 *   minute the stages now get);
 * - programmatic "true"/"false" becomes true/false;
 * - a screenshot's or evidence capture's name or title becomes its label;
 * - setValue with a masked value becomes setPassword, as the app does;
 * - getTextIntoVariable becomes getText;
 * - shapes the action definitions' own examples used to show: a "save" step,
 *   hoverByText's text, evidence's variants;
 * - a run spec's tags or wcag become its profile;
 * - the Section 508 profile, which was WCAG 2.0 A and AA under another name,
 *   becomes WCAG 2.2 AA, for a scan, a run spec and the app's run;
 * - a run has no profile any more: the run's goes onto each scan that had
 *   none (unless it was WCAG 2.2 AA, which such a scan checks anyway);
 * - a scan no longer saves evidence: its evidenceVariant and the run's
 *   evidence format are dropped (the Save evidence step stays);
 * - a run has no Include or Exclude selectors any more: the run's Exclude
 *   selectors are added to each scan's, and its Include selectors go onto
 *   each scan that has none, as the run applied them (a scan's own Include
 *   replaced the run's);
 * - Skip iteration's textEquals, which nothing read, is dropped;
 * - a scan's crawl (and the probes it carried) is dropped;
 * - a scan's optInRules, for RGAA's rules, which the lab no longer runs, is
 *   dropped. A scan or run whose profile is RGAA's is left for a person to
 *   choose another;
 * - a scan's disableRules, a second Exclude rules that surea11y did not
 *   read, joins its excludeRuleIds, which every engine reads.
 *
 * A scan's engine field is dropped: surea11y is the lab's one engine. A scan
 * that named another runs with surea11y now, and a note says so. The app's Load config runs every file through this; the command line
 * has src/cli/convert-config.js.
 *
 * Browser: available as globalThis.A11Y_CONFIG_UPGRADE (after run-spec.js).
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(() => require('./run-spec.js'));
    } else {
        root.A11Y_CONFIG_UPGRADE = factory(() => root.A11Y_RUN_SPEC);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (runSpec) {
    const LEVELS = ['A', 'AA', 'AAA'];
    // Profiles the lab no longer has, and the one each becomes. Section 508
    // was WCAG 2.0 A and AA under another name.
    const RETIRED_PROFILES = { section508: 'wcag22-aa' };
    const retiredProfile = (value) => (typeof value === 'string' ? RETIRED_PROFILES[value.trim().toLowerCase()] || null : null);
    const retiredMessage = (from, to) => `profile ${show(from)} → ${show(to)} (the lab no longer has it: it checked WCAG 2.0 AA, and now checks WCAG 2.2 AA)`;
    const ONE_MINUTE_MS = 60000;
    const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const show = (v) => JSON.stringify(v);

    /**
     * One step brought up to date. `say` records each change against the
     * step. `run.profile` is the profile the run used to give the scans that
     * named none, which each such scan now names itself; `run.context` and
     * `run.exclude` the Include and Exclude selectors it gave them.
     */
    function convertStep(step, say, notes = [], run = {}) {
        let s = step;
        const set = (patch, message) => {
            s = { ...s, ...patch };
            for (const key of Object.keys(patch)) if (patch[key] === undefined) delete s[key];
            say(message);
        };

        if (s.type === 'getTextIntoVariable') set({ type: 'getText' }, 'getTextIntoVariable → getText');
        if (s.type === 'save') set({ type: 'evidenceCapture' }, 'type "save" → evidenceCapture');
        if (s.type === 'setValue' && s.valueMasked === true) set({ type: 'setPassword' }, 'setValue with a masked value → setPassword');

        if (s.type === 'a11yScan') {
            const profileSource = typeof s.conformanceProfile === 'string' && s.conformanceProfile.trim()
                ? s.conformanceProfile.trim()
                : (typeof s.wcagLevel === 'string' && s.wcagLevel.trim() ? s.wcagLevel.trim() : null);
            if ('wcagLevel' in s || 'conformanceProfile' in s) {
                const level = profileSource && LEVELS.includes(profileSource.toUpperCase()) ? profileSource.toUpperCase() : null;
                const profile = level ? `wcag22-${level.toLowerCase()}` : (profileSource ? profileSource.toLowerCase() : undefined);
                const from = [
                    'wcagLevel' in s ? `wcagLevel ${show(s.wcagLevel)}` : null,
                    'conformanceProfile' in s ? `conformanceProfile ${show(s.conformanceProfile)}` : null,
                ].filter(Boolean).join(' and ');
                if (s.profile === undefined) {
                    set({ wcagLevel: undefined, conformanceProfile: undefined, profile },
                        profile ? `${from} → profile ${show(profile)}` : `${from} dropped (no profile of its own)`);
                } else {
                    set({ wcagLevel: undefined, conformanceProfile: undefined }, `${from} dropped: it has a profile already`);
                }
            }
            // surea11y is the lab's one engine: a scan names none.
            if ('engine' in s) {
                const engine = typeof s.engine === 'string' ? s.engine.trim() : '';
                set({ engine: undefined }, `engine ${show(s.engine)} dropped (surea11y is the lab's one engine)`);
                if (engine && engine.toLowerCase() !== 'surea11y') {
                    notes.push(`it named the engine ${show(engine)}, which the lab no longer has: it runs with surea11y now, and its findings may differ`);
                }
            }
            if (retiredProfile(s.profile)) set({ profile: retiredProfile(s.profile) }, retiredMessage(s.profile, retiredProfile(s.profile)));
            // A list of profiles (a scan of several at once): each retired
            // one becomes its replacement, once.
            if (Array.isArray(s.profile) && s.profile.some(retiredProfile)) {
                const list = [];
                for (const p of s.profile) {
                    const to = retiredProfile(p) || p;
                    if (!list.includes(to)) list.push(to);
                }
                const from = s.profile.find(retiredProfile);
                set({ profile: list }, retiredMessage(from, retiredProfile(from)));
            }
            // A run has no profile any more: a scan that had none of its own
            // ("" was "the run's profile") names the run's, unless that was
            // the default, which a scan without a profile checks anyway.
            const own = typeof s.profile === 'string'
                ? s.profile.trim()
                : (Array.isArray(s.profile) && s.profile.length ? s.profile : '');
            if (!own && run.profile) set({ profile: run.profile }, `profile ${show(run.profile)}, the run's`);
            else if (!own && 'profile' in s) set({ profile: undefined }, `profile ${show(s.profile)} (the run's) dropped: WCAG 2.2 AA, as before`);
            if ('evidenceVariant' in s) {
                const saved = ['png', 'mhtml', 'both'].includes(String(s.evidenceVariant));
                set({ evidenceVariant: undefined }, `evidenceVariant ${show(s.evidenceVariant)} dropped (a scan no longer saves evidence`
                    + (saved ? ': add a Save evidence step after it for a PNG or MHTML of the page)' : ')'));
            }
            // The scan's Crawl, which read other pages' titles first in the
            // workflow's own session, is gone, with what carried its result.
            for (const key of ['crawl', 'probes']) {
                if (key in s) set({ [key]: undefined }, `${key} ${show(s[key])} dropped (a scan no longer crawls other pages first)`);
            }
            if ('optInRules' in s) set({ optInRules: undefined }, `optInRules ${show(s.optInRules)} dropped (the lab no longer runs RGAA's rules)`);
            if ('disableRules' in s) {
                const merged = Array.from(new Set([...selectorList(s.excludeRuleIds), ...selectorList(s.disableRules)]));
                set({ disableRules: undefined, excludeRuleIds: merged.length ? merged.join(', ') : undefined },
                    `disableRules ${show(s.disableRules)} → excludeRuleIds ${show(merged.join(', '))}`);
            }
            // A run has no Include or Exclude selectors any more: the scan
            // names the ones it was checked with. Its own Include replaced
            // the run's; its own Exclude added to the run's.
            const ownContext = typeof s.context === 'string' ? s.context.trim() : '';
            if (!ownContext && run.context) set({ context: run.context }, `context ${show(run.context)}, the run's Include selectors`);
            if (run.exclude && run.exclude.length) {
                const own = selectorList(s.exclude);
                const merged = Array.from(new Set([...run.exclude, ...own]));
                if (merged.length !== own.length) {
                    set({ exclude: merged.join(', ') }, `exclude ${show(merged.join(', '))}, with the run's Exclude selectors`);
                }
            }
            if ('timeout' in s) {
                const ms = Number(s.timeout);
                const patch = { timeout: undefined };
                if (s.waitTimeout === undefined && Number.isFinite(ms)) patch.waitTimeout = ms;
                if (s.stageTimeout === undefined && Number.isFinite(ms) && ms > ONE_MINUTE_MS) patch.stageTimeout = ms;
                set(patch, `timeout ${show(s.timeout)} → waitTimeout ${show(patch.waitTimeout ?? s.waitTimeout)}`
                    + (patch.stageTimeout ? ` and stageTimeout ${show(patch.stageTimeout)}` : ' (each stage now gets a minute)'));
            }
        }

        if ((s.type === 'click' || s.type === 'clickByText') && typeof s.programmatic === 'string') {
            const value = s.programmatic.trim().toLowerCase() === 'true';
            set({ programmatic: value }, `programmatic ${show(s.programmatic)} → ${value}`);
        }

        if (s.type === 'screenshot' || s.type === 'evidenceCapture') {
            for (const key of ['name', 'title']) {
                if (!(key in s)) continue;
                const value = s[key];
                const hasLabel = typeof s.label === 'string' && s.label.trim();
                if (!hasLabel && typeof value === 'string' && value.trim()) set({ label: value, [key]: undefined }, `${key} ${show(value)} → label`);
                else set({ [key]: undefined }, `${key} ${show(value)} dropped: it has a label`);
            }
        }

        if (s.type === 'evidenceCapture' && Array.isArray(s.variants)) {
            const v = s.variants.map(String);
            const variant = v.includes('png') && v.includes('mhtml') ? 'both' : (v[0] || undefined);
            set({ variants: undefined, ...(s.evidenceVariant === undefined && variant ? { evidenceVariant: variant } : {}) },
                `variants ${show(s.variants)} → evidenceVariant ${show(variant)}`);
        }

        // Skip iteration's Literal equals compared its text with nothing, and
        // was never read: it goes, and the step skips as it did.
        if (s.type === 'skipIteration' && 'textEquals' in s) {
            set({ textEquals: undefined }, `textEquals ${show(s.textEquals)} dropped (it was never read: use Element selector :ctx with Text equals)`);
        }

        if (s.type === 'hoverByText' && typeof s.text === 'string' && s.labelText === undefined) {
            set({ labelText: s.text, text: undefined }, 'text → labelText');
        }

        return s;
    }

    /** Selectors as a list: an array, or comma (or, once, line) separated text. */
    function selectorList(value) {
        const parts = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,\n]/) : []);
        return parts.map((v) => String(v).trim()).filter(Boolean);
    }

    /**
     * The Include and Exclude selectors a run gave its scans, for the scans to
     * name: { context, exclude }, or nothing. `say` records what became of them.
     */
    function takeRunScope(context, exclude, say) {
        const out = {};
        const include = typeof context === 'string' ? context.trim() : '';
        if (include) {
            out.context = include;
            say(`the run's Include selectors ${show(include)} put on each scan that has none`);
        }
        const excluded = selectorList(exclude);
        if (excluded.length) {
            out.exclude = excluded;
            say(`the run's Exclude selectors ${show(excluded.join(', '))} added to each scan's`);
        }
        return out;
    }

    const looksLikeSteps = (value) => Array.isArray(value) && value.some((v) => isObject(v) && typeof v.type === 'string');

    /** Every step of a list and those nested in them, numbered as the app does. */
    function convertSteps(list, where, changes, notes, run = {}, prefix = '') {
        if (!Array.isArray(list)) return list;
        return list.map((step, i) => {
            if (!isObject(step)) return step;
            const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
            const stepNotes = [];
            let out = convertStep(step, (message) => changes.push(`${where}step ${number}: ${message}`), stepNotes, run);
            for (const n of stepNotes) notes.push(`${where}step ${number}: ${n}`);
            for (const [key, value] of Object.entries(out)) {
                if (looksLikeSteps(value)) {
                    const nested = convertSteps(value, where, changes, notes, run, number);
                    if (nested !== value) out = { ...out, [key]: nested };
                }
            }
            return out;
        });
    }

    function convertCustomSteps(list, changes, notes, run = {}) {
        if (!Array.isArray(list)) return list;
        return list.map((custom, i) => {
            if (!isObject(custom) || !Array.isArray(custom.actions)) return custom;
            const name = typeof custom.id === 'string' && custom.id.trim() ? ` "${custom.id.trim()}"` : '';
            return { ...custom, actions: convertSteps(custom.actions, `custom step ${i + 1}${name}, `, changes, notes, run) };
        });
    }

    /** The profile a spec's tags or wcag asked for, and a note when it is not the same. */
    function profileFromWcag(spec) {
        let version = null;
        let level = null;
        if (isObject(spec.wcag)) {
            version = typeof spec.wcag.version === 'string' ? spec.wcag.version : null;
            level = typeof spec.wcag.level === 'string' ? spec.wcag.level.toUpperCase() : null;
        }
        if (Array.isArray(spec.tags)) {
            for (const tag of spec.tags) {
                const m = /^wcag2(\d?)(a{1,3})$/i.exec(String(tag).trim());
                if (!m) continue;
                const v = m[1] === '2' ? '2.2' : (m[1] === '1' ? '2.1' : '2.0');
                if (!version || v > version) version = v;
                const l = m[2].toUpperCase();
                if (!level || LEVELS.indexOf(l) > LEVELS.indexOf(level)) level = l;
            }
        }
        if (!LEVELS.includes(level || 'AA')) level = 'AA';
        const profile = `wcag22-${(level || 'AA').toLowerCase()}`;
        const note = version && version !== '2.2'
            ? `it asked for WCAG ${version}, which no profile is: it now checks WCAG 2.2 at ${level || 'AA'}`
            : null;
        return { profile, note };
    }

    /** A run spec brought up to date, its steps and custom steps included. */
    function convertRunSpec(spec, changes, notes, where = '') {
        let out = { ...spec };
        if (retiredProfile(out.profile)) {
            changes.push(`${where}${retiredMessage(out.profile, retiredProfile(out.profile))}`);
            out.profile = retiredProfile(out.profile);
        }
        if ('tags' in out || 'wcag' in out) {
            const { profile, note } = profileFromWcag(out);
            const from = ['tags' in out ? `tags ${show(out.tags)}` : null, 'wcag' in out ? `wcag ${show(out.wcag)}` : null].filter(Boolean).join(' and ');
            delete out.tags;
            delete out.wcag;
            if (out.profile === undefined && profile !== runSpec().DEFAULT_PROFILE) {
                out.profile = profile;
                changes.push(`${where}${from} → profile ${show(profile)}`);
            } else {
                changes.push(`${where}${from} dropped (the profile is ${show(out.profile || runSpec().DEFAULT_PROFILE)})`);
            }
            if (note) notes.push(`${where}${note}`);
            const bestPractice = (Array.isArray(spec.tags) && spec.tags.some((t) => String(t).trim().toLowerCase() === 'best-practice'))
                || (isObject(spec.wcag) && spec.wcag.bestPractice === true);
            if (bestPractice) notes.push(`${where}it ran the best-practice rules for the whole run, which a run no longer sets: turn on each scan's "Best practices" instead`);
        }
        // A run has no profile or evidence format any more: its profile goes
        // onto the scans that named none.
        const run = {
            profile: takeRunProfile(out.profile, (message) => changes.push(`${where}${message}`)),
            ...takeRunScope(out.context, out.exclude, (message) => changes.push(`${where}${message}`)),
        };
        delete out.profile;
        delete out.context;
        delete out.exclude;
        if ('globalEvidenceFormat' in out) {
            changes.push(`${where}${evidenceFormatMessage(out.globalEvidenceFormat)}`);
            delete out.globalEvidenceFormat;
        }
        if (Array.isArray(out.actions)) out.actions = convertSteps(out.actions, where, changes, notes, run);
        if (Array.isArray(out.customSteps)) out.customSteps = convertCustomSteps(out.customSteps, changes, notes, run);
        return out;
    }

    /**
     * The profile a run gave its scans, for the scans to name, or null when
     * it gave none or the default (what a scan checks without a profile).
     */
    function takeRunProfile(value, say) {
        const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
        if (!id) return null;
        if (id === runSpec().DEFAULT_PROFILE) {
            say(`the run's profile ${show(value)} dropped: a scan without one checks it anyway`);
            return null;
        }
        say(`the run's profile ${show(value)} put on each scan that has none`);
        return id;
    }

    function evidenceFormatMessage(value) {
        const saved = ['png', 'mhtml', 'both'].includes(String(value));
        return `the run's evidence format ${show(value)} dropped (a scan no longer saves evidence`
            + (saved ? ': add a Save evidence step where you want a PNG or MHTML of the page)' : ')');
    }

    /**
     * -> { kind: 'config' | 'spec' | null, doc, changes: [string], notes: [string] }.
     * kind null: not a configuration or a run spec, left alone.
     */
    function convertDocument(doc) {
        const changes = [];
        const notes = [];

        if (runSpec().isRunSpec(doc)) {
            return { kind: 'spec', doc: convertRunSpec(doc, changes, notes), changes, notes };
        }
        if (!runSpec().isUiConfig(doc)) return { kind: null, doc, changes, notes };

        const out = { ...doc };
        if (isObject(out.state)) {
            const state = { ...out.state };
            if (retiredProfile(state['run-profile'])) {
                changes.push(`the run's ${retiredMessage(state['run-profile'], retiredProfile(state['run-profile']))}`);
                state['run-profile'] = retiredProfile(state['run-profile']);
            }
            const run = {
                profile: takeRunProfile(state['run-profile'], (message) => changes.push(message)),
                ...takeRunScope(state['scan-context'],
                    state['exclude-selectors-global'] ?? state['scan-exclude'], (message) => changes.push(message)),
            };
            delete state['run-profile'];
            for (const key of ['scan-context', 'exclude-selectors-global', 'scan-exclude']) delete state[key];
            if ('evidence-save-selector' in state) {
                changes.push(evidenceFormatMessage(state['evidence-save-selector']));
                delete state['evidence-save-selector'];
            }
            if (Array.isArray(state['actions-workflow'])) state['actions-workflow'] = convertSteps(state['actions-workflow'], '', changes, notes, run);
            for (const key of ['custom-steps-json', 'custom-steps-definitions']) {
                if (typeof state[key] !== 'string' || !state[key].trim()) continue;
                let parsed;
                try {
                    parsed = JSON.parse(state[key]);
                } catch {
                    notes.push(`its ${key} is not valid JSON, left as it is`);
                    continue;
                }
                const before = changes.length;
                const converted = convertCustomSteps(parsed, changes, notes, run);
                if (changes.length > before) state[key] = JSON.stringify(converted);
            }
            out.state = state;
        }
        if (isObject(out.runSpec)) {
            // The saved run spec repeats the form's steps: changes said once, for the form.
            out.runSpec = convertRunSpec(out.runSpec, [], [], 'its saved run spec: ');
        }
        return { kind: 'config', doc: out, changes, notes };
    }

    /**
     * A run spec's fields brought up to date, typed or not: what the queue
     * keeps of a run in batch.json. -> { spec, changes, notes }
     */
    function upgradeRunSpec(spec) {
        const changes = [];
        const notes = [];
        if (!isObject(spec)) return { spec, changes, notes };
        return { spec: convertRunSpec(spec, changes, notes), changes, notes };
    }

    return { convertDocument, convertStep, upgradeRunSpec };
}));
