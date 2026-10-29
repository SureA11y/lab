'use strict';

async function loadSharedUi(defaultOutText) {
    const root = document.getElementById('root');
    if (!root) return;

    const ext = globalThis.browser || globalThis.chrome;
    const res = await fetch(ext.runtime.getURL('ui.html'));
    const html = await res.text();
    root.innerHTML = html;

    const out = document.getElementById('out');
    if (out && typeof defaultOutText === 'string') out.textContent = defaultOutText;
}

globalThis.__loadSharedUi = loadSharedUi;