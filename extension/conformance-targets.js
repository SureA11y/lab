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
 * profile, bestPractices }, which every engine's adapter maps to its own
 * terms: surea11y takes the target (runOnly.wcag) or the standard itself
 * (engineOptions.profile), axe-core the version/level tags, and Alfa, Pa11y
 * and QualWeb the level alone. Steps saved before the targets were one list
 * may hold a bare level (A, AA, AAA), of the version the run gives.
 *
 * Every standard here is WCAG Level A and AA. What differs is the WCAG
 * version each one restates, which is why they are not interchangeable:
 * EN 301 549 V3.2.1 is WCAG 2.1 and still has 4.1.1 Parsing, and V4.1.1 is
 * WCAG 2.2.
 *
 * Not every engine can check every target. An engine selects by `standard`
 * (it applies a standard in full: surea11y), by `version` (a WCAG version and
 * level: axe-core) or by `level` (a WCAG level, for every version it covers:
 * Alfa, Pa11y, QualWeb), as its adapter's capabilities.selectsBy says, and
 * each target says what it needs.
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
     * The version/level tags of a WCAG target, the way axe-core and surea11y
     * tag their rules: every version up to it, every level up to it.
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
    const SCAN_TARGETS = Object.freeze({
        'wcag22-a': target('WCAG 2.2 A', '2.2', 'A'),
        'wcag22-aa': target('WCAG 2.2 AA', '2.2', 'AA'),
        'wcag22-aaa': target('WCAG 2.2 AAA', '2.2', 'AAA'),
        'en301549-v4.1.1': target('EN 301 549 V4.1.1', '2.2', 'AA', { profile: true }),
        'en301549-v3.2.1': target('EN 301 549 V3.2.1', '2.1', 'AA', { profile: true, needs: 'standard' })
    });
    const DEFAULT_SCAN_TARGET = 'wcag22-aa';

    // The standards: the targets that are also surea11y's profiles.
    const CONFORMANCE_TARGETS = Object.freeze(Object.fromEntries(
        Object.entries(SCAN_TARGETS).filter(([, t]) => t.profile)
    ));

    // The profiles core takes in engineOptions.profile: the standards, and
    // its own WCAG 2.2 AA one, which a caller may still ask for. A scan step's
    // WCAG 2.2 AA target is a WCAG selection, not that profile.
    const CORE_PROFILES = Object.freeze([...Object.keys(CONFORMANCE_TARGETS), 'wcag22-aa']);

    function profileId(v) {
        const id = typeof v === 'string' ? v.trim().toLowerCase() : '';
        return CORE_PROFILES.includes(id) ? id : null;
    }

    function scanTargetId(v) {
        const id = typeof v === 'string' ? v.trim().toLowerCase() : '';
        return Object.prototype.hasOwnProperty.call(SCAN_TARGETS, id) ? id : null;
    }

    function selectsByOf(v) {
        return SELECTS_BY.includes(v) ? v : DEFAULT_SELECTS_BY;
    }

    /** Whether an engine that selects by `selectsBy` can check a target. */
    function targetSupported(targetValue, selectsBy) {
        const id = scanTargetId(targetValue);
        // No target: the scan takes the run's level, which every engine selects by.
        if (!id) return true;
        return SELECTS_BY.indexOf(selectsByOf(selectsBy)) >= SELECTS_BY.indexOf(SCAN_TARGETS[id].needs);
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
     * Reads a profile: a scan step's own, or the run's for a step without
     * one. Anything that is not a profile id is none (checkScanSteps stops a
     * run whose step gives something else).
     *
     * @returns {{ level: 'A'|'AA'|'AAA'|null, version: string|null, profile: string|null }}
     */
    function resolveScanTarget({ profile } = {}) {
        const id = scanTargetId(profile);
        if (id) {
            const t = SCAN_TARGETS[id];
            return { level: t.level, version: t.version, profile: t.profile ? id : null };
        }
        return { level: null, version: null, profile: null };
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
        return {
            version: target.version || versionOf(version) || fromTags.version || DEFAULT_WCAG_VERSION,
            level: target.level || fromTags.level || DEFAULT_WCAG_LEVEL,
            profile: target.profile,
            bestPractices
        };
    }

    function runOnlyTags(runOnly) {
        if (!runOnly || typeof runOnly !== 'object') return [];
        const raw = runOnly.type === 'tag' ? runOnly.values : runOnly.tags;
        const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
        return list.map((t) => String(t).trim()).filter(Boolean);
    }

    /**
     * The selection of a caller that gives none, from what it gives instead:
     * WCAG tags in runOnly (`tags`, or axe-core's { type: 'tag', values }), a
     * level, a standard. Null when none of them names a version, level or
     * standard: the engine then runs as it does without a selection.
     *
     * Here `wcagLevel` is a bare level ('AA'), as the runner hands the engines
     * the level it resolved, not a step's target.
     */
    function selectionFromRunOnly({ runOnly, wcagLevel, profile } = {}) {
        const tags = runOnlyTags(runOnly);
        const level = levelOf(wcagLevel);
        if (!selectionFromTags(tags).level && !level && !profileId(profile)) return null;
        const selection = resolveScanSelection({ tags, profile: profileId(profile) });
        // A profile sets its own level; otherwise the level given beats the tags'.
        return level && !profileId(profile) ? { ...selection, level } : selection;
    }

    /**
     * runOnly's tags without those a selection stands for (version/level tags
     * and best-practice): the rule tags a caller adds on top of it.
     */
    function tagsBesideSelection(runOnly) {
        return runOnlyTags(runOnly).filter((t) => !WCAG_LEVEL_TAG.test(t) && t.toLowerCase() !== BEST_PRACTICE_TAG);
    }

    /** The tags a selection comes to, for engines that select by tags (axe-core). */
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

    /** "WCAG 2.1 AA", or the standard's name. */
    function selectionLabel(selection) {
        if (!selection) return null;
        if (selection.profile && SCAN_TARGETS[selection.profile]) return SCAN_TARGETS[selection.profile].label;
        return `WCAG ${selection.version} ${selection.level}`;
    }

    function targetLabel(profile) {
        const target = SCAN_TARGETS[profile];
        return target ? target.label : null;
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
        profileId
    };
}));
