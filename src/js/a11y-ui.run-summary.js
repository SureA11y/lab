'use strict';

/**
 * Run summary rendering helpers
 */

export function createRunSummaryRenderer(deps) {
    if (!deps) throw new Error('createRunSummaryRenderer: deps is required');

    const { appendLog, escapeHtml, escapeAttr, summaryEl, STATUS } = deps;

    if (typeof appendLog !== 'function') throw new Error('createRunSummaryRenderer: appendLog is required');
    if (typeof escapeHtml !== 'function') throw new Error('createRunSummaryRenderer: escapeHtml is required');
    if (typeof escapeAttr !== 'function') throw new Error('createRunSummaryRenderer: escapeAttr is required');

    function renderActionLog(actionResults) {
        if (!Array.isArray(actionResults) || !actionResults.length) return;

        appendLog('Workflow action summary:', STATUS?.INFO || 'info');

        actionResults.forEach((s) => {
            if (!s) return;

            const displayIndex =
                (typeof s.actionPath === 'string' && s.actionPath.trim())
                    ? s.actionPath.trim()
                    : ((typeof s.index === 'number' && Number.isFinite(s.index)) ? String(s.index + 1) : String(s.index));
            const baseLabel = s.label ? s.label : s.type ? s.type : 'action ' + displayIndex;
            const name = 'Action ' + displayIndex + ' (' + baseLabel + ')';
            const duration = typeof s.durationMs === 'number' && s.durationMs >= 0 ? ' in ' + s.durationMs + ' ms' : '';
            // Stamped onto the log DOM entry so the "Collected metadata" panel can jump to
            // the matching log line for a collectOutput step - see renderCollectedMetadata.
            const logOpts = (typeof s.actionPath === 'string' && s.actionPath) ? {actionPath: s.actionPath} : undefined;

            if (s.status === 'ok') {
                appendLog(name + ' completed' + duration + '.', STATUS?.OK || 'ok', logOpts);
            } else if (s.status === 'failed-optional') {
                const extra = s.error ? ': ' + s.error : '';
                appendLog(name + ' failed (optional)' + duration + extra, STATUS?.WARNING || 'warning', logOpts);
            } else if (s.status === 'failed') {
                const extra = s.error ? ': ' + s.error : '';
                appendLog(name + ' failed' + duration + extra, STATUS?.ERROR || 'error', logOpts);
            }
        });
    }

    function showOptionalActionWarnings(actionResults) {
        if (!summaryEl) return;
        if (!Array.isArray(actionResults) || !actionResults.length) return;

        const failed = actionResults.filter((s) => s && s.status === 'failed-optional');
        if (!failed.length) return;

        const box = document.createElement('div');
        box.className = 'hint';

        const itemsHtml = failed
            .map((s) => {
                const label = s.label ? ' (' + escapeHtml(s.label) + ')' : '';
                const msg = s.error ? ': ' + escapeHtml(s.error) : '';
                const displayIndex =
                    (typeof s.actionPath === 'string' && s.actionPath.trim())
                        ? s.actionPath.trim()
                        : ((typeof s.index === 'number' && Number.isFinite(s.index)) ? String(s.index + 1) : String(s.index));
                return '<li>Action ' + escapeHtml(displayIndex) + label + msg + '</li>';
            })
            .join('');

        box.innerHTML = '<strong>Some optional actions failed but the scan continued.</strong><ul>' + itemsHtml + '</ul>';

        summaryEl.prepend(box);
    }

    function renderRunDiagnostics(diag) {
        if (!diag || typeof diag !== 'object') return null;

        const hasAny =
            (Array.isArray(diag.consoleErrors) && diag.consoleErrors.length) ||
            (Array.isArray(diag.requestFailures) && diag.requestFailures.length) ||
            (Array.isArray(diag.badResponses) && diag.badResponses.length);

        if (!hasAny) return null;

        let diagnosticsElement = document.querySelector('.run-diagnostics');

        if(diagnosticsElement) {
            diagnosticsElement.innerHTML = '';
        } else {
            diagnosticsElement = document.createElement('details');
        }
        diagnosticsElement.className = 'run-diagnostics';
        diagnosticsElement.open = false;

        const total = (diag.consoleErrors?.length || 0) + (diag.requestFailures?.length || 0) + (diag.badResponses?.length || 0);

        const summary = document.createElement('summary');
        summary.textContent = `Issues during run (${total})`;
        diagnosticsElement.appendChild(summary);

        const section = (title, items, printer) => {
            if (!Array.isArray(items) || !items.length) return;

            const h = document.createElement('h3');
            h.textContent = title;

            const ul = document.createElement('ul');
            items.forEach((it) => {
                const li = document.createElement('li');
                li.innerHTML = printer(it);
                ul.appendChild(li);
            });

            diagnosticsElement.appendChild(h);
            diagnosticsElement.appendChild(ul);
        };

        section('Console errors', diag.consoleErrors, (e) => `<code>${escapeHtml(e?.text || '')}</code>`);
        section(
            'Request failures',
            diag.requestFailures,
            (r) =>
                `<code>${escapeHtml(r?.method || '')}</code> <span>${escapeHtml(r?.url || '')}</span> - ${escapeHtml(r?.failure || '')}`
        );
        section(
            'Bad responses (>= 400)',
            diag.badResponses,
            (r) =>
                `${escapeHtml(String(r?.status || ''))} <code>${escapeHtml(r?.method || '')}</code> <span>${escapeHtml(
                    r?.url || ''
                )}</span> ${escapeHtml(r?.statusText || '')}`
        );

        return diagnosticsElement;
    }

    // In-DOM row cap per key group - the underlying collectedOutputs array (and export) is
    // never truncated, only what gets rendered here. See docs/design/workflow-collected-metadata-design.md §6.3.
    const MAX_COLLECTED_ROWS_PER_GROUP = 100;

    function renderCollectedMetadata(entries, actionResults) {
        if (!Array.isArray(entries) || !entries.length) return null;

        // Actions nested inside a loop (forEachElement/repeat) have no actionResults entry
        // of their own - only the loop's container does - so renderActionLog never creates a
        // log-panel-entry with their actionPath. Only show the "view step" button when a real
        // target exists. See docs/design/workflow-collected-metadata-design.md §6.4/§9.
        const jumpableActionPaths = new Set(
            (Array.isArray(actionResults) ? actionResults : [])
                .map((r) => r && r.actionPath)
                .filter((p) => typeof p === 'string' && p)
        );

        let el = document.querySelector('.collected-metadata');
        if (el) {
            el.innerHTML = '';
        } else {
            el = document.createElement('details');
        }
        el.className = 'collected-metadata';
        el.open = false;

        const summary = document.createElement('summary');
        summary.textContent = `Collected metadata (${entries.length})`;
        el.appendChild(summary);

        const groups = Object.create(null);
        const byTag = Object.create(null);
        for (const e of entries) {
            const key = String(e?.key || '');
            (groups[key] = groups[key] || []).push(e);
            for (const t of (Array.isArray(e?.tags) ? e.tags : [])) {
                if (!t) continue;
                byTag[t] = (byTag[t] || 0) + 1;
            }
        }

        const stripBits = [`Total: ${entries.length}`];
        for (const [key, list] of Object.entries(groups)) stripBits.push(`${key}: ${list.length}`);
        for (const [tag, count] of Object.entries(byTag)) stripBits.push(`#${tag}: ${count}`);

        const strip = document.createElement('p');
        strip.className = 'collected-metadata-summary';
        strip.textContent = stripBits.join('  ·  ');
        el.appendChild(strip);

        for (const [key, list] of Object.entries(groups)) {
            const groupLabel = (list[0] && isNonEmptyStr(list[0].label)) ? list[0].label : key;

            const h = document.createElement('h3');
            h.textContent = `${groupLabel} (${list.length})`;
            el.appendChild(h);

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'collected-metadata-copy';
            copyBtn.textContent = 'Copy list';
            copyBtn.addEventListener('click', () => {
                const text = list.map((e) => String(e?.value ?? '')).join('\n');
                navigator.clipboard?.writeText(text).catch(() => {});
            });
            el.appendChild(copyBtn);

            const ul = document.createElement('ul');
            list.slice(0, MAX_COLLECTED_ROWS_PER_GROUP).forEach((e) => {
                const li = document.createElement('li');

                const valueText = String(e?.value ?? '');
                const looksLikeUrl = /^https?:\/\//i.test(valueText);
                const valueHtml = looksLikeUrl
                    ? `<a href="${escapeAttr(valueText)}" target="_blank" rel="noopener noreferrer">${escapeHtml(valueText)}</a>`
                    : `<span>${escapeHtml(valueText)}</span>`;

                const chips = [];
                if (e?.iteration && typeof e.iteration.oneBased === 'number') {
                    const totalText = (typeof e.iteration.total === 'number') ? '/' + e.iteration.total : '';
                    chips.push(`<span class="tag-pill">iter ${e.iteration.oneBased}${totalText}</span>`);
                }
                if (isNonEmptyStr(e?.url) && !looksLikeUrl) {
                    chips.push(`<a class="tag-pill" href="${escapeAttr(e.url)}" target="_blank" rel="noopener noreferrer">page</a>`);
                }
                if (e?.truncated) chips.push('<span class="tag-pill tag-pill-warning">truncated</span>');

                let jumpHtml = '';
                if (isNonEmptyStr(e?.actionPath) && jumpableActionPaths.has(e.actionPath)) {
                    jumpHtml = ` <button type="button" class="collected-metadata-jump" data-jump-action-path="${escapeAttr(e.actionPath)}">view step ↳</button>`;
                }

                li.innerHTML = `${valueHtml} ${chips.join(' ')}${jumpHtml}`;
                ul.appendChild(li);
            });
            el.appendChild(ul);

            if (list.length > MAX_COLLECTED_ROWS_PER_GROUP) {
                const more = document.createElement('p');
                more.className = 'collected-metadata-more';
                more.textContent = `…and ${list.length - MAX_COLLECTED_ROWS_PER_GROUP} more - export to see all.`;
                el.appendChild(more);
            }
        }

        el.addEventListener('click', (evt) => {
            const btn = evt.target && evt.target.closest ? evt.target.closest('[data-jump-action-path]') : null;
            if (!btn) return;
            const path = btn.getAttribute('data-jump-action-path');
            // Only meaningful while this run's action log is still in the DOM (renderActionLog
            // stamps the same actionPath onto each log entry it appends). For a step inside a
            // loop, several log lines can share one actionPath (one per iteration) - this jumps
            // to the first, which is still the right neighborhood in the log.
            const target = path ? document.querySelector(`.log-panel-entry[data-action-path="${path}"]`) : null;
            if (!target) return;
            target.scrollIntoView({behavior: 'smooth', block: 'center'});
            target.classList.add('log-panel-entry-highlight');
            setTimeout(() => target.classList.remove('log-panel-entry-highlight'), 1500);
        });

        return el;
    }

    function isNonEmptyStr(v) {
        return typeof v === 'string' && v.trim().length > 0;
    }

    return { renderActionLog, showOptionalActionWarnings, renderRunDiagnostics, renderCollectedMetadata };
}
