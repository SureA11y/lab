// The live view of a run as it goes: its progress, its log lines and the
// live preview's cards. Moved out of a11y-ui.js; what it shares with the rest
// of the app it reaches through `app`.

import {escapeAttr, escapeHtml, parseForEachIteration, parseRepeatIteration} from './a11y-ui.utils.js';
import {enhanceAsLiveCarousel} from './carousel-ui.js';
import {createStreamCardAdder} from './stream-ui.js';
import {createProgressProcessor} from './progress-processor.js';
import {createLiveTotals} from './live-totals.js';
import {collectVarsDeep, deriveScreenshotCaption as deriveLiveScreenshotCaption, findUnresolvedVars, resolveLabelTemplate as resolveLiveLabel} from './live-view.js';
import {resolveStepRefForLogEntry} from './action-tree.js';

/**
 * app: accessors for what the rest of the app shares with this part
 * ($, $$, appendLog, customStepsInput, groupingUi, liveStreamDialog, liveStreamEl, scansDialog, screenshotsDialog, useLiveStream).
 */
export function createLiveUi(app) {
    /** Reset live stream section and variable state */
    function resetLivePanels() {
        if (app.liveStreamEl) app.liveStreamEl.style.display = 'none';
        const grid = app.$('#live-stream-grid');
        if (grid) grid.innerHTML = '';
        app.groupingUi.liveVarState.index = undefined;
        app.groupingUi.liveVarState.oneBased = undefined;
        app.groupingUi.liveVarState.total = undefined;
        app.groupingUi.liveVarState.vars = Object.create(null);

        carousel?.clear?.();
        liveTotals?.reset?.();
        app.groupingUi.liveStepState.counter = null;
    }

    /**
     * Start counting steps for the run about to go out.
     *
     * The plan is built from the same actions and custom steps the payload
     * carries, so what the panel counts down is exactly what the server was
     * asked to run. The shared module arrives as a global (see the script tags
     * in index.html); if it is missing the run proceeds without a step counter
     * rather than failing.
     */
    function startStepCounter(actions, customSteps) {
        const api = globalThis.A11Y_WORKFLOW_STEP_COUNTER;
        if (!api || typeof api.createStepCounter !== 'function') {
            app.groupingUi.liveStepState.counter = null;
            return;
        }

        try {
            app.groupingUi.liveStepState.counter = api.createStepCounter({actions, customSteps});
            liveTotals.setSteps(app.groupingUi.liveStepState.counter.snapshot());
        } catch {
            // A workflow the planner cannot walk still deserves to run.
            app.groupingUi.liveStepState.counter = null;
        }
    }

    // The label helpers are shared with the watch dialog's live view
    // (src/js/live-view.js); the run tab's resolve against its own vars.
    const resolveLabelTemplate = (raw, localVars) => resolveLiveLabel(raw, localVars, app.groupingUi.liveVarState);
    const deriveScreenshotCaption = (extra) => deriveLiveScreenshotCaption(extra, app.groupingUi.liveVarState);

    const carouselContainer = app.$('#live-stream-grid');
    const carousel = carouselContainer && enhanceAsLiveCarousel(carouselContainer, {
        title: "Live preview",
        visibleCount: 4,
        announceNewItems: false
    });

    const addStreamCard = createStreamCardAdder({
        getUseLiveStream: () => app.useLiveStream,
        getGrid: () => document.getElementById('live-stream-grid'),
        getStream: () => document.getElementById('live-stream'),
        carousel,
        dialogs: {liveStreamDialog: app.liveStreamDialog, scansDialog: app.scansDialog, screenshotsDialog: app.screenshotsDialog},
        escapeHtml,
        escapeAttr,
        resolveLabelTemplate,
        findUnresolvedVars,
        isDebug: () => !!window.__A11YLAB_DEBUG
    });

    // Floating, non-dismissable "scan totals" counter shown while a run streams
    // scans into the live preview. It accumulates fail / can't tell / pass and
    // total DOM elements across scans, and is removed when the run finishes.
    const liveTotals = createLiveTotals({getMount: () => document.body});

    // when iteration vars change, re-resolve pending live titles and captions
    function tryUpdateLiveScanTitles() {
        const cards = app.$$('#live-stream-grid .stream-card[data-kind="scan"] h3');
        cards.forEach((h3) => {
            const raw = h3.dataset.rawLabel || '';
            if (raw && raw.includes('{var:')) {
                const resolved = resolveLabelTemplate(raw) || 'a11y scan';
                const desired = 'Scan: ' + resolved;
                if (desired !== h3.textContent) h3.textContent = desired;
            }
        });
    }

    function tryUpdateLiveScreenshotCaptions() {
        const caps = app.$$('#live-stream-grid .stream-card[data-kind="screenshot"] .stream-caption');
        caps.forEach((el) => {
            const raw = el.dataset.rawCaption || '';
            if (!raw || !raw.includes('{var:')) return;

            let localVars = {};
            try {
                localVars = JSON.parse(el.dataset.localVars || '{}');
            } catch {
            }

            const resolved = resolveLabelTemplate(raw, localVars) || 'Screenshot';
            const desired = 'Screenshot' + (resolved !== 'Screenshot' ? ': ' + resolved : '');
            if (desired !== el.textContent) {
                el.textContent = desired;
                const img = el.nextElementSibling?.querySelector('img') || el.previousElementSibling?.querySelector('img');
                if (img) img.alt = resolved;
            }

            if (window.__A11YLAB_DEBUG) {
                const unresolved = findUnresolvedVars(resolveLabelTemplate(raw, localVars));
                const card = el.closest('.stream-card');
                if (card) {
                    const dbg = card.querySelector('.stream-caption-debug');
                    if (unresolved.length) {
                        const box = dbg || document.createElement('div');
                        box.className = 'stream-caption-debug';
                        box.textContent = `Unresolved vars: ${unresolved.join(', ')}`;
                        box.style.fontSize = '12px';
                        box.style.opacity = '0.7';
                        box.style.marginTop = '4px';
                        if (!dbg) card.appendChild(box);
                    } else if (dbg) {
                        dbg.remove();
                    }
                }
            }
        });
    }

    /** Apply iteration vars from a parsed iteration object */
    function applyIterationVars(m) {
        if (!m) return;
        const {oneBased, total} = m;

        app.groupingUi.liveVarState.oneBased = Number.isFinite(oneBased) ? oneBased : undefined;
        app.groupingUi.liveVarState.index = Number.isFinite(oneBased) ? oneBased - 1 : undefined;

        // allow "unknown total" represented as null
        if (total === null) {
            app.groupingUi.liveVarState.total = undefined;
        } else {
            app.groupingUi.liveVarState.total = Number.isFinite(total) ? total : undefined;
        }

        tryUpdateLiveScanTitles();
        tryUpdateLiveScreenshotCaptions();
    }

    /** Handle a single progress log entry (exact same behavior, just extracted) */
    const progressProcessor = createProgressProcessor({
        liveVarState: app.groupingUi.liveVarState,
        liveStepState: app.groupingUi.liveStepState,
        appendLog: app.appendLog,
        resolveStepRefForLogEntry,
        parseForEachIteration,
        parseRepeatIteration,
        tryUpdateLiveScanTitles,
        tryUpdateLiveScreenshotCaptions,
        collectVarsDeep,
        deriveScreenshotCaption,
        addStreamCard,
        addScanTotals: (payload) => liveTotals.add(payload),
        mergeScanTotals: (payload) => liveTotals.merge(payload),
        setStepTotals: (snapshot) => liveTotals.setSteps(snapshot),
        getUseLiveStream: () => app.useLiveStream
    });

    const THEME_KEY = 'a11y-lab-theme';

    // Colour-theme toggle. A single icon button in the header that cycles
    // Auto → Light → Dark, persisting the choice to localStorage and reflecting
    // it on <html data-theme>. Same control the report and extension use; the
    // CSS drives dark styling from :root[data-theme="dark"] and, in Auto mode,
    // from the OS via prefers-color-scheme. The no-FOUC head script in
    // index.html applies the saved choice before first paint.
    const THEME_ORDER = ['auto', 'light', 'dark'];
    const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

    function applyTheme(theme, btn) {
        const root = document.documentElement;

        if (theme === 'auto') {
            delete root.dataset.theme;
        } else {
            root.dataset.theme = theme;
        }

        if (btn) {
            btn.setAttribute('data-choice', theme);
            const label = 'Color theme: ' + THEME_LABELS[theme];
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    }

    function initTheme() {
        const stored = localStorage.getItem(THEME_KEY);
        // Default to Light on a fresh view (nothing stored); an explicit
        // Auto/Light/Dark choice the user made previously always wins.
        let current = (stored === 'auto' || stored === 'light' || stored === 'dark') ? stored : 'light';

        const btn = document.querySelector('[data-theme-toggle]');
        applyTheme(current, btn);

        btn?.addEventListener('click', () => {
            current = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
            try {
                localStorage.setItem(THEME_KEY, current);
            } catch (e) {
                /* ignore — the choice still applies for this view */
            }
            applyTheme(current, btn);
        });

        document.documentElement.classList.remove('no-theme-transition');
    }

    function clearCustomStepsOnFreshBoot() {
        if (!app.customStepsInput) return;
        app.customStepsInput.value = '';
    }

    return {
        clearCustomStepsOnFreshBoot,
        initTheme,
        get liveTotals() { return liveTotals; },
        get progressProcessor() { return progressProcessor; },
        resetLivePanels,
        get resolveLabelTemplate() { return resolveLabelTemplate; },
        startStepCounter,
    };
}
