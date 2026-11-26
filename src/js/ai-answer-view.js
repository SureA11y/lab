// An AI answer to a "can't tell" question, and the person's own answer, as the
// report shows them (docs/design/ai-cant-tell-design.md, "In the app"). Pure:
// markup in, markup out, so the renderer and its tests share it.

const escapeText = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

const VERDICT_WORDS = { pass: 'pass', fail: 'fail', unsure: 'unsure' };

const REASON_WORDS = {
    'no-model': 'No model was available.',
    'budget-calls': "The AI's call budget for this run was used up.",
    'budget-time': "The AI's time budget for this scan was used up.",
    'model-error': 'The model could not be reached.',
    'unreadable-answer': 'The model answered in a form that could not be read.',
    unsure: 'The AI was not sure enough to answer.',
    preview: 'A preview: the question was not sent.',
    'site-not-allowed': 'Not sent: this site is not among the sites the server allows.',
    'no-focus-stops': 'The focus walk reached no element: Tab moved focus nowhere on the page.',
    'state-drift': 'The page changed while it was read, so the answer was not kept.',
    'pass-needs-person': 'The AI found nothing out of reach, but reaching is not using: whether each control works with Enter, Space and the arrow keys needs a person.',
};

/**
 * The log of what the AI pass sent, or a preview would send, across the
 * report's scans: each entry with its scan's label. Empty when none was kept.
 */
export function outboxOf(payload) {
    const out = [];
    for (const scan of Array.isArray(payload && payload.scans) ? payload.scans : []) {
        const box = scan && scan.canonical && scan.canonical.ai && scan.canonical.ai.outbox;
        if (!Array.isArray(box)) continue;
        for (const entry of box) if (entry && typeof entry === 'object') out.push({ scan: scan.label || scan.url || '', ...entry });
    }
    return out;
}

// What identifies a question across pages: its check and its element, not the
// page. The same element on many pages is one question and one answer. A
// page-level question (the focus questions, tier 1) is the page's own: its
// check and its page.
export function aiReviewKey(node) {
    const ai = node && node.ai;
    const pageLevel = !!(ai && ai.tier === 1 && ai.check && ai.page);
    // A walk question about one element is named by its own check: the
    // scanner asks one element for several criteria (2.4.7 and 2.4.13).
    const check = (ai && ai.tier === 1 && ai.check) ? ai.check : ((Array.isArray(node?.sourceAtomicRules) && node.sourceAtomicRules[0]) || '');
    const content = pageLevel ? 'page|' + ai.page : String(node?.html || '') + '|' + JSON.stringify(node?.target || []);
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

// The picture of the element the AI pass took, as it is put in an attribute:
// inline (a data URL), a file the lab serves (/reports/...: a saved run moves
// its pictures out of the report), or a picture of an opened zip (blob:), as
// the other pictures of the report are. Anything else is not shown.
function proofSrc(evidence) {
    const s = evidence && evidence.screenshot;
    if (typeof s !== 'string') return null;
    if (/^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(s)) return s;
    if (/^\/reports\/[A-Za-z0-9._\/-]+\.(jpe?g|png)$/.test(s) && !s.includes('..')) return s;
    if (/^blob:https?:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9-]+$/.test(s)) return s;
    return null;
}

/** The element's picture, as proof beside the facts; for a focus walk, its stops. Empty when there is none. */
export function proofHtml(evidence, { escapeAttr, escapeHtml = escapeAttr }) {
    if (evidence && evidence.focusWalk) return focusWalkHtml(evidence.focusWalk, { escapeHtml, escapeAttr });
    const src = proofSrc(evidence);
    return src ? '<img class="air-shot" alt="The element as it looked when the AI read the page" src="' + escapeAttr(src) + '">' : '';
}

/** How a focus walk ended, in words. */
export function focusWalkEnd(walk) {
    if (!walk) return '';
    if (walk.ended === 'left-page') return 'Focus left the page after the last stop.';
    if (walk.ended === 'came-back') return 'Focus came back to stop ' + walk.endedAt + ' (it may be trapped in a loop).';
    if (walk.ended === 'limit') return 'The walk stopped at its limit of ' + walk.limit + ' stops; the page may have more.';
    if (walk.ended === 'stuck-inside') return 'Focus stayed inside stop ' + walk.endedAt + ' (a frame or a player) for 20 Tab presses: it may be trapped there.';
    return 'The walk could not be done.';
}

// A stop's name, for a list.
function stopName(s) {
    return (s.role || s.tag) + (s.name ? ' “' + s.name + '”' : ' (no name)');
}

const FOCUS_CHECKS = new Set(['focus-visible', 'focus-order', 'focus-not-obscured', 'focus-not-obscured-enhanced-page', 'focus-appearance', 'keyboard',
    'focus-visible-element', 'focus-appearance-element', 'focus-contrast-element', 'keyboard-element', 'focus-not-obscured-box', 'focus-not-obscured-enhanced-box']);

// How much of a stop something was on top of, in words.
function coverText(s) {
    const share = typeof s.coveredShare === 'number' ? Math.round(s.coveredShare * 100) + '% ' : '';
    return share + 'covered by ' + (s.covered || 'something');
}

// A stop's 2.4.13 measurement, in words.
function appearanceText(a) {
    if (!a) return '';
    if (a.skipped) return { 'too-big': 'too large to measure', 'focused-before': 'had focus before the walk, not measured' }[a.skipped] || 'not measured';
    return a.atContrast + ' px changed at 3:1 or more, ' + a.needed + ' px needed';
}

// What an image shows, read from its pixels, in words.
function lookText(look) {
    if (!look.readable) return 'could not be read (' + (look.why || 'unknown') + ')';
    if (look.blank) return 'nothing: fully transparent (a spacer)';
    const main = look.mainColour ? ', mostly ' + look.mainColour + ' (' + Math.round((look.mainColourShare || 0) * 100) + '%)' : '';
    return (look.colours === 1 ? 'one colour' : look.colours + ' colours') + main + (look.transparentShare ? ', ' + Math.round(look.transparentShare * 100) + '% transparent' : '');
}

// A control Tab cannot reach, in words.
function unreachableText(u) {
    return (u.role || u.tag) + (u.name ? ' “' + u.name + '”' : '') + ' (' + u.selector + ', at ' + u.x + ', ' + u.y + '): ' + u.why + '.';
}

// What the open walk saw for one control it pressed, in a sentence.
function openedText(c) {
    const who = (c.role || c.tag) + (c.name ? ' “' + c.name + '”' : '');
    if (c.skipped) return who + ': could not take focus, not pressed.';
    const parts = [];
    if (!c.activated) {
        parts.push(c.key + ' did nothing');
        if (c.enter) parts.push(c.enter.activated ? 'Enter worked' : 'Enter did nothing too');
    } else parts.push(c.key + ' worked');
    const leave = (c.enter && c.enter.wouldLeave) || c.wouldLeave;
    if (leave && leave.length) parts.push('it would go to ' + leave[0] + ' (stopped)');
    if (c.opened) {
        const o = c.opened;
        parts.push('opened ' + (o.dialog ? 'a dialog' : 'content') + ' with ' + o.focusable + ' control' + (o.focusable === 1 ? '' : 's') + ' that can take focus');
        parts.push('focus then ' + ({ control: 'stayed on the control', inside: 'moved into it', nowhere: 'went nowhere', elsewhere: 'went elsewhere' }[c.focusAfter] || 'unknown'));
        if (c.tabs) parts.push(c.tabs.reachedInside ? 'Tab reached into it after ' + c.tabs.reachedInside + (c.tabs.leftAfter ? ' and left it after ' + c.tabs.leftAfter + ' (to ' + ({ control: 'the control', elsewhere: 'the page behind', nowhere: 'outside the page' }[c.tabs.leftTo] || c.tabs.leftTo) + ')' : ' and stayed in it') : 'Tab never reached into it');
        parts.push(o.close ? 'its close control “' + o.close.name + '” ' + (o.close.focusable ? 'can' : 'cannot') + ' take focus' : 'no close control found');
        parts.push('Escape ' + (c.escapeCloses ? 'closed it' : 'did not close it'));
    } else if (c.activated && c.expanded && c.expanded[0] !== c.expanded[1]) parts.push('aria-expanded went from ' + c.expanded[0] + ' to ' + c.expanded[1] + ', nothing new showed');
    return who + ' (' + c.why + '): ' + parts.join('; ') + '.';
}

function openedHtml(walk, { escapeHtml }) {
    const o = walk && walk.opened;
    if (!o || !Array.isArray(o.controls)) return '';
    const head = 'Controls that open something, pressed (' + o.tried + (o.total > o.controls.length ? ' of ' + o.total : '') + ')' + (o.leftChanged ? '; the page was left changed (' + o.leftChanged.join(', ') + ')' : '') + ':';
    return '<p class="air-hint"><strong>' + escapeHtml(head) + '</strong></p>' +
        (o.controls.length ? '<ul class="air-unreachable">' + o.controls.map((c) => '<li>' + escapeHtml(openedText(c)) + '</li>').join('') + '</ul>' : '<p class="air-hint">' + escapeHtml('None found.') + '</p>');
}

// Where a stop is: its landmark and the heading it comes under.
function stopPlace(s) {
    return [s.landmark ? 'in ' + s.landmark : '', s.heading ? 'under ' + s.heading : ''].filter(Boolean).join(', ');
}

/**
 * The page's picture with the stops numbered on it and joined in Tab order,
 * drawn over the picture (the page itself was never drawn on). Empty without
 * a picture.
 */
export function focusMapHtml(walk, { escapeHtml, escapeAttr = escapeHtml }) {
    const map = walk && walk.map;
    const src = proofSrc(map);
    const W = map && Number(map.width);
    const H = map && Number(map.height);
    if (!src || !(W > 0) || !(H > 0)) return '';
    const points = (Array.isArray(walk.stops) ? walk.stops : [])
        .filter((s) => !s.hidden && s.width > 0 && s.height > 0 && s.x < W && s.y < H)
        .map((s) => ({ n: Number(s.n), x: Math.round(s.x + s.width / 2), y: Math.round(s.y + s.height / 2) }));
    const missed = (walk.unreachable && Array.isArray(walk.unreachable.items) ? walk.unreachable.items : [])
        .filter((u) => u.width > 0 && u.height > 0 && u.x < W && u.y < H);
    if (!points.length && !missed.length) return '';
    const r = Math.max(8, Math.round(W / 50));
    const boxes = missed.map((u) => '<rect class="air-map__miss" x="' + Number(u.x) + '" y="' + Number(u.y) + '" width="' + Number(u.width) + '" height="' + Number(u.height) +
        '" stroke-width="' + Math.max(2, Math.round(r / 4)) + '" stroke-dasharray="' + r / 2 + ' ' + r / 3 + '"/>').join('');
    const path = points.length > 1 ? '<polyline class="air-map__line" points="' + points.map((p) => p.x + ',' + p.y).join(' ') + '" stroke-width="' + Math.max(2, Math.round(r / 4)) + '"/>' : '';
    const marks = points.map((p) => '<g class="air-map__stop"><circle cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"/>' +
        '<text x="' + p.x + '" y="' + p.y + '" font-size="' + Math.round(r * 1.1) + '" dy="0.36em">' + escapeHtml(String(p.n)) + '</text></g>').join('');
    const left = (walk.stops || []).length - points.length;
    return '<figure class="air-map"><div class="air-map__scroll"><div class="air-map__frame">' +
        '<img class="air-map__page" src="' + escapeAttr(src) + '" alt="The page, with its focus stops numbered and joined in Tab order. The list gives them in words.">' +
        '<svg class="air-map__over" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + boxes + path + marks + '</svg>' +
        '</div></div><figcaption class="air-hint">' + escapeHtml('The order at a glance: ' + points.length + ' stop' + (points.length === 1 ? '' : 's') + ' on the page' +
        (left > 0 ? ', ' + left + ' not shown (hidden or beyond the picture)' : '') +
        (missed.length ? '; dashed boxes: ' + missed.length + ' control' + (missed.length === 1 ? '' : 's') + ' usable by mouse that Tab never reached' : '') + '.') + '</figcaption></figure>';
}

/**
 * The focus walk, stop by stop: where focus went, what showed it, what
 * covered it, and the stop's picture. As the person checks the AI's answer.
 */
export function focusWalkHtml(walk, { escapeHtml, escapeAttr = escapeHtml }) {
    const stops = walk && Array.isArray(walk.stops) ? walk.stops : [];
    if (!stops.length) return '<p class="air-hint">' + escapeHtml(focusWalkEnd(walk) || 'The focus walk reached no element.') + '</p>';
    const items = stops.map((s) => {
        const src = proofSrc(s);
        const changes = Array.isArray(s.changesOnFocus)
            ? (s.changesOnFocus.length ? 'Focus shows as: ' + s.changesOnFocus.join(', ') + '.' : 'No visible change found on focus.')
            : '';
        const appearance = s.appearance ? 'Indicator: ' + appearanceText(s.appearance) + (typeof s.appearance.meets === 'boolean' ? (s.appearance.meets ? ' (meets 2.4.13).' : ' (short of 2.4.13).') : '.') : '';
        const notes = [changes, appearance, s.covered ? coverText(s).replace(/^./, (c) => c.toUpperCase()) + ' while focused.' : '', s.hidden ? 'Not visible while focused.' : '', s.insideFrame ? 'Focus went on inside it (a frame or a player\'s own controls)' + (s.pressesInside ? ', ' + s.pressesInside + ' Tab presses' : '') + '.' : '']
            .filter(Boolean).join(' ');
        return '<li class="air-stop' + (Array.isArray(s.changesOnFocus) && !s.changesOnFocus.length ? ' air-stop--none' : '') + '">' +
            '<span class="air-stop__name">' + escapeHtml(stopName(s)) + '</span> ' +
            '<span class="air-hint">' + escapeHtml((stopPlace(s) ? stopPlace(s) + ', ' : '') + 'at ' + s.x + ', ' + s.y + '. ' + notes) + '</span>' +
            (src ? '<img class="air-shot air-stop__shot" alt="Stop ' + escapeAttr(String(s.n)) + ' while focused" src="' + escapeAttr(src) + '">' : '') + '</li>';
    }).join('');
    return '<p class="air-hint">' + escapeHtml(stops.length + ' stop' + (stops.length === 1 ? '' : 's') + ' with Tab from the top of the page. ' + focusWalkEnd(walk)) + '</p>' +
        focusMapHtml(walk, { escapeHtml, escapeAttr }) +
        '<ol class="air-stops">' + items + '</ol>' + unreachableHtml(walk, { escapeHtml }) + openedHtml(walk, { escapeHtml });
}

// The controls Tab never reached, under the stops; nothing when none were found.
function unreachableHtml(walk, { escapeHtml }) {
    const un = walk && walk.unreachable;
    if (!un || !Array.isArray(un.items) || !un.items.length) return '';
    return '<p class="air-hint"><strong>' + escapeHtml('Usable by mouse, never reached with Tab (' + un.total + '):') + '</strong></p>' +
        '<ul class="air-unreachable">' + un.items.map((u) => '<li>' + escapeHtml(unreachableText(u)) + '</li>').join('') + '</ul>' +
        (un.total > un.items.length ? '<p class="air-hint">' + escapeHtml('And ' + (un.total - un.items.length) + ' more.') + '</p>' : '');
}

/** The AI's reasoning on one question, and what it was given. Empty without an AI answer. */
export function aiAnalysisHtml(ai, { escapeHtml, escapeAttr = escapeHtml }) {
    if (!ai || typeof ai !== 'object') return '';
    const supported = ai.provenance === 'ai-supported' && VERDICT_WORDS[ai.verdict];
    const analysis = supported
        ? '<p class="node-ai__verdict"><strong>The AI says ' + escapeHtml(ai.verdict) + '.</strong> ' +
            (typeof ai.confidence === 'number' ? '<span class="node-ai__confidence">Confidence ' + escapeHtml(String(Math.round(ai.confidence * 100))) + '%.</span>' : '') + '</p>' +
            (ai.rationale ? '<p class="node-ai__rationale">' + escapeHtml(ai.rationale) + '</p>' : '')
        : '<p class="node-ai__verdict"><strong>The AI could not settle this.</strong> ' + escapeHtml(REASON_WORDS[ai.reason] || '') + '</p>' +
            (ai.rationale ? '<p class="node-ai__rationale">' + escapeHtml(ai.rationale) + '</p>' : '');
    const facts = factsList(ai.evidence, { escapeHtml });
    const given = (facts || (ai.evidence && (ai.evidence.context || ai.evidence.focusWalk || proofSrc(ai.evidence))))
        ? '<details class="node-ai__given"><summary>' + (ai.model ? 'What the AI was given' : 'What was read from the page') + '</summary>' + proofHtml(ai.evidence, { escapeAttr, escapeHtml }) + facts +
            (ai.evidence && ai.evidence.context ? '<p>Around the element:</p><pre class="node-ai__context">' + escapeHtml(ai.evidence.context) + '</pre>' : '') +
            '</details>'
        : '';
    const meta = ai.model ? '<p class="node-ai__meta">Answered by ' + escapeHtml(ai.model) + (ai.reused ? ' (an earlier answer to the same question)' : '') + '. An AI answer is a suggestion: you decide.</p>' : '';
    return analysis + given + meta;
}

/**
 * What the report says about a question once a person and/or the AI have
 * answered it: { source: 'reviewer'|'ai', verdict, reason, differs } or null
 * while it is open. A reviewer's pass or fail is the resolved result; the
 * tool's own outcome is never changed. "unsure" resolves nothing.
 */
export function resolvedOf(review, ai) {
    const r = review && typeof review === 'object' ? review : {};
    if (r.verdict === 'pass' || r.verdict === 'fail') {
        return { source: 'reviewer', verdict: r.verdict, reason: String(r.note || '').trim(), differs: agreementOf(r, ai) === 'different' };
    }
    if (ai && ai.provenance === 'ai-supported' && (ai.verdict === 'pass' || ai.verdict === 'fail') && r.verdict !== 'unsure') {
        return { source: 'ai', verdict: ai.verdict, reason: String(ai.rationale || '').trim(), differs: false };
    }
    return null;
}

/** The reason is asked for when the person differs from the AI or is unsure and has not said why. */
export function whyHint(agreement, note) {
    if ((agreement === 'different' || agreement === 'unsure') && !String(note || '').trim()) {
        return agreement === 'different'
            ? 'Please say why you differ from the AI. It becomes the explanation in the report and teaches the AI.'
            : 'Please say what makes it hard to tell.';
    }
    return '';
}

/** "Resolved: Fail, confirmed by a reviewer. Reason: ..." or an empty string while open. */
export function resolvedHtml(review, ai, { escapeHtml }) {
    const res = resolvedOf(review, ai);
    if (!res) return '';
    const word = res.verdict === 'fail' ? 'Fail' : 'Pass';
    const byPerson = res.source === 'reviewer';
    return '<p class="ai-resolved ai-resolved--' + res.source + ' ai-resolved--' + res.verdict + '"><strong>Resolved: ' + word + '</strong>, ' +
        (byPerson ? 'confirmed by a reviewer' : 'by the AI, not yet confirmed by a person') +
        (res.reason ? '. ' + (byPerson ? 'Reason: ' : 'The AI’s reasoning: ') + escapeHtml(res.reason) : (byPerson && res.verdict === 'fail' ? '. No reason given yet.' : '')) + '</p>';
}

/** Keeps an answer block's agreement line, reason prompt and resolved line in step with its inputs. */
export function syncAnswerFieldset(fieldset, { escapeHtml = escapeText } = {}) {
    if (!fieldset) return;
    const checked = fieldset.querySelector('.ai-review-radio:checked');
    const note = fieldset.querySelector('.ai-review-note');
    const ai = { verdict: fieldset.dataset.aiVerdict || '', provenance: fieldset.dataset.aiVerdict ? 'ai-supported' : '', rationale: fieldset.dataset.aiRationale || '' };
    const review = { verdict: checked ? checked.value : '', note: note ? note.value : '' };
    const agreement = agreementOf(review, ai);
    const status = fieldset.querySelector('.ai-agree');
    if (status) status.textContent = agreementText(agreement);
    const hint = whyHint(agreement, review.note);
    const hintEl = fieldset.querySelector('.ai-why-hint');
    if (hintEl) hintEl.textContent = hint;
    fieldset.classList.toggle('ai-review--needs-why', !!hint);
    if (note) note.setAttribute('aria-invalid', hint ? 'true' : 'false');
    const slot = fieldset.querySelector('.ai-resolved-slot');
    if (slot) slot.innerHTML = resolvedHtml(review, ai, { escapeHtml });
}

/** "Your answer": pass, fail or unsure, why, and whether it agrees with the AI. */
export function answerFieldsetHtml(key, ai, review, { escapeHtml, escapeAttr }) {
    const r = review && typeof review === 'object' ? review : {};
    const name = 'ai-review-' + key;
    const radios = ['pass', 'fail', 'unsure'].map((v) =>
        '<label class="ai-review__option"><input type="radio" class="ai-review-radio" name="' + escapeAttr(name) + '" value="' + v + '"' +
        ' data-ai-key="' + escapeAttr(key) + '"' + (r.verdict === v ? ' checked' : '') + '> ' + v + '</label>').join(' ');
    const agreement = agreementOf(r, ai);
    const hint = whyHint(agreement, r.note);
    const supported = ai && ai.provenance === 'ai-supported' && VERDICT_WORDS[ai.verdict];
    return '<fieldset class="ai-review' + (hint ? ' ai-review--needs-why' : '') + '"' +
        (supported ? ' data-ai-verdict="' + escapeAttr(ai.verdict) + '"' : '') +
        (supported && ai.rationale ? ' data-ai-rationale="' + escapeAttr(ai.rationale) + '"' : '') + '><legend>Your answer</legend>' + radios +
        '<label class="ai-review__note-label">Why <span class="ai-review__note-opt">(needed when you differ from the AI; it is the explanation in the report)</span>' +
        '<input type="text" class="ai-review-note" data-ai-key="' + escapeAttr(key) + '" value="' + escapeAttr(r.note || '') + '" placeholder="For example: the alt text is only the file name" aria-invalid="' + (hint ? 'true' : 'false') + '"></label>' +
        '<span class="ai-why-hint" role="status" aria-live="polite">' + escapeHtml(hint) + '</span>' +
        '<span class="ai-agree" role="status" aria-live="polite">' + escapeHtml(agreementText(agreement)) + '</span>' +
        '<span class="ai-resolved-slot">' + resolvedHtml(r, ai, { escapeHtml }) + '</span>' +
        '</fieldset>';
}

/**
 * The AI's analysis of one question and a place for the person's answer.
 * `review` is what the person has answered so far ({ verdict, note }).
 */
export function aiBlockHtml(node, review, helpers) {
    const ai = node && node.ai;
    if (!ai || typeof ai !== 'object') return '';
    const key = aiReviewKey(node);
    const supported = ai.provenance === 'ai-supported' && VERDICT_WORDS[ai.verdict];
    return '<div class="node-detail node-ai" data-ai-key="' + helpers.escapeAttr(key) + '"' + (supported ? ' data-ai-verdict="' + ai.verdict + '"' : '') + '>' +
        '<h4 class="node-ai__title">AI analysis ' + aiBadgeHtml(ai, helpers) + '</h4>' +
        aiAnalysisHtml(ai, helpers) + answerFieldsetHtml(key, ai, review, helpers) + '</div>';
}

/**
 * Every can't-tell question of a report the AI had a go at, once each (the
 * same element on many pages is one), for the review view.
 */
export function collectAiCases(payload) {
    const byKey = new Map();
    for (const scan of Array.isArray(payload && payload.scans) ? payload.scans : []) {
        for (const f of [...((scan && scan.canonical && scan.canonical.findings) || []), ...((scan && scan.canonical && scan.canonical.bestPractices) || [])]) {
            if (!f || f.outcome !== 'cantTell') continue;
            for (const o of f.occurrences || []) {
                if (!o || !o.ai || typeof o.ai !== 'object') continue;
                const node = { sourceAtomicRules: [o.atomicCheckId || ''], html: o.html || '', target: Array.isArray(o.target) ? o.target : [], ai: o.ai };
                const key = aiReviewKey(node);
                const urls = o.ai.tier === 1 && o.ai.page ? [o.ai.page]
                    : Array.isArray(o.pageUrls) && o.pageUrls.length ? o.pageUrls : (o.pageUrl ? [o.pageUrl] : (scan.url ? [scan.url] : []));
                let c = byKey.get(key);
                if (!c) {
                    c = {
                        key, check: o.ai.check || o.atomicCheckId || '', title: f.title || f.ruleId || '', criterion: (f.wcag && f.wcag.sc) || [],
                        issue: o.failureSummary || '', hint: o.hint || '',
                        lean: o.lean && (o.lean.toward === 'fail' || o.lean.toward === 'pass') ? o.lean : null,
                        howToCheck: o.howToCheck && Array.isArray(o.howToCheck.steps) ? o.howToCheck : null,
                        selector: node.target[0] || '', html: node.html, ai: o.ai, urls: [],
                    };
                    byKey.set(key, c);
                }
                for (const u of urls) if (u && !c.urls.includes(u)) c.urls.push(u);
            }
        }
    }
    return [...byKey.values()];
}

/**
 * "What to check, read from the page": the values a person judges, labelled,
 * from the evidence the AI was given. A list of { label, html } rows.
 */
export function keyFactRows(check, evidence, { escapeHtml }) {
    const q = (v, none) => {
        if (v === undefined || v === null) return '<span class="air-none">' + escapeHtml(none || '(none)') + '</span>';
        if (v === '') return '<span class="air-none">(empty)</span>';
        return '<q>' + escapeHtml(v) + '</q>';
    };
    const code = (v) => '<code>' + escapeHtml(v) + '</code>';
    const nameOf = (f) => {
        if (!f.accessibleName) return q(undefined, '(not available)');
        const n = f.accessibleName.name;
        return (n === '' || n == null) ? '<span class="air-none">(none: nothing gives it a name)</span>' : q(n) + ' <span class="air-hint">as ' + escapeHtml(f.accessibleName.role || 'element') + '</span>';
    };
    const ev = evidence && typeof evidence === 'object' ? evidence : {};
    const f = ev.facts && typeof ev.facts === 'object' ? ev.facts : null;
    const rows = [];
    const add = (label, html) => rows.push({ label, html });
    const walk = ev.focusWalk;
    if (walk && FOCUS_CHECKS.has(check)) {
        const stops = Array.isArray(walk.stops) ? walk.stops : [];
        const list = (xs) => xs.length ? xs.map((s) => escapeHtml(s.n + '. ' + stopName(s))).join('<br>') : '';
        add('Stops with Tab', escapeHtml(String(stops.length)) + ' <span class="air-hint">' + escapeHtml(focusWalkEnd(walk)) + '</span>');
        const target = ev.target;
        const own = target && target.stop ? stops.find((x) => x.n === target.stop) : null;
        if (/-element$|-box$/.test(check) && (!target || !target.found)) {
            add('This element', '<span class="air-none">(not found on the page after the walk)</span>');
        } else if (check === 'focus-visible-element' || check === 'focus-appearance-element' || check === 'focus-contrast-element') {
            add('This element', own ? escapeHtml('Stop ' + own.n + ': ' + stopName(own)) : '<span class="air-none">(never reached with Tab)</span>');
            if (own && check === 'focus-visible-element') {
                add('Shows focus as', Array.isArray(own.changesOnFocus) && own.changesOnFocus.length ? escapeHtml(own.changesOnFocus.join(', ')) : '<span class="air-none">(no visible change found)</span>');
            }
            if (own && check === 'focus-appearance-element') add('Indicator', escapeHtml(appearanceText(own.appearance) || 'not measured'));
            if (own && check === 'focus-contrast-element') {
                const a = own.appearance;
                add('Indicator contrast', !a || a.skipped ? escapeHtml(appearanceText(a) || 'not measured')
                    : !a.changed ? '<span class="air-none">(no visible change on focus: no indicator)</span>'
                        : escapeHtml(a.atContrast + ' of ' + a.changed + ' px that changed are at 3:1 or more against what was there' + (a.oneLine ? '; a 1 px line around it is ' + a.oneLine + ' px' : '')));
            }
        } else if (check === 'keyboard-element') {
            add('Reached with Tab', own ? escapeHtml('Yes, at stop ' + own.n) : '<strong>' + escapeHtml('No') + '</strong>' + (target.unreachable ? ' <span class="air-hint">' + escapeHtml('(' + target.unreachable + ')') + '</span>' : ''));
            add('Still to check by hand', escapeHtml('Whether it works with Enter, Space or the arrow keys, and whether the page offers another way to do the same with the keyboard.'));
        } else if (check === 'focus-not-obscured-box' || check === 'focus-not-obscured-enhanced-box') {
            const covered = stops.filter((x) => (target.coveredStops || []).includes(x.n));
            const counts = check === 'focus-not-obscured-box' ? covered.filter((x) => x.coveredShare === 1) : covered;
            add(check === 'focus-not-obscured-box' ? 'Stops it hid entirely' : 'Stops it hid, in part or entirely', counts.length ? counts.map((x) => escapeHtml(x.n + '. ' + stopName(x) + ', ' + coverText(x))).join('<br>') : '<span class="air-none">(none found)</span>');
            if (check === 'focus-not-obscured-box' && covered.length > counts.length) add('Stops it hid in part (fine for 2.4.11)', covered.filter((x) => x.coveredShare !== 1).map((x) => escapeHtml(x.n + '. ' + stopName(x) + ', ' + coverText(x))).join('<br>'));
        } else if (check === 'focus-visible') {
            const none = stops.filter((s) => Array.isArray(s.changesOnFocus) && !s.changesOnFocus.length);
            const hidden = stops.filter((s) => s.hidden);
            add('No visible change found', list(none) || '<span class="air-none">(every stop changed when focused)</span>');
            if (hidden.length) add('Not visible while focused', list(hidden));
        } else if (check === 'keyboard') {
            const un = walk.unreachable && Array.isArray(walk.unreachable.items) ? walk.unreachable : null;
            add('Usable by mouse, not reachable with Tab', !un ? '<span class="air-none">(not looked for)</span>'
                : un.items.length ? un.items.map((u) => escapeHtml(unreachableText(u))).join('<br>') + (un.total > un.items.length ? '<br>' + escapeHtml('and ' + (un.total - un.items.length) + ' more') : '')
                    : '<span class="air-none">(none found)</span>');
            if (walk.ended === 'came-back') add('Focus trap?', escapeHtml(focusWalkEnd(walk)));
            const opened = walk.opened && Array.isArray(walk.opened.controls) ? walk.opened.controls : null;
            if (opened) add('Pressed, of what opens something', opened.length ? opened.map((c) => escapeHtml(openedText(c))).join('<br>') : '<span class="air-none">(none found)</span>');
            add('Still to check by hand', escapeHtml(opened
                ? 'Use the other controls with Enter, Space and the arrow keys (only controls that say they open something were pressed).'
                : 'Use each control with Enter, Space and the arrow keys; open and close menus and dialogs. The walk only pressed Tab.'));
        } else if (check === 'focus-order') {
            add('Order', stops.slice(0, 25).map((s) => escapeHtml(s.n + '. ' + stopName(s) + (stopPlace(s) ? ', ' + stopPlace(s) : '') + ' (' + s.x + ', ' + s.y + ')')).join('<br>') + (stops.length > 25 ? '<br>…' : ''));
            const opened = walk.opened && Array.isArray(walk.opened.controls) ? walk.opened.controls.filter((c) => c.opened) : [];
            if (opened.length) add('Focus in what opened', opened.map((c) => escapeHtml(openedText(c))).join('<br>'));
        } else if (check === 'focus-appearance') {
            const measured = stops.filter((s) => s.appearance && typeof s.appearance.meets === 'boolean');
            const short = measured.filter((s) => !s.appearance.meets);
            add('Indicator too small or too faint', short.length ? short.map((s) => escapeHtml(s.n + '. ' + stopName(s) + ': ' + appearanceText(s.appearance))).join('<br>') : '<span class="air-none">' + escapeHtml(measured.length ? '(every measured stop meets it)' : '(nothing measured)') + '</span>');
            add('Measured', escapeHtml(measured.length + ' of ' + stops.length + ' stops' + (measured.length < stops.length ? ' (the others hidden, too large, or focused before the walk)' : '')));
            add('Browser’s own indicator?', escapeHtml('The criterion does not apply where the browser draws the indicator and the page did not change it. What changed on focus is listed at each stop.'));
        } else {
            // 2.4.11: entirely hidden fails; 2.4.12: any part hidden fails.
            const entire = check === 'focus-not-obscured';
            const hidden = stops.filter((s) => (entire ? s.coveredShare === 1 : s.coveredShare > 0) || (s.coveredShare == null && s.covered));
            const partly = entire ? stops.filter((s) => s.coveredShare > 0 && s.coveredShare < 1) : [];
            const line = (s) => escapeHtml(s.n + '. ' + stopName(s) + ', ' + coverText(s));
            add(entire ? 'Entirely hidden while focused' : 'Hidden, in part or entirely, while focused', hidden.length ? hidden.map(line).join('<br>') : '<span class="air-none">(none found)</span>');
            if (partly.length) add('Partly hidden (fine for this criterion)', partly.map(line).join('<br>'));
        }
    } else if (check === 'page-title-patterns' && ev.pageTitle) {
        add('Page title', q(ev.pageTitle.title));
        add('Main headings', (ev.pageTitle.headings || []).length ? ev.pageTitle.headings.map((h) => q(h)).join(' ') : q(undefined, '(none found)'));
    } else if (f) {
        if (check === 'img-alt-quality' || check === 'img-alt-decorative' || check === 'area-alt-quality' || check === 'input-image-alt-quality' || check === 'input-image-alt-decorative'
            || check === 'object-text-alternative-quality' || check === 'embed-text-alternative-quality' || check === 'canvas-text-alternative-quality' || check === 'image-redundant-alt' || check === 'video-poster-text-alternative-present') {
            const em = ev.image && ev.image.embedded;
            if (em) {
                add('Embeds', escapeHtml(em.tag) + (em.type ? ' type ' + code(em.type) : '') + (em.url ? ' ' + code(em.url) : '') + (em.src ? ', video ' + code(em.src) : ''));
                if (em.fallbackText) add('Fallback text', q(em.fallbackText));
            }
            add('Alt text', f.alt === undefined
                ? (f.tag === 'img' ? '<span class="air-none">(no alt attribute)</span>' : q(undefined, '(not an img: no alt)'))
                : (f.alt === '' ? '<span class="air-none">(empty alt: marked decorative)</span>' : q(f.alt)));
            add('Accessible name', nameOf(f));
            if (f.control) {
                const c = f.control;
                add('Inside a control', escapeHtml(c.tag) + (c.href ? ' to ' + code(c.href) : '') + (c.ariaLabel ? ', aria-label ' + q(c.ariaLabel) : '') + (c.text ? ', text ' + q(c.text) : ', no text of its own'));
            }
            if (f['aria-label'] !== undefined) add('aria-label', q(f['aria-label']));
            if (f.title !== undefined) add('title', q(f.title));
            const ar = ev.image && ev.image.area;
            if (ar) {
                add('Goes to', code(ar.href || ''));
                add('Covers', escapeHtml((ar.shape || 'rect') + ' ' + (ar.coords || '')) + ' <span class="air-hint">' + escapeHtml('of the picture, whose alt is ') + q(ev.image.alt, '(none)') + '</span>');
                if (ar.otherAreas && ar.otherAreas.length) add('Other areas of the map', ar.otherAreas.map((o) => q(o.name, '(no name)') + ' ' + code(o.href || '')).join('<br>'));
            }
            const src = f.src || (ev.image && ev.image.src);
            if (src) { const parts = String(src).split('/'); add('Image file', q(parts[parts.length - 1] || src)); }
            const look = ev.image && ev.image.look;
            if (look) add('What it shows', escapeHtml(lookText(look)));
            if (f.text) add('Text inside', q(f.text));
            if (f.nearestHeadingBefore) add('Heading before it', q(f.nearestHeadingBefore));
        } else if (check === 'svg-text-alternative-quality') {
            const svg = (ev.image && ev.image.svg) || {};
            add('Accessible name', nameOf(f));
            if (f['aria-label'] !== undefined) add('aria-label', q(f['aria-label']));
            add('title', q(svg.title, '(none)'));
            if (svg.desc) add('desc', q(svg.desc));
            if (svg.uses && svg.uses.length) add('Draws the symbol', svg.uses.map(code).join(' '));
            if (svg.classes) add('Classes', code(svg.classes));
            if (svg.texts && svg.texts.length) add('Text in it', svg.texts.map((t) => q(t)).join(' '));
            if (f.control) {
                const c = f.control;
                add('Inside a control', escapeHtml(c.tag) + (c.href ? ' to ' + code(c.href) : '') + (c.ariaLabel ? ', aria-label ' + q(c.ariaLabel) : '') + (c.text ? ', text ' + q(c.text) : ', no text of its own'));
            }
            if (f.nearestHeadingBefore) add('Heading before it', q(f.nearestHeadingBefore));
        } else if (check === 'link-name-quality') {
            add('Link text', q(f.text || (f.control && f.control.text), '(no text)'));
            add('Accessible name', nameOf(f));
            const href = f.href || (f.control && f.control.href);
            if (href) add('Goes to', code(href));
            if (f['aria-label'] !== undefined) add('aria-label', q(f['aria-label']));
            if (f.sameTextLinks) {
                const s = f.sameTextLinks;
                add('Links with the same text', s.others === 0 ? 'none' : s.others + ' other' + (s.others === 1 ? '' : 's') + (s.distinctTargets && s.distinctTargets.length ? ', going to: ' + s.distinctTargets.map(code).join(' ') : ''));
            }
            if (f.nearestHeadingBefore) add('Heading before it', q(f.nearestHeadingBefore));
        } else if (check === 'form-control-programmatic-label-quality') {
            add('Label', f.labelText !== undefined ? q(f.labelText) : '<span class="air-none">(no label element)</span>');
            add('Placeholder', q(f.placeholder, '(none)'));
            if (f['aria-label'] !== undefined) add('aria-label', q(f['aria-label']));
            if (f.labelledByText !== undefined) add('aria-labelledby text', q(f.labelledByText));
            add('Accessible name', nameOf(f));
            add('Field', escapeHtml(f.tag) + (f.type ? ' type ' + escapeHtml(f.type) : '') + (f.name ? ', name ' + escapeHtml(f.name) : ''));
            if (f.nearestHeadingBefore) add('Heading before it', q(f.nearestHeadingBefore));
        } else {
            add('Text', q(f.text, '(no text)'));
            add('Accessible name', nameOf(f));
            if (f.nearestHeadingBefore) add('Heading before it', q(f.nearestHeadingBefore));
        }
        // What the checker itself reported (`reported`), as it said it.
        if (ev.reported && typeof ev.reported === 'object') {
            const show = (v) => (Array.isArray(v) ? v.map(show).join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v));
            const items = Object.entries(ev.reported).filter(([, v]) => v !== null && v !== undefined && v !== '');
            if (items.length) add('The checker found', items.map(([k, v]) => code(k) + ' ' + escapeHtml(show(v))).join('<br>'));
        }
        add('Shown on the page', f.shown ? 'yes, ' + f.size[0] + ' x ' + f.size[1] + ' px' : '<span class="air-none">not visible when the page loads (hidden, in a menu or collapsed)</span>');
    }
    return rows;
}

/**
 * Where the report stands on its can't-tell questions: how many a reviewer
 * resolved (pass, fail), how many only the AI answered, how many are open, and
 * how many differences have no reason yet.
 */
export function resolveSummary(payload) {
    const cases = collectAiCases(payload);
    const reviews = payload && payload.aiReview && typeof payload.aiReview === 'object' ? payload.aiReview : {};
    const out = { total: cases.length, reviewerPass: 0, reviewerFail: 0, aiOnly: 0, open: 0, withoutReason: 0 };
    for (const c of cases) {
        const r = reviews[c.key];
        const res = resolvedOf(r, c.ai);
        if (!res) out.open++;
        else if (res.source === 'ai') out.aiOnly++;
        else if (res.verdict === 'fail') out.reviewerFail++;
        else out.reviewerPass++;
        if (whyHint(agreementOf(r, c.ai), r && r.note)) out.withoutReason++;
    }
    return out;
}

/**
 * Which questions the AI took, per check, and which it did not, from a
 * report: { asked: [{ check, answered, open }], notTaken: [{ rule, title,
 * count }] }, each question counted once (as the review counts them: one per
 * element, or per page for a page-level one). A can't-tell question the AI did
 * not take stays a person's: its rule says what it is about.
 */
export function coverageByCheck(payload) {
    const asked = new Map();
    for (const c of collectAiCases(payload)) {
        const row = asked.get(c.check) || { check: c.check, answered: 0, open: 0 };
        if (c.ai && c.ai.provenance === 'ai-supported') row.answered++; else row.open++;
        asked.set(c.check, row);
    }
    const notTaken = new Map();
    const seen = new Set();
    for (const scan of Array.isArray(payload && payload.scans) ? payload.scans : []) {
        for (const f of [...((scan && scan.canonical && scan.canonical.findings) || []), ...((scan && scan.canonical && scan.canonical.bestPractices) || [])]) {
            if (!f || f.outcome !== 'cantTell') continue;
            for (const o of f.occurrences || []) {
                if (!o || o.ai) continue;
                const target = Array.isArray(o.target) ? o.target : [];
                const pageLevel = !o.html && (target[0] === 'html' || !target.length);
                const id = [f.ruleId || '', o.atomicCheckId || '', o.html || '', JSON.stringify(target), pageLevel ? (o.pageUrl || scan.url || '') : ''].join('|');
                if (seen.has(id)) continue;
                seen.add(id);
                const rule = f.ruleId || o.atomicCheckId || 'unknown';
                const row = notTaken.get(rule) || { rule, title: f.title || '', count: 0 };
                row.count++;
                notTaken.set(rule, row);
            }
        }
    }
    const byCount = (a, b) => b.count - a.count || a.rule.localeCompare(b.rule);
    return {
        asked: [...asked.values()].sort((a, b) => (b.answered + b.open) - (a.answered + a.open) || a.check.localeCompare(b.check)),
        notTaken: [...notTaken.values()].sort(byCount),
    };
}

/** coverageByCheck as a collapsed section: what the AI took, and what it left to a person. */
export function coverageHtml(payload, { escapeHtml }) {
    const { asked, notTaken } = coverageByCheck(payload);
    if (!asked.length && !notTaken.length) return '';
    const total = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
    const askedRows = asked.map((r) => '<tr><th scope="row">' + escapeHtml(r.check) + '</th><td>' + r.answered + '</td><td>' + r.open + '</td></tr>').join('');
    const notRows = notTaken.map((r) => '<tr><th scope="row">' + escapeHtml(r.rule) + '</th><td>' + escapeHtml(r.title) + '</td><td>' + r.count + '</td></tr>').join('');
    return '<details class="air-coverage"><summary>By check: ' +
        escapeHtml(total(asked, (r) => r.answered) + ' answered and ' + total(asked, (r) => r.open) + ' left open by the AI; ' + total(notTaken, (r) => r.count) + ' can’t-tell questions it does not take') + '</summary>' +
        (asked.length ? '<table class="air-coverage__table"><caption>Questions the AI took</caption><thead><tr><th scope="col">Check</th><th scope="col">Answered</th><th scope="col">Left open</th></tr></thead><tbody>' + askedRows + '</tbody></table>' : '') +
        (notTaken.length ? '<table class="air-coverage__table"><caption>Questions the AI does not take: a person’s</caption><thead><tr><th scope="col">Rule</th><th scope="col">About</th><th scope="col">Questions</th></tr></thead><tbody>' + notRows + '</tbody></table>' : '') +
        '</details>';
}

/**
 * The lessons file (server-side/ai-answer/lessons.js) a report's answers make:
 * every question a person settled as pass or fail and gave a reason for, as an
 * example for its check, with the facts the AI was given and what the AI said.
 * House rules are left for a person to write.
 */
export function buildLessons(payload) {
    const reviews = payload && payload.aiReview && typeof payload.aiReview === 'object' ? payload.aiReview : {};
    const checks = {};
    for (const c of collectAiCases(payload)) {
        const r = reviews[c.key];
        const reason = r && String(r.note || '').trim();
        const facts = c.ai && c.ai.evidence && c.ai.evidence.facts;
        if (!r || (r.verdict !== 'pass' && r.verdict !== 'fail') || !reason || !facts || typeof facts !== 'object') continue;
        const entry = checks[c.check] || (checks[c.check] = { rules: [], examples: [] });
        entry.examples.push({
            facts, verdict: r.verdict, reason,
            ...(c.ai.provenance === 'ai-supported' && c.ai.verdict ? { aiVerdict: c.ai.verdict } : {}),
        });
    }
    return { version: 1, checks };
}

/**
 * What the reviewer settled per WCAG criterion, for the Conformance view:
 * { [sc]: { fails: [{ check, reason, url, selector, aiVerdict }], passes } },
 * from the questions a person answered pass or fail. An answer only the AI gave
 * is not here: the conformance report records what a person confirmed.
 */
export function confirmedByCriterion(payload) {
    const reviews = payload && payload.aiReview && typeof payload.aiReview === 'object' ? payload.aiReview : {};
    const out = {};
    for (const c of collectAiCases(payload)) {
        const r = reviews[c.key];
        if (!r || (r.verdict !== 'pass' && r.verdict !== 'fail')) continue;
        for (const sc of c.criterion) {
            const e = out[sc] || (out[sc] = { fails: [], passes: 0 });
            if (r.verdict === 'pass') { e.passes++; continue; }
            e.fails.push({
                check: c.check, reason: String(r.note || '').trim(), url: c.urls[0] || '', selector: c.selector,
                aiVerdict: c.ai && c.ai.provenance === 'ai-supported' ? c.ai.verdict : '',
            });
        }
    }
    return out;
}

/**
 * Remarks for a criterion from its confirmed fails, in plain words: what a
 * reviewer found, where, and why. Empty when there are none. It never says
 * anything about the conformance level.
 */
export function remarksFromConfirmed(entry) {
    const fails = entry && Array.isArray(entry.fails) ? entry.fails : [];
    if (!fails.length) return '';
    const shown = fails.slice(0, 5).map((f, i) =>
        (i + 1) + ') ' + (f.url ? f.url + ': ' : '') + (f.reason || 'failed on review, no reason given') + (f.check ? ' (' + f.check + ')' : '') + '.');
    return 'Found by an AI-assisted review and confirmed by a reviewer: ' + fails.length + ' question' + (fails.length === 1 ? '' : 's') +
        ' failed. ' + shown.join(' ') + (fails.length > shown.length ? ' And ' + (fails.length - shown.length) + ' more.' : '');
}

/** The block under a criterion's draft in the Conformance view; empty when a reviewer settled nothing for it. */
export function confirmedBlockHtml(entry, { escapeHtml }) {
    if (!entry || (!entry.fails.length && !entry.passes)) return '';
    const text = remarksFromConfirmed(entry);
    return '<div class="acr-ai"><p><span class="acr-draft-label">AI-assisted review:</span> ' +
        escapeHtml(entry.fails.length + ' failed and ' + entry.passes + ' passed, confirmed by a reviewer.') + '</p>' +
        (text ? '<p class="acr-ai-text">' + escapeHtml(text) + '</p>' +
            '<button type="button" class="secondary-button" data-acr-ai-add>Add to the remarks</button>' +
            '<span class="acr-ai-note"> The conformance level stays yours to choose.</span>' : '') + '</div>';
}
