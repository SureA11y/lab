'use strict';

/**
 * scan-inputs.js (shared)
 *
 * The vocabulary a scan request is written in: the viewport presets. The
 * WCAG version and level come from a profile (conformance-targets.js).
 *
 * One table, because these numbers were restated in the app's helpers, in the
 * workflow engine's own preset switch, and again in the labels of the
 * setViewport dropdown.
 *
 * Browser: available as globalThis.A11Y_SCAN_INPUTS.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_INPUTS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // Declaration order is the order the pickers offer them in.
    const VIEWPORT_PRESETS = {
        'default': { width: 1280, height: 720, name: 'Default' },
        'desktop-xlg': { width: 1972, height: 1100, name: 'Desktop extra-large' },
        'desktop-lg': { width: 1440, height: 900, name: 'Desktop large' },
        'desktop-md': { width: 1280, height: 720, name: 'Desktop medium' },
        'tablet': { width: 768, height: 1024, name: 'Tablet portrait' },
        'mobile': { width: 375, height: 812, name: 'Mobile' },
    };

    const CUSTOM_VIEWPORT = 'custom';

    /** The size to hand a browser, or null for a preset that is not one. */
    function buildViewportFromPreset(value) {
        const preset = VIEWPORT_PRESETS[value];
        return preset ? { width: preset.width, height: preset.height } : null;
    }

    function viewportPresetLabel(key) {
        const preset = VIEWPORT_PRESETS[key];
        if (!preset) return null;
        return `${preset.name} (${preset.width} × ${preset.height})`;
    }

    /** Options for a viewport picker, labelled from the table above. */
    function viewportPresetOptions({ includeCustom = false } = {}) {
        const options = Object.keys(VIEWPORT_PRESETS)
            .map((value) => ({ value, label: viewportPresetLabel(value) }));

        if (includeCustom) options.push({ value: CUSTOM_VIEWPORT, label: 'Custom size…' });
        return options;
    }

    return {
        VIEWPORT_PRESETS,
        CUSTOM_VIEWPORT,
        buildViewportFromPreset,
        viewportPresetLabel,
        viewportPresetOptions,
    };
}));
