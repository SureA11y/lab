(function(){
    'use strict';

// Prefer browser (Firefox), fall back to chrome (Chrome/Edge)
    const api = globalThis.browser || globalThis.chrome;

// If a previous picker instance is still around (due to partial cleanup or errors),
// tear it down before starting a new one.
    try {
        if (globalThis.__A11Y_CSS_SELECTOR_PICKER__ && typeof globalThis.__A11Y_CSS_SELECTOR_PICKER__.destroy === 'function') {
            globalThis.__A11Y_CSS_SELECTOR_PICKER__.destroy();
        }
    } catch {}

    function activateSelectorGeneration(paramFromSaveContentExtPicker) {
        // Remove any stale keytrap overlay from previous runs
        try { document.getElementById('__a11y_picker_keytrap__')?.remove(); } catch {}

        let currentElement = undefined;
        const param = paramFromSaveContentExtPicker;
        function getSelectorType() {
            const type = (param && typeof param === 'object' && typeof param.selectorType === 'string')
                ? param.selectorType
                : '';
            return String(type || '').trim().toLowerCase() || 'selector';
        }

        let destroyed = false;
        let keyTrapEl = null;

        // -------------------- Robust interaction blocking (capture phase) --------------------
        // We block page interactions in capture phase so the site's handlers never run.
        // Then we select the clicked element ourselves from the capture click handler.

        function isKeyTrap(el) {
            return !!(el && el.id === '__a11y_picker_keytrap__');
        }

        function swallowEvent(e) {
            if (destroyed) return;
            try { e.preventDefault(); } catch {}
            try { e.stopPropagation(); } catch {}
            try { e.stopImmediatePropagation(); } catch {}
        }

        function captureSelectClick(e) {
            if (destroyed) return;

            // Block the site's click behavior (router, navigation, etc.)
            swallowEvent(e);

            // Pick the element that was actually clicked.
            // Prefer composedPath() (handles Shadow DOM) when available.
            let el = null;
            try {
                const path = (typeof e.composedPath === 'function') ? e.composedPath() : null;
                if (path && path.length) {
                    el = path.find(n => n && n.nodeType === 1) || null;
                }
            } catch {}

            if (!el) {
                el = e.target && e.target.nodeType === 1 ? e.target : null;
            }

            currentElement = el || currentElement;
            if (currentElement) highlight(currentElement);

            try {
                finalizePickedValue();
            } finally {
                // getCSSSelector already calls destroy(), but if it throws we still clean up.
                destroy();
            }
        }

        // -------------------- DevTools-friendly controller API --------------------
        // IMPORTANT: When triggered from a DevTools panel, the inspected page often does NOT have focus,
        // so it won't receive keydown events. Instead, the panel should handle keys and call these
        // methods via injection into the tab (A11Y_EXEC_IN_TAB / scripting.executeScript).
        function move(direction) {
            if (destroyed) return;
            const dir = String(direction || '').toLowerCase();

            // If nothing selected yet, start at documentElement for deterministic behavior
            if (!currentElement || !currentElement.isConnected) {
                currentElement = document.documentElement;
                highlight(currentElement);
                return;
            }

            const parentNode = currentElement.parentElement;

            if (dir === 'up') {
                if (parentNode && parentNode.tagName !== 'HTML') {
                    currentElement = parentNode;
                    highlight(currentElement);
                }
                return;
            }

            if (dir === 'left') {
                if (currentElement.previousElementSibling) {
                    currentElement = currentElement.previousElementSibling;
                    highlight(currentElement);
                }
                return;
            }

            if (dir === 'right') {
                if (currentElement.nextElementSibling) {
                    currentElement = currentElement.nextElementSibling;
                    highlight(currentElement);
                }
                return;
            }

            if (dir === 'down') {
                // First element-child (nodeType 1)
                const firstChild = currentElement.firstElementChild;
                if (firstChild) {
                    currentElement = firstChild;
                    highlight(currentElement);
                }
            }
        }

        function confirm() {
            if (destroyed) return;
            if (!currentElement || !currentElement.isConnected) return;
            try {
                finalizePickedValue();
            } catch {
                // Always clean up
                destroy();
            }
        }

        function cancel() {
            if (destroyed) return;
            destroy();
        }

        function setCurrent(selectorOrElement) {
            if (destroyed) return;

            let el = null;

            // Allow passing a selector string (useful if the panel wants to set a start point)
            if (typeof selectorOrElement === 'string') {
                try { el = document.querySelector(selectorOrElement); } catch { el = null; }
            } else if (selectorOrElement && selectorOrElement.nodeType === 1) {
                el = selectorOrElement;
            }

            if (el) {
                currentElement = el;
                highlight(currentElement);
            }
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;

            // Remove capture blockers/selectors
            try { document.removeEventListener('pointerdown', swallowEvent, true); } catch {}
            try { document.removeEventListener('mousedown', swallowEvent, true); } catch {}
            try { document.removeEventListener('touchstart', swallowEvent, true); } catch {}
            try { document.removeEventListener('click', captureSelectClick, true); } catch {}

            try {
                Array.from(document.querySelectorAll('*')).forEach((el) => {
                    el.removeEventListener('mouseover', mouseOverEvent);
                    el.removeEventListener('mouseout', mouseoutEvent);
                });
            } catch {}

            try { removeHighlight(); } catch {}
            try {
                const isolateStyles = document.querySelector('#isolateStyles');
                isolateStyles?.parentNode?.removeChild(isolateStyles);
            } catch {}

            try {
                if (keyTrapEl) {
                    try { keyTrapEl.parentNode && keyTrapEl.parentNode.removeChild(keyTrapEl); } catch {}
                }
            } catch {}
            keyTrapEl = null;

            try {
                if (globalThis.__A11Y_CSS_SELECTOR_PICKER__) {
                    globalThis.__A11Y_CSS_SELECTOR_PICKER__.destroyed = true;
                }
            } catch {}
        }

        // Expose teardown + controller so a DevTools panel can drive the picker without page focus
        globalThis.__A11Y_CSS_SELECTOR_PICKER__ = {
            destroy,
            destroyed: false,
            move,
            confirm,
            cancel,
            setCurrent
        };

        // Ensure style tag is fresh (avoid duplicates)
        try {
            const old = document.querySelector('#isolateStyles');
            old?.parentNode?.removeChild(old);
        } catch {}

        // Attach listeners (BUBBLE phase) for hover highlighting
        try {
            Array.from(document.querySelectorAll('*')).forEach((element) => {
                element.addEventListener('mouseover', mouseOverEvent);
                element.addEventListener('mouseout', mouseoutEvent);
            });
        } catch {}

        // Add visual style
        try {
            const isolateStyles = document.createElement('style');
            isolateStyles.setAttribute('id', 'isolateStyles');
            isolateStyles.textContent =
                '.highlighted{outline:4px solid black!important;outline-offset:-4px!important;box-shadow:0 0 0 4px #fff;}' +
                '*[data-isolated-hidden]{display:none!important;opacity:0!important;visibility:hidden!important;}';
            document.head.appendChild(isolateStyles);
        } catch {}

        // Block interactions early (capture) so the page can't react to clicks/presses.
        document.addEventListener('pointerdown', swallowEvent, true);
        document.addEventListener('mousedown', swallowEvent, true);
        document.addEventListener('touchstart', swallowEvent, true);

        // Capture click selects and finalizes.
        document.addEventListener('click', captureSelectClick, true);

        function mouseOverEvent(event) {
            if (destroyed) return;
            if (isKeyTrap(event.currentTarget)) return;

            // Stop bubbling so we don't end up highlighting ancestors (body/html)
            try { event.stopPropagation(); } catch {}

            currentElement = event.currentTarget;
            highlight(currentElement);
        }

        function mouseoutEvent(event) {
            if (destroyed) return;
            if (isKeyTrap(event.currentTarget)) return;

            try { event.stopPropagation(); } catch {}
            removeHighlight();
        }

        function cssPath(element) {
            if (!element.parentElement || element.tagName.toLowerCase() === 'body') {
                return element.tagName.toLowerCase();
            }
            const parent = element.parentElement;
            const siblings = Array.from(parent.children).filter((e) => e.tagName === element.tagName);
            const idx = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(element) + 1})` : '';
            const parentPath = cssPath(parent);
            return parentPath === 'body'
                ? `${element.tagName.toLowerCase()}${idx}`
                : `${parentPath} > ${element.tagName.toLowerCase()}${idx}`;
        }

        function idSelector(element) {
            return element.id ? `#${CSS.escape(element.id)}` : null;
        }

        function classSelector(element) {
            const classes = Array.from(element.classList).filter((c) => c !== 'highlighted');
            if (!classes.length) return null;
            return '.' + classes.map((c) => CSS.escape(c)).join('.');
        }

        function uniqueSelector(element) {
            if (!element) return '';
            const idSel = idSelector(element);
            if (idSel && document.querySelectorAll(idSel).length === 1) return idSel;

            const classSel = classSelector(element);
            if (classSel && document.querySelectorAll(classSel).length === 1) return classSel;

            const fullPath = cssPath(element);
            if (fullPath && document.querySelectorAll(fullPath).length === 1) return fullPath;

            let sel = fullPath || '';
            if (idSel) sel += idSel;
            else if (classSel) sel += classSel;
            return sel;
        }

        function sendPickerResult(value, selectorType, selector) {
            const target = (param && typeof param === 'object' && typeof param.target === 'string') ? param.target : null;
            const sessionId = (param && typeof param === 'object' && typeof param.sessionId === 'string') ? param.sessionId : null;

            const payload = {
                type: 'A11Y_PICKER_RESULT',
                target,
                selectorType: String(selectorType || 'selector'),
                value: String(value || ''),
                selector: String(selector || ''),
                sessionId
            };

            // Preferred: extension messaging (content-script / isolated-world)
            try {
                if (api && api.runtime && typeof api.runtime.sendMessage === 'function') {
                    api.runtime.sendMessage(payload, () => {});
                    return;
                }
            } catch {}

            // Fallback: if this script runs in MAIN world (no runtime API),
            // notify any bridge content-script via window.postMessage.
            try {
                window.postMessage({ __A11Y_PICKER_BRIDGE__: true, payload }, '*');
            } catch {}
        }

        function normalizeText(text) {
            return String(text || '').replace(/\s+/g, ' ').trim();
        }

        function getTextFromIds(idRefs) {
            const ids = String(idRefs || '').trim().split(/\s+/).filter(Boolean);
            if (!ids.length) return '';
            return normalizeText(
                ids
                    .map((id) => {
                        try {
                            const ref = document.getElementById(id);
                            return ref ? (ref.innerText || ref.textContent || '') : '';
                        } catch {
                            return '';
                        }
                    })
                    .filter(Boolean)
                    .join(' ')
            );
        }

        function getAssociatedLabelText(el) {
            try {
                if (el && el.labels && el.labels.length) {
                    return normalizeText(Array.from(el.labels).map((l) => l.innerText || l.textContent || '').join(' '));
                }
            } catch {}

            try {
                if (el && el.id) {
                    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                    if (label) return normalizeText(label.innerText || label.textContent || '');
                }
            } catch {}

            return '';
        }

        function getHeuristicAccessibleName(el) {
            if (!el || el.nodeType !== 1) return '';

            try {
                const labelledby = el.getAttribute('aria-labelledby');
                if (labelledby) {
                    const text = getTextFromIds(labelledby);
                    if (text) return text;
                }
            } catch {}

            try {
                const ariaLabel = normalizeText(el.getAttribute('aria-label'));
                if (ariaLabel) return ariaLabel;
            } catch {}

            const tag = (el.tagName || '').toLowerCase();

            if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'progress' || tag === 'meter') {
                const labelText = getAssociatedLabelText(el);
                if (labelText) return labelText;
            }

            if (tag === 'img') {
                const alt = normalizeText(el.getAttribute('alt'));
                if (alt) return alt;
            }

            if (tag === 'input') {
                const type = String(el.type || '').toLowerCase();

                if (type === 'button' || type === 'submit' || type === 'reset') {
                    const value = normalizeText(el.value);
                    if (value) return value;
                }

                const title = normalizeText(el.getAttribute('title'));
                if (title) return title;

                const placeholder = normalizeText(el.getAttribute('placeholder'));
                if (placeholder) return placeholder;
            }

            if (tag === 'button') {
                const text = normalizeText(el.innerText || el.textContent || '');
                if (text) return text;
            }

            if (tag === 'svg') {
                try {
                    const titleEl = el.querySelector('title');
                    const titleText = normalizeText(titleEl ? (titleEl.textContent || '') : '');
                    if (titleText) return titleText;
                } catch {}
            }

            try {
                const title = normalizeText(el.getAttribute('title'));
                if (title) return title;
            } catch {}

            const text = normalizeText(el.innerText || el.textContent || '');
            if (text) return text;

            return '';
        }

        function getAccessibleName(el) {
            // If in the future a reliable native API is available in the target browser,
            // you can plug it in here before the heuristic fallback.
            return getHeuristicAccessibleName(el);
        }

        function finalizePickedValue() {
            const selector = uniqueSelector(currentElement);
            const selectorType = getSelectorType();

            let value = selector;

            if (selectorType === 'gettext') {
                value = getAccessibleName(currentElement);
            }

            try {
                console.log('%cElement:', 'font-weight:bold', currentElement);
                console.log('%cPicker type:', 'color:#2563eb', selectorType);
                console.log('%cReturned value:', 'color:green', value);
                if (selectorType === 'gettext') {
                    console.log('%cCSS selector:', 'color:#6b7280', selector);
                }
            } catch {}

            const prefix = (param && typeof param === 'object' && typeof param.clipboardPrefix === 'string')
                ? param.clipboardPrefix
                : String(paramFromSaveContentExtPicker || '');

            const copied = copyToClipboard(value, prefix);
            sendPickerResult(value, selectorType, selector);

            Promise.resolve(copied).then((success) => {
                try {
                    if (success) console.log('%cCopied to clipboard', 'color:#2563eb');
                    else console.warn('Could not copy to clipboard');
                } catch {}
            });

            destroy();
        }

        function removeHighlight() {
            try {
                document.body.querySelectorAll('.highlighted').forEach((el) => el.classList.remove('highlighted'));
            } catch {}
        }

        function highlight(el) {
            if (!el) return;
            removeHighlight();
            try { el.classList.add('highlighted'); } catch {}
        }

        function copyToClipboard(text, prefix) {
            const p = (typeof prefix === 'string') ? prefix : '';
            const finalText = p + String(text || '');
            if (navigator.clipboard && window.isSecureContext) {
                return navigator.clipboard.writeText(finalText).then(() => true).catch(() => fallbackCopy(finalText));
            }
            return fallbackCopy(finalText);
        }

        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
            document.body.removeChild(ta);
            return ok;
        }
    }

    let pickerParam;
    try {
        pickerParam = (typeof globalThis !== 'undefined' && globalThis.paramFromSaveContentExtPicker !== undefined)
            ? globalThis.paramFromSaveContentExtPicker
            : (typeof window !== 'undefined' ? window.paramFromSaveContentExtPicker : undefined);
    } catch {
        pickerParam = undefined;
    }

    activateSelectorGeneration(pickerParam);

})();