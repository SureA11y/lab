# Adding a new accessibility engine

Every scan engine in this project is an adapter behind one facade, and the
rest of the app never talks to an engine directly. `surea11y` is built in;
the others (axe-core, Alfa, Pa11y, QualWeb) come with the `more-engines`
add-on (`addons/more-engines`), and a new engine belongs in an add-on too:
the lab installs with surea11y alone, and an engine's dependencies are only
installed by whoever wants it.

## 1. Architecture

- **Facade**: `src/server-side/a11y-engine.js`. Runner, server routes, the
  workflow engine and the UI all call through this module and only ever see
  its return value, the canonical result.
- **Adapters**: one `<engineId>-engine.js` file per engine. The built-in
  one is `src/server-side/engines/a11y-labs-engine.js` (its `engineId` is
  `surea11y`); an add-on's are in `addons/<name>/engines/`
  (`addons/more-engines/engines/axe-engine.js`, and so on).
- **Canonical model**: `src/server-side/a11y-canonical.js`.
- **Canonical validator**: `src/server-side/canonical/validate-canonical.js`.

Flow for one scan: the caller calls the facade → the facade resolves an
adapter → it calls the adapter's `runOnPage(page, scanConfig)` → the adapter
runs its underlying engine and maps the result into canonical shape → the
facade stamps provenance (which engine produced each finding) → if
`A11Y_VALIDATE_CANONICAL` is on, the result is validated before it goes back.

## 2. How an engine gets selected

The facade doesn't hardcode a list of engines. At startup it reads every
`*-engine.js` file in `src/server-side/engines/`, then in the `engines/`
folder of every installed add-on (one whose `node_modules` exists), requires
it, and indexes it by whatever it exports as `engineId` (and `engineName`, if
given). Adding a correctly-shaped file is enough for the engine to show up —
no registry to edit elsewhere. `A11Y_ENGINE_ADDONS=off` leaves every add-on
out.

An add-on is a folder in `addons/` with:

- `package.json`: its own dependencies, and the engine ids it offers, so a
  step naming one can say which add-on to install when it is missing:
  `"surea11yLab": { "engines": ["axe", "alfa"] }`.
- `engines/`: its adapters. They reach the lab's modules by relative path
  (`require('../../../src/server-side/conformance-targets')`), and their own
  dependencies from the add-on's `node_modules`.
- `README.md`: what it adds, how to install it, and the engines' licenses.

`npm run addon:install -- <name>` installs one, `npm run addon:list` lists
them. `addons/more-engines` is the example to follow.

Each scan step names the engine it runs with (its `engine` field). A step
without one runs with the default engine, resolved in this order:

1. `A11Y_ENGINE` (or `--engine` / `--a11y-engine` on the command line) — an id
   or a name, e.g. `A11Y_ENGINE=pa11y`.
2. `a11y-engine.config.json` in the working directory (`{ "engineId": "..." }`).
3. The default, `surea11y`.

A scan runs one engine. To check a page with several, add a scan for each —
see §9 for what that does and doesn't give you.

## 3. What an adapter module must export

`axe-engine.js` and `pa11y-engine.js` are the reference implementations; match
their surface.

**Metadata**

- `engineId` — stable id, e.g. `"axe"`. Must be unique across the directory.
- `engineName` — human-readable name, e.g. `"axe-core"`.
- `engineVersion` — a version string, or `null` if unknown.

**Tag/level helpers**

- `buildRunOnlyFromTags(tags)` → an engine-specific `runOnly` filter object,
  or `null` if the engine doesn't support tag filtering.
- `deriveWcagLevelFromTags(tags)` → `"a" | "aa" | "aaa" | null`.
- `overrideTagsWithLevel(globalTags, levelRaw)` → the tag array to use once an
  explicit `wcagLevel` is set on the scan.

**Execution**

- `ensureInjected(page)` — prepare the page (axe injects its script; an engine
  that navigates on its own can no-op).
- `runOnPage(page, scanConfig, engineIdOverride?)` — run the scan and return
  `{ canonical, native?, raw?, meta? }`. Only `canonical` is required; the
  rest is for debugging and export.
- `postProcessResults(nativeResults, ctx)` — normalize/enrich after the engine
  runs. If your adapter already builds canonical output, this can just return
  its input unchanged.

**Optional**

- `getRulesForRunOnly(runOnly)`, `getRulesCatalog()` — feed the UI's rule
  browser.
- `saveHtmlReport(...)` — per-scan HTML export, if the engine supports it.
- `capabilities` — see §4.

## 4. Capabilities

Each adapter declares which `a11yScan` fields it actually honors, so the step
editor can hide the rest for a scan step with that engine, and what it selects
rules by, which decides the conformance targets such a step can choose
(`src/shared/conformance-targets.js`):

- `'standard'` — it applies a standard in full (surea11y): every target.
- `'version'` — it selects a WCAG version and level (axe-core): the WCAG 2.2
  targets and EN 301 549 V4.1.1.
- `'level'` — it selects a WCAG level only, for every version it covers (Alfa,
  Pa11y, QualWeb), and the default for an adapter that does not say: the
  WCAG 2.2 targets and EN 301 549 V4.1.1.

The step editor does not offer a target the step's engine cannot check, and a
run with such a step fails before it starts.

```js
capabilities: {
  selectsBy: 'level',
  actions: {
    a11yScan: {
      label: true,
      context: true,
      exclude: true,
      includeBestPractice: true,
      wcagLevel: true,
      timeout: true,
      heavyNodeThreshold: true,
      disableRules: false,
      waitForSelector: true,
      waitVisible: true
    }
  }
}
```

Don't claim a capability your engine can't back — the UI trusts this object.

## 5. The canonical shape

```js
{
  version: "1.0",
  engine: { id, name, version },
  page: { url, title, viewport, timestamp },
  scope: { context, exclude, include },
  runOptions: { wcagLevel, includeBestPractice, runOnly },
  summary: { outcomes: { fail, cantTell, pass, notApplicable } },
  findings: CanonicalFinding[],
  rules: [],
  diagnostics: []
}
```

Each finding needs a non-empty `uid` (or `id`) and an `outcome` in `fail` /
`cantTell` / `pass` / `notApplicable`. Everything else — `severity`, `wcag`,
`tags`, `occurrences` — is optional but must be the right type if present:

```js
{
  uid: "color-contrast",
  outcome: "fail",
  severity: "critical", // critical | serious | moderate | minor
  wcag: { sc: ["1.4.3"] },
  occurrences: [
    { pageUrl: "https://example.com", target: ["#selector"], html: "<button>...</button>" }
  ]
}
```

`occurrences[].target` must be an array of strings, not a bare string, even
when there's only one.

Validate as you go: set `A11Y_VALIDATE_CANONICAL=1` and
`validateCanonicalOrThrow` will throw with the exact path and reason for any
mismatch, rather than letting a malformed finding reach the UI silently.

## 6. Mapping a new engine's output

- **Outcomes** — normalize whatever your engine calls things (`failed`,
  `violation`, `incomplete`, ...) to the four canonical values.
- **Severity** — map to `critical` / `serious` / `moderate` / `minor` if the
  engine gives you something to map from; omit it otherwise. Don't invent a
  severity the engine didn't report.
- **WCAG** — put success criteria in `finding.wcag.sc` as strings like
  `"1.4.3"`. If you only have tags, keep the tags; a WCAG mapping can be
  derived later.
- **Occurrences** — one per DOM node the engine flagged, with `target`,
  `html`, and `failureSummary` where available.

## 7. Minimal adapter template

```js
'use strict';

const ENGINE_ID = 'myengine';
const ENGINE_NAME = 'My Engine';
const ENGINE_VERSION = null;

function buildRunOnlyFromTags(tags) {
  return null; // or an engine-specific filter object
}

function deriveWcagLevelFromTags(tags) {
  return null; // "a" | "aa" | "aaa" | null
}

function overrideTagsWithLevel(globalTags, levelRaw) {
  return Array.isArray(globalTags) ? globalTags.slice() : [];
}

async function ensureInjected(_page) {}

async function runOnPage(page, { runOnly, contextSelector, excludeSelectors, engineOptions } = {}) {
  const native = await runMyEngine(page, { runOnly, contextSelector, excludeSelectors, engineOptions });
  const canonical = toCanonical(native, {
    engine: { id: ENGINE_ID, name: ENGINE_NAME, version: ENGINE_VERSION },
    page: { url: page.url ? page.url() : null }
  });
  return { canonical, native };
}

function postProcessResults(nativeResults) {
  return nativeResults;
}

module.exports = {
  engineId: ENGINE_ID,
  engineName: ENGINE_NAME,
  engineVersion: ENGINE_VERSION,
  buildRunOnlyFromTags,
  deriveWcagLevelFromTags,
  overrideTagsWithLevel,
  ensureInjected,
  runOnPage,
  postProcessResults,
  capabilities: {
    selectsBy: 'level',
    actions: {
      a11yScan: {
        label: true,
        context: true,
        exclude: false,
        includeBestPractice: false,
        wcagLevel: false,
        timeout: false,
        heavyNodeThreshold: false,
        disableRules: false,
        waitForSelector: true,
        waitVisible: true
      }
    }
  }
};
```

Drop this at `src/server-side/engines/myengine-engine.js` and it's discovered
automatically — nothing else to wire up.

## 8. Checklist

1. Create `addons/<name>/engines/<engineId>-engine.js`, in an add-on of its
   own or an existing one, and list its id in the add-on's `package.json`.
2. Implement the exports in §3.
3. Make sure `canonical.findings` always exists, even as an empty array.
4. Run with `A11Y_VALIDATE_CANONICAL=1` and clear every validation error.
5. Set `capabilities` to match what the engine actually supports.
6. Add a test, named `<engineId>-engine.addon-spec.js` so the lab's own
   test run, which has no add-ons, leaves it out (`npm run test:addons` runs
   it); `axe-engine.addon-spec.js` / `pa11y-engine.addon-spec.js` are the
   pattern to follow.
7. Run it against a few real pages and eyeball outcomes, severities,
   occurrences and URLs.

Common mistakes: returning native output where canonical is expected, leaving
`findings` undefined, using non-canonical outcome strings, returning `target`
as a bare string, and claiming a capability the engine can't back.

## 9. Running more than one engine on a page

A scan runs one engine; to check a page with several, add a scan step for
each, and put them in a Merged scan step to have them reported as one scan
(`src/server-side/merged-scan.js`): its coverage is what the engines reach
between them, and it keeps one set of metrics per engine for the report's
engine filter. That has consequences nothing currently corrects for:

- **Findings aren't reconciled.** The merge doesn't dedup across engines;
  uids are engine-prefixed, so one real issue flagged by three engines becomes
  three findings and is counted three times downstream.
- **Severity isn't comparable across engines.** `surea11y` uses each rule's
  own default severity, `pa11y` marks every error `serious`, QualWeb derives
  severity from WCAG level rather than impact, and axe reports actual impact.
  Aggregating severity across engines produces a number with no consistent
  meaning.
- **Engines can see different page states.** axe and `surea11y` run in the
  live Puppeteer page, so they see whatever state the workflow reached when
  their scan step ran.
  QualWeb and pa11y's fallback path re-navigate to the URL in their own
  browser, so anything behind a login or a prior interaction may be missing
  for them.
- **Scoping isn't honored uniformly.** `excludeSelectors` is a no-op in pa11y
  and unsupported in QualWeb; rule/tag filtering is unsupported by both.
- **pa11y defaults to axe as its own runner**, so an axe scan and a pa11y
  scan together mostly rerun the same rules twice.

If you need multi-engine results to actually reconcile, match findings on
WCAG success criterion plus occurrence (selector + HTML) rather than the
engine-prefixed uid, and make sure every engine scans the same captured DOM
state.
