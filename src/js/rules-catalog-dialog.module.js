'use strict';

/**
 * Rules Catalog Dialog module
 *
 * Self-contained:
 * - Creates the <dialog> + inner DOM
 * - Appends it to document.body
 * - Fetches rules catalog
 * - Renders list
 * - Filters
 * - Opens, closes
 *
 * The dialog keeps one size while it is open, so filtering the list never
 * moves its edges or its Apply and Close buttons.
 */

import { createAdvancedDialog } from './advanced-dialog.js';

export function setupRulesCatalogDialog({
                                            STATUS = { loading: 'Loading...', ready: 'Ready', error: 'Error' },
                                            mount = document.body
                                        } = {}) {
    let lastRulesCatalog = null;
    // Normalized catalogs by engine id ('' for the default engine): the server
    // serves each one as immutable, so a second open needs no round trip.
    const catalogCache = new Map();

    const uid = Math.random().toString(36).slice(2);
    const els = createContentDom();

    const dlg = createAdvancedDialog({
        labels: {
            closeLabel: 'Close',
            acceptBtnLabel: 'Apply',
            closeBtnLabel: 'Close'
        },
        options: {
            paged: false,
            acceptBtn: true,
            closeBtn: true,
            className: 'rules-catalog-dialog'
        }
    });

    // Single-item dialog
    const item = {
        id: 'rules-catalog',
        title: 'Rules catalog',
        contentEl: els.shell,
        onOpen: () => {
            setTimeout(() => els.filter?.focus(), 0);
        }
    };
    dlg.setItems([item], 0);

    let isSelectMode = false;
    let onAcceptCb = null;
    const selectedRuleIds = new Set();

    // The engine whose catalog is shown: the scan step's, as open() is told.
    let engineId = null;
    // Each open() bumps it, so a slow response for an earlier open is dropped.
    let loadSeq = 0;
    let countTimer = null;

    function getRulesCatalogUrlForSelectedEngine() {
        return engineId
            ? `/api/engine/rules?engineId=${encodeURIComponent(engineId)}`
            : `/api/engine/rules`;
    }

    function normalizeRulesCatalogPayload(json) {
        // The server sends the engine as engines[0]; older payloads as engine.
        const engine =
            (json && typeof json === 'object' && json.engine && typeof json.engine === 'object')
                ? json.engine
                : (Array.isArray(json?.engines) && json.engines[0] && typeof json.engines[0] === 'object')
                    ? json.engines[0]
                    : null;

        const version =
            (json && typeof json.version === 'string')
                ? json.version
                : (engine?.version || null);

        const rulesIn = Array.isArray(json?.rules) ? json.rules : [];

        const strings = (v) => Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : [];

        const rules = rulesIn
            .map((r) => {
                if (!r || typeof r !== 'object') return null;

                const ruleId = (typeof r.ruleId === 'string') ? r.ruleId.trim() : '';
                if (!ruleId) return null;

                const title =
                    (typeof r.help === 'string' && r.help.trim())
                        ? r.help.trim()
                        : (typeof r.title === 'string' ? r.title.trim() : '');

                const description =
                    (typeof r.description === 'string' && r.description.trim()) ? r.description.trim() : '';

                const tags = strings(r.tags);

                // surea11y lists the criteria as wcagSc, other engines as wcag.sc.
                const wcagSc = strings(Array.isArray(r.wcagSc) ? r.wcagSc : r?.wcag?.sc);

                const helpUrl =
                    (typeof r.helpUrl === 'string' && r.helpUrl.trim()) ? r.helpUrl.trim() : '';

                const category =
                    (typeof r.category === 'string' && r.category.trim()) ? r.category.trim() : '';

                const type =
                    (typeof r.type === 'string' && r.type.trim()) ? r.type.trim() : '';

                const defaultSeverity =
                    (typeof r.defaultSeverity === 'string' && r.defaultSeverity.trim()) ? r.defaultSeverity.trim() : '';

                const defaultConfidence =
                    (typeof r.defaultConfidence === 'string' && r.defaultConfidence.trim()) ? r.defaultConfidence.trim() : '';

                return {
                    ruleId,
                    title,
                    description,
                    tags,
                    wcagSc,
                    helpUrl,
                    category,
                    type,
                    defaultSeverity,
                    defaultConfidence
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.ruleId.localeCompare(b.ruleId, undefined, { sensitivity: 'base' }));

        const ids = rules.map(r => r.ruleId);

        const has = {
            title: rules.some(r => !!r.title),
            description: rules.some(r => !!r.description),
            tags: rules.some(r => Array.isArray(r.tags) && r.tags.length),
            wcagSc: rules.some(r => Array.isArray(r.wcagSc) && r.wcagSc.length),
            helpUrl: rules.some(r => !!r.helpUrl),
            category: rules.some(r => !!r.category),
            type: rules.some(r => !!r.type),
            defaultSeverity: rules.some(r => !!r.defaultSeverity),
            defaultConfidence: rules.some(r => !!r.defaultConfidence),
        };

        return { engine, version, ids, rules, has, rawCount: rulesIn.length };
    }

    function createContentDom() {
        const filterId = `rules_catalog_filter_${uid}`;
        const countId = `rules_catalog_count_${uid}`;

        const shell = document.createElement('div');
        shell.className = 'rules-catalog';
        shell.innerHTML = `
    <div class="rules-catalog__head">
      <p class="rules-catalog__summary"></p>
      <div class="rules-catalog__search">
        <label for="${filterId}">Filter rules</label>
        <input type="search" id="${filterId}" class="rules-catalog__filter"
               placeholder="Id, title, tag or WCAG criterion"
               autocomplete="off" spellcheck="false" aria-describedby="${countId}">
      </div>
      <div class="rules-catalog__bar">
        <p class="rules-catalog__count" id="${countId}" role="status"></p>
        <div class="rules-catalog__selection" hidden>
          <p class="rules-catalog__selected" role="status"></p>
          <button type="button" class="secondary-button rules-catalog__clear">Clear selection</button>
        </div>
      </div>
    </div>

    <ul class="rules-catalog__list" role="list"></ul>
    <p class="rules-catalog__empty" hidden></p>
  `;

        return {
            shell,
            summary: shell.querySelector('.rules-catalog__summary'),
            count: shell.querySelector('.rules-catalog__count'),
            list: shell.querySelector('.rules-catalog__list'),
            empty: shell.querySelector('.rules-catalog__empty'),
            filter: shell.querySelector('.rules-catalog__filter'),
            selection: shell.querySelector('.rules-catalog__selection'),
            selectedCount: shell.querySelector('.rules-catalog__selected'),
            clear: shell.querySelector('.rules-catalog__clear'),
        };
    }

    function plural(n, one, many) {
        return `${n} ${n === 1 ? one : many}`;
    }

    function filterRules(rules, q) {
        if (!q) return rules;
        return rules.filter((r) => {
            const hay = [
                r.ruleId,
                r.title,
                r.description,
                ...(Array.isArray(r.tags) ? r.tags : []),
                ...(Array.isArray(r.wcagSc) ? r.wcagSc : []),
                r.category,
                r.type,
                r.defaultSeverity,
                r.defaultConfidence
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
    }

    // The count is a status message: set it after typing settles, so a screen
    // reader says it once rather than on every key.
    function setCount(text, { now = false } = {}) {
        clearTimeout(countTimer);
        if (now) {
            els.count.textContent = text;
            return;
        }
        countTimer = setTimeout(() => { els.count.textContent = text; }, 350);
    }

    function updateSelectedCount() {
        if (!isSelectMode) return;
        const n = selectedRuleIds.size;
        const known = new Set(lastRulesCatalog?.ids || []);
        const unlisted = lastRulesCatalog
            ? Array.from(selectedRuleIds).filter(id => !known.has(id)).length
            : 0;
        els.selectedCount.textContent = `${n} selected` +
            (unlisted ? ` (${unlisted} not in this catalog, kept)` : '');
        els.clear.disabled = n === 0;
    }

    function renderRule(r, index, has) {
        const li = document.createElement('li');
        li.className = 'rules-catalog__item';

        const baseId = `rules_catalog_${uid}_${index}`;
        const descId = `${baseId}_desc`;

        let control = null;
        if (isSelectMode) {
            control = document.createElement('input');
            control.type = 'checkbox';
            control.id = baseId;
            control.className = 'rules-catalog__check';
            control.value = r.ruleId;
            control.checked = selectedRuleIds.has(r.ruleId);

            control.addEventListener('change', () => {
                if (control.checked) selectedRuleIds.add(r.ruleId);
                else selectedRuleIds.delete(r.ruleId);
                updateSelectedCount();
            });

            li.appendChild(control);
        }

        const text = document.createElement('div');
        text.className = 'rules-catalog__text';

        // The name: the label of the checkbox in select mode.
        const name = document.createElement(control ? 'label' : 'p');
        name.className = 'rules-catalog__name';
        if (control) name.htmlFor = control.id;

        const idEl = document.createElement('code');
        idEl.className = 'rules-catalog__id';
        idEl.textContent = r.ruleId;
        name.appendChild(idEl);

        if (has.title && r.title) {
            const t = document.createElement('span');
            t.className = 'rules-catalog__title';
            t.textContent = r.title;
            name.appendChild(t);
        }

        text.appendChild(name);

        if (has.description && r.description) {
            const d = document.createElement('p');
            d.className = 'rules-catalog__desc';
            d.id = descId;
            d.textContent = r.description;
            text.appendChild(d);
            if (control) control.setAttribute('aria-describedby', descId);
        }

        const facts = [];
        if (has.wcagSc && r.wcagSc?.length) facts.push(['WCAG', r.wcagSc.join(', ')]);
        if (has.category && r.category) facts.push(['Category', r.category]);
        if (has.type && r.type) facts.push(['Type', r.type]);
        if (has.defaultSeverity && r.defaultSeverity) facts.push(['Severity', r.defaultSeverity]);
        if (has.defaultConfidence && r.defaultConfidence) facts.push(['Confidence', r.defaultConfidence]);
        if (has.tags && r.tags?.length) facts.push(['Tags', r.tags.join(', ')]);

        if (facts.length) {
            const dl = document.createElement('dl');
            dl.className = 'rules-catalog__facts';
            for (const [k, v] of facts) {
                const row = document.createElement('div');
                const dt = document.createElement('dt');
                dt.textContent = k;
                const dd = document.createElement('dd');
                dd.textContent = v;
                row.append(dt, dd);
                dl.appendChild(row);
            }
            text.appendChild(dl);
        }

        if (has.helpUrl && r.helpUrl) {
            const a = document.createElement('a');
            a.href = r.helpUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'rules-catalog__link';
            a.textContent = 'Rule documentation';
            const sr = document.createElement('span');
            sr.className = 'sr-only';
            sr.textContent = ` for ${r.ruleId} (opens in new tab)`;
            a.appendChild(sr);
            text.appendChild(a);
        }

        li.appendChild(text);
        return li;
    }

    function renderRulesCatalogList(filterText, { announceNow = false } = {}) {
        els.list.innerHTML = '';

        const bag = lastRulesCatalog || null;
        const rules = Array.isArray(bag?.rules) ? bag.rules : [];
        const has = bag?.has || {};

        const raw = String(filterText || '').trim();
        const q = raw.toLowerCase();
        const filtered = filterRules(rules, q);

        els.empty.hidden = filtered.length > 0;
        if (!filtered.length) {
            els.empty.textContent = q ? `No rules match “${raw}”.` : 'This engine lists no rules.';
            setCount(q ? 'No rules match the filter' : 'No rules', { now: announceNow });
            updateSelectedCount();
            return;
        }

        const frag = document.createDocumentFragment();
        filtered.forEach((r, i) => frag.appendChild(renderRule(r, i, has)));
        els.list.appendChild(frag);

        setCount(
            q ? `Showing ${filtered.length} of ${plural(rules.length, 'rule', 'rules')}`
              : plural(rules.length, 'rule', 'rules'),
            { now: announceNow }
        );
        updateSelectedCount();
    }

    async function loadCatalog() {
        const key = engineId || '';
        if (catalogCache.has(key)) return catalogCache.get(key);

        const res = await fetch(getRulesCatalogUrlForSelectedEngine(), { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const norm = normalizeRulesCatalogPayload(await res.json());
        catalogCache.set(key, norm);
        return norm;
    }

    async function open(opts = {}) {
        // opts:
        // - select: boolean
        // - preselectedIds: string[]
        // - onAccept: function(ids: string[]) => void
        // - engineId: the engine whose rules to list (the default engine's without)
        // - fieldLabel: the field the picked ids go to, named in the title

        engineId = (typeof opts.engineId === 'string' && opts.engineId.trim()) ? opts.engineId.trim() : null;

        isSelectMode = !!opts.select;
        onAcceptCb = (typeof opts.onAccept === 'function') ? opts.onAccept : null;

        selectedRuleIds.clear();
        if (Array.isArray(opts.preselectedIds)) {
            opts.preselectedIds
                .map(String)
                .map(s => s.trim())
                .filter(Boolean)
                .forEach(id => selectedRuleIds.add(id));
        }

        const fieldLabel = (typeof opts.fieldLabel === 'string' && opts.fieldLabel.trim()) ? opts.fieldLabel.trim() : '';
        item.title = fieldLabel ? `Rules catalog · ${fieldLabel}` : 'Rules catalog';

        els.selection.hidden = !isSelectMode;
        els.shell.classList.toggle('is-select', isSelectMode);

        // Advanced dialog footer buttons
        dlg.setAcceptVisible(isSelectMode);
        dlg.setAcceptHandler(isSelectMode ? acceptSelection : null);

        // Start from an empty list, so a previous engine's rules never show
        // while this one's load.
        lastRulesCatalog = null;
        els.filter.value = '';
        els.list.innerHTML = '';
        els.empty.hidden = true;
        els.summary.textContent = '';
        setCount(STATUS.loading, { now: true });
        updateSelectedCount();

        dlg.open(0);

        const seq = ++loadSeq;
        try {
            const norm = await loadCatalog();
            if (seq !== loadSeq) return;

            lastRulesCatalog = norm;
            const engineLabel = norm.engine?.name || norm.engine?.id || engineId || 'Default engine';
            els.summary.textContent = norm.version ? `${engineLabel} ${norm.version}` : engineLabel;

            renderRulesCatalogList(els.filter.value, { announceNow: true });
        } catch (err) {
            if (seq !== loadSeq) return;
            console.error('Rules catalog load failed', err);
            setCount(`${STATUS.error}: the rules catalog could not be loaded.`, { now: true });
        }
    }

    function close() {
        dlg.close();
        els.filter.value = '';
    }

    function acceptSelection() {
        if (!isSelectMode) return;

        const ids = Array.from(selectedRuleIds);
        try {
            if (onAcceptCb) onAcceptCb(ids);
        } finally {
            close();
        }
    }

    // Events
    els.filter.addEventListener('input', () => renderRulesCatalogList(els.filter.value));

    // Escape in a filled filter clears it rather than closing the dialog.
    els.filter.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !els.filter.value) return;
        e.preventDefault();
        e.stopPropagation();
        els.filter.value = '';
        renderRulesCatalogList('');
    });

    els.clear.addEventListener('click', () => {
        selectedRuleIds.clear();
        els.list.querySelectorAll('.rules-catalog__check').forEach((cb) => { cb.checked = false; });
        updateSelectedCount();
    });

    return {
        open,
        close,
        elements: els,
        getLastCatalog: () => lastRulesCatalog
    };
}
