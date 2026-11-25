'use strict';

// Which "can't tell" checks an AI may answer, and what each needs
// (docs/design/ai-cant-tell-design.md, "The rule registry"). Only checks
// that a person could settle from the element, the page around it and, for an
// image, its source: nothing that needs interaction. Keyed by the check's
// `atomicCheckId`, as an occurrence names it. The focus questions below are
// the exception, and opt-in.

const PROMPT_VERSION = 'registry-2';

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
        question: 'When a keyboard user moves through this page with Tab, can they always see which element has focus? The focus walk lists every stop and what looked different on the element, its parent or its ::before/::after while it had focus; an empty list means no difference was found there. A stop that is hidden or off the page while focused also counts against it. A stop with `lostFocus` took focus and the page gave it up at once: nothing stays visible on it, so it counts against it.',
        evidence: ['focusWalk'],
    },
    'wcag-2.4.3-focus-order': {
        check: 'focus-order',
        question: 'Does focus move through this page in an order that keeps its meaning and use, broadly following the order the page reads in? The focus walk lists every stop in order, with its position (x, y in pixels from the top left of the page), its landmark (header, navigation, main, footer...) and the heading it comes under.',
        evidence: ['focusWalk'],
    },
    // Reaching is not operating: the walk never presses Enter or Space, so the
    // AI may find a fail here but never a pass (passAllowed: false).
    'wcag-2.1.1-keyboard': {
        check: 'keyboard',
        question: 'Can a keyboard user reach every control a mouse user can use on this page? The focus walk lists every stop reached with Tab, and `unreachable` lists what looks usable by mouse (a control role, a click attribute, a pointer cursor, or a link, button or field taken out of the Tab order) but can never take focus. A walk that came back to an earlier stop may be a keyboard trap. A stop with `lostFocus` (also in `unreachable`) took focus and the page gave it up at once: a keyboard user cannot rest on it or use it. Only reaching was checked, not operating: answer "fail" when a control is clearly out of reach (or focus is trapped), otherwise "unsure". Do not answer "pass".',
        evidence: ['focusWalk'],
        passAllowed: false,
    },
    'wcag-2.4.11-focus-not-obscured-minimum': {
        check: 'focus-not-obscured',
        question: 'When an element has keyboard focus, is it at least partly visible, not entirely hidden by other content the page put over it (a sticky header, a cookie banner, a chat button)? For every stop the focus walk gives `coveredShare`, the share of 25 points across the element that something else was on top of (1 is entirely hidden), and `covered`, what.',
        evidence: ['focusWalk'],
    },
    'wcag-2.4.12-focus-not-obscured-enhanced': {
        // Not "focus-not-obscured-enhanced": that is the scanner's name for
        // the same question about one fixed box (ELEMENT_WALK).
        check: 'focus-not-obscured-enhanced-page',
        question: 'When an element has keyboard focus, is no part of it hidden by other content the page put over it? For every stop the focus walk gives `coveredShare`, the share of 25 points across the element that something else was on top of (0 is none), and `covered`, what.',
        evidence: ['focusWalk'],
    },
    'wcag-2.4.13-focus-appearance': {
        check: 'focus-appearance',
        question: 'Is the focus indicator of every stop at least as large as a 2 CSS pixel thick line around the element, with a contrast of at least 3:1 between its focused and unfocused colours? For each stop the walk compared exact pictures of the element focused and unfocused: `appearance.atContrast` is how many CSS pixels changed with a contrast of 3:1 or more, `appearance.needed` the area of that 2 pixel line, `appearance.meets` whether the first is at least the second. The criterion makes an exception when the indicator is the browser\'s own and the page did not change it, which the measurement cannot tell: weigh `changesOnFocus` and say so when it matters.',
        evidence: ['focusWalk'],
    },
});

// The same questions asked about one element (a link whose outline a style
// removes, a control with a click handler, a fixed box that may cover others),
// answered from the same focus walk: by check, then by rule ('*' for any).
const ELEMENT_WALK = Object.freeze({
    'css-focus-indicator-suppressed': {
        'wcag-2.4.7-focus-visible': {
            check: 'focus-visible-element',
            question: 'A style removes this element\'s focus outline. When it has keyboard focus, is focus still visible on it by other means (a border, an underline, a background, a shadow...)? The focus walk gives its stop (`stop`): what looked different on it, its parent or its ::before/::after while focused. Never reached with Tab: say so, and answer "unsure".',
        },
        'wcag-2.4.13-focus-appearance': {
            check: 'focus-appearance-element',
            question: 'A style removes this element\'s focus outline. Is its focus indicator at least as large as a 2 CSS pixel line around it, with a contrast of at least 3:1 between focused and unfocused? Its stop (`stop`) has `appearance`, measured from pictures focused and unfocused: `atContrast` CSS pixels changed at 3:1 or more, `needed` the area required, `meets`.',
        },
    },
    'click-handler-keyboard-operable': {
        '*': {
            check: 'keyboard-element',
            question: 'This element reacts to the mouse. Can a keyboard user reach it? The focus walk says whether Tab ever reached it (`stop`) and, if it is among `unreachable`, why it cannot take focus. Only reaching was checked, not operating: answer "fail" when it cannot be reached and nothing else on the page does the same, otherwise "unsure". Do not answer "pass".',
            passAllowed: false,
        },
    },
    'widget-keyboard-focusable': {
        '*': {
            check: 'keyboard-element',
            question: 'This element has a widget role. Can a keyboard user reach it? The focus walk says whether Tab ever reached it (`stop`) and, if it is among `unreachable`, why it cannot take focus. Only reaching was checked, not operating: answer "fail" when it cannot be reached, otherwise "unsure". Do not answer "pass".',
            passAllowed: false,
        },
    },
    'focus-not-obscured-minimum': {
        '*': {
            check: 'focus-not-obscured-box',
            question: 'This box stays in place over the page (fixed or sticky). Does it ever hide an element entirely while that element has keyboard focus? The focus walk lists the stops it was on top of (`coveredStops`), each with `coveredShare` (1 is entirely).',
        },
    },
    'focus-not-obscured-enhanced': {
        '*': {
            check: 'focus-not-obscured-enhanced-box',
            question: 'This box stays in place over the page (fixed or sticky). Does it hide any part of an element while that element has keyboard focus? The focus walk lists the stops it was on top of (`coveredStops`), each with `coveredShare`.',
        },
    },
});

const PAGE_LEVEL_BY_CHECK = Object.freeze(Object.fromEntries([
    ...Object.values(PAGE_LEVEL).map((e) => [e.check, { ...e }]),
    ...Object.values(ELEMENT_WALK).flatMap((byRule) => Object.values(byRule)).map((e) => [e.check, { ...e, element: true }]),
]));

/**
 * The registry's entry for a check, or null when the AI may not answer it:
 * by `atomicCheckId`, by a page-level question's own check name, or for the
 * scanner's "manual-review" by its rule (`ruleId`), or for an element question
 * the focus walk answers by its check and rule. Each entry says its `check`
 * and, when it needs the walk, `tier: 1` (and `element: true` when it is about
 * one element rather than the page).
 */
function entryFor(checkId, ruleId = null) {
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    if (has(ANSWERABLE, checkId)) return { check: checkId, tier: 0, ...ANSWERABLE[checkId] };
    if (has(PAGE_LEVEL_BY_CHECK, checkId)) return { tier: 1, ...PAGE_LEVEL_BY_CHECK[checkId] };
    if (checkId === 'manual-review' && ruleId && has(PAGE_LEVEL, ruleId)) return { tier: 1, ...PAGE_LEVEL[ruleId] };
    if (has(ELEMENT_WALK, checkId)) {
        const byRule = ELEMENT_WALK[checkId];
        const e = (ruleId && has(byRule, ruleId)) ? byRule[ruleId] : byRule['*'];
        if (e) return { tier: 1, element: true, evidence: ['focusWalk'], ...e };
    }
    return null;
}

module.exports = { ANSWERABLE, PAGE_LEVEL, ELEMENT_WALK, PROMPT_VERSION, entryFor };
