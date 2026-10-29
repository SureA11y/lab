'use strict';

/**
 * The name the report export dialog starts with.
 *
 * The scenario name is what the user already calls this run, so it is what the
 * dialog offers - but only until they type over it. A name they confirmed has
 * to survive the next export, otherwise every export would undo their edit.
 *
 * What breaks the tie is whether the scenario name is one this dialog has
 * offered before: renaming the scenario means the report is about something
 * else now, so the new name takes the field back.
 *
 * @param {Object} input
 * @param {string} [input.storedName] - Name currently on the report payload,
 *   i.e. the last one the user confirmed in this dialog.
 * @param {string} [input.scenarioName] - Scenario name as it stands now.
 * @param {?string} [input.lastPromptedScenario] - Scenario name this dialog was
 *   last seeded with; null when it has never been offered here.
 * @returns {string}
 */
export function pickReportNamePrefill({
    storedName = '',
    scenarioName = '',
    lastPromptedScenario = null
} = {}) {
    const stored = trimmed(storedName);
    const scenario = trimmed(scenarioName);

    if (scenario && scenario !== lastPromptedScenario) return scenario;

    return stored || scenario;
}

function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
