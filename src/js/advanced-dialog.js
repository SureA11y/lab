'use strict';

/**
 * PagedDialog item:
 * { title?: string, contentEl: Element }
 *
 * Factory:
 * createAdvancedDialog({ dialog, closeButton?, initialItems?, initialIndex? })
 *
 * Component owns:
 * - showing/hiding dialog
 * - rendering current item title + content node (directly, no cloning)
 * - left/right buttons (aria-disabled, always visible)
 * - "Item X of Y" indicator
 * - ArrowLeft/ArrowRight
 * - polite live region only for blocked navigation
 *
 * Component does NOT own:
 * - how content elements are created/cloned
 * - where items come from
 */

export function createAdvancedDialog({
                                         initialItems = [],
                                         initialIndex = 0,
                                         labels = {},
                                         options = {
                                             paged: false,
                                             acceptBtn: false,
                                             closeBtn: false,
                                         },

                                     } = {}) {

    const dialogClassName = 'paged-dialog';

    const dialog = document.createElement('dialog');
    dialog.className = dialogClassName;
    // A modifier class for a dialog that sizes itself, e.g. one that keeps
    // its size while its content changes.
    if (options.className) dialog.classList.add(...String(options.className).split(/\s+/).filter(Boolean));
    document.body.appendChild(dialog);

    const paged = options.paged;
    const hasAcceptBtn = options.acceptBtn;
    const hasCloseBtn = options.closeBtn;
    const hasFooterActions = hasAcceptBtn || hasCloseBtn;

    const L = {
        prevLabel: labels.prevLabel || 'Previous item',
        nextLabel: labels.nextLabel || 'Next item',
        closeLabel: labels.closeLabel || 'Close',
        positionLabel: labels.positionLabel || ((i, n) => `Item ${i} of ${n}`),
        noPrev: labels.noPrev || 'No previous items',
        noNext: labels.noNext || 'No next items',
        acceptBtnLabel: labels.acceptBtnLabel || 'Accept',
        closeBtnLabel: labels.closeBtnLabel || 'Close',
        // Left and right only move between items in a paged dialog.
        keyboardHelp:
            labels.keyboardHelp ||
            ((options.paged ? 'Use left and right arrow keys to move between items. ' : '') +
                'Use up and down arrow keys to scroll the content. Use Page Up and Page Down to scroll faster, Home to go to the top, and End to go to the bottom.')
    };

    // Structure:
    // <dialog id="pagedDialog">
    //   <div class="axd-shell">
    //     <button class="axd-close"...>×</button>   (or reuse your existing close)
    //     <div class="axd-header">
    //       <div class="axd-title" ...></div>
    //       <div class="axd-pos" ...></div>
    //     </div>
    //     <div class="axd-body" data-host></div>
    //     <div class="axd-footer">
    //       <button class="axd-footer-accept"...>×</button>
    //       <button class="axd-footer-close"...>×</button>
    //     </div>
    //     <div class="axd-live sr-only" aria-live="polite" aria-atomic="true"></div>
    //     <button class="axd-nav axd-nav--prev" ...>◀</button>
    //     <button class="axd-nav axd-nav--next" ...>▶</button>
    //   </div>
    // </dialog>

    const shell = document.createElement('div');
    shell.className = 'axd-shell';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.classList.add('axd-close');
    closeBtn.setAttribute('aria-label', L.closeLabel);
    closeBtn.setAttribute('data-axd-close', '');

    const header = document.createElement('div');
    header.className = 'axd-header';

    const randomId = Math.random().toString(36).slice(2);

    const titleEl = document.createElement('span');
    titleEl.className = 'axd-title';
    titleEl.id = `axd_title_${randomId}`;

    const posEl = document.createElement('span');
    posEl.id = `axd_title_pos_${randomId}`;
    posEl.className = 'axd-pos';

    const helpEl = document.createElement('div');
    helpEl.id = `axd_help_${randomId}`;
    helpEl.className = 'sr-only';
    helpEl.textContent = L.keyboardHelp;

    header.appendChild(titleEl);
    header.appendChild(posEl);

    dialog.setAttribute('aria-labelledby', `${titleEl.id} ${posEl.id}`);
    dialog.setAttribute('aria-describedby', helpEl.id);

    const host = document.createElement('div');
    host.className = 'axd-body';
    host.setAttribute('data-axd-host', '');

    const live = document.createElement('div');
    live.className = 'axd-live sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');

    const btnPrev = document.createElement('button');
    btnPrev.type = 'button';
    btnPrev.className = 'axd-nav axd-nav--prev';
    btnPrev.setAttribute('aria-label', L.prevLabel);
    btnPrev.setAttribute('aria-controls', titleEl.id);
    btnPrev.textContent = '◀';

    const btnNext = document.createElement('button');
    btnNext.type = 'button';
    btnNext.className = 'axd-nav axd-nav--next';
    btnNext.setAttribute('aria-label', L.nextLabel);
    btnNext.setAttribute('aria-controls', titleEl.id);
    btnNext.textContent = '▶';

    shell.appendChild(closeBtn);
    shell.appendChild(header);
    shell.appendChild(helpEl);
    shell.appendChild(host);

    const footer = document.createElement('div');
    footer.className = 'axd-footer';
    shell.appendChild(footer);

    let btnFooterAccept = null;
    let btnFooterClose = null;
    let onAccept = null;

    if(hasFooterActions) {
        if (hasAcceptBtn) {
            btnFooterAccept = document.createElement('button');
            btnFooterAccept.type = 'button';
            btnFooterAccept.className = 'axd-footer-accept';
            btnFooterAccept.textContent = L.acceptBtnLabel;
            footer.appendChild(btnFooterAccept);
        }

        if (hasCloseBtn) {
            btnFooterClose = document.createElement('button');
            btnFooterClose.type = 'button';
            btnFooterClose.className = 'axd-footer-close secondary-button';
            btnFooterClose.textContent = L.closeBtnLabel;
            footer.appendChild(btnFooterClose);
        }
    }

    shell.appendChild(live);
    if (paged) {
        shell.appendChild(btnPrev);
        shell.appendChild(btnNext);
    }

    // Replace existing dialog content (keeps the dialog element itself + its CSS selectors).
    // If you need to preserve something else, do it outside this component.
    dialog.innerHTML = '';
    dialog.appendChild(shell);

    // Escape, and a click on the backdrop (dialog-backdrop.js), close it
    // through close(), which clears it and tells its item.
    dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });

    // ---- state ----
    let items = [];
    let index = 0;
    let lastFocused = null;

    function isOpen() {
        return dialog.hasAttribute('open');
    }

    function announce(msg) {
        // Only set on-demand (avoid chatty SR).
        live.textContent = msg || '';
    }

    function canPrev() {
        return items.length > 0 && index > 0;
    }

    function canNext() {
        return items.length > 0 && index < items.length - 1;
    }

    function setAriaDisabled(btn, on) {
        btn.setAttribute('aria-disabled', on ? 'true' : 'false');
    }

    function updateNavUi() {
        setAriaDisabled(btnPrev, !canPrev());
        setAriaDisabled(btnNext, !canNext());

        const n = items.length;
        if (!n) {
            titleEl.textContent = '';
            posEl.textContent = '';
            return;
        }

        if(n === 1) return;
        const i = index + 1;
        posEl.textContent = typeof L.positionLabel === 'function' ? L.positionLabel(i, n) : `Item ${i} of ${n}`;
    }

    function clearHost() {
        while (host.firstChild) host.removeChild(host.firstChild);
    }

    function scrollHostBy(delta) {
        if (!host) return;
        host.scrollBy({
            top: delta,
            behavior: 'smooth'
        });
    }

    function scrollHostTo(top) {
        if (!host) return;
        host.scrollTo({
            top,
            behavior: 'smooth'
        });
    }

    function render() {
        clearHost();

        if (!items.length) {
            titleEl.textContent = '';
            updateNavUi();
            return;
        }

        const it = items[index] || null;
        titleEl.textContent = (it && typeof it.title === 'string') ? it.title : '';

        // Use the node directly (no cloning).
        if (it && it.contentEl instanceof Element) {
            host.appendChild(it.contentEl);
            it.onOpen(dialog);
            setTimeout(() => {
                if (host.scrollTop) host.scrollTop = 0;
            })
        }

        updateNavUi();
    }

    function clampIndex(i) {
        if (!items.length) return 0;
        return Math.max(0, Math.min(i, items.length - 1));
    }

    function goTo(i, {announceBlocked = false} = {}) {
        if (!items.length) {
            index = 0;
            render();
            if (announceBlocked) announce(L.noNext);
            return;
        }

        const next = clampIndex(i);
        if (next === index) {
            // blocked navigation attempt
            if (announceBlocked) {
                if (i < index) announce(L.noPrev);
                else if (i > index) announce(L.noNext);
            }
            return;
        }

        announce(''); // clear any previous “blocked” message
        index = next;
        render();
    }

    function prev({announceBlocked = true} = {}) {
        if (!canPrev()) {
            if (announceBlocked) announce(L.noPrev);
            return;
        }
        goTo(index - 1);
    }

    function next({announceBlocked = true} = {}) {
        if (!canNext()) {
            if (announceBlocked) announce(L.noNext);
            return;
        }
        goTo(index + 1);
    }

    function isAriaDisabled(btn) {
        return btn.getAttribute('aria-disabled') === 'true';
    }

    function onPrevClick(e) {
        e.preventDefault();
        if (isAriaDisabled(btnPrev)) {
            announce(L.noPrev);
            return;
        }
        prev();
    }

    function onNextClick(e) {
        e.preventDefault();
        if (isAriaDisabled(btnNext)) {
            announce(L.noNext);
            return;
        }
        next();
    }

    function shouldIgnoreArrowKeys(target) {
        const el = target instanceof Element ? target : null;
        if (!el) return false;

        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return true;

        const role = el.getAttribute('role');
        return [
            'textbox',
            'combobox',
            'listbox',
            'menu',
            'menubar',
            'grid',
            'tree',
            'slider',
            'spinbutton'
        ].includes(role);
    }

    function onDialogKeyDown(e) {
        if (!isOpen()) return;
        if (shouldIgnoreArrowKeys(e.target)) return;

        if (paged) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prev({announceBlocked: true});
                return;
            }

            if (e.key === 'ArrowRight') {
                e.preventDefault();
                next({announceBlocked: true});
                return;
            }
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            scrollHostBy(40);
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            scrollHostBy(-40);
            return;
        }

        if (e.key === 'PageDown') {
            e.preventDefault();
            scrollHostBy(host.clientHeight * 0.9);
            return;
        }

        if (e.key === 'PageUp') {
            e.preventDefault();
            scrollHostBy(-(host.clientHeight * 0.9));
            return;
        }

        if (e.key === 'Home') {
            e.preventDefault();
            scrollHostTo(0);
            return;
        }

        if (e.key === 'End') {
            e.preventDefault();
            scrollHostTo(host.scrollHeight);
        }
    }

    function open(at = 0) {
        lastFocused = document.activeElement;

        index = clampIndex(at);
        render();

        if (typeof dialog.showModal === 'function') dialog.showModal();
        closeBtn.focus();
    }

    function openById(id) {
        lastFocused = document.activeElement;
        const itemIndex = items.findIndex(item => item.id === id);
        if (itemIndex > -1) open(itemIndex);
    }

    function getItems() {
        return items;
    }

    function close() {
        dialog.close();
        clearHost();

        const it = items[index] || null;
        if (it && it.onClose && typeof it.onClose === 'function') {
            it.onClose(dialog);
        }
    }

    function onClose() {
        announce('');
        // restore focus
        if (lastFocused && typeof lastFocused.focus === 'function') {
            lastFocused.focus();
        }
        lastFocused = null;
    }

    function setItems(nextItems, at = 0) {
        items = Array.isArray(nextItems) ? nextItems.filter(Boolean) : [];
        index = clampIndex(at);
        render();
    }

    function clearItems() {
        items.length = 0;
    }

    function addItem(item) {
        if (!item) return;
        items.push(item);
        index = clampIndex(index);
        // Only re-render while actually open. Content nodes aren't cloned (each
        // item's contentEl may be the very same <img> another dialog also holds
        // an item for - see createImg()/appendImgToDialog()), so an unconditional
        // render() here would re-parent that node into *this* dialog's host even
        // while closed, silently stealing it out of whichever dialog is
        // currently showing it open.
        if (isOpen()) render();
    }

    function setAcceptHandler(fn) {
        onAccept = (typeof fn === 'function') ? fn : null;
    }

    function setAcceptVisible(isVisible) {
        if (!btnFooterAccept) return;
        btnFooterAccept.hidden = !isVisible;
        btnFooterAccept.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
    }

    function setAcceptLabel(text) {
        if (!btnFooterAccept) return;
        btnFooterAccept.textContent = String(text || L.acceptBtnLabel);
    }

    function removeAt(i) {
        if (!items.length) return;
        const idx = Number(i);
        if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return;

        items.splice(idx, 1);
        index = clampIndex(index);
        render();
    }

    function getState() {
        return {index, count: items.length};
    }

    // Events
    btnPrev.addEventListener('click', onPrevClick);
    btnNext.addEventListener('click', onNextClick);
    closeBtn.addEventListener('click', close);
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('keydown', onDialogKeyDown);

    function onFooterAcceptClick(e) {
        e.preventDefault();
        if (typeof onAccept === 'function') onAccept();
    }

    function onFooterCloseClick(e) {
        e.preventDefault();
        close();
    }

    if (btnFooterAccept) btnFooterAccept.addEventListener('click', onFooterAcceptClick);
    if (btnFooterClose) btnFooterClose.addEventListener('click', onFooterCloseClick);

    // Init
    setItems(initialItems, initialIndex);

    return {
        dialog,
        open,
        openById,
        close,
        setItems,
        addItem,
        getItems,
        removeAt,
        clearItems,
        goTo,
        prev,
        next,
        getState,
        setAcceptHandler,
        setAcceptVisible,
        setAcceptLabel,
        destroy() {
            btnPrev.removeEventListener('click', onPrevClick);
            btnNext.removeEventListener('click', onNextClick);
            closeBtn.removeEventListener('click', close);
            dialog.removeEventListener('close', onClose);
            dialog.removeEventListener('keydown', onDialogKeyDown);
            if (btnFooterAccept) btnFooterAccept.removeEventListener('click', onFooterAcceptClick);
            if (btnFooterClose) btnFooterClose.removeEventListener('click', onFooterCloseClick);
        }
    };
}
