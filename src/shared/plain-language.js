'use strict';

// What a failing rule means for a person, in one sentence.
//
// Rule ids and WCAG numbers suit whoever fixes the code, not whoever decides
// what gets fixed. Every finding carries `wcag.sc`, so this is a lookup rather
// than an inference: criterion -> { name, impact }, with rule-level overrides
// where one criterion covers several distinct failures (1.1.1 covers images,
// SVG, canvas and video posters alike).
//
// Not conformance language. `name` says what is wrong, `impact` says who hits
// it and what happens. Both are short enough for a table cell.
//
// Browser: globalThis.A11Y_PLAIN_LANGUAGE. Node: module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_PLAIN_LANGUAGE = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const BY_CRITERION = {
        '1.1.1': {
            name: 'Images without a description',
            impact: 'Screen-reader users hear nothing where the image should be, so whatever it communicates is lost.',
        },
        '1.2.1': {
            name: 'Audio or video with no alternative',
            impact: 'People who cannot hear the audio, or cannot see the video, get no other way to reach the content.',
        },
        '1.2.2': {
            name: 'Video without captions',
            impact: 'Deaf and hard-of-hearing viewers cannot follow what is being said.',
        },
        '1.2.3': {
            name: 'Video without an audio description',
            impact: 'Viewers who cannot see the screen miss what is only shown, never said.',
        },
        '1.2.5': {
            name: 'Video without an audio description',
            impact: 'Viewers who cannot see the screen miss what is only shown, never said.',
        },
        '1.3.1': {
            name: 'Structure the page does not declare',
            impact: 'Headings, lists, tables and form labels are only visual, so assistive technology cannot convey them.',
        },
        '1.3.2': {
            name: 'Content read in the wrong order',
            impact: 'The reading order does not match the visual one, so the page makes no sense when read aloud.',
        },
        '1.3.4': {
            name: 'Locked to one screen orientation',
            impact: 'People with a device fixed to a wheelchair or stand cannot use the page at all.',
        },
        '1.3.5': {
            name: 'Fields that do not autofill',
            impact: 'People who rely on autofill have to type personal details by hand every time.',
        },
        '1.4.1': {
            name: 'Meaning carried by colour alone',
            impact: 'Colour-blind readers, and anyone printing in black and white, lose the distinction entirely.',
        },
        '1.4.3': {
            name: 'Text too faint to read',
            impact: 'People with low vision cannot read it — and neither can anyone using their phone outdoors.',
        },
        '1.4.4': {
            name: 'Text that breaks when enlarged',
            impact: 'Enlarging text to read it cuts content off or overlaps it.',
        },
        '1.4.5': {
            name: 'Text baked into an image',
            impact: 'It cannot be enlarged, restyled or read aloud like the rest of the page.',
        },
        '1.4.10': {
            name: 'Content that will not reflow',
            impact: 'Zooming in, or a narrow screen, forces sideways scrolling to read every line.',
        },
        '1.4.11': {
            name: 'Buttons and icons too faint to see',
            impact: 'Controls fade into the background, so people with low vision cannot find what to press.',
        },
        '1.4.12': {
            name: 'Text that breaks when spaced out',
            impact: 'Readers who increase line or letter spacing to cope with dyslexia lose content off the edges.',
        },
        '1.4.13': {
            name: 'Pop-ups that cannot be dismissed',
            impact: 'Content appearing on hover or focus covers the page and traps magnifier users.',
        },
        '2.1.1': {
            name: 'Only usable with a mouse',
            impact: 'Anyone navigating by keyboard, switch or voice cannot operate it at all.',
        },
        '2.1.2': {
            name: 'Keyboard focus that cannot get out',
            impact: 'Focus enters a component and cannot leave, stranding keyboard users on the page.',
        },
        '2.2.1': {
            name: 'A time limit that cannot be extended',
            impact: 'Anyone who needs longer to read or type is cut off mid-task.',
        },
        '2.2.2': {
            name: 'Movement that cannot be stopped',
            impact: 'Animation that keeps moving makes the page unreadable for people with attention or vestibular conditions.',
        },
        '2.3.1': {
            name: 'Flashing content',
            impact: 'Rapid flashing can trigger seizures.',
        },
        '2.4.1': {
            name: 'No way to skip repeated content',
            impact: 'Keyboard and screen-reader users tab through the whole menu on every page before reaching the content.',
        },
        '2.4.2': {
            name: 'Page without a meaningful title',
            impact: 'Screen-reader users cannot tell which page or tab they are on.',
        },
        '2.4.3': {
            name: 'Focus moving in the wrong order',
            impact: 'Tabbing jumps around the page instead of following it, so the sequence cannot be followed.',
        },
        '2.4.4': {
            name: 'Links that do not say where they go',
            impact: 'A screen reader announces "read more" or "click here" with no idea what it leads to.',
        },
        '2.4.6': {
            name: 'Headings and labels that do not describe',
            impact: 'People scanning by heading or label cannot tell sections apart.',
        },
        '2.4.7': {
            name: 'No visible keyboard position',
            impact: 'People who navigate by keyboard cannot see where they are on the page.',
        },
        '2.4.11': {
            name: 'Focus hidden behind other content',
            impact: 'The focused control is covered by a sticky header or banner, so keyboard users lose their place.',
        },
        '2.5.1': {
            name: 'Gestures with no simple alternative',
            impact: 'Anyone who cannot swipe or pinch precisely has no other way to do it.',
        },
        '2.5.3': {
            name: 'Spoken name does not match the label',
            impact: 'Voice-control users say what they see on the button and nothing happens.',
        },
        '2.5.4': {
            name: 'Actions that need device movement',
            impact: 'Shaking or tilting is impossible for anyone whose device is mounted or held still.',
        },
        '2.5.8': {
            name: 'Tap targets too small',
            impact: 'Hard to hit for anyone with limited fine motor control, and for everyone on a moving train.',
        },
        '3.1.1': {
            name: 'Page language not declared',
            impact: 'A screen reader reads the page in the wrong accent and pronunciation, sometimes unintelligibly.',
        },
        '3.1.2': {
            name: 'A passage in another language not marked',
            impact: 'A screen reader pronounces it as if it were the page language, which can make it meaningless.',
        },
        '3.2.1': {
            name: 'The page changes when focus arrives',
            impact: 'Simply tabbing to a control changes the page under the user without warning.',
        },
        '3.2.2': {
            name: 'The page changes while typing',
            impact: 'Filling in a field triggers a jump or a submit before the person is finished.',
        },
        '3.2.5': {
            name: 'Unannounced new window',
            impact: 'A link opens a new window with no warning, which disorients screen-reader and magnifier users.',
        },
        '3.3.1': {
            name: 'Errors that are not identified',
            impact: 'The form refuses to submit without saying which field is wrong or why.',
        },
        '3.3.2': {
            name: 'Fields without instructions',
            impact: 'The required format is only discovered by getting it wrong.',
        },
        '4.1.2': {
            name: 'Controls assistive tech cannot use',
            impact: 'The control is announced without a name, or is reachable but hidden, so it cannot be operated.',
        },
        '4.1.3': {
            name: 'Updates announced to nobody',
            impact: 'A message appears on screen and screen-reader users are never told it happened.',
        },
    };

    // Where one criterion covers several different failures, the rule gets its
    // own wording: three rows reading "images without a description" would be
    // useless in a list.
    const BY_RULE = {
        'a11ycore-svg-image-text-alternative-present': {
            name: 'Diagrams and icons with no description',
            impact: 'The graphic carries information a screen reader cannot announce at all.',
        },
        'a11ycore-svg-text-alternative-present': {
            name: 'Diagrams and icons with no description',
            impact: 'The graphic carries information a screen reader cannot announce at all.',
        },
        'a11ycore-video-poster-text-alternative-present': {
            name: 'Video preview image with no description',
            impact: 'The still frame standing in for the video is announced as nothing.',
        },
        'a11ycore-canvas-text-alternative-present': {
            name: 'Charts drawn in canvas with no description',
            impact: 'A chart drawn in code has no text behind it, so its content is unavailable to screen readers.',
        },
        'a11ycore-object-text-alternative-present': {
            name: 'Embedded content with no description',
            impact: 'An embedded document or player is announced without saying what it is.',
        },
        'a11ycore-embed-text-alternative-present': {
            name: 'Embedded content with no description',
            impact: 'An embedded document or player is announced without saying what it is.',
        },
        'a11ycore-aria-hidden-focus': {
            name: 'Hidden content still reachable by keyboard',
            impact: 'Keyboard users land on controls hidden from everyone else — focus disappears off-screen.',
        },
        'a11ycore-css-hidden-focus': {
            name: 'Focus lands on invisible controls',
            impact: 'Tabbing moves focus to controls nobody can see, so the page appears to stop responding.',
        },
        'a11ycore-button-name-present': {
            name: 'Buttons with no name',
            impact: 'A screen reader announces only "button", so there is no way to know what it does.',
        },
        'a11ycore-link-name-present': {
            name: 'Links with no name',
            impact: 'A screen reader announces only "link", giving no idea where it leads.',
        },
        'a11ycore-form-control-programmatic-label': {
            name: 'Form fields without a label',
            impact: 'A screen reader cannot say what a field is for, so the form cannot be filled in without sight.',
        },
        'a11ycore-contrast-minimum': {
            name: 'Text too faint to read',
            impact: 'People with low vision cannot read it — and neither can anyone using their phone outdoors.',
        },
    };

    const UNKNOWN = {
        name: 'Accessibility problem',
        impact: 'Reported by an automated check; someone needs to confirm what it means for people using the page.',
    };

    // The first WCAG criterion, from either shape: findings carry wcag.sc
    // (strings or {ref}), diff rows flatten it to a single string.
    function criterionOf(source) {
        if (!source) return '';
        if (typeof source === 'string') return source;
        if (typeof source.wcag === 'string') return source.wcag;

        const sc = source.wcag && Array.isArray(source.wcag.sc) ? source.wcag.sc : [];
        for (const entry of sc) {
            const ref = (entry && typeof entry === 'object') ? entry.ref : entry;
            if (ref) return String(ref);
        }
        const std = source.standards && Array.isArray(source.standards.wcag) ? source.standards.wcag : [];
        for (const entry of std) if (entry && entry.ref) return String(entry.ref);
        return '';
    }

    /**
     * Plain-language name and impact for a rule.
     *
     * @param {string} ruleId
     * @param {string|object} criterionOrSource  '1.4.3', or anything carrying wcag.sc
     */
    function plainFor(ruleId, criterionOrSource) {
        return BY_RULE[ruleId] || BY_CRITERION[criterionOf(criterionOrSource)] || UNKNOWN;
    }

    /** True when the pair is a real mapping rather than the fallback. */
    function isKnown(ruleId, criterionOrSource) {
        return plainFor(ruleId, criterionOrSource) !== UNKNOWN;
    }

    return { plainFor, isKnown, criterionOf, BY_CRITERION, BY_RULE, UNKNOWN };
}));
