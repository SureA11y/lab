'use strict';

// Which "can't tell" checks an AI may answer, and what each needs
// (docs/design/ai-cant-tell-design.md, "The rule registry"). Only checks
// that a person could settle from the element, the page around it and, for an
// image, its source: nothing that needs interaction. Keyed by the check's
// `atomicCheckId`, as an occurrence names it. The focus questions below are
// the exception, and opt-in.

// registry-5: an image's evidence says what it shows (image.look: blank,
// colours), so a transparent spacer reads as one. registry-6: the focus order
// question judges the order only; keyboard is asked on a page Tab reaches
// nothing on.
// registry-7: with the open walk (`open: true`), the keyboard and focus order
// questions also see what each control that opens something did.
// registry-8: the SVG text alternative question (svg-text-alternative-quality),
// with what an inline SVG draws (image.svg).
// registry-9: image map areas and image buttons (area-alt-quality,
// input-image-alt-quality, input-image-alt-decorative), with the picture
// behind them.
const PROMPT_VERSION = 'registry-9';

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
        question: 'Is this image or icon purely decorative (nothing is lost for a person who cannot see it), or does it carry meaning or a name the control needs? `image.look` says what the picture shows when it could be read: `blank` (fully transparent, a spacer), the number of `colours` and the main one.',
        evidence: ['element', 'context', 'image'],
    },
    'svg-text-alternative-quality': {
        question: "Is this SVG's text alternative accurate for what the graphic shows, in its context? Its name comes from aria-label, aria-labelledby or its <title>; a <desc> adds a description. When the SVG is the only content of a link or button, its name is the control's name and should say what the control does. `image.svg` gives its title, desc, the symbols it draws (`uses`, such as an icon sprite's \"#icon-search\"), its classes, any text in it, and its markup with the path data left out. A name left over from a drawing tool or an export (\"Layer 1\", \"Created with Sketch.\"), a file name or a placeholder fails.",
        evidence: ['element', 'context', 'image'],
    },
    'area-alt-quality': {
        question: "This is a link drawn as an area of an image map. Does its text alternative (alt, aria-label or title) say where the link leads, for the part of the picture it covers? `image.area` gives its shape and coordinates on the picture, its href, its alt, title and aria-label, and the map's other areas; `image` is the picture it is part of (its alt, what it shows, and for an SVG its source). A file name, a placeholder (\"Area 2\") or a name that does not match that part of the picture fails.",
        evidence: ['element', 'context', 'image'],
    },
    'input-image-alt-quality': {
        question: "This is a button drawn as an image (input type=\"image\"). Does its text alternative say what the button does, in its form? `image` is the button's picture (what it shows, and for an SVG its source, which may hold its visible text). A file name, a web address, a placeholder or a name that only describes the picture (\"green arrow\") fails.",
        evidence: ['element', 'context', 'image'],
    },
    'input-image-alt-decorative': {
        question: "This image button has alt=\"\" but takes its name from aria-label, aria-labelledby or title. That is fine when the name says what the button does. Does it, in its form? `image` is the button's picture. A file name, a placeholder (\"button\", \"image\") or a name that only describes the picture fails.",
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
        question: 'Judge the order only (other criteria cover controls Tab cannot reach and focus that cannot be seen): does focus move through this page in an order that keeps its meaning and use, broadly following the order the page reads in? The focus walk lists every stop in order, with its position (x, y in pixels from the top left of the page), its landmark (header, navigation, main, footer...) and the heading it comes under. When the walk has `opened`, each control that says it opens something was pressed: `focusAfter` says where focus was just after (still on the control, inside what opened, nowhere), `tabs.reachedInside` after how many Tab presses focus got into what opened, and `tabs.leftAfter` and `leftTo` whether it then left (to the page behind, the control, or out of the page). What opens over the page (a lightbox, a dialog) should take focus or come next in the order, and a modal one should keep focus until it is closed; a menu or a section that opens in place may leave focus on its control.',
        evidence: ['focusWalk'],
    },
    // Reaching is not operating: the walk never presses Enter or Space, so the
    // AI may find a fail here but never a pass (passAllowed: false).
    'wcag-2.1.1-keyboard': {
        check: 'keyboard',
        question: 'Can a keyboard user reach every control a mouse user can use on this page? The focus walk lists every stop reached with Tab, and `unreachable` lists what looks usable by mouse (a control role, a click attribute, a pointer cursor, or a link, button or field taken out of the Tab order) but can never take focus. A walk that came back to an earlier stop may be a keyboard trap. A stop with `lostFocus` (also in `unreachable`) took focus and the page gave it up at once: a keyboard user cannot rest on it or use it. Only reaching was checked, not operating: answer "fail" when a control is clearly out of reach (or focus is trapped), otherwise "unsure". Do not answer "pass". When the walk has `opened`, each control that says it opens something on the page was also pressed with its key (Enter; Space for a link with role=button, then Enter if Space did nothing, in `enter`): `activated` says whether anything happened, `opened` what appeared (how many elements can take focus, its close control and whether that can take focus), `tabs` whether Tab reached into it, `escapeCloses` whether Escape closed it. Fail when such a control does nothing with the keyboard, or when what it opens cannot be closed with the keyboard (its close control cannot take focus and Escape does not close it), or its controls cannot be reached. A link with role=button that works with Enter but not Space is still usable by keyboard (it misbehaves as a button, which is 4.1.2, not asked here).',
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
        'wcag-1.4.11-non-text-contrast': {
            check: 'focus-contrast-element',
            question: 'A style removes this element\'s focus outline. Does whatever shows its focus instead have a contrast of at least 3:1 against the colours next to it, enough to see that it has focus? Its stop (`stop`) has `appearance`, measured from pictures focused and unfocused: `changed` CSS pixels changed on focus, `atContrast` of them at 3:1 or more against what was there before (the colours next to the indicator), and `oneLine`, the area of a 1 CSS pixel line around the element, for scale. Unlike 2.4.13 there is no minimum size: judge whether the part at 3:1 is enough to see. If nothing changes on focus there is no indicator, so nothing meets 3:1: answer "fail" (focus visible fails too). Never reached with Tab: answer "unsure".',
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
