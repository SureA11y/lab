'use strict';

const devApi = globalThis.browser || globalThis.chrome;

// Set the target tab id only in this panel instance.
// Do not persist it in shared extension storage, because multiple open panels
// for different tabs would overwrite each other.
try {
    if (devApi && devApi.devtools && devApi.devtools.inspectedWindow) {
        const tabId = devApi.devtools.inspectedWindow.tabId;
        if (typeof tabId === 'number' && Number.isFinite(tabId)) {
            globalThis.__A11Y_TARGET_TAB_ID = tabId;
        }
    }
} catch {}