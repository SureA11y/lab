'use strict';

// "View details" dialogs whose body is drawn when first opened. A large
// report's issue tables held every occurrence of every finding in hidden
// dialogs: most of the page, hundreds of thousands of elements, drawn on every
// render and almost never opened. The table keeps the dialog's shell; its body
// holds a key to the function that draws it. The HTML export, a static
// document, fills them all in its copy (fillLazyDialogs).

// Each body's drawing function, with the results area it belongs to: the run
// and report tabs each keep theirs (setLazyScope), so a tab's results set
// aside while the other is shown can still open their dialogs.
const builders = new Map();
let nextId = 0;
let currentScope = null;

// Above this many occurrences a body takes long enough to draw that the
// dialog opens on a skeleton first, so the click is seen at once.
export const SKELETON_FROM = 150;

/** Bodies registered from now on belong to `scope` (a results tab). */
export function setLazyScope(scope) {
    currentScope = scope;
}

/** Keeps `build` (returns the body's HTML) and returns the key the body carries. */
export function registerLazyBody(build) {
    nextId += 1;
    const id = 'lz' + nextId;
    builders.set(id, {build, scope: currentScope});
    return id;
}

/**
 * Forgets the bodies not drawn yet of `scope`, or of every scope: called
 * before a results tab is drawn again.
 */
export function clearLazyBodies(scope) {
    if (scope === undefined) {
        builders.clear();
        return;
    }
    for (const [id, entry] of builders) {
        if (entry.scope === scope) builders.delete(id);
    }
}

function lazyBodyOf(dialog) {
    return dialog ? dialog.querySelector('[data-lazy-body]') : null;
}

/** Draws a dialog's body if it is still waiting. Returns whether it drew. */
export function fillLazyDialog(dialog) {
    const body = lazyBodyOf(dialog);
    if (!body) return false;
    const id = body.getAttribute('data-lazy-body');
    const build = builders.get(id)?.build;
    body.removeAttribute('data-lazy-body');
    body.removeAttribute('data-lazy-count');
    body.removeAttribute('aria-busy');
    if (!build) {
        body.textContent = 'These details are no longer available. Load the report again to see them.';
        return true;
    }
    body.innerHTML = build();
    builders.delete(id);
    return true;
}

/** Draws every waiting body under `root`, a copy of the page included. */
export function fillLazyDialogs(root) {
    if (!root) return;
    root.querySelectorAll('dialog').forEach((dialog) => {
        const body = lazyBodyOf(dialog);
        if (!body) return;
        const build = builders.get(body.getAttribute('data-lazy-body'))?.build;
        body.removeAttribute('data-lazy-body');
        body.removeAttribute('data-lazy-count');
        // Not deleted: the live page's dialog still needs it.
        if (build) body.innerHTML = build();
    });
}

/**
 * `html` (a copy of the page, as text) with every waiting body drawn into
 * it, each through `transform`. Quicker for an export than filling a copy's
 * dialogs (fillLazyDialogs), which are then turned back into text anyway.
 */
export function fillLazyBodiesInHtml(html, transform = (body) => body) {
    return String(html).replace(
        /(<div class="src-dialog-body") data-lazy-body="(lz\d+)" data-lazy-count="\d+"><\/div>/g,
        (match, open, id) => {
            const build = builders.get(id)?.build;
            return build ? open + '>' + transform(build()) + '</div>' : match;
        }
    );
}

function skeletonHtml(count) {
    const what = count === 1 ? '1 occurrence' : `${count.toLocaleString('en')} occurrences`;
    const bar = '<span class="lazy-skeleton-bar"></span>';
    return '<p class="lazy-dialog-loading status busy">Loading ' + what + '…</p>' +
        '<div class="lazy-skeleton" aria-hidden="true">' +
        ('<div class="lazy-skeleton-item">' + bar + bar + bar + '</div>').repeat(4) +
        '</div>';
}

/**
 * Opens a dialog, drawing its body first if it is still waiting. A long one
 * opens on a skeleton and is drawn after a paint (`afterPaint`), so the
 * dialog appears at once. Resolves once the body is drawn.
 */
export async function openLazyDialog(dialog, {afterPaint} = {}) {
    if (!dialog || typeof dialog.showModal !== 'function') return;
    const body = lazyBodyOf(dialog);
    const count = body ? Number(body.getAttribute('data-lazy-count')) || 0 : 0;

    if (!body || count < SKELETON_FROM || typeof afterPaint !== 'function') {
        fillLazyDialog(dialog);
        if (!dialog.open) dialog.showModal();
        return;
    }

    body.setAttribute('aria-busy', 'true');
    body.innerHTML = skeletonHtml(count);
    if (!dialog.open) dialog.showModal();
    await afterPaint();
    fillLazyDialog(dialog);
}
