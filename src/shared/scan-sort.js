'use strict';

/**
 * scan-sort.js (shared)
 *
 * Sorting for scan cards. Each card carries its sortable values as data-sort-*
 * attributes; sorting reorders the card elements in place by reading those
 * attributes, so it needs no JSON and works identically in the app and in an
 * exported HTML report.
 *
 * Browser: available as globalThis.A11Y_SCAN_SORT.
 * Node:    module.exports.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_SORT = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // attr is the data-sort-<attr> a key reads; dir is the order that puts the
    // most relevant scan first.
    const SORT_KEYS = [
        { id: 'default', label: 'Default (workflow order)', attr: 'order', dir: 'asc' },
        { id: 'failures', label: 'Total failures (desc)', attr: 'failures', dir: 'desc' },
        { id: 'occurrences', label: 'Total occurrences (desc)', attr: 'occurrences', dir: 'desc' }
    ];

    function keyById(id) {
        for (const k of SORT_KEYS) {
            if (k.id === id) return k;
        }
        return SORT_KEYS[0];
    }

    function toInt(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    function failingFindings(scan) {
        const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings)
            ? scan.canonical.findings : [];
        return findings.filter((f) => f && f.outcome === 'fail');
    }

    // The numeric values a scan contributes to a card. Prefers the summary the
    // payload bakes; for reports exported before those fields existed, falls back
    // to the canonical findings. `order` is the card's position in workflow order
    // and is supplied by the renderer, not the scan.
    function scanSortValues(scan) {
        const s = scan && scan.summary ? scan.summary : {};

        let failures = Number.isFinite(s.failCount) ? s.failCount : null;
        let occurrences = Number.isFinite(s.occurrenceCount) ? s.occurrenceCount : null;

        if (failures === null || occurrences === null) {
            const fails = failingFindings(scan);
            if (failures === null) failures = fails.length;
            if (occurrences === null) {
                occurrences = fails.reduce(
                    (n, f) => n + (Array.isArray(f.occurrences) ? f.occurrences.length : 0), 0
                );
            }
        }

        return { failures: toInt(failures), occurrences: toInt(occurrences) };
    }

    function scanSortAttrs(scan, orderIndex) {
        const v = scanSortValues(scan);
        return `data-sort-order="${toInt(orderIndex)}" `
            + `data-sort-failures="${v.failures}" `
            + `data-sort-occurrences="${v.occurrences}"`;
    }

    // Compares two value objects ({order, failures, occurrences}) for a key.
    // Ties fall back to `order`, so equal cards keep their workflow order and the
    // sort is stable.
    function compareByKey(a, b, keyId) {
        const key = keyById(keyId);
        const av = toInt(a[key.attr]);
        const bv = toInt(b[key.attr]);
        let cmp = key.dir === 'desc' ? bv - av : av - bv;
        if (cmp === 0) cmp = toInt(a.order) - toInt(b.order);
        return cmp;
    }

    function readCardValues(el) {
        return {
            order: toInt(el.getAttribute('data-sort-order')),
            failures: toInt(el.getAttribute('data-sort-failures')),
            occurrences: toInt(el.getAttribute('data-sort-occurrences'))
        };
    }

    // The modal dialogs open inside `container`.
    function openModalsIn(container) {
        if (typeof container.querySelectorAll !== 'function') return [];
        return [...container.querySelectorAll('dialog[open]')].filter((d) => {
            try {
                return d.matches(':modal');
            } catch {
                return false;
            }
        });
    }

    // Moving an element out of the document and back takes a modal dialog
    // inside it out of the top layer: it stays open, but drawn in the page,
    // without its backdrop. moveBefore keeps it modal; elsewhere it is shown
    // modal again.
    function appendCards(container, cards) {
        if (typeof container.moveBefore === 'function') {
            try {
                for (const el of cards) container.moveBefore(el, null);
                return;
            } catch {
                // Falls back to appending them.
            }
        }
        const modals = openModalsIn(container);
        const frag = document.createDocumentFragment();
        for (const el of cards) frag.appendChild(el);
        container.appendChild(frag);
        modals.forEach((d) => {
            if (!d.isConnected || d.matches(':modal')) return;
            d.removeAttribute('open');
            d.showModal();
        });
    }

    // Reorders the sortable cards inside `container` (its children carrying a
    // data-sort-order) by the given key. Non-card children keep their place; the
    // cards are re-appended in sorted order, unless they already are in it: a
    // long report is drawn a few scans at a time and sorted after each batch,
    // which otherwise moved every card drawn so far.
    function sortContainer(container, keyId) {
        if (!container || !container.children) return;
        const cards = [];
        for (const el of container.children) {
            if (el.hasAttribute && el.hasAttribute('data-sort-order')) cards.push(el);
        }
        if (cards.length < 2) return;

        const sorted = cards.slice()
            .sort((a, b) => compareByKey(readCardValues(a), readCardValues(b), keyId));
        if (sorted.every((el, i) => el === cards[i])) return;

        appendCards(container, sorted);
    }

    // Applies a sort to several containers at once.
    function sortContainers(containers, keyId) {
        (Array.isArray(containers) ? containers : []).forEach((c) => sortContainer(c, keyId));
    }

    return {
        SORT_KEYS,
        keyById,
        scanSortValues,
        scanSortAttrs,
        compareByKey,
        sortContainer,
        sortContainers
    };
});
