// ---------------------------------------------------------------------
// Stepper module (layout + ordering + dot navigation)
// ---------------------------------------------------------------------
export class HorizontalStepper {
    /**
     * @param {HTMLElement} root
     * @param {object} [options]
     * @param {(info: {activeId: string|null, activeIndex: number, count: number}) => void} [options.onChange]
     */
    constructor(root, options = {}) {
        if (!root) throw new Error('HorizontalStepper needs a root element.');

        root.classList.add('horizontal-stepper');
        this.root = root;
        this.options = options;

        /** @type {{id: string, panelEl: HTMLElement, dotEl: HTMLButtonElement, contentEl: HTMLElement}[]} */
        this.items = [];
        this.activeId = null;

        this._build();
        this._bind();
        this._updateUI();
    }

    // ---- Public API ----

    /**
     * Adds a step.
     * @param {HTMLElement} contentEl - Your UI block element.
     * @param {{index?: number, id?: string}} [opts]
     * @returns {string} id
     */
    addStep(contentEl, opts = {}) {
        if (!contentEl) throw new Error('addStep(contentEl): contentEl is required.');

        const id = String(opts.id || crypto.randomUUID());

        const index = this._clampIndex(opts.index ?? this.items.length);

        // Build panel wrapper
        const panelEl = document.createElement('section');
        panelEl.className = 'stepper__panel';
        panelEl.setAttribute('data-action-id', id);

        // We keep your content as-is inside our panel.
        panelEl.appendChild(contentEl);

        // Build dot button
        const dotEl = document.createElement('button');
        dotEl.type = 'button';
        dotEl.className = 'stepper__dot';
        dotEl.setAttribute('data-action-id', id);
        dotEl.setAttribute('aria-current', 'false');
        dotEl.setAttribute('aria-label', 'Go to action');
        dotEl.textContent = '·';

        dotEl.addEventListener('click', () => {
            this.setActive(id, { focusDot: true });
        });

        const item = { id, panelEl, dotEl, contentEl };

        // Insert into array and DOM
        this.items.splice(index, 0, item);
        this._insertPanelAt(panelEl, index);
        this._insertDotAt(dotEl, index);

        // If nothing active, activate first item.
        if (!this.activeId) {
            this.activeId = id;
        }

        this._renumberDots();
        this._updateUI();

        // By default, if you insert at/after current, activate the inserted action.
        // Demo behavior: new actions become active.
        this.setActive(id, { focusDot: false });

        return id;
    }

    /**
     * Remove a action by id or index.
     * @param {string|number} idOrIndex
     */
    removeAction(idOrIndex) {
        const idx = this._resolveIndex(idOrIndex);
        if (idx < 0) return;

        const item = this.items[idx];
        const wasActive = item.id === this.activeId;

        item.panelEl.remove();
        item.dotEl.remove();
        this.items.splice(idx, 1);

        if (!this.items.length) {
            this.activeId = null;
            this._updateUI();
            return;
        }

        if (wasActive) {
            // Activate previous if possible, else next.
            const nextIdx = Math.min(idx, this.items.length - 1);
            const prevIdx = Math.max(0, nextIdx - 1);
            const activateIdx = (idx - 1 >= 0) ? (idx - 1) : nextIdx;
            const safeIdx = Math.max(0, Math.min(this.items.length - 1, activateIdx));
            this.activeId = this.items[safeIdx].id;
        }

        this._renumberDots();
        this._updateUI();
    }

    /**
     * Move action to a new index.
     * @param {string|number} idOrIndex
     * @param {number} toIndex
     */
    moveAction(idOrIndex, toIndex) {
        const fromIndex = this._resolveIndex(idOrIndex);
        if (fromIndex < 0) return;

        const targetIndex = this._clampIndex(toIndex);
        if (fromIndex === targetIndex) return;

        const item = this.items[fromIndex];
        this.items.splice(fromIndex, 1);
        this.items.splice(targetIndex, 0, item);

        // Move DOM: panels
        this.trackEl.removeChild(item.panelEl);
        this._insertPanelAt(item.panelEl, targetIndex);

        // Move DOM: dots
        this.dotsEl.removeChild(item.dotEl);
        this._insertDotAt(item.dotEl, targetIndex);

        this._renumberDots();
        this._updateUI();
    }

    moveLeft(idOrIndex) {
        const idx = this._resolveIndex(idOrIndex);
        if (idx <= 0) return;
        this.moveAction(idx, idx - 1);
    }

    moveRight(idOrIndex) {
        const idx = this._resolveIndex(idOrIndex);
        if (idx < 0 || idx >= this.items.length - 1) return;
        this.moveAction(idx, idx + 1);
    }

    /**
     * Set the active action.
     * @param {string|number} idOrIndex
     * @param {{focusDot?: boolean}} [opts]
     */
    setActive(idOrIndex, opts = {}) {
        const idx = this._resolveIndex(idOrIndex);
        if (idx < 0) return;

        const id = this.items[idx].id;
        this.activeId = id;

        this._updateUI();

        if (opts.focusDot) {
            this.items[idx].dotEl.focus();
        }
    }

    getActiveIndex() {
        return this.items.findIndex(it => it.id === this.activeId);
    }

    getCount() {
        return this.items.length;
    }

    getIdAt(index) {
        const idx = this._clampIndex(index);
        return this.items[idx] ? this.items[idx].id : null;
    }

    destroy() {
        window.removeEventListener('resize', this._onResize);
        this.root.innerHTML = '';
        this.items = [];
        this.activeId = null;
    }

    // ---- Internals ----

    _build() {
        this.root.innerHTML = '';

        const nav = document.createElement('div');
        nav.className = 'stepper__nav';

        const line = document.createElement('div');
        line.className = 'stepper__line';

        const dots = document.createElement('div');
        dots.className = 'stepper__dots';
        dots.setAttribute('role', 'tablist');
        dots.setAttribute('aria-label', 'Steps');

        const viewport = document.createElement('div');
        viewport.className = 'stepper__viewport';

        const track = document.createElement('div');
        track.className = 'stepper__track';

        viewport.appendChild(track);
        nav.appendChild(line);
        nav.appendChild(dots);

        this.root.appendChild(nav);
        this.root.appendChild(viewport);

        this.navEl = nav;
        this.lineEl = line;
        this.dotsEl = dots;
        this.viewportEl = viewport;
        this.trackEl = track;
    }

    _bind() {
        // Roving tabindex for dots + arrow key navigation
        this.root.addEventListener('keydown', (e) => {
            const activeDot = e.target && e.target.classList && e.target.classList.contains('stepper__dot');
            if (!activeDot) return;

            const idx = this._resolveIndex(e.target.getAttribute('data-action-id'));
            if (idx < 0) return;

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = Math.max(0, idx - 1);
                this.setActive(next, { focusDot: true });
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const next = Math.min(this.items.length - 1, idx + 1);
                this.setActive(next, { focusDot: true });
            } else if (e.key === 'Home') {
                e.preventDefault();
                this.setActive(0, { focusDot: true });
            } else if (e.key === 'End') {
                e.preventDefault();
                this.setActive(this.items.length - 1, { focusDot: true });
            }
        });

        this._onResize = () => this._updateTransform();
        window.addEventListener('resize', this._onResize);
        this.trackEl.addEventListener('focusin', (e) => {
            const panel = e.target.closest('.stepper__panel');
            if (!panel) return;

            const id = panel.getAttribute('data-action-id');
            if (!id) return;

            if (id !== this.activeId) {
                this.setActive(id, { focusDot: false });
            }
        });
    }

    _insertPanelAt(panelEl, index) {
        const before = this.trackEl.children[index] || null;
        this.trackEl.insertBefore(panelEl, before);
    }

    _insertDotAt(dotEl, index) {
        const before = this.dotsEl.children[index] || null;
        this.dotsEl.insertBefore(dotEl, before);
    }

    _renumberDots() {
        this.items.forEach((it, i) => {
            it.dotEl.textContent = String(i + 1);
            it.dotEl.setAttribute('aria-label', `Go to action ${i + 1}`);
        });

        // Update spacing behavior: if only 1 dot, keep it centered.
        this.dotsEl.style.justifyContent = (this.items.length <= 1) ? 'center' : 'space-between';
    }

    _updateUI() {
        const count = this.items.length;
        const activeIndex = this.getActiveIndex();

        this.items.forEach((it, i) => {
            const isActive = it.id === this.activeId;

            it.dotEl.setAttribute('aria-current', isActive ? 'action' : 'false');
            it.dotEl.setAttribute('role', 'tab');
            it.dotEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
            it.dotEl.tabIndex = isActive ? 0 : -1;

            // Panels are always present, but only active is "shown" to screen readers as current.
            if (isActive) {
                it.panelEl.removeAttribute('inert');
                it.panelEl.setAttribute('aria-hidden', 'false');
            } else {
                it.panelEl.setAttribute('inert', '');
                it.panelEl.setAttribute('aria-hidden', 'true');
            }
        });

        this._updateTransform();

        if (typeof this.options.onChange === 'function') {
            this.options.onChange({ activeId: this.activeId, activeIndex, count });
        }
    }

    _updateTransform() {
        // Move track so that the active panel is visible.
        const idx = this.getActiveIndex();
        const w = this.viewportEl.clientWidth || 0;
        const x = -Math.max(0, idx) * w;
        this.trackEl.style.transform = `translateX(${x}px)`;
    }

    _resolveIndex(idOrIndex) {
        if (typeof idOrIndex === 'number') {
            if (!Number.isFinite(idOrIndex)) return -1;
            if (idOrIndex < 0 || idOrIndex >= this.items.length) return -1;
            return idOrIndex;
        }

        const id = String(idOrIndex || '');
        if (!id) return -1;

        return this.items.findIndex(it => it.id === id);
    }

    _clampIndex(index) {
        const n = this.items.length;
        const i = Number(index);
        if (!Number.isFinite(i)) return n;
        return Math.max(0, Math.min(n, i));
    }
}