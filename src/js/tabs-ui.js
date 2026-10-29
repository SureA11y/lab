'use strict';

// Top-level mode switch across the run / report / compare / queue tabs. Generic over
// the tab set so adding a mode is data, not new branching.
export function setupModeSwitch(options = {}) {
    const defs = [
        { mode: 'run', tab: document.getElementById('mode-run'), pane: document.getElementById('pane-run') },
        { mode: 'report', tab: document.getElementById('mode-open'), pane: document.getElementById('pane-open') },
        { mode: 'compare', tab: document.getElementById('mode-compare'), pane: document.getElementById('pane-compare') },
        { mode: 'queue', tab: document.getElementById('mode-queue'), pane: document.getElementById('pane-queue') },
    ].filter((d) => d.tab && d.pane);

    // The run and report tabs are required; compare and queue are optional.
    if (defs.length < 2) return;

    const tabs = defs.map((d) => d.tab);
    const validModes = defs.map((d) => d.mode);
    const initialMode = validModes.includes(options.initialMode) ? options.initialMode : 'run';

    function clearInitialModeAttr() {
        document.documentElement.removeAttribute('data-initial-mode');
    }

    // `fromClick` tells the listeners the user pressed the tab: a results area
    // that has to be drawn again can then wait a frame, so the tab is seen to
    // change first. Calls from code keep drawing at once, as they expect.
    function setActive(which, dispatch = true, moveFocus = true, { fromClick = false } = {}) {
        const target = validModes.includes(which) ? which : 'run';
        clearInitialModeAttr();

        // The tab and its pane change before the listeners run: drawing a
        // large report takes seconds, and until then the old tab stayed
        // selected as if the click had done nothing.
        for (const d of defs) {
            const isActive = d.mode === target;
            d.tab.setAttribute('aria-selected', String(isActive));
            d.tab.tabIndex = isActive ? 0 : -1;
            d.pane.hidden = !isActive;
        }

        if (moveFocus) {
            const active = defs.find((d) => d.mode === target);
            if (active) active.tab.focus();
        }

        if (dispatch) {
            document.dispatchEvent(new CustomEvent('a11ylab:modechange', { detail: { mode: target, fromClick } }));
        }
    }

    function onTabKeydown(e) {
        const key = e.key;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
        e.preventDefault();

        const currentIndex = tabs.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        let nextIndex = currentIndex;
        if (key === 'ArrowLeft') nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
        if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
        if (key === 'Home') nextIndex = 0;
        if (key === 'End') nextIndex = tabs.length - 1;

        tabs[nextIndex].focus();
    }

    for (const d of defs) {
        d.tab.addEventListener('click', () => setActive(d.mode, true, true, { fromClick: true }));
        d.tab.addEventListener('keydown', onTabKeydown);
    }

    setActive(initialMode, false, false);

    return { setActive };
}
