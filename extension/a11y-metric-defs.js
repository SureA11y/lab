'use strict';

/**
 * Canonical metric definitions. Single source for the server, the report UI and the
 * extension, which previously kept a hand-maintained copy that had already drifted.
 *
 * UMD rather than JSON so interval bounds can carry a real Number.POSITIVE_INFINITY;
 * through JSON it becomes null, and a null upper bound silently stops a band matching.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_METRIC_DEFS = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const METRIC_DEFS = {
        // ---- Scores (0..100) ----
        // ---- Scores (0..100) ----
        'scores.adjusted': {
            name: 'Accessibility Risk Ind.',
            help:
                'Risk based indicator derived from automated checks, normalized to 0–100. Low engine confidence inflates the measured risk rather than scaling the whole score, so a page with little risk is not penalized for uncertainty about the little it found. It is an evidence signal, not a conformance statement.',
            caveat: 'Covers only what automation can test, and a check tests just part of what a criterion requires. Read it with the coverage figures.',
            min: 0,
            max: 100,
            intervals: [
                { from: 0, to: 40, label: 'High risk', key: 'bad' },
                { from: 40, to: 60, label: 'Significant risk', key: 'warn' },
                { from: 60, to: 85, label: 'Mixed', key: 'ok' },
                { from: 85, to: 100, label: 'Lower risk', key: 'good' }
            ],
            isPercent: false,
            polarity: 'higher-is-better'
        },

        'scores.avgPageAccessibility': {
            name: 'Automated check result',
            help:
                'Typical result of the automated checks that ran. For a single page, it matches the page result. For a global summary, it is the mean across scanned pages, or, when no page has enough on its own to score, the result of all the pages together. Automation reaches only part of WCAG, so a high value means few automated findings, not an accessible page.',
            caveat: 'Covers only what automation can test, and a check tests just part of what a criterion requires. Read it with the coverage figures.',
            min: 0,
            max: 100,
            intervals: [
                { from: 0, to: 40, label: 'Many findings', key: 'bad' },
                { from: 40, to: 60, label: 'Several findings', key: 'warn' },
                { from: 60, to: 85, label: 'Some findings', key: 'ok' },
                { from: 85, to: 100, label: 'Few findings', key: 'good' }
            ],
            isPercent: false,
            polarity: 'higher-is-better'
        },

        'scores.evidence': {
            name: 'Automated evidence',
            help:
                'Automated evidence from findings severity and their density per evaluable element - the elements accessibility rules can apply to, so page size alone does not move it. Excludes the reliability adjustment.',
            min: 0,
            max: 100,
            intervals: [
                { from: 0, to: 40, label: 'Low', key: 'bad' },
                { from: 40, to: 60, label: 'Moderate', key: 'warn' },
                { from: 60, to: 85, label: 'Good', key: 'ok' },
                { from: 85, to: 100, label: 'Strong', key: 'good' }
            ],
            isPercent: false,
            polarity: 'higher-is-better'
        },

        'scores.confidence': {
            name: 'Assessment Confidence',
            help:
                'How reliable the automated evidence is, taken from the engine’s own per-check confidence for the findings reported. Not every engine reports one, so on a run of several engines this can describe only part of what was found - the chip says so when it does, and the score applies the uncertainty only over that part. Lower confidence means manual verification is more important.',
            min: 0,
            max: 100,
            intervals: [
                { from: 0, to: 75, label: 'Low', key: 'bad' },
                { from: 75, to: 85, label: 'Medium', key: 'warn' },
                { from: 85, to: 100, label: 'High', key: 'good' }
            ],
            isPercent: true,
            polarity: 'higher-is-better'
        },

        // ---- DOM ratios (stored 0..1) ----
        'dom.semanticRatio': {
            name: 'Semantic markup',
            help: 'Share of meaningful semantic HTML compared to generic containers.',
            min: 0,
            max: 1,
            intervals: [],
            isPercent: false,
            polarity: 'higher-is-better'
        },
        'dom.coverageRatio': {
            name: 'Meaningful content share',
            help: 'Share of the DOM that carries meaningful content rather than layout scaffolding. A low share can reduce how representative automated checks are. Unrelated to how many WCAG criteria were covered.',
            min: 0,
            max: 1,
            intervals: [
                { from: 0, to: 0.15, label: 'Low', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'higher-is-better'
        },
        'dom.customControlsRatio': {
            name: 'Custom controls ratio',
            help:
                'Ratio of custom interactive patterns (ARIA interactive roles, tabindex-focusable elements) to native interactive elements. Higher values suggest more manual keyboard, naming, and state validation.',
            min: 0,
            max: null,
            intervals: [
                { from: 0.40, to: Number.POSITIVE_INFINITY, label: 'High', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'dom.hiddenRatio': {
            name: 'Hidden content',
            help: 'Share of elements considered hidden. High hidden content can increase complexity and reduce reliability of some signals.',
            min: 0,
            max: 1,
            intervals: [
                { from: 0.30, to: 1, label: 'High', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'lower-is-better'
        },

        // ---- DOM counts / diagnostics ----
        'dom.depthMax': {
            name: 'Max DOM depth',
            help: 'Maximum DOM nesting depth observed during traversal.',
            min: 0,
            max: null,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'dom.focusableDensityPer1k': {
            name: 'Focusable density (per 1k)',
            help: 'Number of focusable elements per 1,000 DOM nodes.',
            min: 0,
            max: null,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'dom.iframeCount': {
            name: 'Iframes',
            help: 'Number of iframes detected. Cross-origin iframes can reduce automated coverage.',
            min: 0,
            max: null,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'dom.shadowHostCount': {
            name: 'Shadow hosts',
            help: 'Number of Shadow DOM hosts detected. Shadow DOM can reduce visibility for some automated tools.',
            min: 0,
            max: null,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'dom.capped': {
            name: 'Capped metrics',
            help: 'Indicates metrics collection hit a safety cap (page size or text size). Capped metrics may be incomplete.',
            min: 0,
            max: 1,
            intervals: [
                { from: 1, to: 1, label: 'Capped', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'lower-is-better'
        },

        // ---- Control rates (stored 0..1) ----
        'controls.linksNoTextRate': {
            name: 'Links with no visible text',
            help: 'Share of links with no visible text. Not automatically wrong, but increases uncertainty and needs manual verification.',
            min: 0,
            max: 1,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'controls.linksNoTextNoNameRate': {
            name: 'Links no text and no name',
            help: 'Share of links with no visible text and no obvious accessible-name signals.',
            min: 0,
            max: 1,
            intervals: [
                { from: 0.10, to: 1, label: 'High', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'controls.linkTextShare': {
            name: 'Link text share',
            help: 'Share of total visible page text coming from links.',
            min: 0,
            max: 1,
            intervals: [],
            isPercent: false,
            polarity: 'higher-is-better'
        },

        'controls.buttonsNoTextRate': {
            name: 'Buttons with no visible text',
            help: 'Share of buttons with no visible text. Not automatically wrong, but increases uncertainty and needs manual verification.',
            min: 0,
            max: 1,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'controls.buttonsNoTextNoNameRate': {
            name: 'Buttons no text and no name',
            help: 'Share of buttons with no visible text and no obvious accessible-name signals.',
            min: 0,
            max: 1,
            intervals: [
                { from: 0.10, to: 1, label: 'High', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'controls.buttonTextShare': {
            name: 'Button text share',
            help: 'Share of total visible page text coming from buttons.',
            min: 0,
            max: 1,
            intervals: [],
            isPercent: false,
            polarity: 'higher-is-better'
        },

        // ---- Counts and densities (unbounded) ----
        'dom.statefulComponentsCount': {
            name: 'Stateful components',
            help: 'Count of stateful patterns such as dialogs, expanders, tabs, or ARIA-expanded usage. Higher counts usually require more manual interaction testing.',
            min: 0,
            max: null,
            intervals: [
                { from: 15, to: Number.POSITIVE_INFINITY, label: 'Many', key: 'warn' }
            ],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'controls.linksPer1k': {
            name: 'Links per 1k',
            help: 'Number of links per 1,000 DOM elements.',
            min: 0,
            max: null,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        },
        'controls.buttonsPer1k': {
            name: 'Buttons per 1k',
            help: 'Number of buttons per 1,000 DOM elements.',
            min: 0,
            max: null,
            intervals: [],
            isPercent: false,
            polarity: 'lower-is-better'
        }
    };

    return { METRIC_DEFS };
});
