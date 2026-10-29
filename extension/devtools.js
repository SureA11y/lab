'use strict';

const api = globalThis.browser || globalThis.chrome;

try {
    api.devtools.panels.create(
        'surea11y',
        '',
        'panel.html'
    );
} catch {
    // Runs only inside DevTools.
}
