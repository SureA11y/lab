'use strict';

// Which "can't tell" checks an AI may answer, and what each needs
// (docs/design/ai-cant-tell-design.md, "The rule registry"). Only checks
// that a person could settle from the element, the page around it and, for an
// image, its source: nothing that needs interaction. Keyed by the check's
// `atomicCheckId`, as an occurrence names it.

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

function entryFor(checkId) {
    return Object.prototype.hasOwnProperty.call(ANSWERABLE, checkId) ? ANSWERABLE[checkId] : null;
}

module.exports = { ANSWERABLE, PROMPT_VERSION, entryFor };
