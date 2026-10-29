'use strict';

(function (root) {
    const DEFAULT_ENGINE_ID = '@surea11y';

    function getRegistry() {
        const map = Object.create(null);
        if (root.A11Y_EXTENSION_A11Y_LABS_ENGINE && root.A11Y_EXTENSION_A11Y_LABS_ENGINE.engineId) {
            map[root.A11Y_EXTENSION_A11Y_LABS_ENGINE.engineId] = root.A11Y_EXTENSION_A11Y_LABS_ENGINE;
        }
        return map;
    }

    function resolveEngine(engineId) {
        const registry = getRegistry();
        const id = String(engineId || DEFAULT_ENGINE_ID).trim() || DEFAULT_ENGINE_ID;
        const engine = registry[id];
        if (!engine) throw new Error(`Unsupported extension engine: ${id}`);
        return engine;
    }

    root.A11Y_EXTENSION_UI_ENGINE = {
        getDefaultEngineId() {
            return DEFAULT_ENGINE_ID;
        },
        listEngines() {
            return Object.keys(getRegistry()).map((id) => {
                const engine = getRegistry()[id];
                return {
                    id,
                    name: engine.engineName || id,
                    version: engine.engineVersion || null
                };
            });
        },
        resolveEngine
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
