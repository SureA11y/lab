'use strict';

(function (global) {
    function createScreenshotDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'src-dialog screenshot-dialog';
        dialog.setAttribute('aria-labelledby', 'screenshot-dialog-title');

        dialog.innerHTML = `
            <div class="src-dialog-header">
                <div>
                    <h2 id="screenshot-dialog-title" class="src-dialog-title">Screenshot preview</h2>
                    <p class="src-dialog-meta" hidden></p>
                </div>
                <button type="button" class="src-dialog-close" aria-label="Close screenshot preview">Close</button>
            </div>
            <div class="src-dialog-body screenshot-dialog-body">
                <img class="screenshot-dialog-image" alt="">
            </div>
            <div class="src-dialog-footer">
                <span class="instances-meta">Press Escape to close</span>
                <button type="button" class="src-dialog-close">Close</button>
            </div>
        `;

        document.body.appendChild(dialog);

        const titleEl = dialog.querySelector('.src-dialog-title');
        const metaEl = dialog.querySelector('.src-dialog-meta');
        const imgEl = dialog.querySelector('.screenshot-dialog-image');
        const closeButtons = dialog.querySelectorAll('.src-dialog-close');

        let lastFocused = null;

        function close() {
            if (dialog.open) dialog.close();
            if (lastFocused && typeof lastFocused.focus === 'function') {
                lastFocused.focus();
            }
        }

        function open({ src = '', alt = '', title = 'Screenshot preview', meta = '' } = {}) {
            lastFocused = document.activeElement;
            titleEl.textContent = title;
            metaEl.textContent = meta || '';
            metaEl.hidden = !meta;
            imgEl.src = src;
            imgEl.alt = alt || title;

            if (typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }

            if (closeButtons[0]) closeButtons[0].focus();
        }

        closeButtons.forEach((btn) => btn.addEventListener('click', close));

        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) close();
        });

        dialog.addEventListener('cancel', () => {
            if (lastFocused && typeof lastFocused.focus === 'function') {
                setTimeout(() => lastFocused.focus(), 0);
            }
        });

        return { dialog, open, close };
    }

    global.A11Y_SCREENSHOT_DIALOG = { createScreenshotDialog };
})(globalThis);
