'use strict';

/**
 * The activity panel (docs/design/activity-panel.md): actions the user started that
 * take a while and go through steps, such as downloading a report or loading
 * a large zip, shown top right as they go. Each action is a card; each step
 * is listed as it starts, with a spinner, and a check once done. A card that
 * ends well stays a few seconds and goes; one that ends in a warning or an
 * error stays until it is closed. Scans and runs are not shown here: the
 * queue has its own panel.
 *
 * What it does for people who cannot see it:
 * - Only the start and the end of an action are announced, never its steps
 *   or percentages; an error is announced at once.
 * - It never takes focus, except to ask a question the action cannot go on
 *   without, which used to be a modal confirm.
 * - Nothing is lost when a card goes: the Activity button in the header
 *   opens the panel with all this page's actions, their steps and results.
 * - A card that would cover the control in focus shrinks to a chip.
 *
 *   const task = activity.start('Download report "Checkout"', { cancellable: true });
 *   task.step('Packing the pictures').update('120 of 340');
 *   task.done('Saved Checkout.zip');      // or task.fail(error)
 *
 * or `activity.run(title, async (task) => ...)`, which ends the task as the
 * work does.
 */

const SHOW_AFTER_MS = 400;
const KEEP_MS = 5000;
const MAX_EXPANDED = 3;
const HISTORY_MAX = 50;

const STATE_TEXT = {
    running: 'In progress',
    done: 'Done',
    warning: 'Done with warnings',
    failed: 'Failed',
    cancelled: 'Cancelled',
    waiting: 'Waiting for you',
};

const ICONS = {
    running: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="42 100"/>',
    waiting: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    done: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    warning: '<path d="M12 3.5L2.5 20h19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17v.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    failed: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    cancelled: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

/** "0.4s", "12s", "1m 05s". */
export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 10000) return `${(Math.max(ms, 100) / 1000).toFixed(1)}s`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function errorText(error) {
    if (error == null) return 'Something went wrong.';
    if (typeof error === 'string') return error;
    return String(error.message || error);
}

export function isCancelError(error) {
    return !!error && error.name === 'AbortError';
}

function cancelError() {
    const error = new Error('Cancelled.');
    error.name = 'AbortError';
    return error;
}

export function createActivityCenter({
    doc = typeof document !== 'undefined' ? document : null,
    showAfterMs = SHOW_AFTER_MS,
    keepMs = KEEP_MS,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
} = {}) {
    const tasks = []; // newest last, this page's
    let nextId = 1;
    let ui = null;
    let paused = false;
    let clock = null;
    // The panel opened from the Activity button: every task of the page, none
    // leaving, until it is closed again.
    let allOpen = false;
    const listeners = new Set();

    /* ---------- DOM ---------- */

    function el(tag, attrs = {}, children = []) {
        const node = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'className') node.className = v;
            else if (k === 'text') node.textContent = v;
            else node.setAttribute(k, v === true ? '' : String(v));
        }
        for (const c of [].concat(children)) {
            if (c == null || c === false) continue;
            node.append(typeof c === 'string' ? doc.createTextNode(c) : c);
        }
        return node;
    }

    function icon(name, className) {
        const span = el('span', { className, 'aria-hidden': 'true' });
        span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" focusable="false">${ICONS[name]}</svg>`;
        return span;
    }

    function ensureUi() {
        if (ui || !doc || !doc.body) return ui;
        const list = el('div', { className: 'activity-panel__list' });
        const chip = el('button', { type: 'button', className: 'activity-plain activity-panel__chip', hidden: true });
        // Shown with every task, as opened from the Activity button.
        const heading = el('h2', { className: 'activity-panel__title', tabindex: '-1', text: 'Activity' });
        const empty = el('p', { className: 'activity-panel__empty', text: 'Nothing yet. Downloads and the loading of reports and zips are listed here while this page is open.' });
        const header = el('div', { className: 'activity-panel__header', hidden: true }, [
            heading,
            el('p', { className: 'activity-panel__note', text: 'This page’s actions, newest first. Reloading the page clears them.' }),
            empty,
        ]);
        const panel = el('div', { id: 'activity-panel', className: 'activity-panel', role: 'region', 'aria-label': 'Activity', hidden: true }, [chip, header, list]);
        // Live regions exist before anything is said in them, or a screen
        // reader may miss the first message.
        const polite = el('div', { className: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
        const assertive = el('div', { className: 'sr-only', role: 'alert', 'aria-atomic': 'true' });
        doc.body.append(panel, polite, assertive);

        // A card does not leave while it is being read or used.
        panel.addEventListener('mouseenter', () => setPaused(true));
        panel.addEventListener('mouseleave', () => { if (!panel.contains(doc.activeElement)) setPaused(false); });
        panel.addEventListener('focusin', () => setPaused(true));
        panel.addEventListener('focusout', (event) => {
            if (!panel.contains(event.relatedTarget) && !panel.matches(':hover')) setPaused(false);
        });
        chip.addEventListener('click', () => untuck({ focus: true }));
        // WCAG 2.4.11: a control in focus under the panel is not hidden by it.
        // Not while it was opened on purpose: then focus is in it, or leaving
        // it, which closes it.
        doc.addEventListener('focusin', (event) => {
            if (panel.hidden || panel.contains(event.target) || allOpen) return;
            if (covers(panel, event.target)) tuck();
        });
        // Opened from the Activity button, it closes as a menu would: Escape,
        // back to the button, or a press anywhere else.
        panel.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !allOpen) return;
            event.preventDefault();
            closeAll({ focusButton: true });
        });
        doc.addEventListener('pointerdown', (event) => {
            if (!allOpen || panel.contains(event.target) || (headerButton && headerButton.contains(event.target))) return;
            closeAll();
        });

        ui = { panel, list, chip, header, heading, empty, polite, assertive };
        return ui;
    }

    function covers(panel, target) {
        if (!target || typeof target.getBoundingClientRect !== 'function') return false;
        const a = panel.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        if (!a.width || !b.width) return false;
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }

    function tuck() {
        if (!ui || ui.panel.classList.contains('is-tucked')) return;
        ui.panel.classList.add('is-tucked');
        renderChip();
    }

    function untuck({ focus = false } = {}) {
        if (!ui) return;
        ui.panel.classList.remove('is-tucked');
        ui.chip.hidden = true;
        if (focus) ui.list.querySelector('.activity-card__toggle')?.focus();
    }

    function renderChip() {
        const shown = tasks.filter((t) => t.card);
        const running = shown.filter((t) => t.state === 'running' || t.state === 'waiting').length;
        ui.chip.hidden = !ui.panel.classList.contains('is-tucked');
        ui.chip.textContent = running
            ? `${running} action${running === 1 ? '' : 's'} in progress`
            : `${shown.length} finished action${shown.length === 1 ? '' : 's'}`;
        ui.chip.setAttribute('aria-label', `${ui.chip.textContent}: show`);
    }

    function clockTime(ms) {
        const d = new Date(ms);
        return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    }

    // How long it took; with every task shown, when it started too, so two
    // alike can be told apart.
    function timeText(task) {
        const took = formatDuration((task.endedAt ?? now()) - task.startedAt);
        return allOpen ? `${clockTime(task.startedAt)} · ${took}` : took;
    }

    let announceSeq = 0;
    function announce(text, { urgent = false } = {}) {
        if (!ensureUi() || !text) return;
        const region = urgent ? ui.assertive : ui.polite;
        // Cleared first, so the same words said twice are said again.
        region.textContent = '';
        const seq = ++announceSeq;
        setTimer(() => { if (seq === announceSeq) region.textContent = text; }, 50);
    }

    /* ---------- Cards ---------- */

    function buildCard(task) {
        const titleId = `activity-${task.id}-title`;
        const stepsId = `activity-${task.id}-steps`;
        const toggle = el('button', {
            type: 'button', className: 'activity-plain activity-card__toggle', 'aria-expanded': 'true', 'aria-controls': stepsId,
        }, [icon(task.state, 'activity-icon activity-card__icon'), el('span', { id: titleId, className: 'activity-card__title', text: task.title })]);
        const state = el('span', { className: 'activity-card__state' });
        const time = el('span', { className: 'activity-card__time' });
        const close = el('button', { type: 'button', className: 'activity-plain activity-card__close' });
        close.append(icon('close', 'activity-icon'));
        const steps = el('ol', { id: stepsId, className: 'activity-steps' });
        const question = el('div', { className: 'activity-card__question', hidden: true });
        const result = el('p', { className: 'activity-card__result', hidden: true });
        const actions = el('div', { className: 'activity-card__actions', hidden: true });
        const body = el('div', { className: 'activity-card__body' }, [steps, question, result, actions]);
        const card = el('section', { className: 'activity-card', 'aria-labelledby': titleId, 'data-activity-id': task.id }, [
            el('div', { className: 'activity-card__head' }, [
                el('h2', { className: 'activity-card__heading' }, [toggle]),
                close,
                el('p', { className: 'activity-card__meta' }, [state, time]),
            ]),
            body,
        ]);

        toggle.addEventListener('click', () => {
            if (allOpen && isEnded(task)) {
                task.openInList = !task.openInList;
            } else {
                task.collapsed = !task.collapsed;
                task.touched = true;
            }
            renderCard(task);
        });
        close.addEventListener('click', () => {
            const next = neighbourFocus(task);
            // In the list, a finished action's ✕ takes it off the list for
            // good; elsewhere it closes the card, and the list keeps it.
            if (allOpen && isEnded(task)) forget(task);
            else removeCard(task);
            (next || ui?.heading)?.focus();
        });

        task.card = { card, toggle, state, time, close, steps, question, result, actions, body };
        renderCard(task);
        return card;
    }

    // Where focus goes when a card it is in is closed: the next card, else the
    // Activity button, which keeps what the card said.
    function neighbourFocus(task) {
        const shown = tasks.filter((t) => t.card && t !== task);
        const next = shown[0];
        return next ? next.card.toggle : (allOpen ? null : headerButton || null);
    }

    const isEnded = (task) => task.state !== 'running' && task.state !== 'waiting';

    // In the list from the Activity button, a finished action is one line
    // until it is opened: the running ones are what is worth reading there.
    const isFolded = (task) => (allOpen && isEnded(task) ? !task.openInList : !!task.collapsed);

    /** Off the list for good: its card, and the action itself. */
    function forget(task) {
        // Off the list first: the list shows a card for every task it has.
        const at = tasks.indexOf(task);
        if (at >= 0) tasks.splice(at, 1);
        removeCard(task);
        if (ui) ui.empty.hidden = tasks.length > 0;
        announce(`Removed from the list: ${task.title}`);
    }

    function stepNode(step) {
        const li = el('li', { className: `activity-step activity-step--${step.state}` }, [
            icon(step.state, 'activity-icon activity-step__icon'),
            el('span', { className: 'sr-only', text: `${STATE_TEXT[step.state]}: ` }),
            el('span', { className: 'activity-step__label', text: step.label }),
            step.detail ? el('span', { className: 'activity-step__detail', text: step.detail }) : null,
            step.endedAt != null ? el('span', { className: 'activity-step__time', text: formatDuration(step.endedAt - step.startedAt) }) : null,
        ]);
        return li;
    }

    function renderCard(task) {
        const c = task.card;
        if (!c) return;
        const folded = isFolded(task);
        c.card.className = `activity-card activity-card--${task.state}${folded ? ' is-collapsed' : ''}${task.flash ? ' is-flashing' : ''}`;
        c.toggle.setAttribute('aria-expanded', String(!folded));
        // Folded to one line, a long title is cut short: whole on hover.
        if (folded && allOpen) c.toggle.title = task.title;
        else c.toggle.removeAttribute('title');
        c.toggle.querySelector('.activity-card__icon').replaceWith(icon(task.state, 'activity-icon activity-card__icon'));
        c.state.textContent = STATE_TEXT[task.state];
        // Folded to one line in the list, its icon says the state; the word
        // stays for a screen reader.
        c.state.className = `activity-card__state${task.state === 'running' || (folded && allOpen) ? ' sr-only' : ''}`;
        c.time.textContent = timeText(task);
        const ended = isEnded(task);
        if (allOpen) {
            c.close.setAttribute('aria-label', `Remove from the list: ${task.title}`);
            c.close.title = 'Remove from the list';
        } else {
            c.close.setAttribute('aria-label', `${ended ? 'Close' : 'Hide'}: ${task.title}`);
            c.close.title = ended ? 'Close' : 'Hide (it goes on; the Activity button lists it)';
        }
        // In the list, only a finished action can be removed: a running one
        // is still going.
        c.close.hidden = allOpen && !ended;
        c.body.hidden = folded;

        c.steps.replaceChildren(...task.steps.map(stepNode));

        c.question.hidden = !task.question;
        if (task.question && !c.question.dataset.for) {
            c.question.dataset.for = String(task.question.seq);
            const buttons = task.question.choices.map((choice, i) => {
                const b = el('button', {
                    type: 'button',
                    className: i === 0 ? 'activity-card__choice' : 'activity-card__choice secondary-button',
                    text: choice.label,
                });
                b.addEventListener('click', () => answer(task, choice.value));
                return b;
            });
            c.question.replaceChildren(
                el('p', { className: 'activity-card__question-text', text: task.question.text }),
                el('div', { className: 'activity-card__choices' }, buttons),
            );
        } else if (!task.question) {
            delete c.question.dataset.for;
            c.question.replaceChildren();
        }

        c.result.hidden = !task.result;
        c.result.textContent = task.result || '';

        const buttons = [];
        if (!ended && task.cancellable && !task.question) {
            const cancel = el('button', { type: 'button', className: 'secondary-button activity-card__cancel', text: 'Cancel' });
            cancel.addEventListener('click', () => task.handle.cancel());
            buttons.push(cancel);
        }
        if (ended && task.action) {
            const action = el('button', { type: 'button', className: 'secondary-button', text: task.action.label });
            action.addEventListener('click', () => {
                try { task.action.onSelect(); } finally { removeCard(task); }
            });
            buttons.push(action);
        }
        // Rebuilt only when it changes, so a button in focus stays.
        const key = buttons.map((b) => b.textContent).join('|');
        if (c.actions.dataset.key !== key) {
            c.actions.dataset.key = key;
            c.actions.replaceChildren(...buttons);
        }
        c.actions.hidden = !buttons.length;
    }

    function showCard(task, { force = false } = {}) {
        if (task.card || (task.dismissed && !force) || !ensureUi()) return;
        ui.list.prepend(buildCard(task));
        ui.panel.hidden = false;
        // The newest few stay open; older ones fold to their title line,
        // unless the user opened one.
        const shown = tasks.filter((t) => t.card).reverse();
        shown.forEach((t, i) => {
            if (!t.touched && i >= MAX_EXPANDED && !t.collapsed && t.state !== 'waiting') {
                t.collapsed = true;
                renderCard(t);
            }
        });
        if (ui.panel.classList.contains('is-tucked')) renderChip();
        startClock();
    }

    function removeCard(task) {
        clearTimer(task.showTimer);
        clearTimer(task.leaveTimer);
        task.dismissed = true;
        if (!task.card) return;
        task.card.card.remove();
        task.card = null;
        if (ui && !tasks.some((t) => t.card)) {
            ui.panel.hidden = !allOpen;
            untuck();
        } else if (ui && ui.panel.classList.contains('is-tucked')) {
            renderChip();
        }
        changed();
    }

    function scheduleLeave(task) {
        clearTimer(task.leaveTimer);
        task.leaveTimer = null;
        if (paused || allOpen || !task.card || task.state === 'running' || task.state === 'waiting') return;
        if (task.state === 'warning' || task.state === 'failed') return; // stays until closed
        task.leaveTimer = setTimer(() => removeCard(task), keepMs);
    }

    function setPaused(value) {
        paused = value;
        for (const t of tasks) {
            if (paused) {
                clearTimer(t.leaveTimer);
                t.leaveTimer = null;
            } else {
                scheduleLeave(t);
            }
        }
    }

    function startClock() {
        if (clock != null) return;
        clock = setTimer(function tickClock() {
            const live = tasks.filter((t) => t.card && (t.state === 'running' || t.state === 'waiting'));
            for (const t of live) t.card.time.textContent = timeText(t);
            clock = live.length ? setTimer(tickClock, 1000) : null;
        }, 1000);
    }

    /* ---------- Tasks ---------- */

    function changed() {
        for (const fn of listeners) {
            try { fn(); } catch (error) { console.error(error); }
        }
    }

    function update(task) {
        renderCard(task);
        changed();
    }

    function currentStep(task) {
        const last = task.steps[task.steps.length - 1];
        return last && last.state === 'running' ? last : null;
    }

    function endStep(step, state, detail) {
        if (!step || step.state !== 'running') return;
        step.state = state;
        if (detail !== undefined) step.detail = detail;
        step.endedAt = now();
    }

    function finish(task, state, result, { action = null } = {}) {
        if (task.endedAt != null) return;
        const step = currentStep(task);
        endStep(step, state === 'failed' ? 'failed' : state === 'cancelled' ? 'cancelled' : 'done');
        if (state === 'done' && task.steps.some((s) => s.state === 'warning')) state = 'warning';
        task.state = state;
        task.result = result || null;
        task.action = action;
        task.endedAt = now();
        task.question = null;
        clearTimer(task.showTimer);

        const said = `${task.title}: ${task.result || STATE_TEXT[state]}`;
        if (task.quiet) { /* its page's status line says it */ }
        else if (state === 'failed') announce(said, { urgent: true });
        else announce(said);

        // A quick action that ended well needs no card; one with something to
        // say does.
        if (!task.card && (state === 'warning' || state === 'failed' || action)) showCard(task);
        update(task);
        scheduleLeave(task);
    }

    let questionSeq = 0;
    function answer(task, value) {
        const q = task.question;
        if (!q) return;
        task.question = null;
        task.state = 'running';
        update(task);
        q.resolve(value);
        if (q.returnFocus && typeof q.returnFocus.focus === 'function' && doc.contains(q.returnFocus)) q.returnFocus.focus();
    }

    /**
     * A new task. `quiet` for one whose page already says, in a status line
     * of its own, that it started and how it ended: the card does not say it
     * again to a screen reader. A question it asks is still said.
     */
    function start(title, { cancellable = false, quiet = false } = {}) {
        const controller = cancellable && typeof AbortController === 'function' ? new AbortController() : null;
        const task = {
            id: nextId++,
            title: String(title),
            state: 'running',
            steps: [],
            startedAt: now(),
            endedAt: null,
            result: null,
            cancellable: !!controller,
            quiet: !!quiet,
            card: null,
            collapsed: false,
        };

        const stepHandle = (step) => ({
            update(detail) {
                if (step.state !== 'running') return this;
                step.detail = detail == null ? '' : String(detail);
                update(task);
                return this;
            },
            done(detail) { endStep(step, 'done', detail); update(task); return this; },
            warn(detail) { endStep(step, 'warning', detail); update(task); return this; },
            fail(detail) { endStep(step, 'failed', detail); update(task); return this; },
        });

        const handle = {
            id: task.id,
            get title() { return task.title; },
            get state() { return task.state; },
            get ended() { return task.endedAt != null; },
            signal: controller ? controller.signal : null,
            /** A new step; one still running before it is done. */
            step(label, detail) {
                const previous = currentStep(task);
                endStep(previous, 'done');
                const step = { label: String(label), detail: detail == null ? '' : String(detail), state: 'running', startedAt: now(), endedAt: null };
                if (task.endedAt == null) task.steps.push(step);
                update(task);
                return stepHandle(step);
            },
            /**
             * Asks something the action needs to go on: the card shows at once
             * with `choices` ({ label, value }, the first the main one) and the
             * first takes focus, as a confirm would. Resolves with the value
             * chosen; cancelling the task resolves with null.
             */
            ask(text, choices) {
                if (task.endedAt != null) return Promise.resolve(null);
                return new Promise((resolve) => {
                    task.question = {
                        seq: ++questionSeq,
                        text: String(text),
                        choices,
                        resolve,
                        returnFocus: doc ? doc.activeElement : null,
                    };
                    task.state = 'waiting';
                    clearTimer(task.showTimer);
                    if (!task.card) showCard(task);
                    task.collapsed = false;
                    untuck();
                    update(task);
                    announce(`${task.title}: ${text}`, { urgent: true });
                    task.card?.question.querySelector('button')?.focus();
                });
            },
            throwIfCancelled() {
                if (controller && controller.signal.aborted) throw cancelError();
            },
            cancel() {
                if (task.endedAt != null) return;
                if (controller) controller.abort();
                if (task.question) {
                    const q = task.question;
                    task.question = null;
                    q.resolve(null);
                }
                finish(task, 'cancelled', 'Cancelled.');
            },
            done(result, opts) { finish(task, 'done', result, opts); },
            warn(result, opts) { finish(task, 'warning', result, opts); },
            fail(error) { finish(task, 'failed', errorText(error)); },
            /** Shows the card again, as a second press of what started it does. */
            reveal() {
                task.dismissed = false;
                if (!task.card) showCard(task);
                untuck();
                task.collapsed = false;
                task.flash = true;
                update(task);
                setTimer(() => { task.flash = false; renderCard(task); }, 1200);
                announce(`${task.title}: ${task.endedAt != null ? (task.result || STATE_TEXT[task.state]) : 'still in progress'}.`);
            },
        };
        task.handle = handle;

        tasks.push(task);
        if (tasks.length > HISTORY_MAX) {
            const old = tasks.findIndex((t) => t.endedAt != null && !t.card);
            if (old >= 0) tasks.splice(old, 1);
        }
        // A quick action never flashes a card: it shows once it has taken a moment.
        task.showTimer = setTimer(() => {
            if (task.endedAt != null) return;
            showCard(task);
            if (!task.quiet) announce(`${task.title}: started.`);
        }, showAfterMs);
        changed();
        return handle;
    }

    /**
     * Runs `work(task)` as a task titled `title`: it ends as the work does, if
     * the work has not ended it, done with `result` (a string, or a function
     * of what the work returned), failed with what it threw, or cancelled.
     * Returns what the work returned; rethrows unless `rethrow` is false.
     */
    async function run(title, work, { cancellable = false, quiet = false, result = null, rethrow = true } = {}) {
        const task = start(title, { cancellable, quiet });
        try {
            const value = await work(task);
            if (!task.ended) task.done(typeof result === 'function' ? result(value) : result);
            return value;
        } catch (error) {
            if (isCancelError(error)) {
                task.cancel();
                return undefined;
            }
            if (!task.ended) task.fail(error);
            if (rethrow) throw error;
            return undefined;
        }
    }

    /* ---------- The Activity button and its list ---------- */

    let headerButton = null;

    /** Opens the panel with every task of this page, newest first, focus on its title. */
    function openAll() {
        if (!ensureUi() || allOpen) return;
        allOpen = true;
        for (const t of tasks) {
            t.openInList = false;
            if (!t.card) {
                t.viaAll = true;
                showCard(t, { force: true });
            }
        }
        // Newest first, whatever order they came in.
        ui.list.append(...tasks.slice().reverse().filter((t) => t.card).map((t) => t.card.card));
        for (const t of tasks) {
            clearTimer(t.leaveTimer);
            t.leaveTimer = null;
            renderCard(t);
        }
        untuck();
        ui.header.hidden = false;
        ui.empty.hidden = tasks.length > 0;
        ui.panel.classList.add('is-all');
        ui.panel.hidden = false;
        renderHeaderButton();
        ui.heading.focus();
    }

    /** Back to the cards that would be showing anyway. */
    function closeAll({ focusButton = false } = {}) {
        if (!allOpen) return;
        allOpen = false;
        for (const t of tasks) {
            if (!t.viaAll) continue;
            t.viaAll = false;
            // Hidden or gone before: so again. One not yet shown stays.
            if (t.dismissed || t.endedAt != null) removeCard(t);
        }
        ui.header.hidden = true;
        ui.panel.classList.remove('is-all');
        ui.panel.hidden = !tasks.some((t) => t.card);
        for (const t of tasks) {
            renderCard(t);
            scheduleLeave(t);
        }
        renderHeaderButton();
        if (focusButton) headerButton?.focus();
    }

    function toggleAll() {
        if (allOpen) closeAll({ focusButton: true });
        else openAll();
    }

    function renderHeaderButton() {
        if (!headerButton) return;
        const running = tasks.filter((t) => t.state === 'running' || t.state === 'waiting').length;
        headerButton.classList.toggle('is-running', running > 0);
        const count = headerButton.querySelector('.activity-button__count');
        count.textContent = running ? String(running) : '';
        count.hidden = !running;
        headerButton.setAttribute('aria-label', running ? `Activity, ${running} in progress` : 'Activity');
        headerButton.setAttribute('aria-expanded', String(allOpen));
    }

    /** Puts the Activity button in `container`. */
    function installButton(container) {
        if (!doc || !container || headerButton) return headerButton;
        headerButton = el('button', {
            type: 'button',
            className: 'activity-plain activity-button',
            title: 'Activity: downloads and loading on this page',
            'aria-controls': 'activity-panel',
            'aria-expanded': 'false',
        }, [
            el('span', { className: 'activity-button__icon', 'aria-hidden': 'true' }),
            el('span', { className: 'activity-button__count', hidden: true }),
        ]);
        headerButton.querySelector('.activity-button__icon').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" focusable="false"><path d="M4 6h16M4 12h10M4 18h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16.5 15.5l2 2 3.5-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        headerButton.addEventListener('click', toggleAll);
        container.append(headerButton);
        renderHeaderButton();
        return headerButton;
    }

    listeners.add(renderHeaderButton);
    // A task that starts while every task is shown joins them at once.
    listeners.add(() => {
        if (!allOpen) return;
        for (const t of tasks) {
            if (!t.card) {
                t.viaAll = true;
                showCard(t, { force: true });
            }
        }
        ui.empty.hidden = tasks.length > 0;
    });

    return {
        start,
        run,
        installButton,
        openAll,
        closeAll,
        /** This page's tasks, oldest first: { id, title, state, steps, result }. */
        list: () => tasks.map((t) => ({
            id: t.id, title: t.title, state: t.state, result: t.result,
            steps: t.steps.map((s) => ({ label: s.label, detail: s.detail, state: s.state })),
            shown: !!t.card,
        })),
        get panel() { return ensureUi() ? ui.panel : null; },
    };
}

let shared = null;

/** The page's activity panel. */
export function getActivity() {
    if (!shared) shared = createActivityCenter();
    return shared;
}
