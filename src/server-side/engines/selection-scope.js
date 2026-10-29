'use strict';

/**
 * What a scan's selection comes to in engines that select by level only.
 *
 * surea11y and axe-core select a WCAG version and level. Alfa, Pa11y and
 * QualWeb take the level alone and run their checks up to it for every WCAG
 * version they cover, so for a selection of an earlier version (WCAG 2.1 AA,
 * as a saved step may still ask) their findings answer a wider question than the scan's, which
 * the report should say beside them. WCAG 2.2 is what level-only selection
 * comes closest to, so it gets no note.
 */

const { DEFAULT_WCAG_VERSION, selectionLabel, selectionFromRunOnly } = require('../conformance-targets');

const LEVEL_ONLY_ENGINES = new Set(['alfa', 'pa11y', 'pa11y-htmlcs', 'qualweb', 'qualweb-act', 'qualweb-wcag']);

const UP_TO = { A: 'Level A', AA: 'Level A and AA', AAA: 'Level A, AA and AAA' };

// "WCAG 2.1 AA", or "EN 301 549 V3.2.1 (WCAG 2.1 AA)".
function asked(selection) {
    const wcag = `WCAG ${selection.version} ${selection.level}`;
    return selection.profile ? `${selectionLabel(selection)} (${wcag})` : wcag;
}

/**
 * The notice for an engine that selects by level only, when the scan's
 * selection is of an earlier WCAG version than 2.2; null otherwise.
 * -> { engineId, code: 'level-only-selection', message } | null
 */
function levelOnlySelectionNotice({ engineId, engineName, selection } = {}) {
    if (!LEVEL_ONLY_ENGINES.has(String(engineId))) return null;
    if (!selection || !selection.version || selection.version === DEFAULT_WCAG_VERSION) return null;
    return {
        engineId: String(engineId),
        code: 'level-only-selection',
        message: `${engineName || engineId} selects by WCAG level only, so it ran its ${UP_TO[selection.level] || 'Level A and AA'} `
            + `checks for every WCAG version it covers, not only ${asked(selection)} `
            + 'as this scan asked. Some of its findings can be outside that selection.'
    };
}

/**
 * What an engine that selects by level only takes from a scan: its level and
 * whether best-practices run. A caller with no selection may give WCAG tags
 * and a level instead; with neither, the level is null (the engine's default).
 * -> { level: 'A'|'AA'|'AAA'|null, bestPractices: boolean }
 */
function levelOnlySelection({ selection, runOnly, wcagLevel, engineOptions } = {}) {
    const sel = selection !== undefined
        ? selection
        : selectionFromRunOnly({ runOnly, wcagLevel, profile: engineOptions && engineOptions.profile });
    return { level: (sel && sel.level) || null, bestPractices: !!(sel && sel.bestPractices) };
}

module.exports = { LEVEL_ONLY_ENGINES, levelOnlySelectionNotice, levelOnlySelection };
