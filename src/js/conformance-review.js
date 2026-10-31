// The Conformance view: where a reviewer records what automation cannot
// decide, criterion by criterion, starting from the automated draft
// (shared/conformance-report.js, docs/design/conformance-report-design.md).
//
// What they record is the report's `conformanceReview`, saved in it as they
// go, so it travels with every download of the report, the conformance report
// included. Chapter 9 of EN 301 549 restates WCAG, so its clauses are not
// asked twice; its own requirements (9.6, 9.7) are asked.
// Each row can show how to check it by hand (procedures.js): a WCAG
// criterion's from core, EN 301 549's own requirements' from its pack.

const FIELDS = [
    ['name', 'Product name'],
    ['version', 'Product version'],
    ['description', 'Product description', 'textarea'],
    ['contact', 'Contact'],
    ['reviewer', 'Reviewed by'],
    ['methods', 'Evaluation methods', 'textarea'],
    ['notes', 'Notes', 'textarea'],
];

import { loadProcedures, reportLocale, buildHowToAssessHTML, answeredText, suggestFromAnswers } from './procedures.js';

// Which part of the review a table's rows are kept in.
const STORE = { 'wcag-a': 'criteria', 'wcag-aa': 'criteria', 'wcag-aaa': 'criteria', 'en-4': 'clauses', 'en-9': 'clauses', 'en-12': 'clauses', 'en-other': 'clauses' };

// The tables the review asks about: chapter 9's clauses are the WCAG
// criteria, so of chapter 9 only its own requirements (9.6, 9.7) are asked.
export function reviewTables(acr) {
    return acr.tables.filter((t) => STORE[t.id] || isOtherStandard(t))
        .map((t) => (t.id === 'en-9' ? { ...t, title: 'Chapter 9: Web, beyond the WCAG criteria', rows: t.rows.filter((r) => !r.wcag) } : t))
        .filter((t) => t.rows.length);
}

// A table of a standard besides WCAG and EN 301 549, from its pack.
function isOtherStandard(t) {
    return !!(t && t.standard && t.standard !== 'wcag' && t.standard !== 'en301549' && t.version);
}

// Where a table's rows are kept in the review: WCAG's under `criteria`, EN
// 301 549's under `clauses`, another standard's under
// `standards[key][version]`. `create` makes that place when it is missing,
// for writing; reading leaves the review as it is.
function storeOf(review, table, create = false) {
    if (STORE[table.id]) return review[STORE[table.id]];
    if (!isOtherStandard(table)) return {};
    if (!create) return review.standards?.[table.standard]?.[table.version] || {};
    review.standards = review.standards && typeof review.standards === 'object' ? review.standards : {};
    review.standards[table.standard] = review.standards[table.standard] || {};
    review.standards[table.standard][table.version] = review.standards[table.standard][table.version] || {};
    return review.standards[table.standard][table.version];
}

// The table an element of the dialog is in, as its data says.
function tableOfEl(el) {
    const holder = el.closest('[data-table]') || el.closest('[data-section]');
    return {
        id: holder.dataset.table || holder.dataset.section,
        standard: holder.dataset.standard || '',
        version: holder.dataset.version || '',
    };
}

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function emptyReview() {
    return { product: {}, criteria: {}, clauses: {} };
}

/** The review a report holds, made whole so it can be written to. */
export function reviewOf(payload) {
    const r = payload && payload.conformanceReview && typeof payload.conformanceReview === 'object'
        ? payload.conformanceReview : emptyReview();
    r.product = r.product && typeof r.product === 'object' ? r.product : {};
    r.criteria = r.criteria && typeof r.criteria === 'object' ? r.criteria : {};
    r.clauses = r.clauses && typeof r.clauses === 'object' ? r.clauses : {};
    return r;
}

// The key a row is kept under: a chapter's own line is "chapter-5".
function keyOf(table, row) {
    return table.id === 'en-other' ? `chapter-${row.id}` : row.id;
}

/** Carries an earlier review forward: shared/conformance-report.js. */
export function carryReviewForward(review, other) {
    return globalThis.A11Y_CONFORMANCE_REPORT.carryReviewForward(review, other);
}

function rowHTML(table, row, levels, saved) {
    const key = keyOf(table, row);
    const id = `acr-${table.id}-${key}`.replace(/[^A-Za-z0-9_-]/g, '-');
    const options = [`<option value="">Keep the automated draft (${esc(row.draft.conformance ? levels[row.draft.conformance] : '')})</option>`]
        .concat(Object.entries(levels).map(([value, label]) => `<option value="${value}"${saved && saved.conformance === value ? ' selected' : ''}>${esc(label)}</option>`))
        .join('');
    const name = `${esc(row.id)} ${esc(row.name)}${row.level ? ` (Level ${esc(row.level)})` : ''}`;
    return `<fieldset class="acr-row" data-table="${esc(table.id)}" data-standard="${esc(table.standard || '')}" data-version="${esc(table.version || '')}" data-key="${esc(key)}">`
        + `<legend>${table.id === 'en-other' ? esc(row.name) : name}</legend>`
        + `<p class="acr-draft"><span class="acr-draft-label">Automated draft:</span> ${esc(levels[row.draft.conformance])}. ${esc(row.draft.remarks)}</p>`
        + `<div class="acr-how" data-acr-how="${esc(row.id)}" data-acr-standard="${esc(table.standard || 'wcag')}" data-acr-version="${esc(table.version || '')}" data-acr-name="${esc(id)}-how"></div><div class="acr-suggest" data-acr-suggest></div>`
        + `<div class="acr-fields">`
        + `<div class="acr-field"><label for="${id}-level">Conformance level</label><select id="${id}-level" data-part="conformance">${options}</select></div>`
        + `<div class="acr-field acr-field--wide"><label for="${id}-remarks">Remarks and explanations</label>`
        + `<textarea id="${id}-remarks" rows="2" data-part="remarks">${esc(saved && saved.remarks)}</textarea></div>`
        + `</div></fieldset>`;
}

function tableSectionHTML(table, levels, review) {
    const part = storeOf(review, table);
    const reviewed = table.rows.filter((row) => part[keyOf(table, row)]?.conformance).length;
    return `<details class="acr-section" data-section="${esc(table.id)}" data-standard="${esc(table.standard || '')}" data-version="${esc(table.version || '')}">`
        + `<summary><span class="acr-section-title">${esc(table.title)}</span> `
        + `<span class="acr-count" data-count>${reviewed} of ${table.rows.length} reviewed</span></summary>`
        + table.rows.map((row) => rowHTML(table, row, levels, part[keyOf(table, row)])).join('')
        + `</details>`;
}

/**
 * Opens the Conformance view for `payload` (the report on screen). Every
 * change is written to payload.conformanceReview at once; `onChange` is told.
 * `readOtherReview(file)` reads another report's review from a file the
 * reviewer picks, or null when it has none.
 */
export function openConformanceReview({ payload, onChange = () => {}, readOtherReview = null } = {}) {
    const api = globalThis.A11Y_CONFORMANCE_REPORT;
    if (!api || !payload) return null;
    const review = reviewOf(payload);
    payload.conformanceReview = review;
    const levels = api.LEVEL_LABEL;

    let dialog = document.getElementById('acr-review-dialog');
    if (dialog) dialog.remove();
    dialog = document.createElement('dialog');
    dialog.id = 'acr-review-dialog';
    dialog.className = 'acr-review';
    dialog.setAttribute('aria-labelledby', 'acr-review-title');

    // The form, drawn again when a review is copied in; the head, the status
    // and the actions stay, so the status's new text is announced.
    const drawForm = () => {
        const acr = api.buildConformanceReport(payload);
        const tables = reviewTables(acr);
        const product = review.product;
        const fields = FIELDS.map(([key, label, kind]) => {
            const value = key === 'reviewer' || key === 'methods' ? review[key] : product[key];
            const placeholder = key === 'name' ? ` placeholder="${esc(acr.product.name)}"` : '';
            const control = kind === 'textarea'
                ? `<textarea id="acr-p-${key}" rows="2" data-product="${key}">${esc(value)}</textarea>`
                : `<input type="text" id="acr-p-${key}" data-product="${key}" value="${esc(value)}"${placeholder}/>`;
            return `<div class="acr-field${kind === 'textarea' ? ' acr-field--wide' : ''}"><label for="acr-p-${key}">${esc(label)}</label>${control}</div>`;
        }).join('');

        dialog.querySelector('.acr-form').innerHTML = `<fieldset class="acr-product"><legend>The product and the review</legend><div class="acr-fields">${fields}</div></fieldset>`
            + tables.map((t) => tableSectionHTML(t, levels, review)).join('');
        fillHowToAssess();
    };

    // Each row's procedure, once loaded, by its table and key.
    const procedures = new Map();
    const procedureOf = (rowEl) => procedures.get(`${rowEl.dataset.table}|${rowEl.dataset.key}`) || null;
    const entryOf = (rowEl) => storeOf(review, tableOfEl(rowEl))[rowEl.dataset.key];

    // What a criterion's answers suggest, under its checks, with a button that
    // takes it; nothing until every check is answered.
    const drawSuggestion = (rowEl) => {
        const slot = rowEl && rowEl.querySelector('[data-acr-suggest]');
        if (!slot) return;
        const entry = entryOf(rowEl);
        const row = rowOf(rowEl);
        const suggestion = suggestFromAnswers(procedureOf(rowEl), entry && entry.facets, row && row.draft);
        slot.innerHTML = suggestion
            ? `<p class="acr-suggest-text"><span class="acr-draft-label">Your answers suggest:</span> ${esc(levels[suggestion.conformance])}.</p>`
                + `<button type="button" class="secondary-button" data-acr-use>Use it, with remarks from the answers</button>`
            : '';
        const answered = rowEl.querySelector('[data-how-answered]');
        if (answered) {
            const text = answeredText(procedureOf(rowEl), entry && entry.facets);
            answered.textContent = text ? ` · ${text}` : '';
        }
    };

    // The automated draft of the row an element is in.
    const rowOf = (rowEl) => {
        const acr = api.buildConformanceReport(payload);
        const table = acr.tables.find((t) => t.id === rowEl.dataset.table);
        return table ? table.rows.find((r) => keyOf(table, r) === rowEl.dataset.key) : null;
    };

    // Each criterion's "How to check it by hand", from core's procedures, once
    // they come; none from a core without them. Each check can be answered.
    // Each standard's own requirements come from its pack: EN 301 549's in the
    // version the report targets, another's in its table's; chapter 9 of EN
    // 301 549 is the WCAG rows.
    const fillHowToAssess = async () => {
        const slots = Array.from(dialog.querySelectorAll('[data-acr-how]'));
        if (!slots.length) return;
        const locale = reportLocale(payload);
        const enVersion = api.buildConformanceReport(payload).target.en301549;
        const groups = new Map();
        for (const el of slots) {
            const standard = el.dataset.acrStandard || 'wcag';
            const version = standard === 'wcag' ? '' : (standard === 'en301549' ? enVersion : el.dataset.acrVersion);
            const key = `${standard}|${version}`;
            if (!groups.has(key)) groups.set(key, { standard, version, slots: [] });
            groups.get(key).slots.push(el);
        }
        for (const { standard, version, slots: mine } of groups.values()) {
            const loaded = await loadProcedures(mine.map((el) => el.dataset.acrHow), locale,
                standard === 'wcag' ? {} : { standard, version });
            if (!loaded) continue;
            for (const el of mine) {
                const rowEl = el.closest('.acr-row');
                if (!el.isConnected || el.firstChild || !rowEl) continue;
                procedures.set(`${rowEl.dataset.table}|${rowEl.dataset.key}`, loaded[el.dataset.acrHow] || null);
                el.innerHTML = buildHowToAssessHTML(loaded[el.dataset.acrHow], { name: el.dataset.acrName, answers: entryOf(rowEl)?.facets });
                drawSuggestion(rowEl);
            }
        }
    };

    const first = api.buildConformanceReport(payload);
    dialog.innerHTML = `<div class="acr-review-shell">`
        + `<div class="acr-review-head"><h2 id="acr-review-title">Review conformance</h2>`
        + `<button type="button" class="acr-close" data-acr-close aria-label="Close">×</button></div>`
        + `<p class="acr-intro">What automation cannot decide, decided by a person: set each criterion's conformance level and say why. `
        + `The automated draft stays where you leave it, and never says "Supports". What you record is saved in this report as you go, `
        + `and goes with it when you download it, the conformance report included.</p>`
        + `<p class="acr-status" role="status" data-acr-status>${first.totals.reviewed} of ${first.totals.criteria} WCAG criteria reviewed.</p>`
        + `<div class="acr-actions">`
        + (readOtherReview ? `<button type="button" class="secondary-button" data-acr-carry>Copy the review of another report…</button>`
            + `<input type="file" data-acr-carry-file accept=".json,application/json,.zip,application/zip" hidden aria-hidden="true" tabindex="-1"/>` : '')
        + `</div>`
        + `<form class="acr-form" novalidate></form></div>`;

    const status = (text) => {
        const el = dialog.querySelector('[data-acr-status]');
        if (el) el.textContent = text;
    };

    const recount = (section) => {
        if (!section) return;
        const part = storeOf(review, tableOfEl(section));
        const rows = section.querySelectorAll('.acr-row');
        const done = Array.from(rows).filter((r) => part[r.dataset.key]?.conformance).length;
        const count = section.querySelector('[data-count]');
        if (count) count.textContent = `${done} of ${rows.length} reviewed`;
    };

    dialog.addEventListener('input', (event) => {
        const el = event.target;
        if (el.dataset.product) {
            const key = el.dataset.product;
            const value = el.value.trim();
            if (key === 'reviewer' || key === 'methods') review[key] = value;
            else review.product[key] = value;
        } else {
            const row = el.closest('.acr-row');
            if (!row) return;
            const part = storeOf(review, tableOfEl(row), true);
            const key = row.dataset.key;
            const entry = { ...(part[key] || {}) };
            if (el.dataset.facet) {
                const facets = { ...(entry.facets || {}) };
                const facet = (procedureOf(row)?.facets || []).find((f) => f.id === el.dataset.facet);
                if (el.value) facets[el.dataset.facet] = { result: el.value, label: facet?.label || el.dataset.facet };
                else delete facets[el.dataset.facet];
                // In the procedure's order, as the report lists them.
                const order = (procedureOf(row)?.facets || []).map((f) => f.id);
                const rank = (id) => (order.indexOf(id) + 1) || order.length + 1;
                const sorted = Object.fromEntries(Object.entries(facets).sort(([a], [b]) => rank(a) - rank(b)));
                if (Object.keys(sorted).length) entry.facets = sorted;
                else delete entry.facets;
            } else {
                entry[el.dataset.part] = el.value;
            }
            if (!entry.conformance && !String(entry.remarks || '').trim() && !entry.facets) delete part[key];
            else part[key] = entry;
            recount(row.closest('.acr-section'));
            if (el.dataset.facet) drawSuggestion(row);
        }
        review.updatedAt = new Date().toISOString();
        const acr = api.buildConformanceReport(payload);
        status(`Saved in this report. ${acr.totals.reviewed} of ${acr.totals.criteria} WCAG criteria reviewed.`);
        onChange(review);
    });

    dialog.addEventListener('click', async (event) => {
        if (event.target.closest('[data-acr-close]')) {
            dialog.close();
            return;
        }
        const use = event.target.closest('[data-acr-use]');
        if (use) {
            // The suggested level, and remarks from the answers where the
            // reviewer has written none; saved as if they had chosen them.
            const rowEl = use.closest('.acr-row');
            const key = rowEl.dataset.key;
            const suggestion = suggestFromAnswers(procedureOf(rowEl), entryOf(rowEl)?.facets, rowOf(rowEl)?.draft);
            if (!suggestion) return;
            const select = rowEl.querySelector('[data-part="conformance"]');
            const remarks = rowEl.querySelector('[data-part="remarks"]');
            const wroteRemarks = remarks && !remarks.value.trim();
            if (wroteRemarks) {
                remarks.value = suggestion.remarks;
                remarks.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (select) {
                select.value = suggestion.conformance;
                select.dispatchEvent(new Event('input', { bubbles: true }));
            }
            status(`${rowEl.querySelector('legend')?.textContent || key}: set to ${levels[suggestion.conformance]}`
                + `${wroteRemarks ? ', with remarks from your answers' : '; your remarks are kept'}. Saved in this report.`);
            select?.focus();
            return;
        }
        if (event.target.closest('[data-acr-carry]')) {
            dialog.querySelector('[data-acr-carry-file]')?.click();
        }
    });

    dialog.addEventListener('change', async (event) => {
        const input = event.target.closest('[data-acr-carry-file]');
        if (!input || !input.files || !input.files[0]) return;
        const file = input.files[0];
        input.value = '';
        let other = null;
        try {
            other = await readOtherReview(file);
        } catch (err) {
            status(`Could not read ${file.name}: ${String(err && err.message || err)}`);
            return;
        }
        if (!other) {
            status(`${file.name} has no conformance review to copy.`);
            return;
        }
        const copied = carryReviewForward(review, other);
        review.updatedAt = new Date().toISOString();
        drawForm();
        onChange(review);
        status(copied
            ? `Copied ${copied} verdict${copied === 1 ? '' : 's'} from ${file.name}, where this report had none. Saved in this report.`
            : `${file.name} has no verdict this report does not already have.`);
        dialog.querySelector('[data-acr-carry]')?.focus();
    });

    drawForm();
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('#acr-p-name')?.focus();
    return dialog;
}
