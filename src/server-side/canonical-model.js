const scan = {
    version: "1.0",

    engine: {                // from meta.engine (a11y-engine.js passes this)
        id: "surea11y",      // the adapter's engineId
        name: "surea11y",
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
            uid: "fail:wcag-1.4.3-contrast-minimum",  // makeFindingUid(outcome, ruleId)
            id: "wcag-1.4.3-contrast-minimum",
            ruleId: "wcag-1.4.3-contrast-minimum",

            title: "Contrast: minimum", // help or description
            description: "Text has a contrast ratio of at least 4.5:1 with its background (3:1 for large text)",
            helpUrl: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",

            outcome: "fail",            // fail | cantTell | pass | notApplicable
            severity: "serious",        // minor | moderate | serious | critical | unknown
            confidence: 1.0,

            standards: {
                wcag: [
                    {ref: "1.4.3", level: "AA"}, // derived from tags like wcag143 (best effort)
                ],
                tags: ["wcag2aa", "wcag143"],
                wcagLevel: "AA"                 // derived from tags
            },

            wcag: {
                // the criteria's numbers, from the engine's mapping or its wcag tags
                sc: ["1.4.3"],
                // subset of sc the rule actually enforces; excludes informative references.
                // Coverage and scoring must read this one to avoid over-attributing criteria.
                scNormative: ["1.4.3"]
            },

            occurrences: [
                {
                    uid: "occ:...",          // deterministic hash from ruleId, outcome, pageUrl, target, html
                    pageUrl: "https://example.com/page",
                    target: [".btn.primary"], // the element's selector, as an array
                    html: "<button class=\"btn primary\">Buy</button>",
                    failureSummary: "Fix any of the following...",
                    summary: "Fix any of the following...", // duplicated from failureSummary; a saved report leaves it out

                    // A saved report keeps only what the engine's record says
                    // beyond the occurrence (report-format.js, compactOccurrence).
                    evidence: {
                        engineNode: { /* the engine's own record of the element, if available */}
                    }
                }
            ],

            raw: null
        }
    ],

    rules: [],               // passes through native.rules if present
    raw: null,               // the engine's own output is not kept here
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