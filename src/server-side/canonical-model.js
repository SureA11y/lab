const scan = {
    version: "1.0",

    engine: {                // from meta.engine (a11y-engine.js passes this)
        id: "axe",
        name: "axe-core",
        version: "x.y.z"       // or null
    },

    page: {
        url: "https://example.com/page",
        title: null,           // optional if you pass it in meta.page.title
        viewport: null,        // optional if you pass it in meta.page.viewport
        timestamp: "2026-01-03T17:55:00.000Z" // meta.page.timestamp or generated
    },

    scope: {
        include: ["html"],      // or [contextSelector] if provided
        exclude: []            // excludeSelectors
    },

    runOptions: {
        standardTags: [],      // note: the runner populates tags later, engine sets []
        includeBestPractice: false,
        resultTypes: [],       // forwarded from engineOptions.resultTypes if present
        engineOptions: {}      // forwarded engine options
    },

    summary: {
        outcomes: {
            fail: 3,
            cantTell: 1,
            pass: 120,
            notApplicable: 40
        }
    },

    findings: [
        {
            uid: "fail:color-contrast",  // makeFindingUid(outcome, ruleId)
            id: "color-contrast",
            ruleId: "color-contrast",

            title: "Elements must have sufficient color contrast", // help or description
            description: "Ensures the contrast between foreground and background colors meets WCAG 2 AA contrast ratio thresholds",
            helpUrl: "https://dequeuniversity.com/rules/axe/4.8/color-contrast",

            outcome: "fail",            // fail | cantTell | pass | notApplicable
            severity: "serious",        // minor | moderate | serious | critical | unknown
            confidence: 1.0,

            standards: {
                wcag: [
                    {ref: "1.4.3", level: "AA"}, // derived from tags like wcag143 (best effort)
                ],
                tags: ["wcag2aa", "wcag143", "cat.color"],
                wcagLevel: "AA"                 // derived from tags
            },

            wcag: {
                // prefers enriched mapping item.SC (array of {ref, level?}), falls back to parsed wcag tags
                sc: [{ref: "1.4.3", level: "AA"}],
                // subset of sc the rule actually enforces; excludes informative references.
                // Coverage and scoring must read this one to avoid over-attributing criteria.
                scNormative: [{ref: "1.4.3", level: "AA"}]
            },

            occurrences: [
                {
                    uid: "occ:...",          // deterministic hash from ruleId, outcome, pageUrl, target, html
                    pageUrl: "https://example.com/page",
                    target: [".btn.primary"], // axe node.target normalized to array
                    html: "<button class=\"btn primary\">Buy</button>",
                    failureSummary: "Fix any of the following...",
                    summary: "Fix any of the following...", // duplicated from failureSummary; a saved report leaves it out

                    // A saved report keeps only what the engine's record says
                    // beyond the occurrence (report-format.js, compactOccurrence).
                    evidence: {
                        engineNode: { /* the original axe node object, if available */}
                    }
                }
            ],

            raw: null
        }
    ],

    rules: [],               // passes through native.rules if present
    raw: null,               // currently set to null inside fromAxeResults
    diagnostics: {
        durationMs: 0,
        estimatedNodes: 0,
        warnings: [],
        errors: []
    }
}

const scanPayload = {
    id,
    url,
    label,
    engine,
    viewport,
    context,
    exclude,

    metrics: {
        domMetrics,
        a11ySummary,
        metricDefs,
    },

    summary: {
        failCount,
        passesCount,
        reviewCount,
        score,
    },

    runOnly,

    canonical: scan.canonical || null,

    // Native engine output should not be first-class.
    // It exists only when explicitly requested (debug or report export).
    native: null, // or engine-specific object when enabled

};