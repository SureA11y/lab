# Headless Runner — Design Notes

> Status: **Phases 1 to 4 shipped.** `src/cli/run-workflow.js` runs a spec
> headless and writes the payload, over the shared path in
> `src/server-side/workflow-run.js` that `/workflow-start` also uses; the spec
> format in `src/shared/run-spec.js` is what the app posts and saves;
> `--baseline` reports what changed since a previous run, with the exit codes in
> §4; and the run store keeps scheduled runs, their baselines and their prose
> summaries. The package extraction (§7 phase 5) is not done; §8 lists what is
> still undecided.

## 1. Motivation

Every result the tool produces today requires a person to open the UI, load a
config and press Run. There is no memory between runs, so a page that regressed
after a fix is only discovered the next time someone runs the same workflow and
remembers what it used to look like.

A headless runner exists to answer the same question on a schedule and report
when the answer gets worse: run a stored workflow unattended, keep the previous
result, and surface what changed. That makes the tool usable from a build
pipeline, a nightly job, or anything that can run a command and read an exit
code.

The checking logic does not change. The same engine, the same canonical model
and the same metrics — without a screen.

## 2. What already runs without a UI

The run pipeline has no UI dependency. `runA11yWorkflow`
(`src/server-side/a11y-runner.js`) drives Puppeteer, the workflow engine, the
canonical model and every metric: `a11y-summary`, `global-summary`,
`coverage-summary`, `automation-coverage`, `dom-metrics`, `text-metrics`.

`server.js` is a thin wrapper over it. `/workflow-start` (`server.js:519`)
validates the URL, calls `runA11yWorkflow`, then builds the response with
`buildWorkflowPayloadBase` and `finalizeWorkflowPayload` from
`src/shared/workflow-payload-builder.js`. HTML report writing is server-side
too, through `a11yEngine.saveHtmlReport`.

A command that produces the identical payload and the identical HTML reports is
therefore: parse a spec, call `runA11yWorkflow`, build the payload, write to
disk.

The two modules behind run-over-run comparison were already pure — no DOM, no
globals — and now live in the shared tier: `diffReports`
(`src/shared/report-diff.js`) and `src/shared/report-identity.js`.

## 3. The run spec

A saved config used to be a dump of UI state and nothing else: `config-io.js`
collects `state[el.id]` across the form's inputs, and the translation into the
request the server receives lived in the app, in `buildWorkflowPayload`. Running
what the app runs meant reimplementing that glue, which guarantees drift.

`src/shared/run-spec.js` now holds the format. It is versioned, it carries only
what a run needs, and it leaves out what the form did not set:

```
{ type: 'a11y-run-spec', specVersion: 1,
  url, tags, actions, customSteps?, viewport?, context?, exclude?,
  globalEvidenceFormat?, scenarioName? }
```

The app builds it with `buildRunSpec` and posts it — `/workflow-start` receives
the spec plus `groupScans`, which only the report uses. The same call fills the
`runSpec` field of a saved config, so the file that restores the form is also
the file the runner takes. What the app runs and what it saves are the same
object by construction, not by agreement.

State stays in the saved file because it restores the form, including the
builder widget state a spec has no reason to carry. Configs saved before the
spec existed still run: `runSpecFromUiConfig` maps the form ids, in the one
place that knows them.

What a headless run does not get for free: the metrics panel narrative and the
downloadable comparison HTML, which are assembled in the browser
(`src/js/export.js` loads `./report/comparison-template.html` client-side).
Numeric metrics are server-side and come through intact.

## 4. Reporting, not gating

The headline metric is presented throughout the tool as an automated result and
not an accessibility grade. A threshold gate (`fail if score < N`) reintroduces
exactly the false confidence the metrics work was built to avoid, and it is not
what a team needs anyway.

The defensible signal is **new violation instances against a stored baseline**,
which `diffReports` already computes. Fixed instances and unchanged ones are
reported, not enforced.

A second condition matters as much: a run whose actions degraded is not a clean
run. These workflows drive a real browser through clicks, waits and
`forEachElement` loops, and unattended there is nobody to notice that a step
found zero elements.

`assessRun` (`src/shared/run-health.js`) reads that from a finished payload:
scans the runner skipped, iterations that failed inside a loop, and actions that
failed. Failures on actions the spec marked optional are reported but are not
degradation — the spec said they may fail. Console errors, request failures and
bad responses are page noise, not evidence that the workflow misbehaved, so they
are printed and left out of the decision.

Degradation outranks a regression, because a run that covered less makes the
comparison unsound rather than merely worse. A skipped scan reports zero
failures, which against a baseline reads as everything being fixed.

| Condition | Result | Exit |
| --- | --- | --- |
| Run failed | fail | 1 |
| Cancelled | fail | 130 |
| Skipped scans, failed iterations or actions | fail | 4 |
| New instances against baseline | fail | 3 |
| Fixed or unchanged instances | report only | 0 |
| Optional actions that failed | report only | 0 |
| Metric value below any threshold | report only | 0 |

## 5. Shared code — the tiers

`src/shared/` is already a shared module: UMD-wrapped, dependency-injected,
running in both Node and the browser. It is consumed by the server, the UI, and
the extension (copied and bundled by `copy-shared-to-extension.cjs.js`).

That is tier 1, data shaping. A headless runner needs tier 2 as well — the
Puppeteer-bound runner in `src/workflow/` and `src/server-side/`, currently
consumed only by `server.js`.

| Consumer | tier 1 (isomorphic) | tier 2 (node runner) |
| --- | --- | --- |
| server + UI | yes | yes |
| extension | yes | no — cannot run Puppeteer |
| headless runner | yes | yes |

The asymmetry is the reason not to lump both tiers into one package: the
extension would take a dependency on code it can never execute.

## 6. One repository, not three

Duplicated sources of truth are this project's recurring bug class, and there
are three recorded instances. `workflow-payload-deps.js` carries a copy that had
already drifted, losing one metric definition and turning an `Infinity` bound
into `null`. The extension scans with stale engines whenever a dependency bump
lands without rerunning `build:extension-shared`. `@surea11y/core` has to stay
symlinked to its sibling checkout or a rebuild downgrades the bundle.

Separate repositories multiply that: version drift, publish-to-test cycles, and
no way to tell which engine version produced a given result. For a tool whose
value is comparability across runs, a comparison spanning an engine-version
boundary is a wrong answer rather than a missing one.

Yarn workspaces give the boundary without the release cycle — one install, one
test run, and a single commit that changes the engine and both consumers
together.

## 7. Plan

**Phase 1 — the runner. Done.** `executeWorkflowRun`
(`src/server-side/workflow-run.js`) owns determinism defaults, the run itself
and payload assembly, including the partial payload a cancelled or failed run
produces. `/workflow-start` and the CLI both call it, so neither can drift from
the other.

`src/cli/run-workflow.js` reads a spec, runs it, and writes `payload.json` and
`run.log.jsonl` to an output directory. It exits 0 on a finished run, 1 on a
failed one, 2 on bad usage or an invalid spec, and 130 when cancelled — Ctrl+C
still writes the partial payload. `src/cli/run-spec.js` normalizes the input and
reports every problem in one pass instead of failing on the first.

Verified with the server running: the CLI and
`/workflow-start` produced identical findings, occurrence counts, findings inputs,
DOM totals and metric scores from the same spec.

**Phase 2 — the run spec. Done.** The format and its normalization live in
`src/shared/run-spec.js`, loaded as a plain script by the app and required by
the CLI. Tag building, viewport presets and url validation are injected, so the
shared file keeps no dependencies of its own.

`buildRunSpecFromUi` is the app's single source for both the run request and the
`runSpec` embedded in a saved config. The runner prefers that embedded spec, and
falls back to mapping form ids only for configs saved before it existed.

Verified in the browser: a run started from the app posted a spec, and the same
spec run through the CLI reported the same 4 rules over 7 elements the app
displayed.

**Phase 3 — baseline comparison. Done.** `report-diff.js` and
`report-identity.js` moved to `src/shared/` and became plain scripts like the
rest of that tier, so the CLI requires them without Node reparsing them as
modules on every run. The app reads them from `globalThis` at call time.

`--baseline <path>` takes a previous `payload.json`, or the directory holding
one, and is read before the run so a wrong path costs nothing. The comparison
is `diffReports` in evolution mode — the same engine behind the Compare tab —
and it writes `diff.json` next to the payload. A baseline newer than the run is
reported rather than silently reordered.

The iteration-failure summary now reaches the payload
(`payload.iterationFailureSummary`); before this it existed only in the engine's
context and a log line, so nothing downstream could see it.

Verified manually: an unchanged page reported 0 new and exited 0; a
page with new violations reported 3 new rules over 4 instances and exited 3; a
scan skipped by the heavy-node threshold reported *9 fixed, 0 new* — the exact
false reading §4 describes — and exited 4 on the degradation instead. Payloads
written by the CLI load into the app's Compare tab and produce the same counts.

**Phase 4 — scheduling. Done.** The schedule itself is one cron line, but a run
left alone needed three things it did not have: to find its own predecessor, to
keep a reference that outlives the last run, and to not grow without bound.

`src/cli/run-store.js` keeps one directory per scenario:

```
<store>/<scenario>/runs/<stamp>/{payload.json, run.log.jsonl, summary.md, diff.json}
<store>/<scenario>/baselines/<name>.json
```

`--baseline auto` takes the newest run beside this one, checking the scenario
name in the payload rather than trusting the path, and skipping directories with
no payload. The first run has nothing to compare with, which is a note rather
than a failure. `--baseline @name` reads a promoted baseline instead, which is
what answers "since the release" rather than "since last night".

`--promote <name>` keeps the run as that baseline, and refuses a run that failed
or came back degraded: a reference that covered less than it should makes every
later run read as an improvement. `--keep <n>` removes all but the newest n runs
of the scenario, touching only directories that hold a payload, and never the
baselines beside them.

`summary.md` is the run as prose — outcome first, then what ran, what it failed
to cover, and what changed — for whatever the schedule wrapper sends onward. A
pipeline reads the exit code and `diff.json` instead.

A nightly run of one scenario, keeping a fortnight:

```
0 3 * * * cd /path/to/surea11y-lab && \
  node src/cli/run-workflow.js specs/checkout.json --baseline auto --keep 14 --quiet
```

Verified end to end: the first run reported nothing to compare with and promoted
itself as `release-1.0`; the second found it through `auto` and reported 0 new;
a third against `@release-1.0` reported 3 new rules and exited 3 while pruning
the oldest run; and a degraded run was refused as a baseline, leaving the
existing one untouched.

**Phase 5 — extraction. Enforced, not moved.** The goal was a boundary that
fails loudly when something crosses it, and that arrived without the layout
change: `src/shared/scan-inputs.js` holds the viewport table and the tag builder
that the app, the engine and the runner used to restate separately, and
`tier-boundaries.test.js` fails when Node code imports browser code, when shared
code depends on anything outside shared, when browser code imports the runner,
or when the presets offered by the page, the action and the engine stop matching
the table.

What the physical move would still add is packaging — a dependency list per
package, and directory names matching the tiers — which pays off when the core
is published, installed on its own, or joined by a second app. Until one of
those is true, it is path churn across ~146 files against a benefit already
collected. The layout it would take:

```
packages/shared/    payload builder, canonical mapping, metric defs,
                    scan-sort, run-spec, run-health, report-diff,
                    report-identity
packages/core/      workflow-engine, a11y-runner, engines, metrics,
                    screenshot capture
apps/server/        express + UI
apps/cli/           headless runner
extension/          still built from packages/shared by the copy script
```

`src/shared/` already holds that list. The extension would keep the
copy-and-bundle path either way; a browser extension cannot consume a workspace
package.

Sequencing it last was right for a different reason than expected: by the time
the second consumer existed, the boundary it was meant to draw could be checked
instead of moved.

## 8. Costs and open questions

Module formats are three-way mixed: CJS under `src/server-side/` and
`src/workflow/`, ESM under `src/js/`, UMD under `src/shared/`. Phase 5 forces
that to be settled, and the test setup depends on the current arrangement —
client modules are loaded by dynamic `import()` inside jsdom under
`node --test`. The three build scripts (`build:report`,
`build:extension-shared`, `build:action-docs`) resolve paths from
`PROJECT_ROOT` and move together.

This used to be an open question rather than settled: `a11y-runner.js` imported
`sleep` from `../js/a11y-ui.utils`, and `src/cli/run-spec.js` imported
`buildTags` and `buildViewportFromPreset` from the same client UI file to bind
them to the shared spec — the runner reaching into client UI code in both
cases. Copying either helper would have put the tag set and the preset table in
two places, which is how the metric definitions drifted, so the fix was not to
copy but to move: `sleep` is now a local helper in `a11y-runner.js`, and
`buildTags`/`buildViewportFromPreset` now live in `src/shared/scan-inputs.js`,
which both `run-spec.js` and the client import from.

A payload runs about 1.8 MB with screenshots embedded, which is what makes it
loadable in the app's Compare tab. `--keep` bounds that per scenario, but the
number is the operator's to choose and nothing warns when a store grows.

`--keep` prunes the directory holding the run, so pointing `--out` at a folder
whose neighbours are unrelated runs would prune those too. It only removes
directories containing a payload, and the default layout keeps scenarios apart.

Undecided:

- Whether flaky runs retry, or only report. Retrying hides a real signal about
  the workflow; not retrying makes scheduled runs noisier.
- ~~Whether the comparison HTML export is worth moving server-side so scheduled
  runs can attach it, or whether the payload plus `summary.md` is enough.~~
  Settled: a compared run writes `comparison.html` too. The comparison
  renderer was already pure, so the command line draws the same document as
  the app's download (`src/cli/comparison-html.js`, with the document
  assembly shared in `src/js/viewer-documents.js`).
- What sends `summary.md` onward. The runner writes it and stops there, which
  leaves mail, chat and ticketing to whatever wraps the schedule.
- Whether a scheduled run should ever promote its own baseline automatically —
  rolling the reference forward hides slow drift, holding it still eventually
  reports the same regression every night.
