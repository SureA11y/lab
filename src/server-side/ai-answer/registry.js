'use strict';

// Which "can't tell" checks an AI may answer, and what each needs
// (docs/design/ai-cant-tell-design.md, "The rule registry"). Only checks
// that a person could settle from the element, the page around it and, for an
// image, its source (and its picture, `picture: true`, where a step and the
// server allow it): nothing that needs interaction. Keyed by the check's
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
// registry-10: object, embed, canvas, redundant alt and video posters, with
// what they embed (image.embedded) and the picture when it is an image.
// registry-11: names and labels (heading-quality, form-control-label-quality,
// label-in-name, control-name-title-only, link-name-quality-link-only,
// identical-links-same-purpose, identical-iframes-same-purpose,
// landmark-unique), with what the checker reported (`reported`).
// registry-12: structure (form groups, labels, tables, heading order,
// bypass, landmarks, focusable non-controls, presentation conflicts,
// accesskeys), with the table, the heading outline and the landmarks.
// registry-13: "is it text" (contrast-minimum and contrast-enhanced, for the
// reasons reading can settle; symbol-graphic-contrast; css-orientation-lock).
// registry-14: the walk lane answered by reading what the checker reported
// (its own runtime probe, the handler, the states): tabindex,
// focus-not-removed-by-script, iframe-focusable-content,
// scrollable-region-focusable, mouse-only-event-handlers, css-hidden-focus,
// aria-expanded- and aria-checked-state-mismatch, skip-link,
// aria-hidden-focus, nested-interactive-controls-absent,
// server-side-image-map-absent.
// registry-15: with the focus walk, the walk lane's reading questions also
// get the element's own stop (walkStop).
// registry-16: the measure lane: contrast over what the checker cannot
// compute (measured from pixels), links told by colour, text spacing,
// reflow, resized text, target size, a replaced viewport tag.
// registry-17: contrast over what the checker cannot compute measured
// exactly (the text made transparent for a moment), by colour as fallback.
// registry-18: the element's picture may go with the questions that use one
// (`picture: true`), when a step asks (`pictures`) and the server allows it
// (A11Y_AI_PICTURES); image-of-text.
// registry-19: forms: invalid-field-error-message (with the field's texts),
// password-paste-enabled (with a paste tried, `forms`, on
// A11Y_AI_FORM_HOSTS), live-region-announcements.
// registry-20: media and moving content (video-caption,
// media-alternative-transcript-evidence, no-autoplay-audio,
// moving-content-pausable, deprecated-elements-not-used), with the media's
// facts, a same-page transcript and the page's pause controls.
const PROMPT_VERSION = 'registry-20';

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
        picture: true,
    },
    'img-alt-decorative': {
        question: 'Is this image or icon purely decorative (nothing is lost for a person who cannot see it), or does it carry meaning or a name the control needs? `image.look` says what the picture shows when it could be read: `blank` (fully transparent, a spacer), the number of `colours` and the main one.',
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'svg-text-alternative-quality': {
        question: "Is this SVG's text alternative accurate for what the graphic shows, in its context? Its name comes from aria-label, aria-labelledby or its <title>; a <desc> adds a description. When the SVG is the only content of a link or button, its name is the control's name and should say what the control does. `image.svg` gives its title, desc, the symbols it draws (`uses`, such as an icon sprite's \"#icon-search\"), its classes, any text in it, and its markup with the path data left out. A name left over from a drawing tool or an export (\"Layer 1\", \"Created with Sketch.\"), a file name or a placeholder fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'area-alt-quality': {
        question: "This is a link drawn as an area of an image map. Does its text alternative (alt, aria-label or title) say where the link leads, for the part of the picture it covers? `image.area` gives its shape and coordinates on the picture, its href, its alt, title and aria-label, and the map's other areas; `image` is the picture it is part of (its alt, what it shows, and for an SVG its source). A file name, a placeholder (\"Area 2\") or a name that does not match that part of the picture fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'input-image-alt-quality': {
        question: "This is a button drawn as an image (input type=\"image\"). Does its text alternative say what the button does, in its form? `image` is the button's picture (what it shows, and for an SVG its source, which may hold its visible text). A file name, a web address, a placeholder or a name that only describes the picture (\"green arrow\") fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'input-image-alt-decorative': {
        question: "This image button has alt=\"\" but takes its name from aria-label, aria-labelledby or title. That is fine when the name says what the button does. Does it, in its form? `image` is the button's picture. A file name, a placeholder (\"button\", \"image\") or a name that only describes the picture fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'object-text-alternative-quality': {
        question: "Does this <object>'s text alternative (its aria-label or aria-labelledby, else its fallback text, else its title) describe what the object shows? `image.embedded` gives its type, the file it embeds, its fallback text, title and aria-label; `image` the picture when the file is an image (what it shows, and for an SVG its source). A file name, a placeholder or only a note that a plugin or player is missing fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'embed-text-alternative-quality': {
        question: "Does this <embed>'s text alternative (aria-label, aria-labelledby or title) describe what it embeds? `image.embedded` gives its type, the file it embeds, its title and aria-label; `image` the picture when the file is an image. A file name or a placeholder fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'canvas-text-alternative-quality': {
        question: "Does this <canvas>'s text alternative (its fallback content, aria-label, aria-labelledby or title) convey what the canvas shows? `image` says what is drawn on it when it could be read (blank, the colours), and `image.embedded.fallbackText` its fallback text; the text around it often says what it draws. Only a note that the browser does not support canvas, a file name or a placeholder fails.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'image-redundant-alt': {
        question: "This image's alt text repeats visible text next to it in the same parent (often an icon beside a link's or button's text), so the same words may be read twice. A best practice, not a WCAG failure: answer \"fail\" when the alt only repeats that text and the image could be alt=\"\" with nothing lost; \"pass\" when the alt adds something the text does not say, or the repetition is not heard (role=\"none\" or \"presentation\").",
        evidence: ['element', 'context', 'image'],
    },
    'video-poster-text-alternative-present': {
        question: "This <video> shows a poster image but has no name (aria-label, aria-labelledby or title). As time-based media it only needs to be identified. Is it identified by something a screen reader user meets with it: a caption or figcaption, a heading or text right before it naming the video? `image.embedded` gives its poster, source and controls; `image` what the poster shows. Answer \"fail\" when nothing near it says what the video is.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'image-of-text': {
        question: "Does this image hold text that could be real text (WCAG 1.4.5)? It is an image button (input type=\"image\") or an image showing an SVG with text drawn in it. Read the text from `image` (for an SVG its source, the text it draws) or, when it is attached, the picture. Pass when it holds no text, or the text is part of a logo or brand name, or its look is essential (a sample of a typeface, a diagram's labels where real text could not sit); fail when it is text such as a button's label (\"Search\", \"Go\") or a heading drawn as an image, which CSS could style as real text. Unsure when neither the source nor a picture shows what it holds.",
        evidence: ['element', 'context', 'image'],
        picture: true,
    },
    'invalid-field-error-message': {
        question: "This field says it is invalid (aria-invalid), and no shown message is tied to it in the markup, or the one tied to it is hidden, empty or missing (`reported`: why, and the ids it names). WCAG 3.3.1: is the user told, in text, that this field is in error and what is wrong? `field` gives its label, what describes it and its error message, each with whether it is shown and heard by a screen reader (`heard`), and the text of its group; `context` what is around it. Pass when text the user meets with the field (its label, a message beside it, a description) says what is wrong; fail when nothing in text does (only a colour, an icon, a hidden or empty message). A summary at the top of the form that names the field counts.",
        evidence: ['element', 'context', 'reported', 'field'],
        picture: true,
    },
    'password-paste-enabled': {
        question: "This sign-in field has a paste handler (`reported.handler`) that may stop a password manager or the clipboard filling it (WCAG 3.3.8). `field` gives the field (its type, autocomplete, maxLength, onpaste); when the pass could try it, `paste` says what pasting did: `cancelled` (the page stopped the paste), `filledByPage` (the page's own script filled the field, as a split one-time code spreading digits across its boxes does), `alerted` (it showed an alert). Pass when pasting works: not cancelled, or cancelled and filled by the page's script. Fail when the paste is cancelled and nothing fills the field (`return false`, `preventDefault`, a 'disablePaste' function). Without `paste`, judge from the handler; unsure when it calls script that cannot be read.",
        evidence: ['element', 'context', 'reported', 'field', 'paste'],
    },
    'live-region-announcements': {
        question: "This live region may not be able to announce its messages (WCAG 4.1.3), for the reason in `reported`: hidden from screen readers (aria-hidden, inert, behind a modal dialog: `hiddenBy`), busy when scanned (aria-busy), added to the page with its text already in it, or shown and filled at the same moment (`text`: what it said). Does the page rely on it for a status message a screen reader user needs (an item added to a cart, a search's results count, a form saved)? Fail when it carries such a message and the reason keeps it from being announced (hidden while it speaks, a status inserted with its text); pass when it carries no status message users need, when it is hidden only while a dialog that holds the user's attention is open and says nothing meanwhile, or when its busy state is a loading moment that ends. Unsure when its use cannot be told.",
        evidence: ['element', 'context', 'reported'],
    },
    'video-caption': {
        question: "WCAG 1.2.2: does this video need captions, and if it has a captions track, does it look like captions? The checker says whether it found no captions track, a captions track to judge, or only subtitles. `media` gives its facts (autoplay, muted, loop, controls, duration when known) and its tracks (kind, label, the start of the track file when it could be read); `context` what is around it. Pass when it has no sound that carries information (a muted background loop with no controls, a silent demonstration said to be silent) or when its track is captions in the video's language that carry speech and sounds ([music], speaker names). Fail when it is speech or sound that matters (an interview, a talk, a how-to with narration) and has no captions track, or only subtitles that translate the dialogue. Unsure when whether it has sound, or what its track holds, cannot be told.",
        evidence: ['element', 'context', 'reported', 'media'],
    },
    'media-alternative-transcript-evidence': {
        question: "WCAG 1.2.1 (audio or video only) and 1.2.3: is there a text alternative for this media, a transcript or a full description, that a user can reach from it? `media.sectionLinks` are the links in its own section, with the text a link to this page leads to (`leadsTo`); `media.transcriptTarget` the text of a transcript link the checker found; `context` what is around the media. Pass when a transcript (the words spoken, who speaks, sounds that matter) is on the page or clearly linked; fail when the media carries speech or information and nothing near it offers its text. A link to another page named as the transcript passes (it cannot be followed here). A summary of a few words is not a transcript.",
        evidence: ['element', 'context', 'reported', 'media'],
    },
    'no-autoplay-audio': {
        question: "WCAG 1.4.2: this audio or video plays sound by itself when the page opens, and the checker found no reachable native controls. Can the user stop, pause or turn down that sound? `media` gives its facts (duration when known, loop, muted, controls) and `pageControls`: controls on the page named for pausing, stopping or muting, with whether they sit near it. Pass when the sound lasts 3 seconds or less, or a control at the top of the page or near the media pauses, stops or mutes it (its name and `onclick` say so); fail when it loops or plays longer than 3 seconds and no such control exists. Unsure when its length is unknown and no control is found.",
        evidence: ['element', 'context', 'reported', 'media'],
    },
    'moving-content-pausable': {
        question: "WCAG 2.2.2: this element moves by itself for more than five seconds (the checker says how: an animation that never ends, or one over five seconds). Can the user pause, stop or hide it, or is the movement essential? `media.pageControls` lists controls named for pausing, stopping or hiding, with whether they sit near it. Pass when such a control exists for it (a carousel's pause button), or when the movement is a loading indicator shown only while something loads, or is essential; fail when it loops or lasts over five seconds beside other content and nothing pauses, stops or hides it (a decorative spinning or sliding element with no control).",
        evidence: ['element', 'context', 'reported', 'media'],
    },
    'deprecated-elements-not-used': {
        question: "WCAG 2.2.2: this <marquee> scrolls its content. Can the user pause, stop or hide it, by keyboard and touch as well as mouse? The checker says when it stops only while the pointer is over it (its onmouseover, in the element). `media.pageControls` lists controls named for pausing, stopping or hiding, with their `onclick`. Pass when a control pauses, stops or hides it (a button calling its stop()), or it scrolls only once; fail when it keeps scrolling and only hovering, or nothing, stops it.",
        evidence: ['element', 'context', 'reported', 'media'],
    },
    'heading-quality': {
        question: "Does this heading describe the topic or purpose of the content it introduces? The checker found its text looks like a placeholder, a file name or a web address (`reported`: its name and why). `context` shows what follows it. Fail when it is text a template or a tool left (\"Heading 2\", \"lorem ipsum\", a file name); pass when it names its section, even if short (\"Section 3\" in numbered terms).",
        evidence: ['element', 'context', 'reported'],
    },
    'form-control-label-quality': {
        question: "Does this field's visible label say what to enter, so a user can tell it apart from the page's other fields? The checker found its label is the same as another field's with nothing visible telling them apart, partly hidden, or a placeholder word (`reported`: the label, the fields sharing it, what is hidden). `context` shows what is around it. Fail when a user could not tell what this field is for; pass when something visible near it (a legend, a heading, a row's text) does.",
        evidence: ['element', 'context', 'reported'],
    },
    'label-in-name': {
        question: "Does this control's accessible name contain its visible label, so a speech input user can say what they see? The checker could not tell (`reported`: the visible label, the accessible name, where each comes from, and why: hyphens, a possible abbreviation, an icon font glyph or a symbol). Pass when saying the visible words would match the name (\"E-mail\" for \"Email address\"); fail when the name does not hold the visible words or what they mean.",
        evidence: ['element', 'context', 'reported'],
    },
    'control-name-title-only': {
        question: "This button or link takes its only name from its title attribute, which only mouse users see, as a tooltip. A best practice, not a WCAG failure: does the control show its purpose to everyone without the tooltip (visible text, or an icon whose meaning is plain), and does the title say what it does? Fail when its purpose can only be learnt from the tooltip.",
        evidence: ['element', 'context', 'reported', 'image'],
        picture: true,
    },
    'link-name-quality-link-only': {
        question: "This link's whole text is generic (\"read more\"), and only the text around it says where it leads. That meets 2.4.4 (AA); this question is 2.4.9 (AAA): does the link's text alone (or its accessible name) say where it leads? Fail when it does not; pass when its name (aria-label, aria-labelledby, visually hidden text) says it.",
        evidence: ['element', 'context', 'reported'],
    },
    'identical-links-same-purpose': {
        question: "Links with the same name lead to different addresses (`reported`: the name, this link's address and the others'). 2.4.9 (AAA): do they serve the same purpose (the same page in another form, the same thing tracked differently), so the same name is right? Fail when they lead to different things a user would need to tell apart by their name.",
        evidence: ['element', 'context', 'reported'],
    },
    'identical-iframes-same-purpose': {
        question: "Frames with the same accessible name embed different resources (`reported`: the name, what this frame embeds, how many share it). Do they serve the same purpose? Fail when their shared name does not tell apart frames that show different things (4.1.2: a frame's name says what it is).",
        evidence: ['element', 'context', 'reported'],
    },
    'landmark-unique': {
        question: "Two or more landmarks of the same role share one name, or are all unnamed (`reported`: the role, the name, the others). A best practice, not a WCAG failure: does a user moving by landmarks need different names to tell them apart (a main navigation and a footer navigation)? Fail when they hold different things and nothing names them apart; pass when they are the same thing repeated, or a name does tell them apart.",
        evidence: ['element', 'context', 'reported'],
    },
    'form-group-name-present': {
        question: "Radio buttons or checkboxes that share a name are not grouped with a name (no fieldset with a legend, no named group), or are split over differently named groups (`reported`: the name, how many, their type). 1.3.1: do they answer one question whose wording is needed to understand each option (\"Delivery: Standard / Express\")? Fail when the question is only shown visually and not tied to the options; pass when each option's own label is clear on its own, or the shared name is only technical.",
        evidence: ['element', 'context', 'reported'],
    },
    'form-control-single-label': {
        question: "Two or more labels name this field and browsers join them into one name, or an empty label is associated with it (`reported`: how many). 3.3.2: is the joined name still clear and right for the field (a label plus a hint read together)? Fail when it reads as nonsense, repeats itself confusingly, or one label belongs to another field.",
        evidence: ['element', 'context', 'reported'],
    },
    'table-fake-caption': {
        question: "This table has no caption or name, and its first row is one cell of text above rows of several cells (`table`). 1.3.1: is that first row the table's title, shown only by its look (then it should be a caption)? Fail when it is a title; pass when it is data or a header for the cells below.",
        evidence: ['element', 'context', 'table'],
    },
    'td-has-header': {
        question: "This table has data but no header cell at all (`table`: its first rows). 1.3.1: does it hold data whose cells need headers to be understood (then it fails), or does it only lay out content (pass, as a layout table)?",
        evidence: ['element', 'context', 'table'],
    },
    'table-th-has-data-cells': {
        question: "No data cell is assigned to this header cell (`table`, marked \u2190). 1.3.1: is the header wrongly marked up (data shown as headers, or a header with no cells under it by mistake: fail), or is it right (an empty column, a header for a later row group: pass)?",
        evidence: ['element', 'context', 'table', 'reported'],
    },
    'empty-table-header': {
        question: "A best practice, not a WCAG failure: this header cell has no visible text, or is named only by aria-label or aria-labelledby, which some screen readers do not read (`table`, marked \u2190). Does a user lose what the column or row is about? Fail when they do (a header that names data); pass when the cell is a corner cell over row headers, or its column needs no header.",
        evidence: ['element', 'context', 'table', 'reported'],
    },
    'heading-order': {
        question: "A best practice, not a WCAG failure: this heading skips a level after the previous one (`reported`: from and to). `outline` is the page's headings in order, this one marked \u2190. Does the jump break the outline a screen reader user navigates by (a subsection that looks like it belongs to the wrong section)? Fail when it does; pass when the structure is still clear (a sidebar or a card set at a fixed level).",
        evidence: ['element', 'context', 'reported', 'outline'],
    },
    'bypass-blocks-present': {
        question: "2.4.1: no main landmark, working skip link or heading was found to skip what repeats on every page. `landmarks` lists the page's landmarks, its skip links, the headings count and what lies outside every landmark. Does this page have blocks repeated across pages (a header, a navigation) before its content that a keyboard user must pass each time? Fail when it does and nothing lets them skip; pass when nothing repeats, or something else lets them skip.",
        evidence: ['element', 'context', 'landmarks'],
    },
    'page-zones-landmark': {
        question: "A best practice, not a WCAG failure: a block named or placed as the page's header, navigation, search or footer is not exposed as that landmark (`reported`: the zone and why). `landmarks` lists what is exposed. Is it really that zone of the page (then it should be marked up as one: fail), or only named alike (pass)?",
        evidence: ['element', 'context', 'reported', 'landmarks'],
    },
    'region': {
        question: "A best practice, not a WCAG failure: content is outside every landmark region. `landmarks` lists the page's landmarks and what lies outside them. Is that content something a landmark user would miss (page content: fail), or what may sit outside (a skip link, a hidden or decorative block, a cookie banner over the page: pass)?",
        evidence: ['element', 'context', 'landmarks'],
    },
    'focus-order-semantics': {
        question: "A best practice, not a WCAG failure: this element is in the Tab order but has a non-interactive role (`reported`: its tabindex and role), so a keyboard user who reaches it is not told what it does. Does it act as a control (it reacts to a click or key: fail, it needs a control's role), or is it focusable for a reason that needs no role (a scrollable region, a dialog's or a section's focus target: pass)?",
        evidence: ['element', 'context', 'reported'],
    },
    'presentation-role-conflict': {
        question: "A best practice, not a WCAG failure: this element has role=\"presentation\" or \"none\" (or is an img with alt=\"\"), but carries a global aria-* attribute or can take focus, so browsers keep its real role (`reported`: the role, the attributes, whether focusable). Is it meant to be hidden from assistive technology (then the attribute or focus is a mistake: fail), or meant to be read or used (then the presentation role is the mistake: fail too)? Pass only when the conflict changes nothing a user meets.",
        evidence: ['element', 'context', 'reported'],
    },
    'accesskeys': {
        question: "A best practice, not a WCAG failure: this element's accesskey is also used by other elements on the page (`reported`: the key, how many, the others), so the shortcut may not reach it. Do the elements do different things (fail: one is unreachable by its key), or the same thing (the same link twice: pass)?",
        evidence: ['element', 'context', 'reported'],
    },
    'contrast-minimum': {
        question: "The checker found this text below its contrast ratio (1.4.3, AA: 4.5:1, or 3:1 for large text) but could not tell whether that fails, for the reason `reported` gives (its reasonCode). Answer only what reading can settle: a symbol that is not a letter or a digit (SYMBOLIC_CHARACTER_BELOW_THRESHOLD): is it text that conveys something the criterion covers (fail), or decorative or repeated by the text next to it (pass)? Text that looks like part of a logo or brand name (LOGO_TEXT_BELOW_THRESHOLD): logo text has no contrast requirement (pass), other text fails. A control that switches to higher contrast (CONTRAST_SWITCH_OFFERED): pass only when it is easy to find and its high-contrast version meets the ratio, as far as the evidence shows; otherwise unsure. A placeholder below the ratio (PLACEHOLDER_BELOW_THRESHOLD): placeholder text is text, so fail, unless the field's visible label carries all it says. For every other reason (semibold sizes, ::first-line or ::first-letter colours, text stroke or shadow, an engine error) the answer needs a measurement: answer \"unsure\".",
        evidence: ['element', 'context', 'reported'],
    },
    'contrast-enhanced': {
        question: "The checker found this text below its contrast ratio (1.4.6, AAA: 7:1, or 4.5:1 for large text) but could not tell whether that fails, for the reason `reported` gives (its reasonCode). Answer only what reading can settle: a symbol that is not a letter or a digit (SYMBOLIC_CHARACTER_BELOW_THRESHOLD): is it text that conveys something the criterion covers (fail), or decorative or repeated by the text next to it (pass)? Text that looks like part of a logo or brand name (LOGO_TEXT_BELOW_THRESHOLD): logo text has no contrast requirement (pass), other text fails. A control that switches to higher contrast (CONTRAST_SWITCH_OFFERED): pass only when it is easy to find and its high-contrast version meets the ratio, as far as the evidence shows; otherwise unsure. A placeholder below the ratio (PLACEHOLDER_BELOW_THRESHOLD): placeholder text is text, so fail, unless the field's visible label carries all it says. For every other reason (semibold sizes, ::first-line or ::first-letter colours, text stroke or shadow, an engine error) the answer needs a measurement: answer \"unsure\".",
        evidence: ['element', 'context', 'reported'],
    },
    'symbol-graphic-contrast': {
        question: "Symbols drawn as text, with no letter or digit (an arrow, a star, a check mark), are under 3:1 against their background (`reported`: the symbols, the ratio, the colours). 1.4.11: does a person need them to understand something (a rating, a state, the only sign of an action): fail; or are they decorative, or repeated by text next to them: pass?",
        evidence: ['element', 'context', 'reported'],
    },
    'css-orientation-lock': {
        question: "An orientation media query rotates an element by about 90 degrees, or hides the page's content in one orientation, or some style sheets could not be read (`reported`). 1.3.4: does that keep a user from using the page in one orientation, portrait or landscape (fail), or does it only rearrange something that does not hold the content, or is one orientation essential (a piano, a cheque) (pass)? When the style sheets could not be read, answer \"unsure\".",
        evidence: ['element', 'context', 'reported'],
    },
    'tabindex': {
        question: "A best practice, not a WCAG failure: this element has a tabindex above 0, so Tab reaches it before the page's natural order (`reported`: the value, and what Tab skips to reach it). Does that order still make sense (a search field at the top, reached first anyway: pass), or does it pull a keyboard user away from where they are (a footer link reached first: fail)? With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'focus-not-removed-by-script': {
        question: "This element's onfocus handler calls blur() or focus() (`reported`: the handler, whether the element is in the tab order). 2.1.1, 2.4.7: does the handler take focus away as it arrives, so a keyboard user cannot rest on or use the element (fail), or does it keep focus where it is, or move it on purpose to where the user expects (pass)? With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'iframe-focusable-content': {
        question: "A frame with a negative tabindex holds one focusable element, and focus moved straight on from it (`reported`). 2.1.1: can a keyboard user still reach and use what is in the frame (pass), or is it out of reach (fail)? Answer \"unsure\" when the evidence does not show what the frame holds. With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'scrollable-region-focusable': {
        question: "This box scrolls, but it has no tabindex and nothing in it takes focus. Chromium and Firefox let the keyboard scroll it anyway; other browsers do not. 2.1.1: does it hold content a user must scroll to read (fail: give it tabindex=\"0\" and a name), or is everything in it visible without scrolling, or reachable another way (pass)?",
        evidence: ['element', 'context', 'reported'],
    },
    'mouse-only-event-handlers': {
        question: "This element has pointer-only handlers (`reported`: which ones) and no key, focus or blur handler, or none that can run. 2.1.1: does the pointer handler do something a keyboard user also needs (show information, open something, act): fail; or only something cosmetic, or something the keyboard gets another way (the link it is on works with Enter): pass? With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'css-hidden-focus': {
        question: "An element in the Tab order is hidden by CSS (off the screen, clipped, transparent) and no focus rule brings it into view, or focusing it moved focus elsewhere (`reported`). 2.4.7: when it has focus, can a keyboard user see where focus is (it shows itself on focus, as a skip link: pass), or does focus land on something they cannot see (fail)? With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'aria-expanded-state-mismatch': {
        question: "This control's aria-expanded says the opposite of what is shown: \"false\" while what it controls is shown, or \"true\" while it is hidden (`reported`). 4.1.2: is a screen reader user told the wrong state (fail), or is it a moment a script corrects at once, or does the controlled content differ from what the control expands (pass)?",
        evidence: ['element', 'context', 'reported'],
    },
    'aria-checked-state-mismatch': {
        question: "This native checkbox or radio button has aria-checked saying a different state from the one it is really in (`reported`: what aria-checked says, the real state). 4.1.2: a screen reader user is told the wrong state: fail, unless a script sets them equal at once (then pass).",
        evidence: ['element', 'context', 'reported'],
    },
    'skip-link': {
        question: "A best practice, not a WCAG failure: this skip link's target is missing, hidden or has no area (`reported`: its href). `landmarks` shows the page's landmarks and skip links. Does pressing it fail to move a keyboard user past the blocks (fail), or does it still land where it says (a script handles it, a legacy anchor) (pass)? With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'landmarks', 'walkStop'],
    },
    'aria-hidden-focus': {
        question: "Focusable content sits inside aria-hidden=\"true\" (`reported`: the elements, and what happened when the one focusable element was focused). 4.1.2: can a keyboard user land on something a screen reader does not announce (fail), or does focus never reach it (it passes focus on, or a modal dialog keeps focus away from it: pass)? With the focus walk (`focus: true`), `walkStop` gives this element's own stop: whether Tab reached it (`stop`, its neighbours `before` and `after`), whether it was hidden or off the page while focused (`stopFacts.hidden`), whether the page took focus away at once (`lostFocus`), and what changed on it on focus.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'nested-interactive-controls-absent': {
        question: "This control contains another control that can take focus, such as a button inside a link (`reported`: the nested controls). 4.1.2: a screen reader does not announce the inner one properly and its activation is unclear: fail, unless the inner control is not really focusable or is hidden from users (pass).",
        evidence: ['element', 'context', 'reported'],
    },
    'server-side-image-map-absent': {
        question: "This link holds an <img ismap>, a server-side image map, which a keyboard cannot use. 2.1.1: are the same destinations offered as ordinary links nearby (pass), or only by clicking parts of the picture (fail)? `context` shows what is around it.",
        evidence: ['element', 'context', 'reported'],
    },
    'contrast-computable': {
        question: "The checker could not compute this text's contrast because of what is drawn behind or over it (`reported`: the reason: a background image or gradient, an overlapping element, opacity, a blend mode, a filter, a text shadow or stroke...). `pixels` measures it from pictures of the text as drawn. With `method: \"exact\"`, the background under each glyph was read with the text made transparent for a moment: `shareBelow4_5` and `shareBelow3` are the shares of the background under the glyphs below those ratios, with the 10th percentile, the median and the minimum. With `method: \"colour\"` (when the page could not be changed), pixels unlike the text's colour were taken as background: antialiased edges pull the lowest values down, and `nearTextShare`, the share of the box drawn almost in the text's colour, shows a background close to the text colour (far over a fifth: a fail). 1.4.3 asks 4.5:1, or 3:1 for large text (24px, or 18.66px bold; `fontSize`, `fontWeight`). Fail when a real part of the text sits on background below its ratio (with the exact method, more than about a tenth of it); pass when it does not. Unsure when `pixels` is missing or the reason is something a picture cannot show (an option list, an unrendered colour scheme).",
        evidence: ['element', 'context', 'reported', 'pixels'],
    },
    'link-in-text-block': {
        question: "A link in a block of text is told apart from the text around it by colour alone (`reported`: the reason). 1.4.1 asks for a cue other than colour, at least on hover and focus (an underline, a border, bold). With the focus walk, `walkStop` gives what changed on the link when it had focus. Fail when nothing but colour marks it and focus shows no other cue; pass when focus (and so presumably hover) adds an underline or another non-colour cue, or the link is underlined after all. Unsure when the colours could not be worked out and nothing settles it.",
        evidence: ['element', 'context', 'reported', 'walkStop'],
    },
    'text-spacing-content-loss': {
        question: "With the text spacing of 1.4.12 applied (line height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16), the checker found this text partly cut off, overlapping other text, moved out of reach, or the spacing could not be applied (`reported`: the reason and the text). Is content or function lost to a reader: fail; or is it an excerpt already meant to be cut (with a way to read the rest), a moving decoration, or a cut of a few pixels that loses nothing: pass? Unsure when the spacing could not be applied.",
        evidence: ['element', 'context', 'reported'],
    },
    'avoid-inline-spacing': {
        question: "Spacing (line height, letter or word spacing) is forced below the 1.4.12 values with !important on this text (`reported`: which), so a user's own spacing cannot override it. The checker could not tell whether it matters: the text may not wrap, or is short enough to stay on one line. Fail when it is running text a user may need to space out; pass when it is a short label or a single line that cannot lose anything. Unsure when the value could not be worked out.",
        evidence: ['element', 'context', 'reported'],
    },
    'reflow-horizontal-scroll': {
        question: "At 320 CSS pixels wide (1.4.10) this element sticks out past the edge, makes the page scroll sideways, or is cut off (`reported`: how far, its width, the reason: a wide table, media, preformatted text, a box that scrolls or clips). Content that needs two-dimensional layout is excepted: a data table, a map, a diagram, a video, code whose layout carries meaning. Fail when it is text or a control that should reflow (a layout table, a fixed-width box, a long word in a heading) or when the clipped part is lost; pass when it is excepted content, or only a box of its own scrolls and nothing is lost.",
        evidence: ['element', 'context', 'reported'],
    },
    'resize-text-content-loss': {
        question: "With text resized to 200% (1.4.4), the checker found this text cut off by its box (`reported`: the text and the edge it goes past). Is content lost to a reader (fail), or is the cut part decorative, repeated elsewhere, or reachable by scrolling the box (pass)?",
        evidence: ['element', 'context', 'reported'],
    },
    'target-size-minimum': {
        question: "This target is under 24 by 24 CSS pixels and too close to a neighbour (`reported`: the reason and the neighbour). 2.5.8 excepts inline links in a sentence, a spacing that leaves room, an equivalent control elsewhere, a size the user agent sets, and targets whose size is essential (a map's points, a chart). Pass when an exception holds (an \"Edit | Delete\" run is not a sentence, so it does not); fail when none does.",
        evidence: ['element', 'context', 'reported'],
    },
    'target-size-enhanced': {
        question: "This target is under 44 by 44 CSS pixels (`reported`: the reason). 2.5.5 (AAA) excepts inline links in a sentence, an equivalent control elsewhere, a size the user agent sets, and essential sizes (inside an SVG, a canvas or an image map). Pass when an exception holds; fail when none does.",
        evidence: ['element', 'context', 'reported'],
    },
    'meta-viewport-zoom-enabled': {
        question: "A viewport meta tag restricts zoom (`reported`: the settings), but a later one replaces it, and browsers have not always agreed which applies. 1.4.4: does the tag that browsers apply let users zoom to 200% and more (pass), or does the restricting one apply or could it (fail)? `context` shows the page's head as far as it reaches.",
        evidence: ['element', 'context', 'reported'],
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
