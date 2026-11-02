'use strict';

/**
 * conformance-targets.js (shared)
 *
 * Browser: available as globalThis.A11Y_CONFORMANCE_TARGETS.
 * Node:    module.exports.
 *
 * What a scan checks against. A scan step's single "Conformance target"
 * field (`wcagLevel`) names a target: WCAG 2.2 at Level A, AA or AAA, or a
 * standard, which sets a WCAG version and Level AA. With the step's "Include
 * best-practice rules" it resolves to one selection, { version, level,
 * profile, bestPractices }, which surea11y's adapter maps to its own terms:
 * the target (runOnly.wcag) or the standard itself (engineOptions.profile).
 * Steps saved before the targets were one list
 * may hold a bare level (A, AA, AAA), of the version the run gives.
 *
 * Every standard here is WCAG Level A and AA. What differs is the WCAG
 * version each one restates, which is why they are not interchangeable:
 * EN 301 549 V3.2.1 is WCAG 2.1 and still has 4.1.1 Parsing, and V4.1.1 is
 * WCAG 2.2.
 *
 * An engine selects by `standard` (it applies a standard in full, as
 * surea11y does), by `version` (a WCAG version and level) or by `level` (a
 * WCAG level, for every version it covers), as its adapter's
 * capabilities.selectsBy says, and each target says what it needs.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_CONFORMANCE_TARGETS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const LEVELS = ['A', 'AA', 'AAA'];
    const DEFAULT_WCAG_VERSION = '2.2';
    const DEFAULT_WCAG_LEVEL = 'AA';

    // Each WCAG version with the prefix of its version/level tags.
    const WCAG_VERSIONS = [
        { version: '2.0', base: 'wcag2' },
        { version: '2.1', base: 'wcag21' },
        { version: '2.2', base: 'wcag22' }
    ];
    const WCAG_LEVEL_TAG = /^wcag2(0|1|2)?(a{1,3})$/i;
    const BEST_PRACTICE_TAG = 'best-practice';

    /**
     * The version/level tags of a WCAG target, the way surea11y tags its
     * rules: every version up to it, every level up to it.
     * wcagTags('2.1', 'AA') -> ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
     */
    function wcagTags(version, level) {
        const v = WCAG_VERSIONS.findIndex((x) => x.version === version);
        const l = LEVELS.indexOf(level);
        if (v < 0 || l < 0) return [];
        const tags = [];
        for (let i = 0; i <= v; i++) {
            for (let j = 0; j <= l; j++) tags.push(WCAG_VERSIONS[i].base + LEVELS[j].toLowerCase());
        }
        return tags;
    }

    // What an engine selects by, from least to most.
    const SELECTS_BY = ['level', 'version', 'standard'];
    const DEFAULT_SELECTS_BY = 'level';

    function target(label, version, level, { profile = false, needs = 'level' } = {}) {
        return Object.freeze({ label, version, level, profile, needs, tags: Object.freeze(wcagTags(version, level)) });
    }

    // Every target a scan step offers, in the order it offers them. A WCAG
    // target is that version and level; a standard (`profile`) is also
    // surea11y's profile of the same id. EN 301 549 V4.1.1 is WCAG 2.2 AA,
    // which an engine selecting by level comes closest to; EN 301 549 V3.2.1
    // (WCAG 2.1, with 4.1.1 Parsing) needs the standard.
    // Not frozen: an installed standard pack adds its profiles at start
    // (registerStandardProfiles); these entries are never changed.
    const SCAN_TARGETS = ({
        'wcag22-a': target('WCAG 2.2 A', '2.2', 'A'),
        'wcag22-aa': target('WCAG 2.2 AA', '2.2', 'AA'),
        'wcag22-aaa': target('WCAG 2.2 AAA', '2.2', 'AAA'),
        'en301549-v4.1.1': target('EN 301 549 V4.1.1', '2.2', 'AA', { profile: true }),
        'en301549-v3.2.1': target('EN 301 549 V3.2.1', '2.1', 'AA', { profile: true, needs: 'standard' })
    });
    const DEFAULT_SCAN_TARGET = 'wcag22-aa';
    // The targets that are WCAG levels, not standards: a scan names one.
    const WCAG_TARGETS = ['wcag22-a', 'wcag22-aa', 'wcag22-aaa'];

    // The standards: the targets that are also surea11y's profiles.
    const CONFORMANCE_TARGETS = Object.fromEntries(
        Object.entries(SCAN_TARGETS).filter(([, t]) => t.profile)
    );

    // The profiles core takes in engineOptions.profile: the standards, and
    // its own WCAG 2.2 ones, which a caller may still ask for. A scan step's
    // WCAG target alone is a WCAG selection (runOnly.wcag), not that profile;
    // beside a standard it is the profile, since a scan of several profiles
    // names each one.
    const CORE_PROFILES = [...Object.keys(CONFORMANCE_TARGETS), 'wcag22-a', 'wcag22-aa', 'wcag22-aaa'];

    const PROFILE_ID = /^[a-z][a-z0-9]*(-[a-z0-9.]+)+$/;

    /**
     * Adds the profiles of installed standard packs (`standards`, as
     * GET /api/standards lists them) as targets a scan step can take, each
     * a standard surea11y applies itself: WCAG Level AA of the version its
     * profile is built on, unless it says another level. A profile already
     * known keeps its entry, so EN 301 549's are as above. Returns the ids
     * added.
     */
    function registerStandardProfiles(standards) {
        const added = [];
        for (const std of Array.isArray(standards) ? standards : []) {
            for (const p of Array.isArray(std && std.profiles) ? std.profiles : []) {
                const id = typeof (p && p.id) === 'string' ? p.id.trim().toLowerCase() : '';
                if (!PROFILE_ID.test(id) || Object.prototype.hasOwnProperty.call(SCAN_TARGETS, id)) continue;
                const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : id;
                const version = versionOf(p.wcagVersion) || DEFAULT_WCAG_VERSION;
                const level = levelOf(p.level) || 'AA';
                const t = target(label, version, level, { profile: true, needs: 'standard' });
                SCAN_TARGETS[id] = t;
                CONFORMANCE_TARGETS[id] = t;
                CORE_PROFILES.push(id);
                added.push(id);
            }
        }
        return added;
    }

    function profileId(v) {
        const id = typeof v === 'string' ? v.trim().toLowerCase() : '';
        return CORE_PROFILES.includes(id) ? id : null;
    }

    function scanTargetId(v) {
        const id = typeof v === 'string' ? v.trim().toLowerCase() : '';
        return Object.prototype.hasOwnProperty.call(SCAN_TARGETS, id) ? id : null;
    }

    /**
     * The profiles a scan step names: one id, a list of them, or a string of
     * them separated by commas (what a variable holds), each trimmed and
     * lowercased, once each, in the order given. Unknown ids are kept, for
     * checkScanSteps to name.
     */
    function profileList(v) {
        const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
        const out = [];
        for (const item of raw) {
            const id = typeof item === 'string' ? item.trim().toLowerCase() : '';
            if (id && !out.includes(id)) out.push(id);
        }
        return out;
    }

    /** Whether a target is a WCAG level (WCAG 2.2 A, AA or AAA), not a standard. */
    function isWcagTarget(id) {
        return WCAG_TARGETS.includes(scanTargetId(id));
    }

    /**
     * The known targets of a scan step's profiles, its WCAG level first, then
     * the standards in the order given: the order core scans them in, and the
     * first is the scan's lead profile (core's engine.profile).
     */
    function scanTargetIds(v) {
        const ids = profileList(v).map(scanTargetId).filter(Boolean);
        return [...ids.filter(isWcagTarget), ...ids.filter((id) => !isWcagTarget(id))];
    }

    /**
     * What is wrong with a scan step's profiles, as messages: an id that is no
     * target, or two WCAG levels (each level includes the ones below it, so a
     * scan names one). [] when nothing is.
     */
    function scanTargetProblems(v) {
        const list = profileList(v);
        const problems = [];
        // Named as given ("AA", not "aa"), once each.
        const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
        const named = [...new Set(raw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
        for (const id of named) {
            if (!scanTargetId(id)) problems.push(`"${id}" is not a profile`);
        }
        const levels = list.filter(isWcagTarget);
        if (levels.length > 1) {
            problems.push(`${levels.map((id) => SCAN_TARGETS[id].label).join(' and ')} are two WCAG levels: `
                + 'each level includes the ones below it, so choose one');
        }
        return problems;
    }

    function selectsByOf(v) {
        return SELECTS_BY.includes(v) ? v : DEFAULT_SELECTS_BY;
    }

    /** Whether an engine that selects by `selectsBy` can check a target. */
    function targetSupported(targetValue, selectsBy) {
        const ids = scanTargetIds(targetValue);
        // No target: the scan takes the run's level, which every engine selects by.
        if (!ids.length) return true;
        // Several profiles at once: an engine that applies standards in full.
        const needs = ids.length > 1 ? 'standard' : SCAN_TARGETS[ids[0]].needs;
        return SELECTS_BY.indexOf(selectsByOf(selectsBy)) >= SELECTS_BY.indexOf(needs);
    }

    /** The ids of the targets an engine that selects by `selectsBy` can check. */
    function scanTargetsFor(selectsBy) {
        return Object.keys(SCAN_TARGETS).filter((id) => targetSupported(id, selectsBy));
    }

    function levelOf(v) {
        const level = typeof v === 'string' ? v.trim().toUpperCase() : '';
        return LEVELS.includes(level) ? level : null;
    }

    function versionOf(v) {
        const version = v == null ? '' : String(v).trim();
        return WCAG_VERSIONS.some((x) => x.version === version) ? version : null;
    }

    /**
     * Reads a scan step's profile, or its profiles. Anything that is not a
     * profile id is none (checkScanSteps stops a run whose step gives
     * something else).
     *
     * One profile reads as it always has. Several also give `profiles`, every
     * one in the order core scans them (scanTargetIds), which an engine hands
     * core as one scan of them all: the WCAG version and level are then the
     * WCAG profile's, or else the first standard's, and `profile` is the
     * first standard, or null.
     *
     * @returns {{ level: 'A'|'AA'|'AAA'|null, version: string|null, profile: string|null, profiles?: string[] }}
     */
    function resolveScanTarget({ profile } = {}) {
        const ids = scanTargetIds(profile);
        if (!ids.length) return { level: null, version: null, profile: null };
        const t = SCAN_TARGETS[ids[0]];
        if (ids.length === 1) return { level: t.level, version: t.version, profile: t.profile ? ids[0] : null };
        const standard = ids.find((id) => !isWcagTarget(id)) || null;
        return { level: t.level, version: t.version, profile: standard, profiles: ids };
    }

    /**
     * What a list of WCAG tags comes to, for run specs and callers that still
     * give tags: the highest version and the highest level its version/level
     * tags name, and whether it names best-practice. Version and level are null
     * when it names no version/level tag.
     * -> { version, level, bestPractices }
     */
    function selectionFromTags(tags) {
        const list = Array.isArray(tags)
            ? tags
            : (typeof tags === 'string' ? tags.split(',') : []);
        let v = -1;
        let l = -1;
        let bestPractices = false;
        for (const raw of list) {
            const t = String(raw).trim().toLowerCase();
            if (t === BEST_PRACTICE_TAG) bestPractices = true;
            const m = WCAG_LEVEL_TAG.exec(t);
            if (!m) continue;
            v = Math.max(v, m[1] === '1' ? 1 : m[1] === '2' ? 2 : 0);
            l = Math.max(l, m[2].length - 1);
        }
        return {
            version: v >= 0 ? WCAG_VERSIONS[v].version : null,
            level: l >= 0 ? LEVELS[l] : null,
            bestPractices
        };
    }

    /**
     * A scan's selection: { version, level, profile, bestPractices }.
     *
     * - profile: the scan's profile, which sets the version and the level.
     * - version: without a profile, the version given, else the highest
     *   version in `tags`, else 2.2.
     * - tags: WCAG tags, as engine callers give them; without a profile, the
     *   level comes from theirs.
     * - includeBestPractice: the step's option; `tags` naming best-practice
     *   also turns it on.
     */
    function resolveScanSelection({ profile, includeBestPractice, version, tags } = {}) {
        const fromTags = selectionFromTags(tags);
        const target = resolveScanTarget({ profile });
        const bestPractices = includeBestPractice === true || fromTags.bestPractices;
        const selection = {
            version: target.version || versionOf(version) || fromTags.version || DEFAULT_WCAG_VERSION,
            level: target.level || fromTags.level || DEFAULT_WCAG_LEVEL,
            profile: target.profile,
            bestPractices
        };
        if (target.profiles) selection.profiles = target.profiles;
        return selection;
    }

    function runOnlyTags(runOnly) {
        if (!runOnly || typeof runOnly !== 'object') return [];
        const raw = runOnly.type === 'tag' ? runOnly.values : runOnly.tags;
        const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
        return list.map((t) => String(t).trim()).filter(Boolean);
    }

    /**
     * The selection of a caller that gives none, from what it gives instead:
     * WCAG tags in runOnly (`tags`, or { type: 'tag', values }), a
     * level, a standard. Null when none of them names a version, level or
     * standard: the engine then runs as it does without a selection.
     *
     * Here `wcagLevel` is a bare level ('AA'), as the runner hands the engines
     * the level it resolved, not a step's target.
     */
    function selectionFromRunOnly({ runOnly, wcagLevel, profile } = {}) {
        const tags = runOnlyTags(runOnly);
        const level = levelOf(wcagLevel);
        // A profile, or a list of them, as core takes in engineOptions.profile.
        const profiles = profileList(profile).filter((id) => profileId(id));
        if (!selectionFromTags(tags).level && !level && !profiles.length) return null;
        const selection = resolveScanSelection({ tags, profile: profiles.length ? profiles : null });
        // A profile sets its own level; otherwise the level given beats the tags'.
        return level && !profiles.length ? { ...selection, level } : selection;
    }

    /**
     * runOnly's tags without those a selection stands for (version/level tags
     * and best-practice): the rule tags a caller adds on top of it.
     */
    function tagsBesideSelection(runOnly) {
        return runOnlyTags(runOnly).filter((t) => !WCAG_LEVEL_TAG.test(t) && t.toLowerCase() !== BEST_PRACTICE_TAG);
    }

    /** The tags a selection comes to, recorded on a scan. */
    function selectionTags(selection) {
        if (!selection) return [];
        const tags = wcagTags(selection.version, selection.level);
        if (selection.bestPractices) tags.push(BEST_PRACTICE_TAG);
        return tags;
    }

    /**
     * Whether a finding is a best practice: a rule that tests no requirement
     * of the scan's target. Engines mark them (finding.bestPractice) when the
     * scan includes best-practices; they are listed and counted apart from
     * the requirements and never count toward a criterion, score or rate.
     */
    function isBestPracticeFinding(f) {
        return !!(f && f.bestPractice === true);
    }

    /** { fail, cantTell, pass, notApplicable } over a list of findings. */
    function outcomeCounts(findings) {
        const out = { fail: 0, cantTell: 0, pass: 0, notApplicable: 0 };
        for (const f of Array.isArray(findings) ? findings : []) {
            if (f && Object.prototype.hasOwnProperty.call(out, f.outcome)) out[f.outcome] += 1;
        }
        return out;
    }

    /**
     * A scan's summary: the requirements' outcome counts, and the best
     * practices' apart. -> { outcomes, bestPractices }
     */
    function splitOutcomeCounts(findings) {
        const list = Array.isArray(findings) ? findings : [];
        return {
            outcomes: outcomeCounts(list.filter((f) => !isBestPracticeFinding(f))),
            bestPractices: outcomeCounts(list.filter(isBestPracticeFinding))
        };
    }

    /**
     * Moves a scan's best-practice findings out of canonical.findings into
     * canonical.bestPractices, so every count, score, comparison and export
     * that reads the findings reads the requirements only, and the views list
     * the best practices in a section of their own. Safe to call twice.
     */
    function separateBestPractices(canonical) {
        if (!canonical || typeof canonical !== 'object') return canonical;
        const all = Array.isArray(canonical.findings) ? canonical.findings : [];
        const kept = Array.isArray(canonical.bestPractices) ? canonical.bestPractices : [];
        canonical.findings = all.filter((f) => !isBestPracticeFinding(f));
        canonical.bestPractices = [...kept, ...all.filter(isBestPracticeFinding)];
        return canonical;
    }

    /** "WCAG 2.1 AA", the standard's name, or "WCAG 2.2 AA + WAI-ARIA 1.2". */
    function selectionLabel(selection) {
        if (!selection) return null;
        if (Array.isArray(selection.profiles) && selection.profiles.length > 1) return profilesLabel(selection.profiles);
        if (selection.profile && SCAN_TARGETS[selection.profile]) return SCAN_TARGETS[selection.profile].label;
        return `WCAG ${selection.version} ${selection.level}`;
    }

    function targetLabel(profile) {
        const target = SCAN_TARGETS[profile];
        return target ? target.label : null;
    }

    /** The profiles' names joined: "WCAG 2.2 AA + WAI-ARIA 1.2". */
    function profilesLabel(ids) {
        return profileList(ids).map((id) => targetLabel(id) || id).join(' + ');
    }

    return {
        LEVELS,
        DEFAULT_WCAG_VERSION,
        DEFAULT_WCAG_LEVEL,
        CONFORMANCE_TARGETS,
        SCAN_TARGETS,
        DEFAULT_SCAN_TARGET,
        SELECTS_BY,
        resolveScanTarget,
        scanTargetId,
        targetSupported,
        scanTargetsFor,
        resolveScanSelection,
        selectionFromTags,
        selectionFromRunOnly,
        tagsBesideSelection,
        selectionTags,
        selectionLabel,
        isBestPracticeFinding,
        outcomeCounts,
        splitOutcomeCounts,
        separateBestPractices,
        wcagTags,
        targetLabel,
        profilesLabel,
        profileList,
        isWcagTarget,
        scanTargetIds,
        scanTargetProblems,
        profileId,
        registerStandardProfiles
    };
}));
