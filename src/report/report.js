function createAdvancedDialog({
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
    document.body.appendChild(dialog);

    const paged = options.paged;

    const L = {
        prevLabel: labels.prevLabel || 'Previous item',
        nextLabel: labels.nextLabel || 'Next item',
        closeLabel: labels.closeLabel || 'Close',
        positionLabel: labels.positionLabel || ((i, n) => `Item ${i} of ${n}`),
        noPrev: labels.noPrev || 'No previous items',
        noNext: labels.noNext || 'No next items',
        acceptBtnLabel: labels.acceptBtnLabel || 'Accept',
        closeBtnLabel: labels.closeBtnLabel || 'Close',

    };

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

    header.appendChild(titleEl);
    header.appendChild(posEl);

    dialog.setAttribute('aria-labelledby', `${titleEl.id} ${posEl.id}`);

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
    shell.appendChild(host);

    const footer = document.createElement('div');
    footer.className = 'axd-footer';
    shell.appendChild(footer);

    shell.appendChild(live);
    if (paged) {
        shell.appendChild(btnPrev);
        shell.appendChild(btnNext);
    }

    // Replace existing dialog content (keeps the dialog element itself + its CSS selectors).
    // If you need to preserve something else, do it outside this component.
    dialog.innerHTML = '';
    dialog.appendChild(shell);

    // Click outside image closes
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) close();
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

        if (n === 1) return;
        const i = index + 1;
        posEl.textContent = typeof L.positionLabel === 'function' ? L.positionLabel(i, n) : `Item ${i} of ${n}`;
    }

    function clearHost() {
        while (host.firstChild) host.removeChild(host.firstChild);
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
        // Don’t hijack arrows in text inputs if you ever host them.
        const el = target instanceof Element ? target : null;
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function onDialogKeyDown(e) {
        if (!isOpen()) return;
        if (shouldIgnoreArrowKeys(e.target)) return;

        if (paged) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prev({announceBlocked: true});
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                next({announceBlocked: true});
            }
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

    function close() {
        dialog.close();
        clearHost();

        const it = items[index] || null;
        if (it) {
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

    function addItem(item) {
        if (!item) return;
        items.push(item);
        index = clampIndex(index);
        render();
    }

    // Events
    btnPrev.addEventListener('click', onPrevClick);
    btnNext.addEventListener('click', onNextClick);
    closeBtn.addEventListener('click', close);
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('keydown', onDialogKeyDown);

    // Init
    setItems([], 0);

    return {
        dialog,
        openById,
        close,
        setItems,
        addItem
    };
}

function viewDetailsDialogButtons() {
    document.querySelectorAll('.src-dialog-trigger').forEach(trigger => {
        const localDlg = trigger.closest('td')?.querySelector('dialog') || trigger.closest('tr')?.querySelector('dialog');

        const dialog =
            localDlg ||
            (() => {
                const id = trigger.getAttribute('data-dialog-id');
                return id ? document.getElementById(id) : null;
            })();

        if (dialog && typeof dialog.showModal === 'function') {
            trigger.addEventListener('click', () => dialog.showModal());
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) dialog.close();
            });
            dialog.querySelector('.src-dialog-body')?.scrollTo({top: 0});

            dialog.querySelectorAll('.src-dialog-close').forEach(closeBtn => {
                closeBtn.addEventListener('click', () => dialog.close());
            });

            dialog.querySelectorAll('.copy-selector-btn').forEach(copyBtn => {
                const selector = copyBtn.getAttribute('data-selector') || '';
                if (selector && navigator.clipboard?.writeText) {
                    copyBtn.addEventListener('click', () => {
                        const text = String(selector || '');
                        if (!text) return;

                        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                            navigator.clipboard.writeText(text).catch(() => {
                            });
                            return;
                        }

                        // Fallback (works in more contexts, including some file://)
                        try {
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            ta.setAttribute('readonly', '');
                            ta.style.position = 'fixed';
                            ta.style.left = '-9999px';
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            ta.remove();
                        } catch {
                        }
                    });
                }
            });
        }
    })
}

function createDialogs() {
    const scansScreenshots = document.querySelectorAll('#results .screenshot-btn');
    if (scansScreenshots.length) {
        const scansDialog = createAdvancedDialog({
            labels: {},
            options: {
                paged: true
            }
        });

        scansScreenshots.forEach(btn => {
            const img = btn.querySelector('img');
            if (img) {
                addImgItemToDialog(img, scansDialog);
                btn.onclick = () => scansDialog.openById(img.src);
            }
        })
    }
    const screenshots = document.querySelectorAll('#screenshots .screenshot-btn');
    if (screenshots.length) {
        const screenshotsDialog = createAdvancedDialog({
            labels: {},
            options: {
                paged: true
            }
        });

        screenshots.forEach(btn => {
            const img = btn.querySelector('img');
            if (img) {
                addImgItemToDialog(img, screenshotsDialog);
                btn.onclick = () => screenshotsDialog.openById(img.src);
            }
        })
    }
}

function addImgItemToDialog(img, dialog) {
    if (!img || !dialog) return;
    dialog.addItem({
        id: img.src,
        title: img.alt,
        contentEl: img.cloneNode(true),
        onOpen: (dialog) => {
            centerDialogImageView(dialog, img);
        },
        onClose: (dialog) => {
            cleanupCenterDialogImageView(dialog);
        }
    });
}

function centerDialogImageView(dialogEl, imgEl, opts = {}) {
    const bodySel = opts.bodySelector || '.axd-body';
    const bodyEl = dialogEl?.querySelector(bodySel);
    if (!dialogEl || !bodyEl || !imgEl) return;

    const horiz = opts.horizontal || 'center'; // start|center|end
    const vert = opts.vertical || 'start';  // start|center|end

    const pick = (max, mode) => {
        if (!(max > 0)) return 0;
        if (mode === 'end') return max;
        if (mode === 'center') return Math.floor(max / 2);
        return 0; // start
    };

    const doCenter = () => {
        const maxScrollLeft = bodyEl.scrollWidth - bodyEl.clientWidth;
        const maxScrollTop = bodyEl.scrollHeight - bodyEl.clientHeight;

        bodyEl.scrollLeft = pick(maxScrollLeft, horiz);
        bodyEl.scrollTop = pick(maxScrollTop, vert);
    };

    const runAfterLayout = () => requestAnimationFrame(() => requestAnimationFrame(doCenter));

    if (imgEl.complete && imgEl.naturalWidth > 0) runAfterLayout();
    else imgEl.addEventListener('load', runAfterLayout, {once: true});

    if (!dialogEl._axdCenterOnResize) {
        dialogEl._axdCenterOnResize = () => runAfterLayout();
        window.addEventListener('resize', dialogEl._axdCenterOnResize, {passive: true});
    }
}

function cleanupCenterDialogImageView(dialogEl) {
    if (!dialogEl?._axdCenterOnResize) return;
    window.removeEventListener('resize', dialogEl._axdCenterOnResize);
    delete dialogEl._axdCenterOnResize;
}

function addVisualizationModeSelector() {
    const containerEl = document.querySelector('#results');

    // The comparison export ships the same script but has no results section.
    if (!containerEl || !containerEl.parentElement) return;

    const scanPresentationSelect = buildLabeledSelect({
        id: 'scan-presentation-mode',
        name: 'scanPresentationMode',
        labelText: 'Results visualization mode',
        options: {
            analysis: 'Findings and analysis',
            evidence: 'Findings',
            failures: 'Failures only'
        },
        selected: 'evidence',
        onChange: (e, value) => {
            if(value === 'evidence') {
                document.body.classList.add('evidence-mode');
                document.body.classList.remove('failures-mode');
                document.body.classList.remove('analysis-mode');
            } else if(value === 'failures') {
                document.body.classList.add('evidence-mode');
                document.body.classList.add('failures-mode');
                document.body.classList.remove('analysis-mode');
            } else {
                document.body.classList.remove('evidence-mode');
                document.body.classList.remove('failures-mode');
                document.body.classList.add('analysis-mode');
            }
        }
    });
    scanPresentationSelect.classList.add('presentation-mode');
    containerEl.parentElement.insertBefore(scanPresentationSelect, containerEl);
}

function buildLabeledSelect({
                                id,
                                labelText,
                                options,
                                selected,
                                onChange,
                                name
                            }) {
    const wrapper = document.createElement('div');

    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;

    const select = document.createElement('select');
    select.id = id;
    if (name) select.name = name;

    Object.entries(options).forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    });

    if (typeof onChange === 'function') {
        select.addEventListener('change', (event) => {
            onChange(event, event.target.value);
        });
    }

    if (selected !== undefined && selected !== null) {
        select.value = selected;

        if (typeof onChange === 'function') {
            onChange({ target: select }, select.value);
        }
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);

    return wrapper;
}

function initReportToc(options = {}) {
    const {
        tocContainer,
        contentRoot = document,
        headingSelector = 'h1, h2, h3, h4',
        minLevel = 1,
        maxLevel = 4,
        title = 'Accessibility report',
        navLabel = 'Table of contents',
        listClass = 'report-toc__list',
        itemClass = 'report-toc__item',
        linkClass = 'report-toc__link',
        activeClass = 'is-active',
        titleClass = 'report-toc__title',
        innerClass = 'report-toc__inner',
        navClass = 'report-toc__nav',
        includeTitle = true
    } = options;

    const container =
        typeof tocContainer === 'string'
            ? document.querySelector(tocContainer)
            : tocContainer;

    if (!container) {
        console.warn('initReportToc: tocContainer not found');
        return null;
    }

    const root =
        typeof contentRoot === 'string'
            ? document.querySelector(contentRoot)
            : contentRoot;

    if (!root) {
        console.warn('initReportToc: contentRoot not found');
        return null;
    }

    const headings = Array.from(root.querySelectorAll(headingSelector)).filter((heading) => {
        const level = Number(String(heading.tagName || '').replace(/[^\d]/g, ''));

        if (!level || level < minLevel || level > maxLevel) return false;

        // ignore headings inside the TOC container itself
        if (container.contains(heading)) return false;

        // ignore headings inside dialog elements
        if (heading.closest('dialog')) return false;

        return !!heading.textContent.trim();
    });

    function getLevel(heading) {
        return Number(heading.tagName.substring(1));
    }

    if (!headings.length) {
        container.innerHTML = '';
        container.hidden = true;
        container.closest('.report-layout')?.classList.add('report-layout--no-toc');
        return null;
    }

    const deepestLevel = Math.max(...headings.map(getLevel));
    const deepestHeadings = headings.filter((heading) => getLevel(heading) === deepestLevel);

    if (deepestHeadings.length < 2) {
        container.innerHTML = '';
        container.hidden = true;
        container.closest('.report-layout')?.classList.add('report-layout--no-toc');
        return null;
    }

    const slugCounts = new Map();

    function slugify(text) {
        const base = String(text || '')
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'section';

        const count = slugCounts.get(base) || 0;
        slugCounts.set(base, count + 1);

        return count ? `${base}-${count + 1}` : base;
    }

    function ensureId(heading) {
        if (!heading.id) {
            heading.id = slugify(heading.textContent);
        }
        return heading.id;
    }

    function getLevel(heading) {
        return Number(heading.tagName.substring(1));
    }

    function createLink(heading) {
        const li = document.createElement('li');
        li.className = itemClass;

        const a = document.createElement('a');
        a.className = linkClass;
        a.href = `#${ensureId(heading)}`;
        a.textContent = heading.textContent.trim();
        a.setAttribute('data-level', String(getLevel(heading)));

        // An entry follows its section out of view: "Failures only" hides the
        // failure-free scans and the can't-tell-only topics, and a link to a
        // hidden heading would lead nowhere.
        if (heading.closest('.scan-no-failures')) li.classList.add('scan-no-failures');
        else if (heading.closest('.issues-group.cantTell')) li.classList.add('cantTell');

        li.appendChild(a);
        return { li, a };
    }

    container.hidden = false;
    container.closest('.report-layout')?.classList.remove('report-layout--no-toc');

    container.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = innerClass;

    if (includeTitle) {
        const headingEl = document.createElement('h2');
        headingEl.className = titleClass;
        headingEl.textContent = title;
        inner.appendChild(headingEl);
    }

    const nav = document.createElement('nav');
    nav.className = navClass;
    nav.setAttribute('aria-label', navLabel);

    const rootOl = document.createElement('ol');
    rootOl.className = listClass;
    nav.appendChild(rootOl);
    inner.appendChild(nav);
    container.appendChild(inner);

    const stack = [{ level: minLevel - 1, list: rootOl }];
    const links = [];

    headings.forEach((heading) => {
        const level = getLevel(heading);
        const { li, a } = createLink(heading);

        while (stack.length > 1 && level <= stack[stack.length - 1].level) {
            stack.pop();
        }

        const parent = stack[stack.length - 1];
        parent.list.appendChild(li);

        const childList = document.createElement('ol');
        li.appendChild(childList);

        stack.push({ level, list: childList });
        links.push({ heading, link: a });
    });

    let activeId = null;

    function setActive(id) {
        if (!id || id === activeId) return;
        activeId = id;

        links.forEach(({ heading, link }) => {
            const isActive = heading.id === id;
            link.classList.toggle(activeClass, isActive);

            if (isActive) {
                link.setAttribute('aria-current', 'true');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    }

    const observer = new IntersectionObserver(
        (entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => {
                    if (a.boundingClientRect.top >= 0 && b.boundingClientRect.top >= 0) {
                        return a.boundingClientRect.top - b.boundingClientRect.top;
                    }
                    return b.intersectionRatio - a.intersectionRatio;
                });

            if (visible.length) {
                setActive(visible[0].target.id);
            }
        },
        {
            root: null,
            rootMargin: '-18% 0px -60% 0px',
            threshold: [0.1, 0.25, 0.5, 0.75, 1]
        }
    );

    links.forEach(({ heading }) => observer.observe(heading));

    if (links[0]) {
        setActive(links[0].heading.id);
    }

    return {
        container,
        root,
        headings,
        destroy() {
            observer.disconnect();
        },
        refresh() {
            observer.disconnect();
            initReportToc(options);
        }
    };
}

// "View all scans" grid dialog. The dialog markup + trigger button are baked
// into the exported HTML by the app (a11y-ui.js renders them into
// #results-container, which the exporter clones). Here we only wire the
// open/close behaviour and let each card's #sc-<id> anchor carry the jump —
// the same interaction the app implements.
function initAllScansDialog() {
    const dialog = document.getElementById('all-scans-dialog');
    if (!dialog) return;

    // Excluded / tag-filtered cards may have been stripped from the export, so
    // recompute the trigger count from the cards actually present. The trigger
    // is an icon-only button, so the count lives in its accessible name/tooltip
    // rather than visible text — update those without disturbing the SVG icon.
    const cardCount = dialog.querySelectorAll('.all-scans-card').length;
    const label = 'View all scans (' + cardCount + ')';
    document.querySelectorAll('[data-all-scans-open]').forEach((btn) => {
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    });

    document.addEventListener('click', function (e) {
        const opener = e.target.closest && e.target.closest('[data-all-scans-open]');
        if (opener) {
            e.preventDefault();
            if (typeof dialog.showModal === 'function') {
                try { dialog.showModal(); } catch (_) { /* already open */ }
            }
            return;
        }

        const closer = e.target.closest && e.target.closest('[data-all-scans-close]');
        if (closer) {
            if (dialog.open) dialog.close();
            return;
        }

        // Screenshot-link click: close the dialog, then let the anchor navigate
        // to #sc-<id>. The scanned-page URL link is left to open normally.
        const thumb = e.target.closest && e.target.closest('.all-scans-thumb');
        if (thumb) {
            if (dialog.open) dialog.close();
            return;
        }

        // Backdrop click.
        if (e.target === dialog && dialog.open) dialog.close();
    });
}

// Colour-theme toggle. A single icon button in the header that cycles
// Auto → Light → Dark, persisting the choice to localStorage and reflecting
// it on <html data-theme>. Mirrors the app's theme control; the report's CSS
// drives dark styling from :root[data-theme="dark"] and, in Auto mode, from
// the OS via prefers-color-scheme. The no-FOUC head script in the template
// applies the saved choice before first paint — this only wires interaction.
function initThemeToggle() {
    const root = document.documentElement;
    const btn = document.querySelector('[data-theme-toggle]');

    const STORAGE_KEY = 'surea11y-report-theme';
    const ORDER = ['auto', 'light', 'dark'];
    const LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };

    function readChoice() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            // Default to Light when nothing is stored; an explicit
            // Auto/Light/Dark choice the reader made always wins on reload.
            return (v === 'auto' || v === 'light' || v === 'dark') ? v : 'light';
        } catch (e) {
            return 'light';
        }
    }

    function apply(choice) {
        if (choice === 'light' || choice === 'dark') {
            root.setAttribute('data-theme', choice);
        } else {
            root.removeAttribute('data-theme');
        }

        if (btn) {
            btn.setAttribute('data-choice', choice);
            const label = 'Colour theme: ' + LABELS[choice];
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    }

    let current = readChoice();
    apply(current);

    // The head script disabled transitions to avoid a first-paint flash; the
    // saved choice is now applied, so re-enable them for interactive toggles.
    requestAnimationFrame(() => root.classList.remove('no-theme-transition'));

    if (!btn) return;

    btn.addEventListener('click', () => {
        current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
        try {
            localStorage.setItem(STORAGE_KEY, current);
        } catch (e) {
            /* ignore — the choice still applies for this view */
        }
        apply(current);
    });
}

// Category tabs in an exported comparison (resolved / new / persistent, or
// A-only / B-only / both). Delegated from the .cmp2 root, matching the app's
// own handler so the export behaves the same.
function initComparisonPanes() {
    function select(scope, seg) {
        const key = seg.dataset.k;

        scope.querySelectorAll('.seg').forEach((s) => {
            const on = s === seg;
            s.setAttribute('aria-selected', String(on));
            s.tabIndex = on ? 0 : -1;
        });
        scope.querySelectorAll('.pane').forEach((p) => {
            p.classList.toggle('active', p.dataset.pane === key);
        });
    }

    document.querySelectorAll('.cmp2').forEach((scope) => {
        scope.addEventListener('click', (event) => {
            const seg = event.target.closest && event.target.closest('.seg');

            if (!seg || !scope.contains(seg)) return;

            select(scope, seg);
        });

        // Arrow/Home/End move between tabs, per the tablist role the markup declares.
        scope.addEventListener('keydown', (event) => {
            const seg = event.target.closest && event.target.closest('.seg');

            if (!seg || !scope.contains(seg)) return;

            const segs = Array.from(scope.querySelectorAll('.seg'));
            const from = segs.indexOf(seg);
            let to = -1;

            if (event.key === 'ArrowRight') to = (from + 1) % segs.length;
            else if (event.key === 'ArrowLeft') to = (from - 1 + segs.length) % segs.length;
            else if (event.key === 'Home') to = 0;
            else if (event.key === 'End') to = segs.length - 1;

            if (to < 0) return;

            event.preventDefault();
            select(scope, segs[to]);
            segs[to].focus();
        });
    });
}

// Dashboard behaviour in an exported comparison of three or more reports: the
// rule-grid filters and the chart tooltips. Same handlers as the app's, so a
// downloaded dashboard behaves like the tab it came from.
function initComparisonDashboard() {
    document.querySelectorAll('.cmp2--dash').forEach((scope) => {
        scope.addEventListener('click', (event) => {
            const chip = event.target.closest && event.target.closest('[data-dash-filter]');

            if (!chip || !scope.contains(chip)) return;

            const bar = chip.parentElement;

            bar.querySelectorAll('[data-dash-filter]').forEach((c) => {
                c.setAttribute('aria-pressed', String(c === chip));
            });

            const wanted = chip.dataset.dashFilter;
            const table = bar.parentElement.querySelector('table.dash-grid');

            if (!table) return;

            table.querySelectorAll('tbody tr').forEach((row) => {
                row.hidden = wanted !== 'all' && row.dataset.dashCat !== wanted;
            });
        });

        initComparisonTooltip(scope);
    });
}

// Focus opens the tooltip as well as hover, so the values behind the marks are
// reachable by keyboard.
function initComparisonTooltip(scope) {
    let tip = null;

    function show(mark) {
        if (!tip) {
            tip = document.createElement('div');
            tip.className = 'cmp2-tip';
            document.body.append(tip);
        }

        tip.textContent = '';

        const value = document.createElement('b');

        value.textContent = mark.dataset.tipValue;
        tip.append(value, ` · ${mark.dataset.tipLabel}`);
        tip.classList.add('on');

        const box = mark.getBoundingClientRect();

        tip.style.left = `${Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2)}px`;
        tip.style.top = `${box.top - tip.offsetHeight - 10}px`;
    }

    function hide() {
        if (tip) tip.classList.remove('on');
    }

    [['mouseover', 'mouseout'], ['focusin', 'focusout']].forEach(([open, close]) => {
        scope.addEventListener(open, (event) => {
            const mark = event.target.closest && event.target.closest('[data-tip-value]');

            if (mark && scope.contains(mark)) show(mark);
        });
        scope.addEventListener(close, hide);
    });
}

function initScanSort() {
    const select = document.getElementById('scan-sort-select');
    const SORT = (typeof globalThis !== 'undefined' ? globalThis : window).A11Y_SCAN_SORT;
    if (!select || !SORT) return;

    function containers() {
        const set = new Set();
        document.querySelectorAll('[data-sort-order]').forEach((card) => {
            if (card.parentElement) set.add(card.parentElement);
        });
        return Array.from(set);
    }

    function apply() {
        const key = select.value || 'default';
        containers().forEach((c) => SORT.sortContainer(c, key));
        return key;
    }

    select.addEventListener('change', () => {
        const key = apply();
        const TOAST = (typeof globalThis !== 'undefined' ? globalThis : window).A11Y_TOAST;
        if (TOAST) TOAST.showToast('Sorted by: ' + SORT.keyById(key).label, { type: 'info' });
    });

    apply();
}

initScanSort();
// "Where the failures are": tooltips and the keyboard-readable scan strips.
// The module ships in report.min.js; the markup carries everything it reads.
if (globalThis.A11Y_ISSUE_DISPERSION_VIEW) globalThis.A11Y_ISSUE_DISPERSION_VIEW.installDispersionInteractions(document);
initComparisonPanes();
initComparisonDashboard();
viewDetailsDialogButtons();
createDialogs();
addVisualizationModeSelector();
initAllScansDialog();
initThemeToggle();
initReportToc({
    tocContainer: '.report-toc',
    contentRoot: '.page',
    maxLevel: 3,
    includeTitle: false
});
