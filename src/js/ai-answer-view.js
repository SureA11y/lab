// An AI answer to a "can't tell" question, and the person's own answer, as the
// report shows them (docs/design/ai-cant-tell-design.md, "In the app"). Pure:
// markup in, markup out, so the renderer and its tests share it.

const VERDICT_WORDS = { pass: 'pass', fail: 'fail', unsure: 'unsure' };

const REASON_WORDS = {
    'no-model': 'No model was available.',
    'budget-calls': "The AI's call budget for this run was used up.",
    'budget-time': "The AI's time budget for this scan was used up.",
    'model-error': 'The model could not be reached.',
    'unreadable-answer': 'The model answered in a form that could not be read.',
    unsure: 'The AI was not sure enough to answer.',
};

// What identifies a question across pages: its check and its element, not the
// page. The same element on many pages is one question and one answer.
export function aiReviewKey(node) {
    const check = (Array.isArray(node?.sourceAtomicRules) && node.sourceAtomicRules[0]) || '';
    const content = String(node?.html || '') + '|' + JSON.stringify(node?.target || []);
    let h = 5381;
    for (let i = 0; i < content.length; i++) h = ((h << 5) + h + content.charCodeAt(i)) | 0;
    return check + '|' + (h >>> 0).toString(36);
}

/**
 * Keeps a person's answer in the report's payload, by question. An answer
 * with no verdict and no note is no answer, and the last one removed takes
 * the whole entry with it.
 */
export function applyAiReview(payload, key, patch, now = new Date().toISOString()) {
    if (!payload || typeof payload !== 'object' || !key) return;
    const all = payload.aiReview && typeof payload.aiReview === 'object' ? payload.aiReview : (payload.aiReview = {});
    const next = { ...(all[key] || {}), ...patch, at: now };
    if (!next.verdict && !String(next.note || '').trim()) delete all[key];
    else all[key] = next;
    if (!Object.keys(all).length) delete payload.aiReview;
}

/** 'same', 'different', or 'unsure' (one of them is) once both have answered; else null. */
export function agreementOf(review, ai) {
    if (!review || !review.verdict || !ai || !VERDICT_WORDS[ai.verdict] || ai.provenance !== 'ai-supported') return null;
    if (review.verdict === 'unsure' || ai.verdict === 'unsure') return review.verdict === ai.verdict ? 'same' : 'unsure';
    return review.verdict === ai.verdict ? 'same' : 'different';
}

export function agreementText(agreement) {
    if (agreement === 'same') return 'Your answer is the same as the AI’s.';
    if (agreement === 'different') return 'Your answer is different from the AI’s.';
    if (agreement === 'unsure') return 'One of you is unsure.';
    return '';
}

/** Who answered: 'human' once a person has, 'ai' for a confident AI answer, 'none' for an open question. */
export function provenanceOf(node, review) {
    if (review && review.verdict) return 'human';
    return node?.ai && node.ai.provenance === 'ai-supported' ? 'ai' : 'none';
}

/** The small badge beside the lean badge: what the AI made of it. */
export function aiBadgeHtml(ai, { escapeHtml }) {
    if (!ai || typeof ai !== 'object') return '';
    const supported = ai.provenance === 'ai-supported' && VERDICT_WORDS[ai.verdict];
    return '<span class="ai-badge ai-badge-' + (supported ? ai.verdict : 'open') + '">' +
        (supported ? 'AI: ' + escapeHtml(ai.verdict) : 'AI: unresolved') + '</span>';
}

/** For a row: how many of its questions the AI answered. */
export function aiRowSummaryHtml(nodes, { escapeHtml }) {
    const list = Array.isArray(nodes) ? nodes : [];
    const withAi = list.filter((n) => n && n.ai);
    if (!withAi.length) return '';
    const answered = withAi.filter((n) => n.ai.provenance === 'ai-supported').length;
    return '<span class="ai-badge ai-badge-row">' + escapeHtml('AI answered ' + answered + ' of ' + list.length) + '</span>';
}

function factsList(evidence, { escapeHtml }) {
    const facts = evidence && evidence.facts && typeof evidence.facts === 'object' ? evidence.facts : null;
    const rows = [];
    const add = (label, value) => {
        if (value === undefined || value === null) return;
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        rows.push('<div><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(text === '' ? '(empty)' : text) + '</dd></div>');
    };
    if (facts) {
        add('Text', facts.text);
        add('Alt', facts.alt);
        add('aria-label', facts['aria-label']);
        add('Label', facts.labelText);
        add('Placeholder', facts.placeholder);
        add('Link target', facts.href || (facts.control && facts.control.href));
        add('Accessible name', facts.accessibleName ? (facts.accessibleName.name === '' ? '(none)' : facts.accessibleName.name) : undefined);
        add('Heading before', facts.nearestHeadingBefore);
        if (facts.sameTextLinks) add('Other links with this text', facts.sameTextLinks.others);
    }
    if (evidence && evidence.pageTitle) {
        add('Page title', evidence.pageTitle.title);
        add('Headings', (evidence.pageTitle.headings || []).join(' | '));
    }
    return rows.length ? '<dl class="node-details-list">' + rows.join('') + '</dl>' : '';
}

/**
 * The AI's analysis of one question and a place for the person's answer.
 * `review` is what the person has answered so far ({ verdict, note }).
 */
export function aiBlockHtml(node, review, { escapeHtml, escapeAttr }) {
    const ai = node && node.ai;
    if (!ai || typeof ai !== 'object') return '';
    const key = aiReviewKey(node);
    const supported = ai.provenance === 'ai-supported' && VERDICT_WORDS[ai.verdict];
    const r = review && typeof review === 'object' ? review : {};
    const analysis = supported
        ? '<p class="node-ai__verdict"><strong>The AI says ' + escapeHtml(ai.verdict) + '.</strong> ' +
            (typeof ai.confidence === 'number' ? '<span class="node-ai__confidence">Confidence ' + escapeHtml(String(Math.round(ai.confidence * 100))) + '%.</span>' : '') + '</p>' +
            (ai.rationale ? '<p class="node-ai__rationale">' + escapeHtml(ai.rationale) + '</p>' : '')
        : '<p class="node-ai__verdict"><strong>The AI could not settle this.</strong> ' + escapeHtml(REASON_WORDS[ai.reason] || '') + '</p>' +
            (ai.rationale ? '<p class="node-ai__rationale">' + escapeHtml(ai.rationale) + '</p>' : '');
    const facts = factsList(ai.evidence, { escapeHtml });
    const given = (facts || (ai.evidence && ai.evidence.context))
        ? '<details class="node-ai__given"><summary>What the AI was given</summary>' + facts +
            (ai.evidence && ai.evidence.context ? '<p>Around the element:</p><pre class="node-ai__context">' + escapeHtml(ai.evidence.context) + '</pre>' : '') +
            '</details>'
        : '';
    const meta = ai.model ? '<p class="node-ai__meta">Answered by ' + escapeHtml(ai.model) + (ai.reused ? ' (an earlier answer to the same question)' : '') + '. An AI answer is a suggestion: you decide.</p>' : '';
    const name = 'ai-review-' + key;
    const radios = ['pass', 'fail', 'unsure'].map((v) =>
        '<label class="ai-review__option"><input type="radio" class="ai-review-radio" name="' + escapeAttr(name) + '" value="' + v + '"' +
        ' data-ai-key="' + escapeAttr(key) + '"' + (r.verdict === v ? ' checked' : '') + '> ' + v + '</label>').join(' ');
    const agreement = agreementText(agreementOf(r, ai));
    return '<div class="node-detail node-ai" data-ai-key="' + escapeAttr(key) + '"' + (supported ? ' data-ai-verdict="' + ai.verdict + '"' : '') + '>' +
        '<h4 class="node-ai__title">AI analysis ' + aiBadgeHtml(ai, { escapeHtml }) + '</h4>' +
        analysis + given + meta +
        '<fieldset class="ai-review"><legend>Your answer</legend>' + radios +
        '<label class="ai-review__note-label">Note <input type="text" class="ai-review-note" data-ai-key="' + escapeAttr(key) + '" value="' + escapeAttr(r.note || '') + '" placeholder="Optional"></label>' +
        '<span class="ai-agree" role="status" aria-live="polite">' + escapeHtml(agreement) + '</span>' +
        '</fieldset></div>';
}
