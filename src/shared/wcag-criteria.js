'use strict';

/**
 * The full WCAG success-criterion list, used as the coverage denominator.
 * `removedIn` marks 4.1.1 Parsing, obsolete from 2.2 but still live in 2.0/2.1.
 *
 * Shared by the server, which measures coverage against it, and the app,
 * whose conformance report lists every criterion.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_WCAG_CRITERIA = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const WCAG_CRITERIA = [
        { sc: '1.1.1', level: 'A', title: 'Non-text Content', addedIn: '2.0' },

        { sc: '1.2.1', level: 'A', title: 'Audio-only and Video-only (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.2', level: 'A', title: 'Captions (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.3', level: 'A', title: 'Audio Description or Media Alternative (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.4', level: 'AA', title: 'Captions (Live)', addedIn: '2.0' },
        { sc: '1.2.5', level: 'AA', title: 'Audio Description (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.6', level: 'AAA', title: 'Sign Language (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.7', level: 'AAA', title: 'Extended Audio Description (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.8', level: 'AAA', title: 'Media Alternative (Prerecorded)', addedIn: '2.0' },
        { sc: '1.2.9', level: 'AAA', title: 'Audio-only (Live)', addedIn: '2.0' },

        { sc: '1.3.1', level: 'A', title: 'Info and Relationships', addedIn: '2.0' },
        { sc: '1.3.2', level: 'A', title: 'Meaningful Sequence', addedIn: '2.0' },
        { sc: '1.3.3', level: 'A', title: 'Sensory Characteristics', addedIn: '2.0' },
        { sc: '1.3.4', level: 'AA', title: 'Orientation', addedIn: '2.1' },
        { sc: '1.3.5', level: 'AA', title: 'Identify Input Purpose', addedIn: '2.1' },
        { sc: '1.3.6', level: 'AAA', title: 'Identify Purpose', addedIn: '2.1' },

        { sc: '1.4.1', level: 'A', title: 'Use of Color', addedIn: '2.0' },
        { sc: '1.4.2', level: 'A', title: 'Audio Control', addedIn: '2.0' },
        { sc: '1.4.3', level: 'AA', title: 'Contrast (Minimum)', addedIn: '2.0' },
        { sc: '1.4.4', level: 'AA', title: 'Resize Text', addedIn: '2.0' },
        { sc: '1.4.5', level: 'AA', title: 'Images of Text', addedIn: '2.0' },
        { sc: '1.4.6', level: 'AAA', title: 'Contrast (Enhanced)', addedIn: '2.0' },
        { sc: '1.4.7', level: 'AAA', title: 'Low or No Background Audio', addedIn: '2.0' },
        { sc: '1.4.8', level: 'AAA', title: 'Visual Presentation', addedIn: '2.0' },
        { sc: '1.4.9', level: 'AAA', title: 'Images of Text (No Exception)', addedIn: '2.0' },
        { sc: '1.4.10', level: 'AA', title: 'Reflow', addedIn: '2.1' },
        { sc: '1.4.11', level: 'AA', title: 'Non-text Contrast', addedIn: '2.1' },
        { sc: '1.4.12', level: 'AA', title: 'Text Spacing', addedIn: '2.1' },
        { sc: '1.4.13', level: 'AA', title: 'Content on Hover or Focus', addedIn: '2.1' },

        { sc: '2.1.1', level: 'A', title: 'Keyboard', addedIn: '2.0' },
        { sc: '2.1.2', level: 'A', title: 'No Keyboard Trap', addedIn: '2.0' },
        { sc: '2.1.3', level: 'AAA', title: 'Keyboard (No Exception)', addedIn: '2.0' },
        { sc: '2.1.4', level: 'A', title: 'Character Key Shortcuts', addedIn: '2.1' },

        { sc: '2.2.1', level: 'A', title: 'Timing Adjustable', addedIn: '2.0' },
        { sc: '2.2.2', level: 'A', title: 'Pause, Stop, Hide', addedIn: '2.0' },
        { sc: '2.2.3', level: 'AAA', title: 'No Timing', addedIn: '2.0' },
        { sc: '2.2.4', level: 'AAA', title: 'Interruptions', addedIn: '2.0' },
        { sc: '2.2.5', level: 'AAA', title: 'Re-authenticating', addedIn: '2.0' },
        { sc: '2.2.6', level: 'AAA', title: 'Timeouts', addedIn: '2.1' },

        { sc: '2.3.1', level: 'A', title: 'Three Flashes or Below Threshold', addedIn: '2.0' },
        { sc: '2.3.2', level: 'AAA', title: 'Three Flashes', addedIn: '2.0' },
        { sc: '2.3.3', level: 'AAA', title: 'Animation from Interactions', addedIn: '2.1' },

        { sc: '2.4.1', level: 'A', title: 'Bypass Blocks', addedIn: '2.0' },
        { sc: '2.4.2', level: 'A', title: 'Page Titled', addedIn: '2.0' },
        { sc: '2.4.3', level: 'A', title: 'Focus Order', addedIn: '2.0' },
        { sc: '2.4.4', level: 'A', title: 'Link Purpose (In Context)', addedIn: '2.0' },
        { sc: '2.4.5', level: 'AA', title: 'Multiple Ways', addedIn: '2.0' },
        { sc: '2.4.6', level: 'AA', title: 'Headings and Labels', addedIn: '2.0' },
        { sc: '2.4.7', level: 'AA', title: 'Focus Visible', addedIn: '2.0' },
        { sc: '2.4.8', level: 'AAA', title: 'Location', addedIn: '2.0' },
        { sc: '2.4.9', level: 'AAA', title: 'Link Purpose (Link Only)', addedIn: '2.0' },
        { sc: '2.4.10', level: 'AAA', title: 'Section Headings', addedIn: '2.0' },
        { sc: '2.4.11', level: 'AA', title: 'Focus Not Obscured (Minimum)', addedIn: '2.2' },
        { sc: '2.4.12', level: 'AAA', title: 'Focus Not Obscured (Enhanced)', addedIn: '2.2' },
        { sc: '2.4.13', level: 'AAA', title: 'Focus Appearance', addedIn: '2.2' },

        { sc: '2.5.1', level: 'A', title: 'Pointer Gestures', addedIn: '2.1' },
        { sc: '2.5.2', level: 'A', title: 'Pointer Cancellation', addedIn: '2.1' },
        { sc: '2.5.3', level: 'A', title: 'Label in Name', addedIn: '2.1' },
        { sc: '2.5.4', level: 'A', title: 'Motion Actuation', addedIn: '2.1' },
        { sc: '2.5.5', level: 'AAA', title: 'Target Size (Enhanced)', addedIn: '2.1' },
        { sc: '2.5.6', level: 'AAA', title: 'Concurrent Input Mechanisms', addedIn: '2.1' },
        { sc: '2.5.7', level: 'AA', title: 'Dragging Movements', addedIn: '2.2' },
        { sc: '2.5.8', level: 'AA', title: 'Target Size (Minimum)', addedIn: '2.2' },

        { sc: '3.1.1', level: 'A', title: 'Language of Page', addedIn: '2.0' },
        { sc: '3.1.2', level: 'AA', title: 'Language of Parts', addedIn: '2.0' },
        { sc: '3.1.3', level: 'AAA', title: 'Unusual Words', addedIn: '2.0' },
        { sc: '3.1.4', level: 'AAA', title: 'Abbreviations', addedIn: '2.0' },
        { sc: '3.1.5', level: 'AAA', title: 'Reading Level', addedIn: '2.0' },
        { sc: '3.1.6', level: 'AAA', title: 'Pronunciation', addedIn: '2.0' },

        { sc: '3.2.1', level: 'A', title: 'On Focus', addedIn: '2.0' },
        { sc: '3.2.2', level: 'A', title: 'On Input', addedIn: '2.0' },
        { sc: '3.2.3', level: 'AA', title: 'Consistent Navigation', addedIn: '2.0' },
        { sc: '3.2.4', level: 'AA', title: 'Consistent Identification', addedIn: '2.0' },
        { sc: '3.2.5', level: 'AAA', title: 'Change on Request', addedIn: '2.0' },
        { sc: '3.2.6', level: 'A', title: 'Consistent Help', addedIn: '2.2' },

        { sc: '3.3.1', level: 'A', title: 'Error Identification', addedIn: '2.0' },
        { sc: '3.3.2', level: 'A', title: 'Labels or Instructions', addedIn: '2.0' },
        { sc: '3.3.3', level: 'AA', title: 'Error Suggestion', addedIn: '2.0' },
        { sc: '3.3.4', level: 'AA', title: 'Error Prevention (Legal, Financial, Data)', addedIn: '2.0' },
        { sc: '3.3.5', level: 'AAA', title: 'Help', addedIn: '2.0' },
        { sc: '3.3.6', level: 'AAA', title: 'Error Prevention (All)', addedIn: '2.0' },
        { sc: '3.3.7', level: 'A', title: 'Redundant Entry', addedIn: '2.2' },
        { sc: '3.3.8', level: 'AA', title: 'Accessible Authentication (Minimum)', addedIn: '2.2' },
        { sc: '3.3.9', level: 'AAA', title: 'Accessible Authentication (Enhanced)', addedIn: '2.2' },

        { sc: '4.1.1', level: 'A', title: 'Parsing', addedIn: '2.0', removedIn: '2.2' },
        { sc: '4.1.2', level: 'A', title: 'Name, Role, Value', addedIn: '2.0' },
        { sc: '4.1.3', level: 'AA', title: 'Status Messages', addedIn: '2.1' }
    ];

    const LEVEL_ORDER = { A: 1, AA: 2, AAA: 3 };
    const VERSION_ORDER = { '2.0': 0, '2.1': 1, '2.2': 2 };

    function versionRank(v) {
        const rank = VERSION_ORDER[String(v)];
        return Number.isFinite(rank) ? rank : VERSION_ORDER['2.2'];
    }

    /**
     * Conformance is cumulative: a target of AA includes every A criterion.
     */
    function criteriaForScope({ level = 'AA', version = '2.2' } = {}) {
        const maxLevel = LEVEL_ORDER[String(level).toUpperCase()] || LEVEL_ORDER.AA;
        const target = versionRank(version);

        return WCAG_CRITERIA.filter((c) => {
            if (LEVEL_ORDER[c.level] > maxLevel) return false;
            if (versionRank(c.addedIn) > target) return false;
            if (c.removedIn && versionRank(c.removedIn) <= target) return false;
            return true;
        });
    }

    function criterionBySc(sc) {
        const key = String(sc || '').trim();
        return WCAG_CRITERIA.find((c) => c.sc === key) || null;
    }

    return {
        WCAG_CRITERIA,
        criteriaForScope,
        criterionBySc
    };
});
