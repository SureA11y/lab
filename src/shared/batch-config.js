'use strict';

/**
 * batch-config.js (shared)
 *
 * A queue batch's configuration, as "Save configuration" writes one: the
 * workflow and the Batch section with every row, so loading it in the run
 * workflow tab sets up the batch again (docs/design/workflow-queue-batch-design.md
 * §6). A batch queued from the app saves it beside its results as
 * "<name>.a11y-config.json"; one saved before that has only batch.json, which
 * keeps each run's configuration and row, and this rebuilds it from them.
 *
 * Masked values stay out: each run's configuration was saved without them.
 *
 * Browser: globalThis.A11Y_BATCH_CONFIG.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_BATCH_CONFIG = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const CONFIG_TYPE = 'a11y-ui-src-config';
    const CONFIG_SUFFIX = '.a11y-config.json';

    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    /** True for a configuration's file name, which a zip of reports leaves out of its reports. */
    function isConfigFileName(name) {
        return typeof name === 'string' && name.toLowerCase().endsWith(CONFIG_SUFFIX);
    }

    function isConfig(value) {
        return isPlainObject(value) && value.type === CONFIG_TYPE;
    }

    /**
     * The configuration a batch.json describes: its first run's, with every
     * run's row in the Batch section. Null when no run kept its configuration.
     */
    function configForBatch(manifest) {
        const items = isPlainObject(manifest) && Array.isArray(manifest.items) ? manifest.items : [];
        const first = items.find((i) => i && isConfig(i.config));
        if (!first) return null;

        const config = JSON.parse(JSON.stringify(first.config));
        const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : null;
        // The rows carry each run's name, url and variables; the workflow's
        // own name is the batch's.
        if (isPlainObject(config.state) && name) config.state['scenario-name'] = name;
        if (isPlainObject(config.runSpec)) {
            delete config.runSpec.vars;
            if (name) config.runSpec.scenarioName = name;
        }
        config.batch = {
            rows: items.filter(Boolean).map((i) => ({
                ...(typeof i.name === 'string' && i.name ? { name: i.name } : {}),
                ...(typeof i.url === 'string' && i.url ? { url: i.url } : {}),
                ...(isPlainObject(i.vars) && Object.keys(i.vars).length ? { vars: i.vars } : {}),
            })),
            enabled: true,
        };
        config.metadata = { ...(isPlainObject(config.metadata) ? config.metadata : {}), rebuiltFrom: 'batch.json' };
        return config;
    }

    return { CONFIG_TYPE, CONFIG_SUFFIX, isConfigFileName, isConfig, configForBatch };
}));
