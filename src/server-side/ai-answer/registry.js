'use strict';

// Which "can't tell" checks an AI may answer, and what each needs
// (docs/design/ai-cant-tell-design.md, "The rule registry"). Only checks
// that a person could settle from the element, the page around it and, for an
// image, its source: nothing that needs interaction. Keyed by the check's
// `atomicCheckId`, as an occurrence names it. The focus questions below are
// the exception, and opt-in.

const PROMPT_VERSION = 'registry-1';

const ANSWERABLE = Object.freeze({
    'p-as-heading': {
        question: 'Is this bold paragraph a section title for the text after it (then it should be a heading), or emphasis, a label or a name that reads as part of the text?',
        evidence: ['element', 'context'],
    },
    'page-title-patterns': {
        question: "Does the page's title say what the page is about?",
        evidence: ['element', 'context', 'pageTitle'],
    },
    'img-alt-quality': {
        question: "Is the image's alt text accurate and does it fit its context (for an image that is a link or button, does it say what the control does)?",
        evidence: ['element', 'context', 'image'],
    },
    'img-alt-decorative': {
        question: 'Is this image or icon purely decorative (nothing is lost for a person who cannot see it), or does it carry meaning or a name the control needs?',
        evidence: ['element', 'context', 'image'],
    },
    'link-name-quality': {
        question: "Does the link's text (or accessible name) tell where it goes or what it does, in its context?",
        evidence: ['element', 'context'],
    },
    'form-control-programmatic-label-quality': {
        question: "Is the form control's label strong enough for its purpose, as the check's steps describe?",
        evidence: ['element', 'context'],
    },
});

// Page-level questions the scanner leaves to a person ("manual-review"), told
// apart by their rule. They are answered from a focus walk (focus-walk.js):
// the AI pass's one step that acts on the page (tier 1), only when a step asks
// for it (`ai: { focus: true }`). Each is one question per page.
const PAGE_LEVEL = Object.freeze({
    'wcag-2.4.7-focus-visible': {
        check: 'focus-visible',
        question: 'When a keyboard user moves through this page with Tab, can they always see which element has focus? The focus walk lists every stop and what looked different on the element, its parent or its ::before/::after while it had focus; an empty list means no difference was found there. A stop that is hidden or off the page while focused also counts against it.',
        evidence: ['focusWalk'],
    },
    'wcag-2.4.3-focus-order': {
        check: 'focus-order',
        question: 'Does focus move through this page in an order that keeps its meaning and use, broadly following the order the page reads in? The focus walk lists every stop in order, with its position (x, y in pixels from the top left of the page), its landmark (header, navigation, main, footer...) and the heading it comes under.',
        evidence: ['focusWalk'],
    },
    'wcag-2.4.11-focus-not-obscured-minimum': {
        check: 'focus-not-obscured',
        question: 'When an element has keyboard focus, is it at least partly visible, not entirely hidden by other content the page put over it (a sticky header, a cookie banner, a chat button)? The focus walk says for every stop whether something else was on top of the centre of the element, and what.',
        evidence: ['focusWalk'],
    },
});

const PAGE_LEVEL_BY_CHECK = Object.freeze(Object.fromEntries(Object.values(PAGE_LEVEL).map((e) => [e.check, e])));

/**
 * The registry's entry for a check, or null when the AI may not answer it:
 * by `atomicCheckId`, by a page-level question's own check name, or for the
 * scanner's "manual-review" by its rule (`ruleId`). Each entry says its `check`
 * and, for a page-level one, `tier: 1`.
 */
function entryFor(checkId, ruleId = null) {
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    if (has(ANSWERABLE, checkId)) return { check: checkId, tier: 0, ...ANSWERABLE[checkId] };
    if (has(PAGE_LEVEL_BY_CHECK, checkId)) return { tier: 1, ...PAGE_LEVEL_BY_CHECK[checkId] };
    if (checkId === 'manual-review' && ruleId && has(PAGE_LEVEL, ruleId)) return { tier: 1, ...PAGE_LEVEL[ruleId] };
    return null;
}

module.exports = { ANSWERABLE, PAGE_LEVEL, PROMPT_VERSION, entryFor };
