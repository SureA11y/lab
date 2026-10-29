'use strict';

/**
 * The scan step's Engine field, filled in from the engines installed.
 *
 * The step definitions (src/workflow/action-definitions.js) cannot know which
 * engines a server has, so the server adds them when it serves the
 * definitions to the step editor: the engines as the field's options, the
 * default engine as its default, and per engine what the editor needs to show
 * a step with it, in `engineCapabilities`:
 *
 *   { [engineId]: { fields: { [fieldName]: boolean }, conformanceTargets: [id] } }
 *
 * `fields` are the engine's capabilities for the scan step (a field set to
 * false is one it does not use); `conformanceTargets` are the targets it can
 * check. An engine whose capabilities cannot be read is left out of it, and
 * the editor then shows every field and target for it.
 */

/** The engine choices and capabilities: { options, defaultEngineId, engineCapabilities }. */
function engineChoices(a11yEngine) {
    const listed = a11yEngine && typeof a11yEngine.listEngines === 'function' ? a11yEngine.listEngines() : null;
    const engines = (listed && Array.isArray(listed.engines) ? listed.engines : [])
        .filter((e) => e && e.id && e.loadable !== false);

    const engineCapabilities = {};
    for (const e of engines) {
        try {
            const caps = a11yEngine.getCapabilities(e.id);
            const fields = caps && caps.capabilities && caps.capabilities.actions && caps.capabilities.actions.a11yScan;
            engineCapabilities[e.id] = {
                fields: fields && typeof fields === 'object' ? { ...fields } : {},
                conformanceTargets: Array.isArray(caps && caps.conformanceTargets) ? caps.conformanceTargets.slice() : null
            };
        } catch {
            // Unreadable: the editor shows everything for it.
        }
    }

    return {
        options: engines.map((e) => ({ value: String(e.id), label: e.name ? String(e.name) : String(e.id) })),
        defaultEngineId: listed && listed.defaultEngineId ? String(listed.defaultEngineId) : null,
        engineCapabilities
    };
}

/**
 * The definitions with the scan step's Engine field filled in. The
 * definitions themselves are left as they are.
 */
function withEngineChoices(definitions, a11yEngine) {
    const scan = definitions && definitions.a11yScan;
    const field = scan && scan.fields && scan.fields.engine;
    if (!field) return definitions;

    const { options, defaultEngineId, engineCapabilities } = engineChoices(a11yEngine);
    if (!options.length) return definitions;

    return {
        ...definitions,
        a11yScan: {
            ...scan,
            fields: {
                ...scan.fields,
                engine: {
                    ...field,
                    options,
                    ...(defaultEngineId ? { default: defaultEngineId } : {}),
                    engineCapabilities
                }
            }
        }
    };
}

module.exports = { engineChoices, withEngineChoices };
