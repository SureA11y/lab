'use strict';

/**
 * Colour-theme toggle for the extension pages (popup + devtools panel).
 *
 * A single icon button in the header cycles Auto → Light → Dark, persisting the
 * choice to localStorage and reflecting it on <html data-theme>. The CSS in
 * ui.css drives dark styling from :root[data-theme="dark"] and, in Auto mode
 * (no data-theme), from the OS via prefers-color-scheme — the same control the
 * app and the exported report use.
 *
 * Loaded from <head> so the saved choice is applied to <html> synchronously,
 * before the body paints — no inline script needed, which matters because the
 * Chrome MV3 build's default CSP (script-src 'self') blocks inline scripts. The
 * button wiring waits for the DOM; the theme itself is applied immediately.
 */
(function () {
    const STORAGE_KEY = 'surea11y-ext-theme';
    const ORDER = ['auto', 'light', 'dark'];
    const LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

    const root = document.documentElement;

    function readChoice() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            return (v === 'light' || v === 'dark') ? v : 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    function applyRoot(choice) {
        if (choice === 'light' || choice === 'dark') {
            root.setAttribute('data-theme', choice);
        } else {
            root.removeAttribute('data-theme');
        }
    }

    function reflectButton(choice, btn) {
        if (!btn) return;
        btn.setAttribute('data-choice', choice);
        const label = 'Colour theme: ' + LABELS[choice];
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }

    // --- Pre-paint: suppress transitions and apply the saved theme now, while
    // <html> exists but before the body renders, so there's no theme flash. ---
    let current = readChoice();
    root.classList.add('no-theme-transition');
    applyRoot(current);

    function wire() {
        const btn = document.querySelector('[data-theme-toggle]');
        reflectButton(current, btn);

        // The saved choice is applied; re-enable transitions for interaction.
        requestAnimationFrame(() => root.classList.remove('no-theme-transition'));

        if (!btn) return;

        btn.addEventListener('click', () => {
            current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
            try {
                localStorage.setItem(STORAGE_KEY, current);
            } catch (e) {
                /* ignore — the choice still applies for this view */
            }
            applyRoot(current);
            reflectButton(current, btn);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire();
    }
})();
