// The review of the AI's answers (docs/design/ai-cant-tell-design.md, "In the
// app", step 3): a dialog that goes through every can't-tell question the AI
// had a go at, one card each, with what to check read from the page, a way to
// the page, and the person's own answer first; the AI's analysis follows. The
// person's answers are kept in the report (payload.aiReview), as everywhere.

import {
    agreementOf, aiAnalysisHtml, aiBadgeHtml, answerFieldsetHtml, applyAiReview, collectAiCases, keyFactRows, proofHtml,
} from './ai-answer-view.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const helpers = { escapeHtml: esc, escapeAttr: esc };

function leanHtml(lean) {
    if (!lean) return '<p class="air-lean">The tool gave no lean.</p>';
    return '<p class="air-lean"><strong>The tool leans toward ' + esc(lean.toward) + '.</strong> ' + esc(lean.why || '') +
        (lean.caution ? '<br><span class="air-hint">Caution: ' + esc(lean.caution) + '</span>' : '') + '</p>';
}

function cardHtml(c, review, revealed) {
    const r = review || {};
    const facts = keyFactRows(c.check, c.ai && c.ai.evidence, helpers);
    const factsHtml = facts.length
        ? '<dl class="air-facts">' + facts.map((x) => '<div><dt>' + esc(x.label) + '</dt><dd>' + x.html + '</dd></div>').join('') + '</dl>'
        : '<p class="air-hint">The element could not be read from the page when the AI looked. Use the page and the HTML below.</p>';
    const pages = c.urls.slice(0, 3).map((u) => '<li><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a></li>').join('');
    const steps = c.howToCheck && c.howToCheck.steps.length
        ? '<details><summary>How to check (the tool’s steps)</summary><ol>' + c.howToCheck.steps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>' +
            (c.howToCheck.passWhen ? '<p><strong>Pass when:</strong> ' + esc(c.howToCheck.passWhen) + '</p>' : '') +
            (c.howToCheck.failWhen ? '<p><strong>Fail when:</strong> ' + esc(c.howToCheck.failWhen) + '</p>' : '') + '</details>'
        : '';
    const ai = c.ai;
    const gate = revealed || r.revealed
        ? '<div class="air-ai"><h4>AI analysis and conclusion ' + aiBadgeHtml(ai, helpers) + '</h4>' + aiAnalysisHtml(ai, helpers) + '</div>'
        : '<div class="air-ai"><h4>AI analysis and conclusion</h4><p class="air-hint">Hidden until you have answered, so it does not steer you.</p>' +
            '<button type="button" class="secondary-button" data-air-reveal="' + esc(c.key) + '"' + (r.verdict ? '' : ' disabled') + '>Show the AI’s answer</button>' +
            (r.verdict ? '' : '<p class="air-hint">Choose your answer first.</p>') + '</div>';
    return '<article class="air-card" id="air-' + esc(c.key.replace(/[^a-z0-9]/gi, '-')) + '" data-ai-key="' + esc(c.key) + '">' +
        '<h3>' + esc(c.check) + ' <span class="air-title">' + esc(c.title) + (c.criterion.length ? ' · WCAG ' + esc(c.criterion.join(', ')) : '') + '</span></h3>' +
        '<p><strong>The issue:</strong> ' + esc(c.issue) + ' <span class="air-hint">Found on ' + c.urls.length + ' page' + (c.urls.length === 1 ? '' : 's') + '.</span></p>' +
        leanHtml(c.lean) +
        '<div class="air-box"><h4>What to check (read from the page)</h4>' + factsHtml + '</div>' +
        '<div class="air-box"><h4>Proof and where to look</h4>' +
        (proofHtml(c.ai && c.ai.evidence, helpers) || '<p class="air-hint">No picture: the element was not shown when the AI looked (hidden, in a menu or collapsed). Use the page and the selector.</p>') +
        (pages ? '<ul>' + pages + '</ul>' : '') +
        (c.selector ? '<p>Selector: <code>' + esc(c.selector) + '</code> <button type="button" class="copy-selector-btn" data-selector="' + esc(c.selector) + '">Copy selector</button></p>' : '') +
        '<details><summary>Element HTML</summary><pre class="air-pre">' + esc(c.html) + '</pre></details>' + steps + '</div>' +
        answerFieldsetHtml(c.key, ai, r, helpers) + gate + '</article>';
}

/**
 * Opens the review for `payload` (the report on screen). Every answer is
 * written to payload.aiReview at once; `onChange` is told.
 */
export function openAiReview({ payload, onChange = () => {} } = {}) {
    if (!payload) return null;
    const cases = collectAiCases(payload);
    if (!cases.length) return null;
    const reviews = () => (payload.aiReview && typeof payload.aiReview === 'object' ? payload.aiReview : {});
    const checks = [...new Set(cases.map((c) => c.check))];

    let dialog = document.getElementById('ai-review-dialog');
    if (dialog) dialog.remove();
    dialog = document.createElement('dialog');
    dialog.id = 'ai-review-dialog';
    dialog.className = 'acr-review';
    dialog.setAttribute('aria-labelledby', 'ai-review-title');
    dialog.innerHTML = '<div class="acr-review-shell">' +
        '<div class="acr-review-head"><h2 id="ai-review-title">Review the AI’s answers</h2>' +
        '<button type="button" class="secondary-button acr-close" data-air-close>Close</button></div>' +
        '<p class="acr-intro">For each question the scan could not decide: look at what the page says, give your answer, then see what the AI made of it. Your answers are kept in this report.</p>' +
        '<div class="air-controls">' +
        '<label>Check <select data-air-filter="check"><option value="all">all checks</option>' + checks.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select></label> ' +
        '<label>Show <select data-air-filter="state"><option value="all">all questions</option><option value="todo">not yet answered</option><option value="done">answered</option><option value="diff">where I differ from the AI</option></select></label> ' +
        '<label><input type="checkbox" data-air-first> Show the AI’s answer before I decide</label> ' +
        '<button type="button" class="secondary-button" data-air-export>Export my answers (CSV)</button>' +
        '</div>' +
        '<p class="acr-status" role="status" aria-live="polite" data-air-status></p>' +
        '<div class="air-cards" data-air-cards></div></div>';
    document.body.appendChild(dialog);

    const cardsEl = dialog.querySelector('[data-air-cards]');
    const statusEl = dialog.querySelector('[data-air-status]');
    const filter = (name) => dialog.querySelector('[data-air-filter="' + name + '"]').value;
    const aiFirst = () => dialog.querySelector('[data-air-first]').checked;
    const byKey = new Map(cases.map((c) => [c.key, c]));

    const shown = (c) => {
        if (filter('check') !== 'all' && c.check !== filter('check')) return false;
        const r = reviews()[c.key] || {};
        const state = filter('state');
        if (state === 'todo') return !r.verdict;
        if (state === 'done') return !!r.verdict;
        if (state === 'diff') return agreementOf(r, c.ai) === 'different';
        return true;
    };
    const summary = () => {
        let done = 0, same = 0, different = 0, unsure = 0, aiPassYouFail = 0, aiFailYouPass = 0;
        for (const c of cases) {
            const r = reviews()[c.key];
            if (!r || !r.verdict) continue;
            done++;
            const a = agreementOf(r, c.ai);
            if (a === 'same') same++;
            else if (a === 'different') { different++; if (c.ai.verdict === 'pass') aiPassYouFail++; else aiFailYouPass++; }
            else if (a === 'unsure') unsure++;
        }
        statusEl.textContent = done + ' of ' + cases.length + ' answered. The same as the AI: ' + same + '. Different: ' + different +
            ' (the AI said pass where you said fail: ' + aiPassYouFail + '; fail where you said pass: ' + aiFailYouPass + '). One of you unsure: ' + unsure + '.';
    };
    const draw = () => {
        const list = cases.filter(shown);
        cardsEl.innerHTML = list.length ? list.map((c) => cardHtml(c, reviews()[c.key], aiFirst())).join('') : '<p>No questions match.</p>';
        summary();
    };
    const redrawCard = (key, focusSelector) => {
        const c = byKey.get(key);
        const el = [...cardsEl.querySelectorAll('.air-card')].find((x) => x.dataset.aiKey === key);
        if (c && el) {
            const tmp = document.createElement('div');
            tmp.innerHTML = cardHtml(c, reviews()[key], aiFirst());
            el.replaceWith(tmp.firstElementChild);
            const next = [...cardsEl.querySelectorAll('.air-card')].find((x) => x.dataset.aiKey === key);
            const focus = next && next.querySelector(focusSelector);
            if (focus) focus.focus();
        }
        summary();
    };

    dialog.addEventListener('change', (event) => {
        const t = event.target;
        if (t.matches('.ai-review-radio')) {
            applyAiReview(payload, t.dataset.aiKey, { verdict: t.value });
            onChange(payload.aiReview);
            if (filter('state') === 'all') redrawCard(t.dataset.aiKey, '.ai-review-radio:checked'); else { draw(); }
        } else if (t.matches('.ai-review-note')) {
            applyAiReview(payload, t.dataset.aiKey, { note: t.value });
            onChange(payload.aiReview);
        } else if (t.matches('[data-air-filter], [data-air-first]')) {
            draw();
        }
    });
    dialog.addEventListener('click', (event) => {
        const t = event.target.closest('button');
        if (!t) return;
        if (t.matches('[data-air-close]')) { dialog.close(); return; }
        if (t.dataset.airReveal) {
            applyAiReview(payload, t.dataset.airReveal, { revealed: true });
            onChange(payload.aiReview);
            redrawCard(t.dataset.airReveal, '.air-ai h4');
            return;
        }
        if (t.matches('.copy-selector-btn')) {
            navigator.clipboard?.writeText(t.dataset.selector).catch(() => {});
            return;
        }
        if (t.matches('[data-air-export]')) {
            const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
            const head = ['check', 'page', 'selector', 'toolLean', 'yourAnswer', 'yourNote', 'aiAnswer', 'aiConfidence', 'aiRationale', 'agreement'];
            const rows = cases.map((c) => {
                const r = reviews()[c.key] || {};
                return [c.check, c.urls[0], c.selector, c.lean && c.lean.toward, r.verdict, r.note, c.ai.verdict, c.ai.confidence, c.ai.rationale, agreementOf(r, c.ai)];
            });
            const blob = new Blob([[head, ...rows].map((row) => row.map(q).join(',')).join('\n')], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ai-review-answers.csv';
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
    });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());

    draw();
    dialog.showModal();
    return dialog;
}
