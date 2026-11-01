// Focus helpers: whether an element can take focus, the first one in a
// container that can, moving focus without scrolling the page about, and
// whether a key press belongs to a text field rather than to the app.

// -------------------- Staging focus preservation --------------------

export function isActuallyFocusable(el) {
    if (!el) return false;
    if (!(el instanceof Element)) return false;
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    return typeof el.focus === 'function';
}

export function focusSafely(el) {
    if (!el) return false;

    // If the element is not natively focusable, add temporary tabindex.
    const needsTabindex =
        !(el instanceof HTMLButtonElement) &&
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLSelectElement) &&
        !(el instanceof HTMLTextAreaElement) &&
        !el.hasAttribute('tabindex');

    if (needsTabindex) el.setAttribute('tabindex', '-1');

    try {
        el.focus({preventScroll: true});
    } catch {
        try { el.focus(); } catch { /* ignore */ }
    }

    if (needsTabindex) {
        setTimeout(() => {
            try { el.removeAttribute('tabindex'); } catch { /* ignore */ }
        }, 0);
    }
    return true;
}

/* ==================== Focus helpers ==================== */

export function isFocusable(el) {
    if (!(el instanceof Element)) return false;
    if ('disabled' in el && el.disabled) return false;

    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (el.closest('[hidden]')) return false;

    const focusableTags = ['A', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'];
    if (focusableTags.includes(el.tagName)) {
        if (el.tagName === 'A' && !el.hasAttribute('href') && !el.hasAttribute('tabindex')) return false;
        return true;
    }
    if (el.hasAttribute('contenteditable')) return true;

    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && !isNaN(tabindex)) return parseInt(tabindex, 10) >= 0;

    return false;
}

export function getFirstFocusable(el) {
    if (!(el instanceof Element)) return null;
    const focusableSelector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable]'
    ].join(',');
    const candidates = el.querySelectorAll(focusableSelector);
    for (const c of candidates) if (isFocusable(c)) return c;
    return null;
}

export function isEditableElement(el) {
    if (!(el instanceof Element)) return false;

    // contenteditable (or inside)
    if (el.isContentEditable) return true;
    if (el.closest('[contenteditable=""],[contenteditable="true"]')) return true;

    const tag = el.tagName;

    // common form controls
    if (tag === 'TEXTAREA') return true;

    if (tag === 'INPUT') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();

        // Treat most inputs as editable, except ones where undo/redo is not meaningful
        const nonTextTypes = new Set([
            'button', 'submit', 'reset',
            'checkbox', 'radio',
            'file', 'color',
            'range',
            'image'
        ]);

        // For everything else (text, search, email, url, number, tel, password, etc.), allow native undo
        return !nonTextTypes.has(t);
    }

    // Optional: allow native undo inside selects too (usually irrelevant, but harmless)
    if (tag === 'SELECT') return true;

    return false;
}

export function shouldIgnoreGlobalUndoRedo(e) {
    // If user is composing IME text, don’t interfere
    if (e.isComposing) return true;

    const ae = document.activeElement;

    // If focus is in an editable control, let the browser handle undo/redo for that control
    if (isEditableElement(ae)) return true;

    // Also ignore if the key event originated from an editable element even if activeElement is odd
    if (isEditableElement(e.target)) return true;

    return false;
}
