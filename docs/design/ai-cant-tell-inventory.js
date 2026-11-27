'use strict';

// Every check of the scan engine that can end in "can't tell", read from the
// engine's own documentation of each check (@check, @sc and the reason codes
// marked cantTell), with what settles it: the AI as it answers today, the AI
// with evidence the lab still has to collect, a measurement, or a person.
// Writes docs/design/ai-cant-tell-inventory.md.
//
//   node docs/design/ai-cant-tell-inventory.js
//
// The lane of each check is a judgement (LANES below); the list of checks and
// their reason codes come from the engine, so a check added to the engine
// shows up here, and ai-cant-tell-inventory.test.js fails until it has a lane.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECKS = path.join(ROOT, 'node_modules', '@surea11y', 'core', 'src', 'checks');

// What would settle each check's "can't tell". `answered`: the AI answers it
// today (registry.js). The others are the plan, in the order of the roadmap.
const LANE_TEXT = {
    answered: 'The AI answers it today',
    read: 'The AI, from the element and the text around it, as today',
    walk: 'The AI, from the focus walk or the open walk, or a small extension of them',
    tree: "The browser's own accessibility tree (no model needed)",
    measure: 'A measurement by the lab, then the AI or a person for what is left',
    picture: 'The AI, once it can see the picture',
    media: 'Audio, video or time: a person, or the AI with the media',
    interact: 'Using the page beyond opening things (errors, announcements): a person, later the AI',
    code: 'The markup states it: little for the AI to add; a person confirms',
};

const LANES = {
    // Answered today.
    'img-alt-quality': ['answered'], 'img-alt-decorative': ['answered'], 'p-as-heading': ['answered'],
    'page-title-patterns': ['answered'], 'link-name-quality': ['answered'], 'form-control-programmatic-label-quality': ['answered'],
    'svg-text-alternative-quality': ['answered', 'from its title, desc, the symbol it draws and its classes (image.svg)'],
    'manual-review': ['answered', 'focus visible, focus order and keyboard, from the focus walk (and the open walk)'],
    'css-focus-indicator-suppressed': ['answered', 'per element: focus visible, its contrast (1.4.11) and appearance (2.4.13)'],
    'click-handler-keyboard-operable': ['answered', 'fail only'], 'widget-keyboard-focusable': ['answered', 'fail only'],
    'focus-not-obscured-minimum': ['answered'], 'focus-not-obscured-enhanced': ['answered'],

    // Reading questions like today's: the next to add.
    'area-alt-quality': ['answered', 'with the map\'s picture, the area\'s place on it and the other areas (image.area)'],
    'input-image-alt-quality': ['answered', 'with the button\'s picture'], 'input-image-alt-decorative': ['answered', 'with the button\'s picture'],
    'object-text-alternative-quality': ['answered', 'with what it embeds and its picture (image.embedded)'], 'embed-text-alternative-quality': ['answered', 'with what it embeds and its picture'],
    'canvas-text-alternative-quality': ['answered', 'with what is drawn on it, read from its pixels'],
    'image-redundant-alt': ['answered', 'a best practice: asked with includeBestPractice'], 'video-poster-text-alternative-present': ['answered', 'with its poster and what is near it'],
    'heading-quality': ['answered', 'with what the checker reported (reported)'], 'form-control-label-quality': ['answered', 'with what the checker reported (reported)'], 'label-in-name': ['answered', 'with what the checker reported (reported)'],
    'link-name-quality-link-only': ['answered', 'AAA (2.4.9): with the AAA profile'], 'identical-links-same-purpose': ['answered', 'AAA (2.4.9): with the AAA profile'],
    'identical-iframes-same-purpose': ['answered', 'with what the checker reported (reported)'], 'landmark-unique': ['answered', 'a best practice: with includeBestPractice'], 'control-name-title-only': ['answered', 'a best practice: with includeBestPractice'],
    'form-group-name-present': ['answered', 'with what the checker reported'], 'form-control-single-label': ['answered', 'with what the checker reported'], 'table-fake-caption': ['answered', 'with the table (table)'],
    'td-has-header': ['answered', 'with the table'], 'table-th-has-data-cells': ['answered', 'with the table'], 'empty-table-header': ['answered', 'a best practice, with the table'],
    'heading-order': ['answered', 'a best practice, with the heading outline (outline)'], 'bypass-blocks-present': ['answered', 'with the landmarks (landmarks)'],
    'page-zones-landmark': ['answered', 'a best practice, with the landmarks'], 'region': ['answered', 'a best practice, with the landmarks'], 'focus-order-semantics': ['answered', 'a best practice'],
    'contrast-minimum': ['read', 'is this symbol text? (the ratio is measured)'], 'contrast-enhanced': ['read', 'is this symbol text?'],
    'symbol-graphic-contrast': ['read', 'does the symbol carry information? (the ratio is measured)'],
    'css-orientation-lock': ['read', 'does the rotated element matter?'],
    'presentation-role-conflict': ['answered', 'a best practice'], 'accesskeys': ['answered', 'a best practice'],

    // The walks' evidence settles it, or would with a small extension.
    'tabindex': ['walk', 'the walk shows what Tab reaches first'], 'focus-not-removed-by-script': ['walk', 'the walk records lostFocus'],
    'iframe-focusable-content': ['walk'], 'scrollable-region-focusable': ['walk', 'can the region be scrolled with the keyboard'],
    'mouse-only-event-handlers': ['walk', 'as keyboard per element'], 'css-hidden-focus': ['walk', 'as focus visible'],
    'aria-expanded-state-mismatch': ['walk', 'the open walk sees what shows'], 'aria-checked-state-mismatch': ['walk'],
    'skip-link': ['walk', 'press it and see where focus goes'], 'server-side-image-map-absent': ['walk'],
    'aria-hidden-focus': ['walk', 'can Tab reach it'], 'nested-interactive-controls-absent': ['walk'],

    // The browser's accessibility tree settles a name the engine could not compute.
    'button-name-present': ['tree'], 'link-name-present': ['tree'], 'binary-control-name-present': ['tree'],
    'combobox-name-present': ['tree'], 'dialog-name-present': ['tree'], 'listbox-name-present': ['tree'],
    'menuitem-name-present': ['tree'], 'meter-name-present': ['tree'], 'option-name-present': ['tree'],
    'progressbar-name-present': ['tree'], 'searchbox-name-present': ['tree'], 'slider-name-present': ['tree'],
    'spinbutton-name-present': ['tree'], 'summary-name-present': ['tree'], 'tab-name-present': ['tree'],
    'textbox-name-present': ['tree'], 'tooltip-name-present': ['tree'], 'treeitem-name-present': ['tree'],
    'empty-heading': ['tree'], 'role-img-text-alternative-present': ['tree'], 'input-image-alt-present': ['tree', 'then read: is the name right'],
    'aria-role-name-present': ['tree'], 'landmark-role-name-present': ['tree'],

    // Measured by the lab first.
    'contrast-computable': ['measure', 'text over an image or gradient: measure the pixels behind it'],
    'link-in-text-block': ['measure', 'hover and focus cues: measure, as the walk does'],
    'text-spacing-content-loss': ['measure', 'with the spacing applied: picture before and after'],
    'avoid-inline-spacing': ['measure'], 'reflow-horizontal-scroll': ['measure', 'at 320 px: is the content lost or only a table or map'],
    'resize-text-content-loss': ['measure'], 'target-size-minimum': ['measure', 'inline links and spacing exceptions'],
    'target-size-enhanced': ['measure', 'AAA (2.5.5)'],
    'meta-viewport-zoom-enabled': ['measure'],

    // Needs the picture.
    'image-of-text': ['picture', 'is there text in the image'],

    // Needs the media, or time.
    'video-caption': ['media'], 'media-alternative-transcript-evidence': ['media', 'or read: is there a transcript near it'],
    'no-autoplay-audio': ['media'], 'moving-content-pausable': ['media', 'or the walk: is there a pause control'],
    'deprecated-elements-not-used': ['media', 'a marquee: is there a pause control'],

    // Needs the page used further.
    'live-region-announcements': ['interact'], 'invalid-field-error-message': ['interact', 'submit with errors, on a test system'],
    'password-paste-enabled': ['interact', 'paste into the field'],

    // The markup says it; a person confirms.
    'aria-allowed-attr': ['code'], 'aria-allowed-role': ['code'], 'aria-braille-equivalent': ['code'], 'aria-conditional-attr': ['code'],
    'aria-deprecated-role': ['code'], 'aria-owns-valid': ['code'], 'aria-prohibited-attr': ['code'], 'aria-required-attr': ['code'],
    'aria-required-children': ['code'], 'aria-valid-attr-value': ['code', 'or the walk: does a script add the id later'], 'aria-valid-attr': ['code'],
    'aria-text': ['code'], 'aria-roles-valid': ['code'], 'definition-list-children-valid': ['code'], 'dlitem-parent-valid': ['code'], 'list-children-valid': ['code'],
    'listitem-parent-valid': ['code'], 'duplicate-id': ['code'], 'duplicate-id-aria': ['code'], 'label-for-valid': ['code'],
    'label-title-only': ['code'], 'scope-attr-valid': ['code'], 'table-duplicate-name': ['code'], 'meta-viewport-large': ['code'],
    'page-has-heading-one': ['code'], 'landmark-one-main': ['code'], 'landmark-banner-is-top-level': ['code'],
    'landmark-complementary-is-top-level': ['code'], 'landmark-contentinfo-is-top-level': ['code'], 'landmark-main-is-top-level': ['code'],
    'landmark-no-duplicate-banner': ['code'], 'landmark-no-duplicate-contentinfo': ['code'], 'landmark-no-duplicate-main': ['code'],
};

const ORDER = ['answered', 'read', 'walk', 'tree', 'measure', 'picture', 'media', 'interact', 'code'];

/** Every engine check that can end in "can't tell": { id, kind, sc, codes }. */
function readChecks(dir = CHECKS) {
    const out = [];
    const files = [['manual', path.join(dir, 'manual')], ['automatic', path.join(dir, 'automatic')], ['manual', dir]];
    for (const [kind, folder] of files) {
        if (!fs.existsSync(folder)) continue;
        for (const f of fs.readdirSync(folder)) {
            const file = path.join(folder, f);
            if (!f.endsWith('.js') || !fs.statSync(file).isFile()) continue;
            const text = fs.readFileSync(file, 'utf8');
            const doc = ((text.match(/\/\*\*[\s\S]*?\*\//) || [''])[0]).replace(/\n\s*\*[ \t]?/g, '\n');
            // A file without @check is named after its check.
            const id = (doc.match(/@check\s+(\S+)/) || [])[1] || (/cantTell/.test(doc) ? f.replace(/\.js$/, '') : null);
            if (!id) continue;
            // `CODE` (cantTell) or `CODE` (fail, cantTell); codes may hold hyphens.
            const codes = [...doc.matchAll(/`([A-Za-z0-9_-]+)`\s*\((?:[a-z]+,\s*)*cantTell\)/g)].map((m) => m[1]);
            const manual = /@type\s+manual/.test(doc) || kind === 'manual';
            if (!codes.length && !manual) continue;
            const sc = [...doc.matchAll(/@sc\s+([^\n]+)/g)].map((m) => m[1].trim()).join(', ');
            out.push({ id, kind: manual ? 'manual' : 'automatic', sc, codes });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

function render(checks) {
    const by = {};
    for (const c of checks) (by[(LANES[c.id] || ['?'])[0]] = by[(LANES[c.id] || ['?'])[0]] || []).push(c);
    const lines = [
        '# Every "can\'t tell" of the scan engine, and what would settle it',
        '',
        'Generated by `node docs/design/ai-cant-tell-inventory.js` from the engine\'s',
        'own documentation of each check (`node_modules/@surea11y/core/src/checks`).',
        'The lane of each check is a judgement kept in that script; the plan built on',
        'it is in [ai-cant-tell-roadmap.md](ai-cant-tell-roadmap.md). Do not edit this',
        'page by hand.',
        '',
        '| Lane | What settles it | Checks |',
        '| --- | --- | --- |',
        ...ORDER.map((l) => `| \`${l}\` | ${LANE_TEXT[l]} | ${(by[l] || []).length} |`),
        `| | **All** | **${checks.length}** |`,
        '',
    ];
    for (const l of ORDER) {
        if (!by[l]) continue;
        lines.push(`## \`${l}\`: ${LANE_TEXT[l]}`, '', '| Check | SC | Kind | Can\'t-tell reasons | Note |', '| --- | --- | --- | --- | --- |');
        for (const c of by[l]) {
            const note = (LANES[c.id] || [])[1] || '';
            lines.push(`| \`${c.id}\` | ${c.sc || '(best practice)'} | ${c.kind} | ${c.codes.length ? c.codes.map((x) => '`' + x + '`').join(', ') : '(always)'} | ${note} |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

if (require.main === module) {
    const checks = readChecks();
    const missing = checks.filter((c) => !LANES[c.id]).map((c) => c.id);
    fs.writeFileSync(path.join(__dirname, 'ai-cant-tell-inventory.md'), render(checks));
    console.log(`${checks.length} checks written to ai-cant-tell-inventory.md${missing.length ? `; without a lane: ${missing.join(', ')}` : ''}`);
}

module.exports = { readChecks, render, LANES, LANE_TEXT, ORDER };
