# Workflow Collected Metadata / Outputs — Design Notes

> Status: **Shipped.** Kept as a historical record of the design rationale, the
> decisions made (and alternatives rejected), and the real bugs found while building
> and later auditing this feature — not an active plan or checklist.

## 1. Motivation

While a workflow runs (especially loops like `repeat` / `forEachElement` / `crawlQueue`
that visit many pages), users often want to **record arbitrary pieces of information**
and review them after the run finishes — separate from the a11y scan results. E.g.:

- Browsing all pages of a menu, running scans, and saving the URL/title/`h1`/breadcrumb
  whenever a view has no data (or matches any other condition).
- Building a list of every breadcrumb (or title, or any value) across all pages visited.
- Logging one string, or the value of one variable, at a point in the workflow.

The feature has two halves: **capture** (a step that records a value into a run-level
collection, optionally only when a condition holds) and **display** (a report panel
showing the collected values, grouped, with roll-up summaries) — plus a requirement that
the collection travel with exported results.

## 2. Requirements

- **R1** — capture a value: a literal/template string, a workflow variable, the current
  URL, or a value read from the page (selector text/attribute).
- **R2** — optionally only record when a condition matches, reusing the existing
  condition vocabulary (`skipIteration`'s predicate shape).
- **R3** — each entry has a grouping key/label; multiple entries can share a key. Every
  occurrence is kept — no automatic de-duplication.
- **R4** — each entry auto-captures timestamp, current URL, loop iteration index/total,
  and the producing step's `actionPath` (for cross-linking to the action log).
- **R5** — a dedicated report panel, grouped by key, with summaries.
- **R6** — roll-up summaries: totals, per-key counts, tag-based counts.
- **R7** — export-ready: plain JSON, included in the run result.
- **R8** — no behavior change when unused (empty collection → panel hidden).

## 3. Data model

Per-entry shape:

```jsonc
{
  "key": "breadcrumb",          // grouping label (R3); required
  "label": "Breadcrumb",        // optional human label; defaults to key
  "value": "Home / Accounts / Cards",  // recorded value (string only)
  "url": "https://.../cards",   // auto-captured
  "time": "2026-08-05T12:34:56.789Z",  // auto-captured
  "iteration": { "index": 3, "oneBased": 4, "total": 12 },  // null outside a loop
  "actionPath": "3.2.5",        // producing step; shared key with actionResults entries
  "tags": ["emptyView"],        // optional freeform tags
  "truncated": false            // true only if value hit the internal length safety-net
}
```

`ctx.collectedOutputs` is a flat array of these, in capture order, with **no capture-time
cap on entry count and no de-duplication** — deliberately opt-in and low-volume by
construction (entries only appear where a workflow author placed a `collectOutput`
step). A generous internal length cap (5000 chars) guards a single `value` against a
selector accidentally matching something huge (e.g. a container instead of a label) —
a mistake-guard, not a volume-control feature. Summaries (totals, per-key/per-tag counts,
unique values) are computed at render time from the raw array, not precomputed into a
second payload field.

## 4. The `collectOutput` action

Category `reporting` (same as `screenshot`/`evidenceCapture`).

| field | type | notes |
|---|---|---|
| `key` | string, required | grouping key. Supports `{var:...}`. Empty → no-op. |
| `label` | string | display label; defaults to `key`. |
| `value` | string | literal/template. Supports `{var:name}`, `{index}`, `{oneBased}`, `{total}`. |
| `fromVar` | string | record the value of this variable. |
| `from` | enum: `url` \| `selectorText` \| `selectorAttr` | page-derived source. |
| `selector` / `attr` | string | used with `from: selectorText`/`selectorAttr`. |
| `trim` | boolean, default `true` | collapse whitespace on read text. |
| `tags` | string[] | freeform tags for summaries; UI uses the existing tags widget. |
| `when` | JSON-encoded string | optional predicate, `skipIteration` shape. See §6. |
| `optional` | boolean | standard action field. |

Exactly one of `value`/`fromVar`/`from` provides the value. `from`'s enum is
`url | selectorText | selectorAttr` — a separate `title`/`h1` source was considered and
dropped: `document.title` and `document.querySelector('title').textContent` are the same
value for any normal page, so `from: "selectorText", selector: "title"` (or `"h1"`)
covers it with the exact same code path as any other selector-based capture. `url` stays
distinct since there's no element to select for "the current address."

Examples:

```jsonc
// Every breadcrumb across all iterations
{ "type": "collectOutput", "key": "breadcrumb", "from": "selectorText", "selector": "nav.breadcrumb" }

// Save URL only when a view has no data
{ "type": "collectOutput", "key": "emptyView", "from": "url", "tags": ["emptyView"],
  "when": "{\"selectorExists\": \".empty-state\"}" }

// Record a variable captured earlier
{ "type": "getText", "selector": "h1", "var": "pageTitle" }
{ "type": "collectOutput", "key": "title", "fromVar": "pageTitle" }

// A fixed marker with iteration context
{ "type": "collectOutput", "key": "note", "value": "Reached checkout on iteration {oneBased}/{total}" }
```

## 5. Report panel

A collapsible "Collected metadata" panel (hidden when empty), grouped by `key`, each
group a titled list with context chips (URL link, iteration `4/12`), a summary strip at
top (totals, per-key/tag counts), and a per-group "copy list" affordance. Rendering caps
in-DOM rows per group (the underlying data and export are never truncated, only what's
rendered).

**Cross-linking with the action log**: every `collectedOutputs` entry carries the same
`actionPath` as its step's entry in the persisted `actionResults` array, so a "view step"
link on each row can scroll to/highlight the matching action-log line — for both live
runs and reopened/exported reports, no new identifier scheme needed. A second, parallel
live-log panel/tab was considered and rejected: the live log stream (`#log-panel`) isn't
persisted — on a reopened report it's rebuilt from `actionResults`, not from the raw log
— so anything built only on top of the live stream would vanish once a report is
reopened. The reverse direction (a badge on the action-log line linking back to its
metadata entry) was deferred as a fast-follow; only the metadata→log direction shipped.

## 6. Decisions and rejected alternatives

1. **Action name**: `collectOutput`.
2. **`when` condition**: supported, sharing one predicate evaluator extracted from
   `skipIteration` (`buildConditionConfig`/`evaluateConditionPredicate`) rather than
   forcing every conditional collect to be wrapped in `if { actions: [...] }` — this tool
   is step/JSON-authored, and the primary use case ("save URL only when a view has no
   data") is exactly this predicate shape.
3. **Value types**: strings only.
4. **De-dup**: rejected as a capture-time option — users generally want every occurrence
   with its iteration/URL context, which de-duplication would throw away. Unique-value
   counts remain available in the display summary.
5. **Summaries**: computed at render time, not precomputed into a second payload field.
6. **Export**: automatic inclusion, no toggle. A CSV convenience for a single key's
   values was deferred.
7. **Growth control**: no capture-time entry-count cap (opt-in/low-volume by
   construction); cardinality is handled at render time, not capture time.
8. **Rejected: auto-surface `ctx.getVarsFlat()` instead of a new step.** Simpler on
   paper, but vars are scoped/overwritten per iteration by design — you'd only ever see
   the last value, not a list — and it conflates transient computation state with
   durable report data.
9. **Rejected: a second live-logs panel/tab.** See §5 — the live log stream isn't
   persisted into saved/exported reports; the `actionPath` cross-link achieves the same
   goal without that problem.

## 7. Bugs found along the way

- **`when` shipped as a JSON string, not a nested object, after a real round-trip bug.**
  The original design used a raw object (`when: { selectorExists: "..." }`,
  `type: "object"`). The step-config UI's field renderer has no branch for `type:
  "object"` or a bare `type: "array"` — both silently fall through to a plain text input
  that stringifies whatever it's given (`String({...})` → `"[object Object]"`,
  `String(["lowRated"])` → `"lowRated"`, a single-element array's `.toString()` has no
  comma to give it away). Loading a config through the real UI and clicking Run
  therefore submitted a broken `when`/`tags`, silently disabling the condition entirely
  — confirmed by intercepting the actual `fetch` body from a live browser session, and
  reproducible only that way (engine unit tests pass real JS objects directly,
  bypassing the form; a curl-driven config post also bypasses the form's serializer).
  Fixed by giving `tags` the existing `widget: "tags"` chip-input and making `when` a
  JSON-encoded string (same convention as `runCustomStep`'s `argsJson`), with the engine
  `JSON.parse`-ing it and failing closed (not recording) on malformed JSON. Locked in
  with DOM round-trip tests under jsdom (`actions-builder.collect-output.test.js`) that
  fail with the exact same mangled values against the old field definitions. **Lesson**:
  a new field `type` in `ACTION_DEFINITIONS` isn't free if the UI has no renderer for
  it — and nothing catches that except a test that actually drives the real form.

- **Pre-existing bug: `prepareDataForReport`'s field allowlist dropped `actionResults`/
  `runDiagnostics`.** `finalizeAndRenderAll` only ever receives data that's passed
  through this allowlist, which never included those two fields — so the action-log
  and diagnostics panels were silently no-ops in the live "run" view even before this
  feature existed. `collectedOutputs` inherited the same gap the moment it was wired up
  the same way. Fixed by adding all three to the allowlist.

- **Pre-existing bug: `actionPath` collision for anything nested inside a sequential
  `forEachElement`.** Three `applyActions(...)` calls in that loop were missing the
  `actionPathPrefix` argument every other call site already passed, so nested actions
  got a bare, un-prefixed `actionPath` ("1", "2", "3") that collided with unrelated
  top-level actions at the same index — breaking both the "view step" cross-link and
  the "Go to config" live-log button. Fixed by passing the missing argument at all three
  sites, with a regression test asserting a nested action's path is correctly prefixed.

- **Related, deliberately not fixed: the cross-link is a no-op for anything nested
  inside a loop.** `actionResults` only ever gets one entry for a loop's own container,
  never for its nested actions — true for every action type, not just `collectOutput`.
  Making every nested action push its own entry would grow report payload size with
  total iterations × actions-per-iteration for any workflow using a loop, not just ones
  using this feature — too consequential a change to make unilaterally here. Instead,
  the "view step" button only renders when a real target actually exists, trading "jump
  to the right place" for "never show a button that silently does nothing."

## 8. Export

Included automatically in the in-app "Download JSON" export (a side effect of the
`prepareDataForReport` fix above — both go through the same function). Deliberately
**not** added to the on-disk per-scan report sidecar (`saveHtmlReport`): that file is
written once per scan, while `collectedOutputs` is a whole-run aggregate with no clean
way to partition per scan — bolting it on would just duplicate the same array into every
scan's file. A flat CSV export of a single key's values was deferred as a fast-follow.

## 9. Where things live

- Engine: `src/workflow/engine/context.js` — `createWorkflowContext`/`createChildContext`
  (the collector array), `stepCollectOutput` in `src/workflow/steps/data.js`,
  `buildConditionConfig`/`evaluateConditionPredicate` in `src/workflow/engine/conditions.js`
  (shared with `skipIteration`).
- Runner → payload: `src/server-side/a11y-runner.js` (all three return sites) →
  `src/shared/workflow-payload-builder.js` (`buildWorkflowPayloadBase`) → `server.js`
  (`/workflow-scan`, `/workflow-start`).
- UI: `src/js/a11y-ui.run-summary.js` (`renderCollectedMetadata`), invoked from
  `finalizeAndRenderAll` in `src/js/a11y-ui.js`. Not yet added to the standalone exported
  report viewer (`src/report/report.js`) — a known fast-follow.
- Schema: `src/workflow/action-definitions.js` (`ACTION_DEFINITIONS.collectOutput`).
- Tests: `src/workflow/workflow-engine.test.js` (engine-level), plus
  `src/js/actions-builder.collect-output.test.js` (DOM round-trip, jsdom).
