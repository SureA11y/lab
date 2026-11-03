'use strict';

const { viewportPresetOptions } = require('../shared/scan-inputs.js');

// Shared by the element-targeting "interaction" steps.
function scrollIntoViewField(verb, note = "") {
    return {
        type: "boolean",
        required: false,
        default: true,
        alias: "Scroll into view",
        description: `Scroll the element to the center of the viewport before ${verb}.` + (note ? ` ${note}` : "")
    };
}

const ACTION_DEFINITIONS = {
    a11yScan: {
        label: "A11y scan",
        category: "a11y",
        description: "Run an accessibility scan on the current page or within a selector. You can narrow the scan to a region using 'context' and exclude noisy areas using 'exclude'.",
        fields: {
            label: {
                type: "string",
                required: false,
                alias: "Scan label",
                description: "Label shown in reports and live stream. Supports {var:name}, {index}, {oneBased}, {total}.",
                placeholder: "After action",
                example: "Product {oneBased} details"
            },
            scanTags: {
                type: "string[]",
                widget: "tags",
                required: false,
                alias: "Tags",
                description: "Free-form tags for this scan. Used to filter the report by tag once the run finishes. Supports {var:name}, {index}, {oneBased}, {total}, so a single tag like {var:viewport} fills in per iteration. Pick tags already used elsewhere in this workflow or add new ones.",
                placeholder: "desktop, mobile",
                example: "desktop, checkout"
            },
            context: {
                type: "string",
                required: false,
                alias: "Include selectors",
                cssSelector: true,
                description: "The parts of the page this scan checks: every element these CSS selectors match, comma separated. Empty, the scan checks the whole page. A selector that matches nothing scans nothing, and the report says so.",
                placeholder: "main",
                example: "main, #content"
            },
            exclude: {
                type: "string|string[]",
                required: false,
                alias: "Exclude selectors",
                cssSelector: true,
                description: "The parts of the page this scan leaves out: every element these CSS selectors match, comma separated.",
                example: ".cookie, .ads, [data-test='skip-a11y']"
            },
            includeBestPractice: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Include best-practice rules",
                description: "Also run the best-practice rules in this scan: good practice beyond the profile, such as landmarks and heading order. The profile alone never runs them. Their findings are listed in a Best practices section of their own and count toward no criterion, score, compliance rate or comparison."
            },
            profile: {
                type: "string|string[]",
                widget: "profiles",
                required: false,
                alias: "Profile",
                description: "What this scan checks against, WCAG 2.2 AA unless it says otherwise: WCAG 2.2 at Level A, AA or AAA, or a standard, which sets the WCAG version and the level, all of them Level A and AA: EN 301 549 V4.1.1, the EU standard, which is WCAG 2.2, and EN 301 549 V3.2.1, its earlier version, which is WCAG 2.1 and still checks 4.1.1 Parsing. surea11y applies a standard in full, version details such as 4.1.1 included. A list checks against several at once, such as [\"wcag22-aa\", \"wai-aria-1.2\"]: one WCAG level at most, since each includes the ones below it, and any standards. Each one judges the page as a scan of it alone would, and a finding that fails any of them fails the scan; a finding says what each one makes of it. A variable may hold one profile or several separated by commas. Including rule IDs or tags explicitly takes precedence over a standard. Passing the rules does not mean the page meets the standard: many criteria still need a manual check.",
                default: "wcag22-aa",
                // An installed standard pack adds its profiles to these
                // (server-side/standard-packs.js).
                packValues: true,
                options: [
                    {value: "wcag22-a", label: "WCAG 2.2 A"},
                    {value: "wcag22-aa", label: "WCAG 2.2 AA"},
                    {value: "wcag22-aaa", label: "WCAG 2.2 AAA"},
                    {value: "en301549-v4.1.1", label: "EN 301 549 V4.1.1"},
                    {value: "en301549-v3.2.1", label: "EN 301 549 V3.2.1"}
                ]
            },
            locale: {
                type: "string",
                required: false,
                alias: "Results language",
                description: "Language surea11y writes its findings in: rule titles, what failed, how to fix it, and the WCAG criteria names. Rules that judge wording, such as vague link text or generic headings, go by the language of the page, not this setting.",
                default: "en",
                options: [
                    {value: "en", label: "English"},
                    {value: "de", label: "Deutsch"},
                    {value: "es", label: "Español"},
                    {value: "fr", label: "Français"},
                    {value: "ja", label: "日本語"}
                ]
            },
            applyDefaultStyle: {
                type: "boolean",
                alias: "Blur exclusions",
                required: false,
                default: true,
                description: "Blur and fade the parts of the page the scan leaves out (Exclude selectors, and what is outside Context) in the scan's screenshots, so they show what was checked."
            },
            preserveHover: {
                type: "boolean",
                alias: "Preserve hover state",
                required: false,
                default: false,
                description: "Keep current :hover styling for this scan/evidence capture. Disable to clear transient hover before capture."
            },
            waitTimeout: {
                type: "number",
                required: false,
                alias: "Wait timeout (ms)",
                description: "How long Wait for waits for its selector before the step fails.",
                placeholder: 10000,
                default: 10000,
                example: 15000,
                step: 500
            },
            stageTimeout: {
                type: "number",
                required: false,
                alias: "Time limit per stage (ms)",
                description: "The most each stage of the scan may take before it is given up on: loading the engine into the page, letting the page settle, the page ready wait, the check itself and the screenshot. Pictures of flagged elements get their own time on top.",
                placeholder: 60000,
                default: 60000,
                example: 120000,
                step: 1000
            },
            pageReadyTimeout: {
                type: "number",
                required: false,
                alias: "Page ready timeout (ms)",
                description: "Before scanning, wait up to this long for the page to finish loading: the load event, web fonts and images (not lazy ones). If it has not finished by then, the scan runs anyway and its report says what was still loading. 0 checks without waiting.",
                placeholder: 3000,
                default: 3000,
                example: 5000,
                step: 500
            },
            frames: {
                type: "boolean",
                required: false,
                alias: "Scan iframes too",
                description: "Scan the content of the page's iframes as well, each whole, and report what they show with the page: an element in an iframe names the iframe it is in. An iframe the page doesn't show, that the scan excludes or leaves outside its Include, or that shows nothing is left out, and the report says which and why; one under aria-hidden is scanned for what is seen, not for names and roles. Off, the default, the page's own content is scanned and the report says how many iframes were left out.",
                default: false
            },
            heavyNodeThreshold: {
                type: "number",
                required: false,
                alias: "Note pages with more elements than",
                description: "A page with more elements than this (its shadow roots' included) is still scanned in full, and its report notes that it is large and how long the scan took, with how to make it faster: scan the part that matters, or leave out a long list.",
                placeholder: 25000,
                default: 25000,
                example: 40000,
                step: 500
            },
            waitForSelector: {
                type: "string",
                required: false,
                alias: "Wait for",
                description: "Start the scan only once this selector is on the page, for content that loads late. If it does not appear within the wait timeout, the step fails rather than scanning the page without it.",
                placeholder: ".main-content",
                example: "main .product-list"
            },
            waitVisible: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Require visibility",
                description: "With Wait for, wait until the element is visible, not only on the page."
            },
            includeRuleIds: {
                type: "string|string[]",
                required: false,
                ruleIds: true,
                alias: "Include rules",
                description: "The only rules this scan runs: the rest of its level's rules do not. Name a WCAG criterion (wcag-1.4.3-contrast-minimum) to check it in full, or single checks (contrast-minimum); a criterion only some of whose checks run is reported as partly checked unless one of them fails. Use a comma separated string.",
                example: "wcag-1.4.3-contrast-minimum, landmark-one-main"
            },
            excludeRuleIds: {
                type: "string|string[]",
                required: false,
                ruleIds: true,
                alias: "Exclude rules",
                description: "Rule IDs to exclude for this scan only. Use a comma separated string.",
                example: "contrast-minimum, region"
            },
            includeTags: {
                type: "string|string[]",
                required: false,
                alias: "Include tags",
                description: "Run only the rules with these tags, within the scan's WCAG version and level (rules that test no WCAG criterion, such as best practices, as tagged). Their criteria are reported as with Include rules: partly checked when some of a criterion's checks do not run. Use a comma separated string.",
                example: "contrast, forms"
            },
            excludeTags: {
                type: "string|string[]",
                required: false,
                alias: "Exclude tags",
                description: "Rule tags to exclude for this scan only. Use a comma separated string.",
                example: "contrast, landmarks"
            },
            includeMode: {
                type: "string",
                required: false,
                alias: "Combine Include rules and tags",
                description: "With both Include rules and Include tags: run only the rules that are in both, or every rule that is in either.",
                default: "and",
                options: [{ value: "and", label: "Rules in both" }, { value: "or", label: "Rules in either" }]
            },
            engineMode: {
                type: "string",
                required: false,
                alias: "Checking mode",
                description: "Auditor support makes the assumptions an auditor would where the page leaves something unset, such as a white background behind the page; Strict conformance assumes nothing the page does not state.",
                default: "auditorAssist",
                options: [{value: "auditorAssist", label: "Auditor support"}, {value: "strictConformance", label: "Strict conformance"}]
            },
            findingsSource: {
                type: "string",
                required: false,
                alias: "Report findings by",
                description: "Whether findings are reported per WCAG success criterion, gathering the checks behind each one, or per single check, or both.",
                default: "composite",
                options: [{value: "composite", label: "Criterion"}, {value: "atomic", label: "Single check"}, {value: "Both", label: "Both"}]
            },
            screenshotView: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Screenshot view",
                description: "Take a screenshot of the page once the scan is done, shown with its results. Set to false for a scan that needs no picture of the page: it runs faster and its report is smaller. Pictures of the flagged elements (Element screenshots) are set apart."
            },
            elementScreenshots: {
                type: "string",
                required: false,
                alias: "Element screenshots",
                description: "Take a picture of each element surea11y flags, with a box around it, shown beside its finding. A finding that shows only with the WCAG text spacing applied also gets a picture with the spacing applied, beside the one of the page as it is.",
                default: "fail",
                options: [
                    { value: "off", label: "None" },
                    { value: "fail", label: "Failures" },
                    { value: "failCantTell", label: "Failures and can't tell" }
                ]
            },
            elementScreenshotsMax: {
                type: "number",
                integer: true,
                min: 0,
                required: false,
                default: 50,
                alias: "Most element screenshots",
                description: "The most pictures one scan takes when Element screenshots is on; 0 for no limit, though a scan still has 30 seconds for its pictures. Elements past it say so beside their finding.",
                example: 20
            },
            elementScreenshotsPerRule: {
                type: "number",
                integer: true,
                min: 0,
                required: false,
                default: 0,
                alias: "Most element screenshots per rule",
                description: "The most elements pictured for each rule, so the rules checked first don't take every picture; 0 for no limit. An element pictured for one rule shows that picture under every rule that flags it.",
                example: 3
            }
        },
        fieldOrder: {
            primary: ["label", "scanTags", "profile"],
            secondary: [
                "context",
                "exclude",
                "screenshotView",
                "frames",
                "elementScreenshots",
                "elementScreenshotsMax",
                "elementScreenshotsPerRule",
                "includeBestPractice",
                "findingsSource",
                "applyDefaultStyle",
                "preserveHover",
                "engineMode",
                "locale",
                "waitForSelector",
                "waitVisible",
                "waitTimeout",
                "includeRuleIds",
                "excludeRuleIds",
                "includeTags",
                "excludeTags",
                "includeMode",
                "stageTimeout",
                "heavyNodeThreshold",
            ]
        },
        examples: [
            {
                title: "Scan whole page",
                snippet: {type: "a11yScan", label: "Full page"}
            },
            {
                title: "Scan only main content",
                snippet: {type: "a11yScan", label: "Main area", context: "#main"}
            },
            {
                title: "Scan only one rule",
                snippet: {
                    type: "a11yScan",
                    label: "Contrast check",
                    includeRuleIds: ["wcag-1.4.3-contrast-minimum"]
                }
            },
            {
                title: "Scan product details and ignore banners",
                snippet: {
                    type: "a11yScan",
                    label: "Product {oneBased}",
                    context: "#product",
                    exclude: [".ads", ".cookie"]
                }
            }
        ]
    },

    click: {
        label: "Click",
        category: "interaction",
        description: "Click by selector, or click by visible text (labelText). When labelText is set, selector becomes an optional scope.",
        fields: {
            labelText: {
                type: "string",
                required: false,
                alias: "Text to click",
                description: "Visible text (or accessible name sources) to find. If set, this is the target, and selector is treated as an optional scope.",
                placeholder: "Log in",
                example: "Add to cart"
            },
            selector: {
                type: "string",
                required: false,
                alias: "Element selector / scope selector",
                description: "If labelText is NOT set, this is the CSS selector for the element to click. If labelText IS set, this is an optional scope container selector. Use :ctx inside forEachElement.",
                placeholder: "#open-modal",
                example: ":ctx a.details"
            },
            programmatic: {
                type: "boolean",
                required: false,
                alias: "Programmatic click",
                description: "Click by calling the element's click() in the page, instead of with the mouse: for an element the mouse cannot reach, such as one something else covers.",
                default: false
            },
            mouseButton: {
                type: "string",
                required: false,
                alias: "Mouse button",
                description: "If the click is done with the left or right button.",
                default: "left",
                options: ["left", "right"]
            },
            clickKind: {
                type: "string",
                required: false,
                alias: "Single or double click",
                description: "If it is single or double click.",
                default: "click",
                options: [{value: "click", label: "single"}, {value: "doubleClick", label: "double"}]
            },
            scrollIntoView: scrollIntoViewField("clicking", "A pointer click may still scroll if the element is outside the viewport."),
            caseSensitive: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Case sensitive (labelText)",
                description: "Use case-sensitive comparison when clicking by labelText."
            },
            exact: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Exact match (labelText)",
                description: "Match full text when true. Default is substring match."
            },
            allowPointerFallback: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Allow pointer fallback",
                description: "When clicking by labelText, allow clicking non-interactive targets near the matched text."
            },
            pointerFallbackMaxMatches: {
                type: "number",
                integer: true,
                required: false,
                default: 1,
                step: 1,
                alias: "Pick nth match",
                description: "When labelText appears multiple times, pick the nth visible match (1 = first).",
                example: 2
            },
            timeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Timeout (ms)",
                description: "When clicking by labelText, how long to wait for the target to appear.",
                example: 5000
            },
            waitUntil: {
                type: "string",
                required: false,
                alias: "Wait until",
                description: "If set, waits for a possible navigation after the click.",
                options: ["load", "domcontentloaded", "networkidle0"]
            },
            retries: {
                type: "number",
                integer: true,
                required: false,
                default: 0,
                alias: "Retry attempts",
                description: "Extra attempts if the click fails.",
                step: 1,
                example: 2
            },
            retryDelay: {
                type: "number",
                required: false,
                default: 500,
                alias: "Retry delay (ms)",
                description: "Time in ms between retries.",
                step: 500,
                example: 1000
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this click fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Open the menu"
            }
        },
        fieldOrder: {
            primary: ["selector", "labelText", "programmatic"],
            secondary: [
                "mouseButton",
                "clickKind",
                "scrollIntoView",
                "caseSensitive",
                "exact",
                "allowPointerFallback",
                "pointerFallbackMaxMatches",
                "timeout",
                "waitUntil",
                "retries",
                "retryDelay",
                "optional",
                "label"
            ]
        },
        examples: [
            { title: "Click by selector", snippet: { type: "click", selector: "#open-modal" } },
            { title: "Click details inside the current card", snippet: { type: "click", selector: ":ctx a.details" } },
            { title: "Click by text (global)", snippet: { type: "click", labelText: "Log in" } },
            { title: "Click by text within scope", snippet: { type: "click", labelText: "Details", selector: ":ctx" } }
        ]
    },

    type: {
        label: "Type into field",
        category: "interaction",
        description: "Type text into an input or textarea. You can clear first, add delay between keys, and press Enter at the end.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Field selector",
                description: "CSS selector of the input or textarea.",
                placeholder: "#search-input",
                example: "#search"
            },
            text: {
                type: "string",
                required: true,
                alias: "Text to type",
                description: "Text to type.",
                placeholder: "example",
                example: "Accessibility"
            },
            delay: {
                type: "number",
                required: false,
                default: 0,
                alias: "Key delay (ms)",
                description: "Delay in ms between keystrokes.",
                step: 500,
                example: 50
            },
            clear: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Clear before typing",
                description: "Clear the field before typing."
            },
            pressEnter: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Press Enter after typing",
                description: "Press Enter after typing."
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Search for shoes"
            },
            scrollIntoView: scrollIntoViewField("typing", "Focusing the field may still make the browser scroll it into view.")
        },
        fieldOrder: {
            primary: ["selector", "text"],
            secondary: [
                "delay",
                "clear",
                "pressEnter",
                "scrollIntoView",
                "optional",
                "label"
            ]
        },
        examples: [
            {
                title: "Search and submit",
                snippet: {type: "type", selector: "#search", text: "WCAG 2.2", pressEnter: true}
            }
        ]
    },

    setValue: {
        label: "Set field value",
        category: "interaction",
        description: "Set the value of an input or textarea directly in the DOM without typing.",
        fields: {
            selector: {
                type: "string",
                required: false,
                alias: "Field selector",
                description: "CSS selector of the input or textarea.",
                placeholder: "#email",
                example: "input[name='email']"
            },
            labelText: {
                type: "string",
                required: false,
                alias: "Label to find the field",
                description: "Label that the field to edit has.",
                placeholder: "name",
                example: "Email address"
            },
            value: {
                type: "string",
                required: true,
                alias: "Value",
                description: "Value to set. It is saved with the configuration; use \"Set password value\" for a value that must not be.",
                placeholder: "user@example.com",
                example: "test@example.com"
            },
            caseSensitive: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Case sensitive when select by label",
                description: "Use case-sensitive comparison."
            },
            exact: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Exact match when select by label",
                description: "Match the full text when true. Default is substring match.",
                placeholder: false
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Fill in the email"
            },
            scrollIntoView: scrollIntoViewField("setting its value")
        },
        fieldOrder: {
            primary: ["labelText", "selector", "value"],
            secondary: ["caseSensitive", "exact", "scrollIntoView", "optional", "label"]
        },
        examples: [
            {title: "Fill email quickly", snippet: {type: "setValue", selector: "#email", value: "user@example.com"}}
        ]
    },

    setPassword: {
        label: "Set password value",
        category: "interaction",
        description: "Set the value of a password or other secret field, like \"Set field value\", but the value is never saved: configurations carry \"valueMasked\": true and no value. Type it again after loading a configuration; a run with the value empty fails. In a spec file, the value can instead be read from an environment variable when the run starts, as {\"$env\": \"SHOP_PASSWORD\"}: the file then holds no password and can run unattended.",
        fields: {
            selector: {
                type: "string",
                required: false,
                alias: "Field selector",
                description: "CSS selector of the input.",
                placeholder: "#password",
                example: "#password"
            },
            labelText: {
                type: "string",
                required: false,
                alias: "Label to find the field",
                description: "Label that the field to edit has.",
                placeholder: "password",
                example: "Password"
            },
            value: {
                type: "string",
                secret: true,
                required: true,
                alias: "Password",
                description: "Value to set. Hidden on screen unless revealed with the field's button, and never saved with the configuration, revealed or not. Or {\"$env\": \"NAME\"}: read from that environment variable where the workflow runs, and saved as the reference, so unattended runs can use it.",
                example: "{\"$env\": \"SHOP_PASSWORD\"}"
            },
            caseSensitive: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Case sensitive when select by label",
                description: "Use case-sensitive comparison."
            },
            exact: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Exact match when select by label",
                description: "Match the full text when true. Default is substring match.",
                placeholder: false
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Fill in the password"
            },
            scrollIntoView: scrollIntoViewField("setting its value")
        },
        fieldOrder: {
            primary: ["labelText", "selector", "value"],
            secondary: ["caseSensitive", "exact", "scrollIntoView", "optional", "label"]
        },
        examples: [
            {title: "Fill a password", snippet: {type: "setPassword", labelText: "Password", valueMasked: true}},
            {title: "Fill a password from the environment", snippet: {type: "setPassword", labelText: "Password", value: {"$env": "SHOP_PASSWORD"}}}
        ]
    },

    clickByText: {
        label: "Click by text",
        category: "interaction",
        description: "Find a clickable element by its text. Works with buttons, links, and elements inside an optional selector scope.",
        fields: {
            labelText: {
                type: "string",
                required: true,
                alias: "Text to find",
                description: "Text to look for. Spaces are trimmed.",
                placeholder: "Log in",
                example: "Add to cart"
            },
            selector: {
                type: "string",
                required: false,
                alias: "Scope selector",
                description: "Scope for the search. If omitted, searches common interactive elements. Use :ctx inside forEachElement.",
                example: "nav"
            },
            caseSensitive: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Case sensitive",
                description: "Use case-sensitive comparison."
            },
            mouseButton: {
                type: "string",
                required: false,
                alias: "Mouse button",
                description: "If the click is done with the left or right button.",
                default: "left",
                options: ["left", "right"]
            },
            programmatic: {
                type: "boolean",
                required: false,
                alias: "Programmatic click",
                description: "Click by calling the element's click() in the page, instead of with the mouse: for an element the mouse cannot reach, such as one something else covers.",
                default: false
            },
            clickKind: {
                type: "string",
                required: false,
                alias: "Single or double click",
                description: "If it is single or double click.",
                default: "click",
                options: [{value: "click", label: "single"}, {value: "doubleClick", label: "double"}]
            },
            exact: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Exact match",
                description: "Match the full text when true. Default is substring match.",
                placeholder: false
            },
            allowPointerFallback: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Allow pointer fallback",
                description: "It tries to click not only on interactive elements.",
                placeholder: false
            },
            pointerFallbackMaxMatches: {
                type: "number",
                integer: true,
                required: false,
                default: 1,
                alias: "Timeout (ms)",
                description: "If text appears multiple times, either pick first match (fast) or allow picking nth.",
                example: 2
            },
            timeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Timeout (ms)",
                description: "How long to wait for the target to appear.",
                example: 5000
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Open the cart"
            },
            scrollIntoView: scrollIntoViewField("clicking", "A pointer click may still scroll if the element is outside the viewport.")
        },
        fieldOrder: {
            primary: ["labelText", "selector", "programmatic",],
            secondary: [
                "mouseButton",
                "clickKind",
                "caseSensitive",
                "exact",
                "allowPointerFallback",
                "pointerFallbackMaxMatches",
                "timeout",
                "scrollIntoView",
                "optional",
                "label"
            ]
        },
        examples: [
            {title: "Click a Login button", snippet: {type: "clickByText", labelText: "Log in"}},
            {
                title: "Click a scoped button within the current card",
                snippet: {type: "clickByText", labelText: "Details", selector: ":ctx"}
            }
        ]
    },

    focus: {
        label: "Focus",
        category: "interaction",
        description: "Move keyboard focus to the first element that matches the selector.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Element selector",
                description: "CSS selector of the element to focus.",
                placeholder: "#user-name",
                example: "#search"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Focus the search field"
            },
            scrollIntoView: scrollIntoViewField("focusing", "Focusing may still make the browser scroll the element into view.")
        },
        fieldOrder: {
            primary: ["selector"],
            secondary: ["scrollIntoView", "optional", "label"]
        },
        examples: [
            {title: "Focus main heading", snippet: {type: "focus", selector: "h1"}}
        ]
    },

    hover: {
        label: "Hover element",
        category: "interaction",
        description: "Trigger hover on the first match of the selector.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Element selector",
                description: "CSS selector to hover.",
                placeholder: "#menu-item",
                example: "nav .menu-item:first-child"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Open the first menu"
            },
            scrollIntoView: scrollIntoViewField("hovering", "Hovering may still scroll if the element is outside the viewport.")
        },
        fieldOrder: {
            primary: ["selector"],
            secondary: ["scrollIntoView", "optional", "label"]
        },
        examples: [
            {title: "Open a hover menu", snippet: {type: "hover", selector: "#menu > li:nth-child(2) > a"}}
        ]
    },

    focusByText: {
        label: "Focus by text",
        category: "interaction",
        description: "Find the element by its text. Works with buttons, links, and elements inside an optional selector scope.",
        fields: {
            labelText: {
                type: "string",
                required: true,
                alias: "Text to find",
                description: "Text to look for. Spaces are trimmed.",
                placeholder: "Log in",
                example: "Add to cart"
            },
            selector: {
                type: "string",
                required: false,
                alias: "Scope selector",
                description: "Scope for the search. If omitted, searches common interactive elements. Use :ctx inside forEachElement.",
                example: "nav"
            },
            caseSensitive: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Case sensitive",
                description: "Use case-sensitive comparison."
            },
            exact: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Exact match",
                description: "Match the full text when true. Default is substring match.",
                placeholder: false
            },
            timeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Timeout (ms)",
                description: "How long to wait for the target to appear.",
                example: 5000
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Focus the Products link"
            },
            postWaitForSelector: {
                type: "string",
                required: false,
                alias: "Wait after hover",
                description: "Selector that must appear after hovering (e.g., a menu panel).",
                example: ".submenu"
            },
            postWaitVisible: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Require visibility",
                description: "Require the post-hover selector to be visible."
            },
            postWaitTimeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Post-wait timeout (ms)",
                description: "Timeout for the post-hover wait.",
                example: 3000
            },
            scrollIntoView: scrollIntoViewField("focusing", "Focusing may still make the browser scroll the element into view.")
        },
        fieldOrder: {
            primary: ["labelText"],
            secondary: [
                "selector",
                "caseSensitive",
                "exact",
                "timeout",
                "scrollIntoView",
                "optional",
                "label",
                "postWaitForSelector",
                "postWaitVisible",
                "postWaitTimeout"
            ]
        },
        examples: [
            {title: "Open a hover Menu button", snippet: {type: "focusByText", labelText: "Log in"}}
        ]
    },

    hoverByText: {
        label: "Hover by text",
        category: "interaction",
        description: "Find a clickable element by its text. Works with buttons, links, and elements inside an optional selector scope.",
        fields: {
            labelText: {
                type: "string",
                required: true,
                alias: "Text to find",
                description: "Text to look for. Spaces are trimmed.",
                placeholder: "Log in",
                example: "Add to cart"
            },
            selector: {
                type: "string",
                required: false,
                alias: "Scope selector",
                description: "Scope for the search. If omitted, searches common interactive elements. Use :ctx inside forEachElement.",
                example: "nav"
            },
            caseSensitive: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Case sensitive",
                description: "Use case-sensitive comparison."
            },
            exact: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Exact match",
                description: "Match the full text when true. Default is substring match.",
                placeholder: false
            },
            timeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Timeout (ms)",
                description: "How long to wait for the target to appear.",
                example: 5000
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action action."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Open the Products menu"
            },
            postWaitForSelector: {
                type: "string",
                required: false,
                alias: "Wait after hover",
                description: "Selector that must appear after hovering (e.g., a menu panel).",
                example: ".submenu"
            },
            postWaitVisible: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Require visibility",
                description: "Require the post-hover selector to be visible."
            },
            postWaitTimeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Post-wait timeout (ms)",
                description: "Timeout for the post-hover wait.",
                example: 3000
            },
            scrollIntoView: scrollIntoViewField("hovering", "Hovering may still scroll if the element is outside the viewport.")
        },
        fieldOrder: {
            primary: ["labelText"],
            secondary: [
                "selector",
                "caseSensitive",
                "exact",
                "timeout",
                "scrollIntoView",
                "optional",
                "label",
                "postWaitForSelector",
                "postWaitVisible",
                "postWaitTimeout"
            ]
        },
        examples: [
            {title: "Open a hover Menu button", snippet: {type: "hoverByText", labelText: "Log in"}}
        ]
    },

    hoverOut: {
        label: "Hover out",
        category: "interaction",
        description: "End a hover state by moving the pointer away, causing hover-based panels or menus to close.",
        fields: {
            selector: {
                type: "string",
                required: false,
                alias: "Target selector",
                description: "Optional selector to move the pointer to. If omitted, the pointer is moved to a neutral viewport location.",
                example: "body"
            },
            scrollIntoView: scrollIntoViewField("moving the pointer onto it")
        },
        fieldOrder: {
            primary: [],
            secondary: ["selector", "scrollIntoView"]
        },
    },

    waitForSelector: {
        label: "Wait for selector",
        category: "wait",
        description: "Wait until a selector is present, optionally visible. Useful for dynamic pages.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Selector to wait for",
                description: "CSS selector to wait for.",
                placeholder: ".modal",
                example: ".results-loaded"
            },
            visible: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Require visibility",
                description: "Require visibility when true. Existence is enough when false.",
                placeholder: true
            },
            timeout: {
                type: "number",
                required: false,
                default: 10000,
                step: 500,
                alias: "Timeout (ms)",
                description: "Timeout in ms.",
                example: 15000
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Wait for the results"
            }
        },
        fieldOrder: {
            primary: ["selector"],
            secondary: ["visible", "timeout", "optional", "label"]
        },
        examples: [
            {
                title: "Wait for dialog to open",
                snippet: {type: "waitForSelector", selector: ".dialog[open]", visible: true, timeout: 8000}
            }
        ]
    },

    wait: {
        label: "Wait",
        category: "wait",
        description: "Pause for a fixed number of milliseconds. Prefer waitForSelector when possible.",
        fields: {
            ms: {
                type: "number",
                required: false,
                default: 2000,
                min: 0,
                // An hour: past 2^31 - 1 ms (about 24.8 days) a timer fires at once.
                max: 3600000,
                step: 500,
                alias: "Milliseconds",
                description: "Time to wait in ms, at most an hour (3600000).",
                placeholder: 1500,
                example: 1500
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Let the carousel settle"
            }
        },
        fieldOrder: {
            primary: ["ms"],
            secondary: ["optional", "label"]
        },
        examples: [
            {title: "Give time to a spinner", snippet: {type: "wait", ms: 1200}}
        ]
    },

    scrollIntoView: {
        label: "Scroll element into view",
        category: "scroll",
        description: "Scroll until the element is centered in the viewport.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Element selector",
                description: "CSS selector to bring into view.",
                placeholder: "#footer",
                example: "footer"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Bring the footer into view"
            }
        },
        fieldOrder: {
            primary: ["selector"],
            secondary: ["optional", "label"]
        },
        examples: [
            {title: "Reveal footer", snippet: {type: "scrollIntoView", selector: "#footer"}}
        ]
    },

    scroll: {
        label: "Scroll page",
        category: "scroll",
        description: "Scroll the page to top, bottom, or by a custom offset.",
        fields: {
            to: {
                type: "string",
                required: false,
                alias: "Destination",
                description: "Use “top” or “bottom” to jump.",
                placeholder: "bottom",
                example: "bottom"
            },
            y: {
                type: "number",
                required: false,
                alias: "Offset Y (px)",
                description: "Vertical offset in pixels when “to” is not set.",
                example: 600
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Scroll to the end of the list"
            }
        },
        fieldOrder: {
            primary: [],
            secondary: ["to", "y", "optional", "label"]
        },
        examples: [
            {title: "Scroll to bottom", snippet: {type: "scroll", to: "bottom"}},
            {title: "Scroll down 600 px", snippet: {type: "scroll", y: 600}}
        ]
    },

    setViewport: {
        label: "Set viewport",
        category: "viewport",
        description: "Change viewport size for the rest of the workflow or until you change it again.",
        fields: {
            preset: {
                type: "string",
                required: false,
                alias: "Viewport preset",
                description: "Viewport presets. Choose \"Custom size\" to set an exact width/height below, or use a variable token such as {var:preset}.",
                default: "default",
                options: viewportPresetOptions({includeCustom: true})
            },
            zoom: {
                type: "string",
                required: false,
                alias: "Zoom",
                description: "Browser zoom level, emulated the way Chrome does it: the CSS viewport shrinks by this factor while the rendered size stays the same, so the page reflows and text scales (WCAG 1.4.4 / 1.4.10). Applies on top of the size above. Leaving this unset means 100%.",
                default: "1",
                options: [{value:"1", label: "100%"},
                    {value:"2", label: "200%"},
                    {value:"3", label: "300%"},
                    {value:"4", label: "400%"},
                ],
                // The engine takes any factor from 1 to 10; these are the steps the app offers.
                otherValues: true
            },
            width: {
                type: "number",
                required: false,
                alias: "Width (px)",
                description: "Viewport width in CSS pixels. Only used when the preset above is \"Custom size\".",
                placeholder: 1024,
                example: 390
            },
            height: {
                type: "number",
                required: false,
                alias: "Height (px)",
                description: "Viewport height in CSS pixels. Only used when the preset above is \"Custom size\".",
                placeholder: 768,
                example: 844
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Phone size"
            }
        },
        fieldOrder: {
            // width/height are rendered as primary fields too (right after preset),
            // but stay hidden (via wireSetViewportPresetToggle in
            // actions-builder.module.js) unless preset is "custom" - they must not
            // be tucked behind "Show more options" since, when set, they silently
            // override the preset at runtime. zoom moves to secondary so it doesn't
            // sit between preset and the width/height pair it's conditionally tied to.
            primary: ["preset", "width", "height"],
            secondary: ["zoom", "optional", "label"]
        },
        examples: [
            {title: "Simulate mobile viewport", snippet: {type: "setViewport", preset: "custom", width: 375, height: 812}}
        ]
    },

    navigate: {
        label: "Navigate to URL",
        category: "navigation",
        description: "Go to a new URL and wait for the page to be ready.",
        fields: {
            url: {
                type: "string",
                required: true,
                alias: "URL",
                description: "Absolute URL.",
                placeholder: "https://example.com/checkout",
                example: "https://shop.example.com/products"
            },
            waitUntil: {
                type: "string",
                required: false,
                default: "load",
                alias: "Wait until",
                description: "When to consider navigation complete.",
                options: ["load", "domcontentloaded", "networkidle0"]
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Open the products page"
            }
        },
        fieldOrder: {
            primary: ["url"],
            secondary: ["waitUntil", "optional", "label"]
        },
        examples: [
            {
                title: "Open help page",
                snippet: {
                    type: "navigate",
                    url: "https://www.iana.org/help/example-domains",
                    waitUntil: "domcontentloaded"
                }
            }
        ]
    },

    refresh: {
        label: "Refresh",
        category: "navigation",
        description: "Reload the current page and wait for it to be ready. Useful to reset SPA state or re-trigger network requests.",
        fields: {
            waitUntil: {
                type: "string",
                required: false,
                default: "domcontentloaded",
                alias: "Wait until",
                description: "When to consider the reload complete.",
                options: ["load", "domcontentloaded", "networkidle0"]
            },
            timeout: {
                type: "number",
                required: false,
                default: 30000,
                step: 500,
                alias: "Timeout (ms)",
                description: "Navigation timeout in ms for the reload.",
                example: 20000
            },
            bypassCache: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Bypass cache",
                description: "Temporarily disable the browser cache during the reload."
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this refresh fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Reload the cart"
            }
        },
        fieldOrder: {
            primary: [],
            secondary: ["waitUntil", "timeout", "bypassCache", "optional", "label"]
        },
        examples: [
            { title: "Reload current page", snippet: { type: "refresh" } },
            { title: "Reload and wait for DOM", snippet: { type: "refresh", waitUntil: "domcontentloaded" } },
            { title: "Hard refresh (bypass cache)", snippet: { type: "refresh", bypassCache: true } }
        ]
    },

    emulateVisionDeficiency: {
        label: "Emulate vision deficiency",
        category: "viewport",
        description: "Visually simulate a vision deficiency in the browser renderer. Stays active on the same page across navigation until reset to 'none'.",
        fields: {
            deficiency: {
                type: "string",
                required: false,
                default: "none",
                alias: "Deficiency type",
                description: "Vision deficiency simulation mode.",
                options: [
                    { value: "none", label: "None (reset)" },
                    { value: "blurredVision", label: "Blurred vision" },
                    { value: "reducedContrast", label: "Reduced contrast" },
                    { value: "achromatopsia", label: "Achromatopsia (no color)" },
                    { value: "deuteranopia", label: "Deuteranopia" },
                    { value: "protanopia", label: "Protanopia" },
                    { value: "tritanopia", label: "Tritanopia" }
                ]
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "As seen without red perception"
            }
        },
        fieldOrder: {
            primary: ["deficiency", "label"],
            secondary: ["optional"]
        },
        examples: [
            { title: "Simulate deuteranopia", snippet: { type: "emulateVisionDeficiency", deficiency: "deuteranopia" } },
            { title: "Reset to normal vision", snippet: { type: "emulateVisionDeficiency", deficiency: "none" } }
        ]
    },

    setColorScheme: {
        label: "Set color scheme and contrast",
        category: "viewport",
        description: "Show the page in the light or dark color scheme, in high contrast, or both, as a browser or system set to them would. The color scheme sets prefers-color-scheme, which the page's media queries follow; until a step sets it, the page is shown as the run's configuration says (the browser's default, light, unless it says otherwise), and Run default goes back to that. High contrast shows the page in forced colors, as Windows' contrast themes do: the browser replaces the page's colors with the user's, and its forced-colors media queries and system colors such as Canvas and GrayText follow, so a scan or a screenshot shows what stays visible then (focus indicators, icons, borders of controls). Leave either one empty to keep it as it is. Both stay until another step changes them, across navigation. A site with its own theme switch that does not follow prefers-color-scheme needs a click on that switch instead. surea11y still measures contrast in the page's own colors in high contrast, as WCAG asks, and each scan says it was taken in it. High contrast needs Chrome.",
        fields: {
            colorScheme: {
                type: "string",
                required: false,
                alias: "Color scheme",
                description: "The color scheme to switch to, or Run default for the one the run started with (its configuration's, the browser's own unless it sets one). Empty keeps the current one.",
                emptyLabel: "Keep as it is",
                options: [
                    { value: "default", label: "Run default" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" }
                ]
            },
            highContrast: {
                type: "string",
                required: false,
                alias: "High contrast",
                description: "Show the page in forced colors (high contrast), or stop, or Run default for what the run started with (its configuration's, Off unless it says otherwise). Empty keeps it as it is.",
                emptyLabel: "Keep as it is",
                options: [
                    { value: "default", label: "Run default" },
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" }
                ]
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Dark mode"
            }
        },
        fieldOrder: {
            primary: ["colorScheme", "highContrast", "label"],
            secondary: ["optional"]
        },
        examples: [
            { title: "Scan the dark theme", snippet: { type: "setColorScheme", colorScheme: "dark" } },
            { title: "Back to the light theme", snippet: { type: "setColorScheme", colorScheme: "light" } },
            { title: "Scan in high contrast, keeping the color scheme", snippet: { type: "setColorScheme", highContrast: "on" } },
            { title: "Dark high contrast", snippet: { type: "setColorScheme", colorScheme: "dark", highContrast: "on" } },
            { title: "Back to the page's own colors", snippet: { type: "setColorScheme", highContrast: "off" } },
            { title: "Back to what the run started with", snippet: { type: "setColorScheme", colorScheme: "default", highContrast: "default" } }
        ]
    },

    setLanguage: {
        label: "Set language",
        category: "viewport",
        description: "Show the page in a language, as a browser set to it would: the Accept-Language header a server picks a language by, navigator.language and navigator.languages for a site that picks it in its scripts, and the format of dates and numbers. It stays set until another Set language step changes it, across navigation, refreshes and pages the workflow opens. The open page loads again so it shows the new language now; a page that has not loaded yet picks it up when it does. Run default goes back to the language the run started with: its configuration's, or the browser's own when it sets none. Each scan says the language it was taken in, and warns when the page declares another (its html lang): a site that keeps its language in a cookie, an account setting or its address (such as /en/), or picks it by location, may not follow this step. Dates and numbers need Chrome.",
        fields: {
            language: {
                type: "string",
                required: false,
                alias: "Language",
                description: "The language to show the page in, or Run default for the one the run started with (its configuration's, the browser's own unless it sets one). Other language, when filled, is used instead.",
                emptyLabel: "Choose…",
                options: [
                    { value: "default", label: "Run default" },
                    { value: "ar", label: "Arabic (ar)" },
                    { value: "eu", label: "Basque (eu)" },
                    { value: "bn", label: "Bengali (bn)" },
                    { value: "bg", label: "Bulgarian (bg)" },
                    { value: "ca", label: "Catalan (ca)" },
                    { value: "zh-CN", label: "Chinese (Simplified) (zh-CN)" },
                    { value: "zh-TW", label: "Chinese (Traditional) (zh-TW)" },
                    { value: "hr", label: "Croatian (hr)" },
                    { value: "cs", label: "Czech (cs)" },
                    { value: "da", label: "Danish (da)" },
                    { value: "nl", label: "Dutch (nl)" },
                    { value: "en-GB", label: "English (United Kingdom) (en-GB)" },
                    { value: "en-US", label: "English (United States) (en-US)" },
                    { value: "et", label: "Estonian (et)" },
                    { value: "fi", label: "Finnish (fi)" },
                    { value: "fr-FR", label: "French (France) (fr-FR)" },
                    { value: "gl", label: "Galician (gl)" },
                    { value: "de-DE", label: "German (Germany) (de-DE)" },
                    { value: "el", label: "Greek (el)" },
                    { value: "he", label: "Hebrew (he)" },
                    { value: "hi", label: "Hindi (hi)" },
                    { value: "hu", label: "Hungarian (hu)" },
                    { value: "id", label: "Indonesian (id)" },
                    { value: "it", label: "Italian (it)" },
                    { value: "ja", label: "Japanese (ja)" },
                    { value: "ko", label: "Korean (ko)" },
                    { value: "lv", label: "Latvian (lv)" },
                    { value: "lt", label: "Lithuanian (lt)" },
                    { value: "ms", label: "Malay (ms)" },
                    { value: "nb", label: "Norwegian (Bokmål) (nb)" },
                    { value: "fa", label: "Persian (fa)" },
                    { value: "pl", label: "Polish (pl)" },
                    { value: "pt-BR", label: "Portuguese (Brazil) (pt-BR)" },
                    { value: "pt-PT", label: "Portuguese (Portugal) (pt-PT)" },
                    { value: "ro", label: "Romanian (ro)" },
                    { value: "ru", label: "Russian (ru)" },
                    { value: "sr", label: "Serbian (sr)" },
                    { value: "sk", label: "Slovak (sk)" },
                    { value: "sl", label: "Slovenian (sl)" },
                    { value: "es-ES", label: "Spanish (Spain) (es-ES)" },
                    { value: "es-419", label: "Spanish (Latin America) (es-419)" },
                    { value: "sv", label: "Swedish (sv)" },
                    { value: "th", label: "Thai (th)" },
                    { value: "tr", label: "Turkish (tr)" },
                    { value: "uk", label: "Ukrainian (uk)" },
                    { value: "vi", label: "Vietnamese (vi)" }
                ]
            },
            customLanguage: {
                type: "string",
                required: false,
                alias: "Other language",
                description: "A language not in the list, as a BCP 47 tag (es-MX, fr-CA, zh-Hant-HK, a variable such as {var:lang}). Used instead of Language when filled.",
                placeholder: "es-MX",
                example: "fr-CA"
            },
            reload: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Reload the page",
                description: "Load the open page again, so it shows the new language now. Off, it shows it from the next page loaded."
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "German"
            }
        },
        fieldOrder: {
            primary: ["language", "customLanguage", "label"],
            secondary: ["reload", "optional"]
        },
        examples: [
            { title: "Scan the German version", snippet: { type: "setLanguage", language: "de-DE" } },
            { title: "A variant not in the list", snippet: { type: "setLanguage", customLanguage: "es-MX" } },
            { title: "The language from a variable", snippet: { type: "setLanguage", customLanguage: "{var:lang}" } },
            { title: "Back to the language the run started with", snippet: { type: "setLanguage", language: "default" } }
        ]
    },

    keyboard: {
        label: "Keyboard input",
        category: "interaction",
        description: "Press keys and/or type text as a user would. Useful to navigate forms with Tab and Enter.",
        fields: {
            keys: {
                type: "string[]",
                required: false,
                alias: "Keys to press",
                description: "List of keys to press in order. Each item can be a single key (\"Tab\", \"Enter\") or a key combination using \"+\" to press multiple keys together (\"Shift+F10\", \"Control+S\"). Multiple entries are executed sequentially.",
                placeholder: ["Tab", "Shift+F10"],
                example: "Tab, Tab, Enter"
            },
            text: {
                type: "string",
                required: false,
                alias: "Text to type",
                description: "Text to type using the keyboard.",
                example: "running shoes"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Move to the second link and follow it"
            }
        },
        fieldOrder: {
            primary: ["keys", "text"],
            secondary: ["optional", "label"]
        },
        examples: [
            {title: "Tab and activate", snippet: {type: "keyboard", keys: ["Tab", "Enter"]}},
            {
                title: "Open context menu",
                snippet: { type: "keyboard", keys: ["Shift+F10"] }
            }
        ]
    },

    select: {
        label: "Select dropdown option",
        category: "interaction",
        description: "Change the value of a select element by option value.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Select selector",
                description: "CSS selector of the select element.",
                placeholder: "#country",
                example: "#country"
            },
            value: {
                type: "string|number",
                required: true,
                alias: "Option value",
                description: "Option value to select.",
                placeholder: "CH",
                example: "ES"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Choose Spain"
            },
            scrollIntoView: scrollIntoViewField("selecting the option")
        },
        fieldOrder: {
            primary: ["selector", "value"],
            secondary: ["scrollIntoView", "optional", "label"]
        },
        examples: [
            {title: "Choose Switzerland", snippet: {type: "select", selector: "#country", value: "CH"}}
        ]
    },

    group: {
        label: "Group",
        category: "composition",
        description: "Run several actions as a single unit. If a child action fails, the group fails. Variables set inside the group (getText, getCount, setVar) are only available to later steps inside it; to use a value after the group, set it before the group or outside it.",
        fields: {
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional group",
                description: "If true and the group fails, mark as failed-optional and continue."
            },
            label: {
                type: "string",
                required: false,
                alias: "Group label",
                description: "Name of the group for reporting.",
                placeholder: "Grouped actions",
                example: "Accept the cookie banner"
            },
            actions: {
                type: "Action[]",
                required: true,
                alias: "Actions",
                description: "Nested actions to run in order.",
                placeholder: [{type: "click", selector: "#start"}]
            }
        },
        fieldOrder: {
            primary: ["actions"],
            secondary: ["optional", "label"]
        },
        examples: [
            {
                title: "Open a menu and capture screenshot",
                snippet: {
                    type: "group",
                    label: "Open and capture",
                    actions: [
                        {type: "click", selector: "#menu-button"},
                        {type: "waitForSelector", selector: "#menu[open]"},
                        {type: "screenshot", label: "menu-open"}
                    ]
                }
            }
        ]
    },

    mergedScan: {
        label: "Merged scan",
        category: "composition",
        description: "Report the A11y scans inside it as one scan: the same view scanned in several contexts (light and dark theme, desktop and mobile width) counts once. Each scan inside is a context, named by its label; a failure lists the contexts it occurs in, and one whose result differs between contexts (a different contrast ratio, a different size) is listed once per result. The merged scan holds every context's screenshot. Variables set inside stay available after it. A Merged scan cannot contain another.",
        fields: {
            label: {
                type: "string",
                required: false,
                alias: "Scan name",
                description: "The merged scan's name in the report. {var:...} tokens work, so a Repeat over pages can name each one. Without it, the first context's name is used.",
                placeholder: "Product page",
                example: "Product page, all states"
            },
            scanTags: {
                type: "string[]",
                widget: "tags",
                required: false,
                alias: "Tags",
                description: "The merged scan's tags, used to filter the report by tag and to break the live totals down. The tags of the scans inside describe their contexts and are shown with them; when this is empty, the merged scan takes all of theirs. Supports {var:name}, {index}, {oneBased}, {total}.",
                placeholder: "checkout",
                example: "checkout, {var:site}"
            },
            actions: {
                type: "Action[]",
                required: true,
                alias: "Actions",
                description: "The steps to run, with an A11y scan for each context. A scan with no label is named by its place, as \"Scan 2 of 4\".",
                placeholder: [{type: "a11yScan", label: "Light · desktop"}]
            }
        },
        fieldOrder: {
            primary: ["label", "scanTags", "actions"],
            secondary: []
        },
        examples: [
            {
                title: "One scan of a page in light and dark",
                snippet: {
                    type: "mergedScan",
                    label: "Product page",
                    scanTags: ["product"],
                    actions: [
                        {type: "setColorScheme", colorScheme: "light"},
                        {type: "a11yScan", label: "Light"},
                        {type: "setColorScheme", colorScheme: "dark"},
                        {type: "a11yScan", label: "Dark"}
                    ]
                }
            }
        ]
    },

    runCustomStep: {
        label: "Custom step",
        category: "composition",
        description: "Run a reusable custom step by id. Inputs are provided as a JSON object and become scoped variables for nested actions. For repeated calls that only differ by input values, prefer one runCustomStep inside a repeat dataset.",
        fields: {
            customStepId: {
                type: "string",
                required: true,
                alias: "Custom step name",
                description: "Name of the custom step definition to run.",
                placeholder: "scan-desktop-mobile",
                example: "accept-cookies"
            },
            argsJson: {
                type: "string|object",
                required: false,
                alias: "Inputs (JSON object)",
                description: "Optional inputs passed to this custom step: an object, or the same object as JSON text. Example: {\"label\":\"Settings\"}",
                multiline: true,
                placeholder: "{\"label\":\"Account\", \"section\":\"Main\"}",
                example: "{\"label\":\"Settings\"}"
            },
            exportVars: {
                type: "string[]",
                required: false,
                alias: "Export vars",
                description: "Optional variable names to copy back to parent scope after execution.",
                example: "total, firstTitle"
            },
            maxDepth: {
                type: "number",
                integer: true,
                required: false,
                default: 15,
                alias: "Max nesting depth",
                description: "Safety limit for nested custom step calls.",
                example: 5
            },
            allowRecursion: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Allow direct self-recursion",
                description: "Allow only direct self-recursion for this call (A -> A). Indirect cycles (A -> B -> A) are still blocked."
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional step",
                description: "If true and this call fails, mark as failed-optional and continue."
            },
            label: {
                type: "string",
                required: false,
                alias: "Call label",
                description: "Name for reporting/logging.",
                example: "Accept cookies"
            }
        },
        fieldOrder: {
            primary: ["customStepId", "argsJson"],
            secondary: ["exportVars", "maxDepth", "allowRecursion", "optional", "label"]
        },
        examples: [
            {
                title: "Run reusable scan bundle",
                snippet: {
                    type: "runCustomStep",
                    customStepId: "scan-desktop-mobile",
                    argsJson: "{\"viewLabel\":\"Products\"}"
                }
            }
        ]
    },

    if: {
        label: "Condition",
        category: "composition",
        description: "Run one branch when the condition is true, otherwise run elseActions. Variables set inside a branch (getText, getCount, setVar) are only available to later steps in that branch; to use a value after the condition, set it before or outside it.",
        fields: {
            selectorExists: {
                type: "string",
                required: false,
                alias: "Selector exists",
                description: "Condition is true if this selector exists. Use :ctx inside forEachElement.",
                placeholder: "#promo-code",
                example: "#cookie-banner"
            },
            onlyVisible: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Only visible items",
                description: "When true, only iterate elements that are visible (non-zero size, not display:none, not visibility:hidden)."
            },
            urlIncludes: {
                type: "string",
                required: false,
                alias: "URL includes",
                description: "Condition is true if the URL includes this substring.",
                example: "/checkout"
            },
            var: {
                type: "string",
                required: false,
                alias: "Variable name",
                description: "Variable name to compare using “equals”.",
                example: "loggedIn"
            },
            equals: {
                type: "any",
                required: false,
                alias: "Equals value",
                description: "Value to compare against the variable, as text: 2310 matches a variable holding the number 2310, and true matches true.",
                example: "true"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional block",
                description: "If true and the block fails, mark as failed-optional and continue."
            },
            label: {
                type: "string",
                required: false,
                alias: "Block label",
                description: "Name for reporting.",
                example: "Only when the banner shows"
            },
            actions: {
                type: "Action[]",
                required: false,
                alias: "If actions",
                description: "Actions to run when the condition is true.",
                placeholder: [{type: "type", selector: "#promo-code", text: "WELCOME"}]
            },
            elseActions: {
                type: "Action[]",
                required: false,
                alias: "Else actions",
                description: "Actions to run when the condition is false.",
                placeholder: [{type: "screenshot", label: "no-promo"}]
            }
        },
        fieldOrder: {
            primary: ["selectorExists", "urlIncludes", "actions", "elseActions"],
            secondary: [
                "onlyVisible",
                "var",
                "equals",
                "optional",
                "label"
            ]
        },
        examples: [
            {
                title: "Apply promo code if field exists",
                snippet: {
                    type: "if",
                    selectorExists: "#promo-code",
                    actions: [{type: "type", selector: "#promo-code", text: "WELCOME"}],
                    elseActions: [{type: "screenshot", label: "no-promo"}]
                }
            }
        ]
    },

    ifUrl: {
        label: "URL condition",
        category: "composition",
        description: "Compare one part of the current page URL (domain name, port, path, query string, one query parameter or fragment) with a value, and run one branch when the comparison is true, otherwise run elseActions. Variables set inside a branch are only available to later steps in that branch.",
        fields: {
            urlPart: {
                type: "string",
                required: true,
                alias: "URL part",
                variableToken: false,
                description: "Which part of the URL to compare. For https://shop.example.com:8443/cart/checkout?step=2&lang=en#payment: domain name is shop.example.com, port is 8443 (a URL with no port uses the protocol's default, 443 for https and 80 for http), path is /cart/checkout, query string is step=2&lang=en, the query parameter \"step\" is 2, and fragment is payment.",
                options: [
                    {value: "host", label: "Domain name"},
                    {value: "port", label: "Port"},
                    {value: "path", label: "Path"},
                    {value: "query", label: "Query string (all parameters)"},
                    {value: "param", label: "One query parameter"},
                    {value: "hash", label: "Fragment (#…)"}
                ]
            },
            paramName: {
                type: "string",
                required: false,
                alias: "Parameter name",
                description: "Name of the query parameter to compare, when URL part is \"One query parameter\". A parameter missing from the URL equals nothing and contains nothing, so \"is different from\" and \"does not contain\" are true for it.",
                placeholder: "step",
                example: "lang"
            },
            comparison: {
                type: "string",
                required: true,
                default: "equals",
                alias: "Comparison",
                variableToken: false,
                description: "How to compare the URL part with the value.",
                options: [
                    {value: "equals", label: "is equal to"},
                    {value: "notEquals", label: "is different from"},
                    {value: "contains", label: "contains"},
                    {value: "notContains", label: "does not contain"}
                ]
            },
            value: {
                type: "string",
                required: false,
                alias: "Value",
                description: "Text to compare with, without the leading ? or # (either is ignored if typed). Empty means the part is empty: a fragment equal to nothing means the URL has no fragment. The domain name is compared ignoring case; every other part is case-sensitive. Supports {var:name}.",
                placeholder: "/checkout",
                example: "es"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional block",
                description: "If true and the block fails, mark as failed-optional and continue."
            },
            label: {
                type: "string",
                required: false,
                alias: "Block label",
                description: "Name for reporting.",
                example: "Spanish pages only"
            },
            actions: {
                type: "Action[]",
                required: false,
                alias: "If actions",
                description: "Actions to run when the comparison is true.",
                placeholder: [{type: "screenshot", label: "checkout"}]
            },
            elseActions: {
                type: "Action[]",
                required: false,
                alias: "Else actions",
                description: "Actions to run when the comparison is false.",
                placeholder: [{type: "navigate", url: "https://example.com/checkout"}]
            }
        },
        fieldOrder: {
            primary: ["urlPart", "paramName", "comparison", "value", "actions", "elseActions"],
            secondary: ["optional", "label"]
        },
        examples: [
            {
                title: "Scan the payment step only",
                snippet: {
                    type: "ifUrl",
                    urlPart: "param",
                    paramName: "step",
                    comparison: "equals",
                    value: "payment",
                    actions: [{type: "a11yScan", label: "Payment step"}]
                }
            },
            {
                title: "Go back to the site if a link left the domain",
                snippet: {
                    type: "ifUrl",
                    urlPart: "host",
                    comparison: "notEquals",
                    value: "www.example.com",
                    actions: [{type: "goBack"}]
                }
            }
        ]
    },

    switch: {
        label: "Switch",
        category: "composition",
        description: "Compare one value, a part of the current page URL or a variable, with each case in order, and run the first case that matches; when none matches, run the default actions. Variables set inside a case are only available to later steps in that case.",
        fields: {
            subject: {
                type: "string",
                required: true,
                default: "url",
                alias: "Compare",
                variableToken: false,
                description: "What the cases are compared with: a part of the current page URL, or a workflow variable.",
                options: [
                    {value: "url", label: "A part of the page URL"},
                    {value: "var", label: "A variable"}
                ]
            },
            urlPart: {
                type: "string",
                required: false,
                alias: "URL part",
                variableToken: false,
                description: "When comparing a part of the URL: which part. Read like the URL condition step: no leading ? or #, and a URL with no port is on its protocol's default one.",
                options: [
                    {value: "host", label: "Domain name"},
                    {value: "port", label: "Port"},
                    {value: "path", label: "Path"},
                    {value: "query", label: "Query string (all parameters)"},
                    {value: "param", label: "One query parameter"},
                    {value: "hash", label: "Fragment (#…)"}
                ]
            },
            paramName: {
                type: "string",
                required: false,
                alias: "Parameter name",
                description: "When the URL part is \"One query parameter\": the parameter's name.",
                placeholder: "step",
                example: "lang"
            },
            var: {
                type: "string",
                required: false,
                alias: "Variable name",
                description: "When comparing a variable: its name. Found the way {var:name} finds it; an unset variable equals nothing and contains nothing.",
                placeholder: "path",
                example: "plan"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional block",
                description: "If true and the block fails, mark as failed-optional and continue."
            },
            label: {
                type: "string",
                required: false,
                alias: "Block label",
                description: "Name for reporting.",
                example: "By language"
            },
            cases: {
                type: "Action[]",
                itemType: "case",
                required: false,
                alias: "Cases",
                description: "The cases, checked in order. The first one that matches runs, and the rest are not checked."
            },
            defaultActions: {
                type: "Action[]",
                required: false,
                alias: "Default actions",
                description: "Actions to run when no case matches."
            }
        },
        fieldOrder: {
            primary: ["subject", "urlPart", "paramName", "var", "cases", "defaultActions"],
            secondary: ["optional", "label"]
        },
        examples: [
            {
                title: "Different actions per component examples page",
                snippet: {
                    type: "switch",
                    subject: "url",
                    urlPart: "hash",
                    cases: [
                        {type: "case", comparison: "contains", value: "/avq-popover/examples", actions: [{type: "click", selector: "button[aria-label=\"More information\"]"}]},
                        {type: "case", comparison: "contains", value: "/avq-snackbar/examples", actions: [{type: "clickByText", labelText: "Open snackbar"}]}
                    ],
                    defaultActions: []
                }
            }
        ]
    },

    case: {
        label: "Case",
        category: "composition",
        onlyIn: "switch",
        description: "One case of a switch: when the switch's value matches, its actions run. Only used inside a switch's cases.",
        fields: {
            comparison: {
                type: "string",
                required: true,
                default: "equals",
                alias: "Comparison",
                variableToken: false,
                description: "How to compare the switch's value with this case's value.",
                options: [
                    {value: "equals", label: "is equal to"},
                    {value: "notEquals", label: "is different from"},
                    {value: "contains", label: "contains"},
                    {value: "notContains", label: "does not contain"}
                ]
            },
            value: {
                type: "string",
                required: false,
                alias: "Value",
                description: "Text to compare with. For a URL part, compared the way the URL condition step compares it. Supports {var:name}.",
                placeholder: "/checkout",
                example: "es"
            },
            actions: {
                type: "Action[]",
                required: false,
                alias: "Case actions",
                description: "Actions to run when this case matches."
            }
        },
        fieldOrder: {
            primary: ["comparison", "value", "actions"],
            secondary: []
        },
        examples: [
            {
                title: "Case for the changelog page",
                snippet: {type: "case", comparison: "equals", value: "/changelog", actions: [{type: "a11yScan"}]}
            }
        ]
    },

    repeat: {
        label: "Repeat",
        category: "composition",
        description: "Run the same list of actions multiple times, either by a fixed repetition count or by iterating over a dataset (one item per line). Useful for replacing duplicated actions that only differ by one value.",
        fields: {
            repetitions: {
                type: "number",
                integer: true,
                min: 1,
                required: false,
                alias: "Repetitions",
                description: "How many times to repeat. Accepts a whole number or a variable token such as {var:count} (for example, a count stored by \"Count elements into variable\"). The variable is turned into a number when the step runs; if it is not a whole number the repeat runs 0 times and a warning is logged.",
                default: 1,
                example: 3
            },
            itemsText: {
                type: "string",
                required: false,
                alias: "Dataset (one item per line)",
                description: "Optional dataset to drive iterations. Each non-empty line is one item. Lines may be plain text (mapped to item.value and available as {var:value}) or JSON objects (mapped to item.key and available as {var:item.key}). All values are normalized to strings. When provided, this overrides repetitions. Use this with runCustomStep argsJson to avoid repeating the same custom-step call for each static value.",
                placeholder: "https://example.com\n{\"label\":\"Home\",\"url\":\"https://example.com/\"}\nCH",
                example: "{\"label\":\"Country CH\",\"country\":\"CH\"}"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional block",
                description: "If one iteration fails, mark as failed-optional and continue."
            },
            continueOnIterationError: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Continue on error",
                description: "If an iteration fails, the process continues to the next iteration."
            },
            label: {
                type: "string",
                required: false,
                alias: "Block label",
                description: "Name for reporting.",
                example: "Each category"
            },
            actions: {
                type: "Action[]",
                required: true,
                alias: "Actions",
                description: "Actions to run each time.",
                placeholder: [{type: "click", selector: ".carousel-next"}]
            },
            closeWorkerPages: {
                type: "boolean",
                default: true,
                alias: "Close worker pages",
                description: "Whether to close worker pages after all repeat iterations complete."
            },
            maxSeconds: {
                type: "number",
                default: null,
                step: 1,
                alias: "Max time (s)",
                description: "Maximum allowed execution time (in seconds) for the entire repeat action.",
                example: 300
            },
            perPageDelayMs: {
                type: "number",
                default: 0,
                step: 500,
                alias: "Delay per page (ms)",
                description: "Optional delay (in milliseconds) applied between iteration executions.",
                example: 500
            }
        },
        fieldOrder: {
            primary: ["repetitions", "itemsText", "continueOnIterationError", "actions"],
            secondary: [
                "optional",
                "label",
                "closeWorkerPages",
                "maxSeconds",
                "perPageDelayMs"
            ]
        },
        examples: [
            {
                title: "Cycle carousel three times",
                snippet: {
                    type: "repeat",
                    repetitions: 3,
                    actions: [{type: "click", selector: ".carousel-next"}]
                }
            },
            {
                title: "Iterate viewport presets for one custom-step call",
                snippet: {
                    type: "repeat",
                    itemsText: "desktop\ntablet\nmobile",
                    actions: [
                        {
                            type: "runCustomStep",
                            customStepId: "a11y-scan-in-viewport",
                            argsJson: "{\"label\":\"{var:label}\",\"preset\":\"{var:value}\",\"viewportName\":\"{var:value}\"}"
                        }
                    ]
                }
            }
        ]
    },

    forEachElement: {
        label: "Iterate",
        category: "composition",
        description: "Repeat actions for each element that matches a selector. Inside, use :ctx to target the current element. Use {index}, {oneBased}, and {total} in strings. This is for DOM elements; use repeat for static value lists.",
        fields: {
            targetSelector: {
                type: "string",
                required: true,
                alias: "Items selector",
                description: "Selector that returns one or many elements.",
                placeholder: "a.product-card",
                example: "nav a"
            },
            limit: {
                type: "number",
                integer: true,
                required: false,
                default: 0,
                alias: "Max items",
                description: "Max number of elements to process. 0 means unlimited.",
                placeholder: 0,
                example: 5
            },
            reverse: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Reverse order",
                description: "Iterate from last to first when true."
            },
            onlyVisible: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Only visible items",
                description: "When true, only iterate elements that are visible (non-zero size, not display:none, not visibility:hidden)."
            },
            label: {
                type: "string",
                required: false,
                alias: "Block label",
                description: "Label for logging only.",
                example: "Each product"
            },
            concurrency: {
                type: "number",
                integer: true,
                default: 1,
                min: 1,
                // As many as the queue allows runs at once: each worker is a
                // page of its own, and Chrome's memory grows with them.
                max: 8,
                alias: "Concurrency",
                description: "Number of concurrent workers used to process iterations, from 1 to 8. When greater than 1, each iteration runs in its own isolated worker page.",
                example: 3
            },
            isolation: {
                type: "string",
                enum: ["page", "context"],
                default: "page",
                alias: "Isolation",
                options: [{value: "page", label: "Shared session (page)"}, {value: "context", label: "Separate sessions (context)"}],
                description: "With a concurrency above 1, whether the extra pages share cookies and session with the main page (page), or each runs in a browser context of its own (context)."
            },
            closeWorkerPages: {
                type: "boolean",
                default: true,
                alias: "Close worker pages",
                description: "Close the extra pages a concurrency above 1 opened once every item is done."
            },
            maxSeconds: {
                type: "number",
                default: null,
                alias: "Max time (s)",
                description: "Maximum allowed execution time (in seconds) for the entire repeat action.",
                example: 600
            },
            perPageDelayMs: {
                type: "number",
                default: 0,
                alias: "Delay per iteration (ms)",
                step: 500,
                description: "Optional delay (in milliseconds) applied between iteration executions.",
                example: 500
            },
            dynamic: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Dynamic selection",
                description: "Re-evaluate the selector on each iteration. Use this when the DOM list changes between iterations."
            },
            continueOnIterationError: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Continue on error",
                description: "If an iteration fails, the process continues to the next iteration."
            },
            // Keeping it here avoids a mismatch between UI config and runtime behavior.
            maxIterationErrors: {
                type: "number",
                integer: true,
                required: false,
                default: null,
                alias: "Max iteration errors",
                description: "If set, stop after this many iteration errors (only applies when 'Continue on error' is enabled).",
                example: 3
            },

            iterSetupActions: {
                type: "Action[]",
                required: false,
                alias: "Iteration setup",
                description: "Actions that run before collecting items, and again before each iteration. Use this to reveal menus or panels that contain the target elements. Do not use :ctx here.",
                placeholder: [{type: "hoverByText", selector: "header nav", labelText: "Products", exact: true}]
            },
            preActions: {
                type: "Action[]",
                required: false,
                alias: "Pre-actions",
                description: "Actions that run after an item is selected and scoped, before the main actions. Use :ctx here.",
                placeholder: [{type: "getText", selector: ":ctx", var: "scanTitle", trim: true}]
            },
            actions: {
                type: "Action[]",
                required: true,
                alias: "Actions",
                description: "Actions to run on each item. Use :ctx to target the current item."
            }
        },

        fieldOrder: {
            primary: [
                "targetSelector",
                "onlyVisible",
                "concurrency",
                "continueOnIterationError",
                "maxIterationErrors",
                "iterSetupActions",
                "preActions",
                "actions"
            ],
            secondary: [
                "limit",
                "reverse",
                "label",
                "isolation",
                "closeWorkerPages",
                "maxSeconds",
                "perPageDelayMs",
                "dynamic"
            ]
        },

        examples: [
            {
                title: "Scan each top navigation link",
                snippet: {
                    type: "forEachElement",
                    targetSelector: "header .navigation a",
                    preActions: [
                        {type: "getText", selector: ":ctx", var: "scanTitle", trim: true}
                    ],
                    actions: [
                        {type: "click", selector: ":ctx"},
                        {type: "waitForSelector", selector: "main"},
                        {type: "a11yScan", label: "{var:scanTitle}"},
                        {type: "goBack"}
                    ]
                }
            },
            {
                title: "Iterate products without returning (dynamic list)",
                snippet: {
                    type: "forEachElement",
                    targetSelector: ".product-card a",
                    dynamic: true,
                    actions: [
                        {type: "click", selector: ":ctx"},
                        {type: "waitForSelector", selector: "main"},
                        {type: "a11yScan", label: "Product {oneBased}"}
                    ]
                }
            },
            {
                title: "Hover to reveal a panel, then iterate links",
                snippet: {
                    type: "forEachElement",
                    iterSetupActions: [
                        {type: "hoverByText", selector: "header nav", labelText: "Products", exact: true},
                        {type: "waitForSelector", selector: ".products-panel", visible: true, timeout: 5000}
                    ],
                    targetSelector: ".products-panel a",
                    preActions: [
                        {type: "getText", selector: ":ctx", var: "scanTitle", trim: true}
                    ],
                    actions: [
                        {type: "click", selector: ":ctx"},
                        {type: "waitForSelector", selector: "main"},
                        {type: "a11yScan", label: "{var:scanTitle}"},
                        {type: "goBack"}
                    ]
                }
            }
        ]
    },

    crawlQueue: {
        label: "Crawl queue",
        category: "crawl",
        description: "Depth-limited crawl with strict budgets. For each visited page, run nested actions, then discover and enqueue new links.",
        fields: {
            maxDepth: {
                type: "number",
                integer: true,
                required: false,
                default: 2,
                alias: "Max depth",
                description: "Maximum link depth to follow from seeds. 0 means only the seed pages.",
                example: 1
            },
            strategy: {
                type: "string",
                required: false,
                default: "bfs",
                alias: "Strategy",
                options: [{value: "bfs", label: "By level first"}, {value: "dfs", label: "Deep as possible first"}],
                description: "Queue strategy: 'By level first' or 'Deep as possible first'."
            },
            isolation: {
                type: "string",
                required: false,
                default: "page",
                alias: "Isolation",
                options: [{value: "page", label: "Shared session (page)"}, {value: "context", label: "Separate sessions (context)"}],
                description: "Whether worker pages share cookies and session with the main page (page), or run in isolated browser contexts (context)."
            },
            maxPages: {
                type: "number",
                integer: true,
                required: false,
                default: 30,
                alias: "Max pages",
                description: "Maximum number of pages to visit.",
                example: 50
            },
            continueOnIterationError: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Continue on error",
                description: "If an iteration fails, the process continues to the next iteration."
            },
            maxSeconds: {
                type: "number",
                required: false,
                default: 600,
                alias: "Max time (s)",
                step: 60,
                description: "Maximum crawl time in seconds.",
                example: 900
            },
            sameOriginOnly: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Same origin only",
                description: "Only crawl URLs on the same origin as the seed/current page."
            },
            perPageDelayMs: {
                type: "number",
                required: false,
                default: 200,
                step: 500,
                alias: "Delay per page (ms)",
                description: "Delay between pages in milliseconds.",
                example: 500
            },
            maxLinksPerPage: {
                type: "number",
                integer: true,
                required: false,
                default: 200,
                alias: "Max links per page",
                description: "Maximum number of discovered links to enqueue per visited page.",
                example: 100
            },
            include: {
                type: "string",
                required: false,
                multiline: true,
                alias: "Include patterns",
                description: "One pattern per line. Supports /regex/flags or wildcards (* and ?). If set, only matching URLs are enqueued.",
                placeholder: "^https://example\\.com/",
                example: "^https://example\\.com/"
            },
            exclude: {
                type: "string",
                required: false,
                multiline: true,
                alias: "Exclude patterns",
                description: "One pattern per line. Supports /regex/flags or wildcards (* and ?). Matching URLs are skipped.",
                placeholder: "/(privacy|cookies|terms)",
                example: "/(privacy|cookies|terms)"
            },
            queueVar: {
                type: "string",
                required: false,
                default: "crawl.queue",
                alias: "Queue variable",
                description: "Variable path storing the URL queue (array).",
                example: "crawl.queue"
            },
            visitedVar: {
                type: "string",
                required: false,
                default: "crawl.visited",
                alias: "Visited variable",
                description: "Variable path storing visited URLs (array).",
                example: "crawl.visited"
            },
            varNs: {
                type: "string",
                required: false,
                default: "crawl",
                alias: "Variable namespace",
                description: "Namespace used for per-page variables: crawl_url, crawl_depth, crawl_index, crawl_total.",
                example: "crawl"
            },
            actions: {
                type: "Action[]",
                required: true,
                alias: "Actions for each visited page",
                description: "Actions to run on every visited page, typically navigate + a11yScan."
            }
        },
        fieldOrder: {
            primary: [
                "maxDepth",
                "strategy",
                "isolation",
                "maxPages",
                "continueOnIterationError",
                "actions"
            ],
            secondary: [
                "maxSeconds",
                "sameOriginOnly",
                "perPageDelayMs",
                "maxLinksPerPage",
                "include",
                "exclude",
                "queueVar",
                "visitedVar",
                "varNs"
            ]
        },
    },

    skipIteration: {
        label: "Skip iteration",
        category: "flow",
        description: "Inside a loop (For each element, Repeat or Crawl), skip the rest of the current item when its conditions match, and go on with the next one. Each field you fill in is one condition: Selector exists; each check on the element of Element selector (Text equals, Text contains, Attribute equals, Attribute contains, or Attribute name alone for having it); URL includes; Variable equals. The item is skipped when all of them match, or, with Use OR, when any of them does. A step with no condition never skips. Text checks are case-sensitive and read the text with its spaces collapsed. In a Crawl, a skipped page's links are not followed.",
        placeholder: {
            type: "skipIteration",
            selector: ":ctx",
            selectorTextContains: "Subscribe",
            or: false
        },
        fields: {
            selector: {
                type: 'string',
                required: false,
                alias: "Element selector",
                description: 'The element the text and attribute checks read: the first one this selector matches. Use :ctx for the current item (:ctx alone for the item itself). If nothing matches, each of those checks fails. On its own, with no check, the element being there is the condition.',
                example: ":ctx .badge"
            },
            selectorTextEquals: {
                type: 'string',
                required: false,
                alias: "Text equals",
                description: "A condition: the element's text is exactly this.",
                example: "Sold out"
            },
            selectorTextContains: {
                type: 'string',
                required: false,
                alias: "Text contains",
                description: "A condition: the element's text contains this.",
                example: "sold out"
            },
            selectorAttr: {
                type: 'string',
                required: false,
                alias: "Attribute name",
                description: "The element's attribute that Attribute equals and Attribute contains read. With neither, the condition is that the element has it.",
                example: "href"
            },
            attrEquals: {
                type: 'string',
                required: false,
                alias: "Attribute equals",
                description: "A condition: the attribute's value is exactly this.",
                example: "#"
            },
            attrContains: {
                type: 'string',
                required: false,
                alias: "Attribute contains",
                description: "A condition: the attribute's value contains this.",
                example: "/external/"
            },
            selectorExists: {
                type: 'string',
                required: false,
                alias: "Selector exists",
                description: 'A condition: an element matches this selector. Use :ctx for inside the current item. Independent of Element selector.',
                example: ":ctx .sold-out"
            },
            var: {
                type: 'string',
                required: false,
                alias: "Variable name",
                description: 'The variable Variable equals compares.',
                example: "status"
            },
            varEquals: {
                type: 'string',
                required: false,
                alias: "Variable equals",
                description: 'A condition: the variable equals this, compared as text (2310 equals the number 2310). An unset variable equals nothing.',
                example: "done"
            },
            urlIncludes: {
                type: 'string',
                required: false,
                alias: "URL includes",
                description: "A condition: the page's address contains this.",
                example: "/archive/"
            },
            or: {
                type: 'boolean',
                required: false,
                default: false,
                alias: "Use OR across conditions",
                description: 'Skip when any condition matches, instead of only when all of them do.'
            }
        },
        fieldOrder: {
            primary: ["selector", "selectorExists", "selectorAttr", "attrEquals", "attrContains"],
            secondary: [
                "selectorTextEquals",
                "selectorTextContains",
                "var",
                "varEquals",
                "urlIncludes",
                "or"
            ]
        },
        examples: [
            {
                title: "Skip newsletter items",
                snippet: {type: "skipIteration", selector: ":ctx", selectorTextContains: "Subscribe", or: false}
            },
            {
                title: "Skip links to other sites that offer a download (both must match)",
                snippet: {type: "skipIteration", selector: ":ctx", selectorAttr: "href", attrContains: "://", selectorTextContains: "Download"}
            },
            {
                title: "Skip sold-out items, or anything on an archive page (either is enough)",
                snippet: {type: "skipIteration", selectorExists: ":ctx .sold-out", urlIncludes: "/archive/", or: true}
            }
        ]
    },

    goBack: {
        label: "Go back",
        category: "navigation",
        description: "Navigate back in history and wait until the page is ready.",
        fields: {
            waitUntil: {
                type: "string",
                required: false,
                default: "load",
                alias: "Wait until",
                description: "Navigation completion signal.",
                options: ["load", "domcontentloaded", "networkidle0"]
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Back to the list"
            }
        },
        fieldOrder: {
            primary: [],
            secondary: ["waitUntil", "optional", "label"]
        },
        examples: [
            {title: "Return to listing", snippet: {type: "goBack", waitUntil: "domcontentloaded"}}
        ]
    },

    screenshot: {
        label: "Screenshot",
        category: "reporting",
        description: "Capture a screenshot at the current state and attach it to the results.",
        fields: {
            label: {
                type: "string",
                required: false,
                alias: "Display label",
                description: "Display label for logs and reports.",
                example: "Cart with one item"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            },
            preserveHover: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Preserve hover state",
                description: "Keep current :hover styling in this screenshot. Disable to clear transient hover before capture."
            }
        },
        fieldOrder: {
            primary: ["label"],
            secondary: ["name", "optional", "preserveHover"]
        },
        examples: [
            {title: "Capture after login", snippet: {type: "screenshot", label: "after-login"}}
        ]
    },

    getText: {
        label: "Get text into variable",
        category: "variables",
        description: "Read textContent from the first matching element and store it into a variable.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Element selector",
                description: "CSS selector to read.",
                placeholder: "h1",
                example: "h1"
            },
            var: {
                type: "string",
                required: true,
                alias: "Variable name",
                description: "Variable name to store the value.",
                placeholder: "pageTitle",
                example: "productName"
            },
            attr: {
                type: "string",
                required: false,
                alias: "Attribute name",
                description: "If set, reads the given attribute instead of textContent (e.g. href, aria-label, data-id).",
                placeholder: "href",
                example: "href"
            },
            rawAttr: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Read raw attribute value",
                description: "When attr is href, read the raw HTML attribute (e.g. ../page.html) instead of the resolved absolute URL."
            },
            useInnerText: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Use rendered text (innerText)",
                description: "Use innerText instead of textContent. Slower but respects visibility and CSS."
            },
            trim: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Trim whitespace",
                description: "Trim and collapse whitespace when true."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Read the product name"
            }
        },
        fieldOrder: {
            primary: ["selector", "var"],
            secondary: ["attr", "rawAttr", "useInnerText", "trim", "label"]
        },
        examples: [
            {
                title: "Save card title during iteration",
                snippet: {
                    type: "getText",
                    selector: ":ctx .title",
                    var: "scanTitle",
                    trim: true
                }
            },
            {
                title: "Read link URL",
                snippet: {
                    type: "getText",
                    selector: ":ctx a",
                    attr: "href",
                    var: "targetUrl"
                }
            },
            {
                title: "Read aria-label for accessibility checks",
                snippet: {
                    type: "getText",
                    selector: "button",
                    attr: "aria-label",
                    var: "buttonLabel"
                }
            }
        ]
    },

    getCount: {
        label: "Count elements into variable",
        category: "variables",
        description: "Count the elements that match a selector (including inside open shadow roots) and store the number into a variable. Stores 0 when nothing matches. The variable can be used in number fields, e.g. repeat's repetitions: {var:count}.",
        fields: {
            selector: {
                type: "string",
                required: true,
                alias: "Element selector",
                description: "CSS selector to count.",
                placeholder: "ul.results > li",
                example: ".cart-item"
            },
            var: {
                type: "string",
                required: true,
                alias: "Variable name",
                description: "Variable name to store the count.",
                placeholder: "resultCount",
                example: "itemsInCart"
            },
            logValue: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Log the value",
                description: "Write the stored count to the run log."
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Count the cart's items"
            }
        },
        fieldOrder: {
            primary: ["selector", "var", "logValue"],
            secondary: ["label"]
        },
        examples: [
            {
                title: "Count result rows",
                snippet: {
                    type: "getCount",
                    selector: "ul.results > li",
                    var: "resultCount",
                    logValue: true
                }
            },
            {
                title: "Repeat once per tab",
                snippet: {
                    type: "group",
                    actions: [
                        {type: "getCount", selector: "[role=tab]", var: "tabCount"},
                        {
                            type: "repeat",
                            repetitions: "{var:tabCount}",
                            actions: [{type: "keyboard", keys: ["ArrowRight"]}]
                        }
                    ]
                }
            }
        ]
    },

    setVar: {
        label: "Set variable",
        category: "variables",
        description: "Set a workflow variable to a literal value. Strings support {var:name} expansion.",
        fields: {
            key: {
                type: "string",
                required: true,
                alias: "Variable name",
                description: "Variable name.",
                placeholder: "section",
                example: "category"
            },
            value: {
                type: "string|number|boolean",
                required: true,
                alias: "Value",
                description: "Value to assign. For strings, you can use {var:name}.",
                placeholder: "Checkout",
                example: "shoes"
            },
            from: {
                type: "string",
                required: false,
                alias: "Source",
                description: "Set from a runtime source instead of a literal value. Supported: url.",
                options: [{ value: "url", label: "Current page URL" }]
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Start with shoes"
            }
        },
        fieldOrder: {
            primary: ["key", "value"],
            secondary: ["from", "label"]
        },
        examples: [
            {title: "Set section name", snippet: {type: "setVar", key: "section", value: "Checkout"}}
        ]
    },

    clearVar: {
        label: "Clear variable",
        category: "variables",
        description: "Remove a variable from the workflow variable map.",
        fields: {
            key: {
                type: "string",
                required: true,
                alias: "Variable name",
                description: "Variable name to remove.",
                placeholder: "section",
                example: "category"
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Forget the category"
            }
        },
        fieldOrder: {
            primary: ["key"],
            secondary: ["label"]
        },
        examples: [
            {title: "Clear a temporary variable", snippet: {type: "clearVar", key: "scanTitle"}}
        ]
    },

    collectOutput: {
        label: "Collect metadata",
        category: "reporting",
        description:
            "Record a value into the run's collected-metadata report, grouped by key. Useful inside loops (forEachElement/repeat/crawlQueue) to build a list of values across pages, optionally only when a condition holds.",
        fields: {
            key: {
                type: "string",
                required: true,
                alias: "Key",
                description: "Grouping key for the report panel. Supports {var:name}.",
                placeholder: "breadcrumb",
                example: "Empty categories"
            },
            label: {
                type: "string",
                required: false,
                alias: "Display label",
                description: "Display label; defaults to the key.",
                example: "Category with no products"
            },
            value: {
                type: "string",
                required: false,
                alias: "Literal value",
                description: "Literal/template value to record. Supports {var:name}, {index}, {oneBased}, {total}. Exactly one of value/fromVar/from must be set.",
                placeholder: "Reached checkout on iteration {oneBased}/{total}",
                example: "{var:category}"
            },
            fromVar: {
                type: "string",
                required: false,
                alias: "From variable",
                description: "Record the current value of this workflow variable.",
                example: "productName"
            },
            from: {
                type: "string",
                required: false,
                alias: "From page",
                description: "Record a page-derived value instead of a literal/variable.",
                options: [
                    {value: "url", label: "Current page URL"},
                    {value: "selectorText", label: "Text content of a selector"},
                    {value: "selectorAttr", label: "Attribute of a selector"}
                ]
            },
            selector: {
                type: "string",
                required: false,
                alias: "Element selector",
                description: "Used when from is selectorText or selectorAttr. Use selector: \"title\" for the page title, \"h1\" for the main heading.",
                placeholder: "nav.breadcrumb",
                example: "h1"
            },
            attr: {
                type: "string",
                required: false,
                alias: "Attribute name",
                description: "Used when from is selectorAttr (e.g. href, aria-label).",
                placeholder: "aria-label",
                example: "aria-label"
            },
            trim: {
                type: "boolean",
                required: false,
                default: true,
                alias: "Trim whitespace",
                description: "Trim and collapse whitespace when reading from the page."
            },
            tags: {
                type: "array",
                widget: "tags",
                required: false,
                alias: "Tags",
                description: "Freeform tags rolled up into the report's summary counts (e.g. [\"emptyView\"]).",
                example: "emptyView"
            },
            when: {
                type: "string",
                required: false,
                alias: "Condition (JSON object)",
                description: "Only record when this predicate matches. JSON object with the same shape as skipIteration's condition fields (selectorExists, selector+selectorTextEquals/selectorTextContains, selector+selectorAttr+attrEquals/attrContains, urlIncludes, var+varEquals, or). Omit to always record. Example: {\"selectorExists\":\".empty-state\"}",
                multiline: true,
                placeholder: "{\"selectorExists\": \".empty-state\"}",
                example: "{\"selectorExists\": \".no-results\"}"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            }
        },
        fieldOrder: {
            primary: ["key", "value", "fromVar", "from"],
            secondary: ["selector", "attr", "trim", "tags", "when", "label", "optional"]
        },
        examples: [
            {
                title: "Collect every breadcrumb across all iterations",
                snippet: {type: "collectOutput", key: "breadcrumb", from: "selectorText", selector: "nav.breadcrumb"}
            },
            {
                title: "Save URL only when a view has no data",
                snippet: {
                    type: "collectOutput",
                    key: "emptyView",
                    from: "url",
                    tags: ["emptyView"],
                    when: "{\"selectorExists\": \".empty-state\"}"
                }
            },
            {
                title: "Record a variable captured earlier",
                snippet: {type: "collectOutput", key: "title", fromVar: "pageTitle"}
            },
            {
                title: "Log a fixed marker with iteration context",
                snippet: {type: "collectOutput", key: "note", value: "Reached checkout on iteration {oneBased}/{total}"}
            }
        ]
    },

    evidenceCapture: {
        label: "Save evidence",
        category: "reporting",
        description:
            "Capture a stable page state and attach it as an ordered artifact in the timeline. By default it saves a PNG preview and an MHTML snapshot (includes CSS and assets).",
        fields: {
            label: {
                type: "string",
                required: false,
                alias: "Display label",
                description:
                    "Optional label for the artifact shown in reports and live stream. Supports {var:name}, {index}, {oneBased}, {total}. If empty, the system will generate “Evidence N”.",
                placeholder: "Evidence after login",
                example: "Product {oneBased} evidence"
            },
            evidenceVariant: {
                type: "string",
                required: false,
                alias: "Variants to save",
                description:
                    "Which variants to generate for this evidence capture.",
                default: "both",
                options: [
                    { value: "png", label: "PNG preview (screenshot)" },
                    { value: "mhtml", label: "MHTML snapshot (offline replay, includes CSS)" },
                    { value: "both", label: "PNG and MHTML snapshot" }
                ]
            },
            onError: {
                type: "string",
                required: false,
                alias: "On error",
                description:
                    "What to do if saving evidence fails. Default is to continue the workflow and record the artifact error.",
                default: "continue",
                options: [
                    { value: "continue", label: "Continue (record error)" },
                    { value: "fail", label: "Fail workflow" }
                ]
            },
            preserveHover: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Preserve hover state",
                description: "Keep current :hover styling for evidence capture. Disable to clear transient hover before capture."
            }
        },
        fieldOrder: {
            primary: ["label", "evidenceVariant"],
            secondary: ["onError", "preserveHover"]
        },
        examples: [
            {
                title: "Default evidence capture (PNG + MHTML)",
                snippet: { type: "evidenceCapture" }
            },
            {
                title: "Labelled evidence capture",
                snippet: { type: "evidenceCapture", label: "After login" }
            },
            {
                title: "Only PNG preview",
                snippet: { type: "evidenceCapture", label: "Evidence (lightweight)", evidenceVariant: "png" }
            },
            {
                title: "Strict evidence capture (fail if missing)",
                snippet: { type: "evidenceCapture", label: "Critical checkpoint", onError: "fail" }
            }
        ]
    },

    injectCss: {
        label: "Inject CSS",
        category: "debug",
        description: "Inject a CSS <style> tag into the current page. Useful to tweak visuals or stabilize UI behavior (for example, disable animations).",
        fields: {
            css: {
                type: "string",
                required: true,
                alias: "CSS rules",
                description: "CSS text to inject. Supports {var:name}, {index}, {oneBased}, {total}.",
                placeholder: "*,*::before,*::after{animation:none!important;transition:none!important}",
                example: ".cdk-overlay-backdrop{pointer-events:none!important}"
            },
            label: {
                type: "string",
                required: false,
                alias: "Log label",
                description: "Label for logging only.",
                example: "Hide the chat widget"
            },
            optional: {
                type: "boolean",
                required: false,
                default: false,
                alias: "Optional action",
                description: "Do not stop the workflow if this action fails."
            }
        },
        fieldOrder: {
            primary: ["css"],
            secondary: ["label", "optional"]
        },
        examples: [
            {
                title: "Disable animations",
                snippet: { type: "injectCss", css: "*,*::before,*::after{animation:none!important;transition:none!important}" }
            },
            {
                title: "Highlight focus for screenshots",
                snippet: { type: "injectCss", css: ":focus{outline:3px solid #f00!important;outline-offset:2px!important}" }
            }
        ]
    },
};

module.exports = { ACTION_DEFINITIONS };
