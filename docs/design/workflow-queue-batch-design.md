# Run Queue and Batch Runs — Design Notes

> Status: **Phases 1 to 3 shipped** (§11). Finished runs are swept from
> memory by `src/server-side/run-sweep.js`. The queue is
> `src/server-side/run-queue.js` (scheduling, saving, resume) over
> `queue-files.js` (folders, names, manifest, retention), with its HTTP routes
> in `queue-routes.js` and the zip in `queue-zip.js`; the queue tab is
> `src/js/run-queue-panel.js`. Batch rows are read and checked by
> `src/shared/batch-rows.js`, and the Batch section of the run workflow tab is
> `src/js/batch-panel.js`. Extracting rows from a table on a page (phase 4) is
> not built.
>
> This note records the design agreed for running several workflows from one
> tab: a server-side queue with a configurable concurrency limit, batch runs
> that expand one workflow over a pasted list of rows, automatic saving of
> every finished run, and download links for each result and for the whole
> folder. §12 lists what is still
> undecided; §7 covers what happens when the server restarts mid-queue.

## 1. Motivation

Running several workflows at once today means opening one tab per workflow.
That works — the server already handles concurrent runs — but nothing shows
them together, each result has to be exported by hand, and finished results
stay in the server's memory until it restarts.

A second need sits on top of the first: running **the same workflow once per
version of a product**. Given a list of versions (URL, name, date, …), run the
workflow for each, name each run after its version, and keep each result as its
own JSON file.

Both are the same feature seen from two sides: a queue of runs, filled either
one workflow at a time or many at once from a data list.

## 2. What already exists

- **Concurrent runs.** `/workflow-start` (`server.js:540`) gives each run its own
  `runId`; progress and results are polled by id. All runs share one Chromium
  (`getBrowser()`, `src/server-side/a11y-runner.js:70`), but each opens its own
  browser context (`a11y-runner.js:718`), so cookies and storage do not leak
  between runs.
- **One shared run path.** `executeWorkflowRun`
  (`src/server-side/workflow-run.js:149`) is what both the app and the headless
  CLI call. The queue calls it too; there is no second way to run a workflow.
- **Variables.** `{var:name}` tokens are interpolated in navigation URLs,
  labels and typed values (`src/workflow/engine/vars.js:191`), and
  `createWorkflowContext` already accepts starting variables
  (`src/workflow/workflow-engine.js:1295`). The runner does not pass any yet
  (`a11y-runner.js:1370`).
- **Serving files.** Everything under `reports/` is served at `/reports/...`
  (`server.js:193`), with dotfiles denied and no directory index.
- **Zip support.** `archiver` is already a dependency.
- **The leak this design must not repeat.** The `Runs` map (`server.js:524`) and
  the extension's `ManualRuns` map (`server.js:530`) are never cleared. Every
  finished run — result, base64 screenshots, up to 10,000 log entries — stays in
  memory until the process exits.

## 3. The model: one Run button, two meanings

- **Batch off** (the default): **Run** runs the workflow once and shows its
  report on the page, as it always has.
- **Batch on**: **Run** reads "Run batch (N runs)" and queues the workflow
  once per row of a pasted JSON list, each with that row's values filled in,
  then opens the queue tab. A batch cannot show N reports on one page, so it
  always goes through the queue, where each result is saved.

The label always says which of the two a press will do. Everything after
queuing is the queue's: the runs panel, the concurrency limit, per-item status
and cancel, automatic saving, download links, and handing finished runs to
Compare.

An earlier "Add to queue" button, for queuing single runs of different
workflows, was removed to keep one obvious Run button: different workflows run
in different tabs, and one workflow can stand in for several with an `if` on a
row variable at its root (§4.1).

## 4. Batch rows

Pasted as JSON. Each row carries only what the engine can use:

```json
[
  { "name": "v2.3", "url": "https://example.com/v2.3", "vars": { "date": "2026-03-01", "build": "2310" } },
  { "name": "v2.4", "url": "https://example.com/v2.4", "vars": { "date": "2026-06-15" } }
]
```

- `name` becomes the run's scenario name, which also names its saved file. The
  batch may give a pattern instead, e.g. `Product {var:name}`, filled from the
  row's vars plus `{var:name}`, `{var:url}` and `{var:row}` (its number).
- `url` replaces the workflow's starting URL. Optional; the workflow's own URL
  is used when absent.
- `vars` become starting variables, available as `{var:date}` and so on
  anywhere the engine accepts the token. Names follow the engine's strict
  token rule (a letter or `_`, then letters, digits, `_` or `-`); values are
  text, numbers or booleans. They are also written into the saved result as
  `vars`, so a file says which version it covered and not only when it ran.

Any other field in a row is refused rather than ignored: a misspelt `nmae`
would otherwise run under no name. A batch holds at most 500 rows.

**Validation runs as the rows are typed**, over every row: the JSON parses
and is a list of objects; each `url` is a full http(s) URL (the server checks
again with `validateUrlOrThrow`); names are non-empty after the pattern is
filled and unique within the batch; every token the pattern uses is set by the
row. A bad row blocks the batch with its row number and the reason, rather
than failing halfway through.

A `{var:…}` token the *workflow* uses but some row does not set only warns.
The workflow may set it itself: a Set variable step is recognised and not
warned about, but loops set variables of their own that cannot be told apart
from a forgotten row value without running the workflow.

`vars` is part of the run spec (`src/shared/run-spec.js`) and threads through
`executeWorkflowRun` and `runA11yWorkflow` into `createWorkflowContext`, so a
spec saved for one row runs the same from the headless CLI.

**Where the rows go in.** A collapsible "Batch" section in the run workflow tab,
above Custom steps and Workflow (the rows feed the steps, so they come first),
collapsed unless a loaded config carries a batch. It holds an "Enable batch" /
"Disable batch" button (beside "Load file…"), the rows (pasted, or "Load file…"), the run name
pattern, and a status line with the verdict. The batch enables itself when
rows arrive in an empty box; it can be disabled to run the workflow once
without deleting the rows; rows kept while it is disabled show as dashed,
greyed boxes under the line "Batch disabled: Run runs the workflow once. The
rows stay here." (not opacity: the rows stay editable, and their text keeps
4.5:1). While it is enabled, Run says "Run batch (N runs)", or
"Run batch (fix N problems)" and then opens the section on the problems instead
of running. The status line announces a one-line verdict; the list of problems
under it is not live, so a long list is read only on request. The rows stay in
the box after a run, to change one and run the batch again.

Each queued row is its own item with its own saved config (that row's URL,
name and vars), so resuming or reloading a run gives back exactly that row.

### 4.1 Row variables inside the workflow

A row's `vars` are seeded into the run's outermost variable scope, and every
step looks a variable up through all the scopes enclosing it, so a row
variable is readable by any step at any depth: inside groups, `if` branches,
loops and custom steps alike (`src/workflow/workflow-engine.row-vars.test.js`
holds the engine to it). One workflow can therefore choose its steps per row
with an `if` on a row variable: `variant = logged-in` around the login steps.

`if` (and the shared condition of skip-iteration and collect-output) compares
a variable with the value typed into the step as text, so a row's `2310` (a
number) equals the step's `2310`, and an unset variable equals nothing.

**Nothing may hide a row variable.** A step that names a variable the rows set
would hide the row's value from that step on (or, for Clear variable, remove
it for the rest of the run), and the run would quietly use the wrong value.
While the batch is on, such a step is a **field error** in the step editor,
shown as soon as the rows and the step clash and blocking Run like an empty
required field: Set variable, Get text and Get count's variable name, Clear
variable's name, Run custom step's export vars, an argument of a different
value under a row variable's name (`"build": "{var:build}"` passes the row's
value on and is fine), and a custom step input named like a row variable that
the call does not hand the row's value. The step editor shows one custom step
at a time, so a clash inside another custom step is also reported in the Batch
section, by custom step. Loops create `index`, `oneBased`, `total`, `item` and
`value` on every iteration with no field to flag, so a row variable may not use
those names. With the batch off, all these names are ordinary again.

**Saved with the config.** Whenever the Batch section holds rows, "Export
config" writes the batch beside the workflow as
`batch: { rows, namePattern, enabled }` (a draft that does not parse yet is
kept as `rowsText`, and so are rows laid out other than with two-space
indentation, next to `rows`, so they load back exactly as typed), and loading that config restores the rows, enables or
disables the batch as it was saved (enabled when `enabled` is missing) and
opens the section, so a batch is saved, shared and re-run as one file. The
section is marked `data-config-exclude`, so its fields never enter the form
state a plain export captures. A config without a batch leaves the section as
it is. The config also keeps which of the Batch, Custom steps and
Workflow sections were collapsed (`sections: { batch, customSteps, workflow }`,
true when collapsed), applied last on load so they end as saved, whatever the
batch rows or the steps' fields would otherwise open. The workflow is checked on
save without opening its failing steps, so each step is saved open or collapsed
as the user left it. A rows file opened with "Load config" by mistake (a bare list, not a
config) goes to the Batch section too, with the workflow left unchanged.

## 5. Execution

The queue lives **on the server**, not in the tab. The batch keeps running if
the tab is closed or reloaded; reopening the app shows the queue's current
state.

- **Concurrency** is a setting, **default 1**: one run at a time, the same load
  as today. The maximum is **8**, from measured batches (§5.3). Several runs
  against one site look like a burst of traffic to rate limiters and WAFs, so
  a batch over one site may be better kept to a few.
- A changed concurrency setting applies to the next item that starts; running
  items are not interrupted. Lowering it below what is running pauses nothing
  (a run is a live browser session and cannot be frozen): the running items
  finish, and a waiting one starts only once fewer than the new number are
  running. The queue tab says so when the setting is lowered.
- Each item runs through `executeWorkflowRun` with its own abort controller,
  exactly as `/workflow-start` does. Cancel works per item (stops a running one,
  or removes a waiting one) and for the whole queue.
- One item failing does not stop the queue.

### 5.1 Resource metrics

Several runs share one Node process and one Chromium, so past some point
running more at once stops adding throughput and only adds load, or runs the
server out of memory and loses every running batch row at once. Where that
point is depends on the machine and the workflows, so each session measures
it: **`metrics.jsonl`** in the session folder, one JSON object per line, each
with its time `t`:

- `session` — when a session opens or resumes: concurrency, and the host
  (platform, Node version, CPUs, RAM, Node's heap limit).
- `run-start` / `run-end` — a run starting and ending (`status`, `durationMs`,
  `scansRun`), with `running`: how many run once it is counted.
- `scan` — every scan as it finishes: `scanMs`, the scan itself, and
  `sinceLastMs`, the time since the run's previous scan (or its start), which
  takes in its steps, waits and navigation too; with `running` at that moment.
- `sample` — every 5 seconds: Node's heap (`heapUsedMb`, `heapPct` of
  `heapLimitMb`), process memory, event-loop delay (mean, p99, max over the
  interval), CPU (% of one core), and the browser's memory with all its child
  processes (`browser.rssMb`, `browser.processes`; from `ps`, so null on
  Windows), with the number of runs running and waiting and each run's scans
  so far.
- `concurrency` — the setting changed; `session-end` — the session closed.

It is appended to, so a resumed session carries on in the same file, and its
sampling is `resource-sampler.js`. A failed write is logged once and the log
stops; the batch never waits on it. `A11Y_QUEUE_METRICS=0` turns the file
off; the sampling goes on, for the governor (§5.2).
Results are listed from `*.json`, so the file is never taken for one; "Download
all" includes it.

`npm run batch:metrics -- <session folder>` reads it back
(`queue-metrics-summary.js`): scans per minute and the median time between a
run's scans at each number of runs going at once, the memory, event-loop and
CPU peaks, and each run's slowdown, its last scans against its first. Running
the same batch at 2 and at 4 shows whether the extra runs add throughput; the
same figures are what an adaptive concurrency limit would act on.

### 5.2 Holding the next run while memory is high

Runs share one Node process, and a run holds its scans' findings until it
ends (§6), so a batch whose runs grow past the heap's limit crashes the
server ("JavaScript heap out of memory") and loses every running row. The
**governor** (`src/server-side/queue-governor.js`) reads the same 5-second
samples as the metrics log: when Node's heap reaches **60%** of its limit, the
next waiting run is held; it starts once the heap is back below **50%**. The
gap keeps it from flapping while a garbage collection is due.

It only ever holds a start. A running run is never paused or stopped (a run
is a live browser session, §5), the concurrency setting stays as it was, and
with nothing running the next run always starts, so a batch cannot be held
for good. Only the heap is watched: it is what crashes, the browser's memory
stayed flat in measured batches, and the system's free memory is no guide on
macOS, which keeps it near zero by design.

`GET /queue` carries `hold` (`{ reason, heapPct, holdAtPct, resumeBelowPct,
since }`, or null) and `resources` (the latest `heapPct`, `heapUsedMb`,
`heapLimitMb`), both null with no batch running. Under the running batch's
status line, in a smaller size, the queue tab shows "Server memory: 23% of its
4.0 GB limit.";
while a run is held, "Holding the next run while server memory is high: 63%
of its 4.0 GB limit. It starts once memory is below 50%; the runs already
going carry on.", with a warning edge. The hold and its end are announced in
the tab's status line; metrics.jsonl records them as `hold` and `resume`.

### 5.3 Why the maximum is 8

Measured on a 4-core Linux machine with 16 GB of RAM and Node's heap at
4 GB, with workflows of a Repeat over pages, each page a Merged scan of three
contexts (light and dark desktop, light mobile) at the scan step's defaults:

| Batch | Time | Scans a minute | Between a run's scans | Heap peak |
|---|---:|---:|---:|---:|
| 8 workflows of 30 scans, 2 at once | 12.2 min | 19.7 | 5.7 s | 0.1 GB |
| the same, 4 at once | 7.9 min | 30.3 | 7.5 s | 0.1 GB |
| the same, 6 at once | 7.4 min | 32.3 | 8.4 s | 0.4 GB |
| 8 workflows of 570 scans (190 merged), 8 at once | 1 h 48 min | 42.2 | 11.1 s | 1.17 GB (28%) |
| 8 workflows of 90 scans of heavy pages, 8 at once | 18.8 min | 38.3 | 10.9 s | 0.66 GB (16%) |

- **Throughput.** Node uses a fraction of one core; the runs share one
  Chromium, so each slows the others (a scan took 4.0 s at 2 at once, 9.3 s
  at 8). More at once still adds throughput, and a batch whose workflows all
  start together saves whole rounds: 8 long workflows took 1 h 48 min at 8,
  about 2 h 20 min at 4 from the paces above. A limit between 4 and the
  number of workflows saves little, since the batch still needs a second
  round.
- **Memory.** A run holds its findings until it ends, and its heap grows with
  them: in both batches above, about 0.63 MB of heap for each MB of the
  result it writes (pictures aside, which are kept on disk, §6). With 8 at
  once the governor has nothing left to hold, so the runs' results together
  must fit: 8 results of up to about 500-600 MB each stay under 75% of a
  4 GB heap. A result of 190 merged scans of a heavily failing site wrote
  317 MB; heavy test pages (3,800 elements, ~760 failing elements a page)
  write about 4.4 MB a merged scan, so 190 of them about 825 MB, past what 8
  at once can hold. Workflows that size want fewer at once, or a larger heap
  (`--max-old-space-size`).
- **The end of a batch.** Saving 8 results of ~220 MB at once added no heap
  peak, but held the event loop for up to 1.2 s at a time for about a minute.
- **The browser.** Chromium with all its processes used up to 3.6 GB at 8
  runs of light pages and 2.6-6.7 GB with heavy ones. The governor does not
  watch it (§5.2); on a machine with 8 GB of RAM, fewer at once is safer.

## 6. Saving and cleanup

**Where.** One configurable base directory for queue output, defaulting to
`reports/batches/`; `A11Y_QUEUE_DIR` sets another folder inside `reports/`
(anything outside it falls back to the default). Nothing else is configured. Each queue session writes to
its own folder named after the time it started, e.g.
`reports/batches/2026-10-12T14-03-27/` (filesystem-safe; a numeric suffix is
added if the name exists). A queue session starts when the queue goes from
idle to running and lasts until it is idle again. One batch runs at a time:
`POST /queue/items` is refused (409) while a session runs, so a folder only
ever holds one batch. In the run workflow tab, "Run batch" is disabled with
that reason while a batch runs; a single Run (switch off) still starts, since
it does not go through the queue.

The base directory must sit inside `reports/`, so every file it holds is
already served at `/reports/...`. The server never writes outside the session
folder, whatever the row names contain.

**What.** When an item finishes — done, failed or cancelled — the server
finalizes the payload (`finalizeWorkflowPayload`) and writes it as
`<slug of scenario name>.json`, the JSON the app receives, with its pictures
as files beside it (below), so the open report tab and Compare read it. The file is compact JSON written in ~1 MB
pieces (`json-file-writer.js`), never one string: a long workflow's result,
screenshots inline, can pass V8's ~512 MB string limit ("Invalid string
length"), and a single `JSON.stringify` would also hold the event loop, and
every other run, for seconds. Duplicate names get `-2`, `-3`, … A run that
failed before producing any payload writes no result file; its error is
recorded in the manifest.

Each session folder also holds **`batch.json`**, a manifest updated as items
start and finish: the scenario name the batch was run under (shown in its
heading, as "Checkout – Queue started …"; none if the field was empty), when
the session started, the concurrency used, the workflow
spec each item ran (with masked fields removed, see §7), and for each item its
name, row data, status, scan count, issue counts, duration, file name and
error if any. It is written atomically — to a temporary file in the same
folder, then renamed over the old one — so a crash mid-write cannot leave it
half-written.

A batch queued from the app also keeps **its configuration**,
`<slug of scenario name>.a11y-config.json`: the file "Save configuration"
writes, workflow and Batch section with every row (§4), masked values
removed. It is written when the batch is queued, so "Download all" carries
it and "Load configuration" on that zip sets the batch up again. A batch
saved before kept none: its Download all adds one rebuilt from `batch.json`
(each run's saved config and row, `src/shared/batch-config.js`), and Load
configuration rebuilds it the same way from a zip that has only `batch.json`.
Each run's result carries its own configuration as `config` too, as a
downloaded report does (`docs/report-package.md`), and a run's Download adds
it as `<name>.a11y-config.json`.

**Retention.** The newest **100** session folders are kept. When a new session
starts and there are more, the oldest are deleted. Only direct children of the
base directory that contain a `batch.json` are ever considered; anything else
in the directory is left alone. The number is fixed, not a setting.

**Masked values never reach disk.** The run needs the real values, so "Add
to queue" sends them, flagged `<field>Masked: true`. Before the result is
written, the queue strips every flagged value from the payload's `actions` —
the only place a result echoes the workflow (`actionResults` carry labels, not
values). The run itself is unaffected.

**Cleanup.** As soon as an item's file is written, the server drops its
payload from memory, keeping only the small summary that goes into the
manifest and the panel; its progress log follows a minute later. The tab holds
only those summaries too. At any moment at most "concurrency" full results are
in memory, however long the queue.

**The session folder is a report package** (`docs/report-package.md`,
`src/server-side/batch-package.js`). Before a result is written, each picture
in it becomes a file in the session's `images/` folder, named by its content
as the app names it (the first 20 hex digits of its SHA-256 and its
extension), and the result names it by its path there, `images/<name>`:
page and workflow screenshots, from the spool (moved in) or memory (written),
and the element pictures the run wrote under `reports/evidence/<run>/`,
hard-linked, so they take no second place on disk. A picture shared by runs,
or by the scans of one, is one file. The results hold no inline picture and no
link to the lab, which also makes them a good deal smaller to write and to
open. A picture that cannot be had keeps its link, and is logged. Each item
in `batch.json` records the run folders its links named (`runFolders`,
`"evidence/<run>"`), which deleting the session removes, as its results no
longer name them; results saved before keep naming them, and are found by
their links as before. The app reads a result from the lab with each
`images/` path pointed at the session's folder, which `/reports` serves;
"Download all" is the folder, and opens anywhere.

**A running item's page screenshots wait on disk.** A run holds every scan
it has finished until it ends, since its result is built from all of them at
once, and each scan's page screenshot (~0.5 MB) was about half of that. The
queue gives each run a spool folder, `.spool-<item id>` in the session folder
(`src/server-side/scan-spool.js`): as each scan finishes, the runner writes
its screenshot there and keeps in its place one that names the file, which
the result is packed from (above): the file moves into `images/`. A dot
folder, so "Download all" and the result list leave it out; it is
removed once the run has ended, and on startup any a stopped server left are
removed. A screenshot that cannot be written stays in memory. Runs started
from the form keep theirs in memory, since the page fetches their result.
Measured on a heavy page (50 element screenshots a scan), what a run holds
per scan went from ~0.86 MB to ~0.56 MB; the rest is the scan's findings,
which the end-of-run summary reads across all scans.

**Progress logs keep every line but only the latest screenshots.** A running
item keeps a progress log so it can be watched (§8). Its "a11yScan ready" and
screenshot entries each carry a screenshot of a few hundred KB, so a full log
of a 300-scan workflow would be 45–120 MB, and four at once up to half a GB.
`src/server-side/progress-log.js` keeps every text entry (the log panel and
the step counter need them all) but only the latest 8 images; older entries
keep their line, marked `extra.screenshotDropped`, and their live card says the
screenshot is in the report. That is about 3 MB of text plus 8 images per
running item, whatever the number of scans. Runs started from the form use the
same log, which also gives `/workflow-progress` absolute indexes, so a reader
never re-reads or skips a line once old entries are dropped.

Separately, the existing `Runs` and `ManualRuns` maps get a time-based sweep
(`src/server-side/run-sweep.js`): an app run is removed 30 minutes after the
sweep, which runs every minute, first sees it finished — never while it is
still running. Finished extension sessions are kept 4 hours instead, since the
extension finishes a session and fetches its result with separate clicks. An extension session left `collecting` — started but never
finished, typically because DevTools was closed mid-capture — is removed once
it has received no scan for 4 hours. Deleting on first fetch was rejected because
`fetchWorkflowResult` retries, and a reload would otherwise get
"Unknown runId".

## 7. Server restart mid-queue

The in-memory queue is lost when the server stops, and a run cannot be
continued from the middle: its browser context — logged-in session, current
page, open dialogs — is gone with the process.

**On startup**, the server scans the session folders. Any `batch.json` with
items still `running` or `waiting` has those items marked **`interrupted`**.
Results already saved are untouched.

**In the panel**, an interrupted session shows as such ("6 of 10 finished,
4 interrupted") with a **Resume** action. Resume re-queues only the
interrupted items, with the same rows, the same concurrency and the same
session folder, so the batch ends up complete in one place. An item that was
running when the server stopped starts again from its first step.

**Resume is never automatic.** Under `yarn dev`, nodemon restarts the server on
every file save; auto-resume would relaunch half-finished batches at each edit.
And if one run is what brought the server down (memory exhausted on a huge
page, for instance), auto-resume would restart it and crash again in a loop.

**Masked fields.** Resume needs the workflow, so each item in `batch.json`
keeps its workflow as a saved config (form state plus run spec, built by the
same `buildConfigFile` as "Export config"), which never contains a masked
value. Items whose workflow had none resume directly. When some had masked
values, Resume first asks for them in a dialog: `GET
/queue/sessions/:session/masked-fields` lists each hidden value once however
many rows share it (same place in the workflow, same step settings), with
the step it belongs to and how many runs use it. Each field also carries
`match` (its path, field and step settings), and the app first looks for
those passwords in its editor, which still holds them unless the page was
reloaded: the step with the same settings, at the same place or anywhere if
they all agree, else the step with the same type and selector or label. When
every field is found Resume goes ahead without asking; otherwise the dialog
asks for the rest, with the found ones filled in. The values go back with
`POST .../resume` as `{ values: { <key>: <value> } }`. The server puts them
into the run specs it holds in memory, never into `batch.json`, and results
are saved with them redacted as usual. Every value is required; dismissing
the dialog resumes nothing. **Load workflow** (a pencil icon button, as the
row's other actions are icons, so they always fit on one line) stays on such
a row as the other way back: the workflow goes into the form and the run's row into the
Batch section, the user types the values and presses Run, and that run joins
a new queue session.

## 8. The runs panel

Each item shows:

- name, and the row data for batch items
- status: waiting, running (with a spinner beside the word), cancelling, done,
  failed, cancelled, interrupted
- **number of scans it ran** (while running: scans finished so far)
- failing, can't-tell and passing findings, counted as the live totals and
  the report count them (one per rule per scan, added up across scans); while
  running, added up from each scan's progress entry and shown as plain
  numbers, as the Status column already says the run is going.
  Elements are not counted: pass findings mostly do not list theirs. Empty
  until the run has a scan
- issue counts
- duration (while running: time so far)
- **Open** — loads the saved file into the normal report view
- **Download** — a link to the JSON file under `/reports/...`, with the HTML
  `download` attribute so the browser saves it under its own name

**Earlier batches are collapsed.** Each batch's heading is a disclosure button
("Queue started …") with a one-line summary under it; its links and table of
runs open on request. A running batch opens by itself and stays open when it
finishes, so a batch being watched does not snap shut; one closed by hand stays
closed. Which batches are open is remembered for the page only, so after a
refresh every finished batch starts collapsed again.

**Delete** removes a finished batch's folder (every result and its
`batch.json`) after a confirmation that says how many results go and that it
cannot be undone. It is not offered on the running batch, and the server
refuses it there too. Focus then moves to the next batch's heading.

Each run is one table row. The panel polls `GET /queue` every 1.5 s while its
tab is shown and a session is running, every 5 s while it is hidden, and once
when the page loads. With no batch known to run it still polls every 30 s
while the page is on screen, and at once when the page comes back on screen,
so a batch started from another tab, browser or the API shows up without a
reload; a page not on screen does no idle polling. While a batch runs, the queue tab carries the same spinner
as the run tab and its accessible name reads "queue, running". It announces
runs as they finish through a status line rather than making the table a live
region.

**Watch.** A running row has a "Watch" button that opens a dialog over the
queue with that run's live view: the totals with the step progress (from the
run's own workflow in `batch.json`), the live cards and the log from the start,
fed from `GET /queue/items/:id/progress`. They are their own copies
(`src/js/live-view.js`), so the run tab is left as it was and a run from the
form can go on meanwhile; in the dialog the totals are part of the content
(`inline`), not the floating card. The dialog's title says which run it is
("Watching “Product v2.4” (workflow 2 of 3)") and its status line that it is
running; once the run ends it says how, and offers "Open report". Closing the
dialog (Close, Escape, the backdrop) stops watching, not the run, and focus goes
back to the Watch button, or to the run's row once the button is gone. The
dialog frame (`src/js/run-dialog.js`) holds no live code, so a finished run's
report can use it too. Focus stays on the same control across a refresh, or
moves to the run's row when that control goes away.

For the session as a whole:

- **Download all** — one zip of the session folder (every result, its
  `images/`, `batch.json` and `metrics.jsonl`): a report package, which the
  open report tab and Compare load with its pictures, without the lab.
  Streamed by the server with `archiver` from
  `GET /queue/sessions/<session>/download.zip`. The handler resolves the session folder
  from its id, refuses anything that is not a direct child of the base
  directory, and zips only that folder. In the panel it is disabled while
  that batch runs (it would hold only the runs saved so far); clicking it
  says so. The endpoint itself still answers.
- no separate link to `batch.json`: the queue needs the file (resume, Load
  workflow, Watch, the list of past batches) and it comes inside "Download
  all", which covers keeping a record of the batch
- **Resume**, on an interrupted session (§7); disabled while another batch
  runs (the server refuses it with 409 too)

- **Send to Compare**: every saved result of the session, in queue order, up to
  the dashboard's 24 reports. A batch's runs arrive arranged in row order and
  under "Versions", since scan times need not follow the rows (at concurrency
  above 1 they will not); the comparison controller's `arrange(keys)` sets
  that order. Other sessions keep the Compare tab's current framing. A run can
  be dropped from the comparison there. Disabled while that batch runs, like
  Download all.

Disabled controls keep `aria-disabled="true"` rather than `disabled`, so they
stay focusable and a click states the reason in the panel's status line.

Each batch run's row number and values show under its name: "Row 3 ·
date: 2026-03-01 · build: 2310".

### 8.1 What a running run is doing

A long run shows little for minutes at a time, so what it is on and how
lively it is can be seen on demand, in its **Watch dialog**, from what the
server already knows. The rows keep to what does not change by the second:
text that did, under the status and the scan count, resized the table's
columns and rows as the runs went.

**In the row.** "Running", or **"Saving result"** once the run starts
building its result (`executeWorkflowRun` logs `stepEvent: 'result-build'`
and waits a turn of the event loop so a poll can see it, before the build,
which holds the event loop, and the write). A run that has logged nothing for
5 minutes (a long wait, or a page it is stuck on) gets a warning sign after
its spinner, the same size whatever it says, named for screen readers "No
progress for over 5 minutes. Watch the run for details." and with that as its
tooltip. The table has fixed column widths (Name takes what is left, with a
minimum below which the table scrolls), so neither a duration growing nor the
sign appearing moves the columns.

**In the Watch dialog**, above its live preview and log, refreshed with each
poll (`describeRunNow` in `run-queue-panel.js`):

- **Its step**: the deepest step still open and the loop iterations it is
  inside, e.g. "Repeat “Pages” 34 of 120 › A11y scan “Home”"
  (`src/server-side/run-activity.js`, from the progress entries' structured
  `stepEvent`, `actionPath`, `actionType`, `label` and loop `index`/`total`,
  never their text). Iterate items running side by side show the latest step
  started. "Starting" before the first step; "Building and writing the
  result" while it saves.
- **"Last scan 12s ago · 1 every 9.0s"**: how long since its last scan, and
  its pace, the median gap between its last 10 scans. "No scan yet" before
  the first.
- **"No progress for 5m 02s: it may be on a long wait, or stuck on a page."**
  in the warning colour once it has logged nothing for 5 minutes.

It is not a live region: the log below already reports each step.

`GET /queue` and a run's `/queue/items/:id/progress` give a running item
`phase` (`running` or `saving`), `activity`, `sinceScanMs`, `sinceProgressMs`
(ages rather than times, so the tab needs no clock that agrees with the
server's) and `paceMs`.

### 8.2 While you are elsewhere

A batch can take hours, mostly with the app in another tab:

- **The page title** carries a running batch's progress, "(3/7) surea11y
  scanner", and "Batch finished · surea11y scanner" once it ends unless the
  queue tab was on screen; it goes back when the queue tab is next shown.
- **"Notify me when a batch finishes"**, beside the queue controls, shown only
  where the browser can notify. Ticking it asks the browser's permission; if
  refused, it unticks and says the site settings can allow it. The choice is
  kept in this browser (`localStorage`). A batch that finishes while the page
  is not on screen then raises a notification: "Batch finished", with the
  batch's name and its summary line ("Checkout: Finished · 7 runs · 1 failed").

### 8.3 Pace, and the batch in a line

A workflow's number of scans is not known until it ends, so there is no
percentage or estimated time left; the pace says how fast it goes instead:

- **Under a finished run's scan count**, "1 every 9.0s" (tenths under 10 s):
  its duration over the scans it ran. None for a failed or cancelled run,
  whose time is no measure of its pace; a running run's is in its Watch
  dialog (§8.1).
- **In the running batch's status line**, "about 31 scans a minute": the runs
  going now, each at its pace (`scansPerMin` on the session). A pace counts
  every scan run, each context of a Merged scan too, while the Scans column
  counts a Merged scan once; where they differ the line adds what the report
  keeps, "about 27 scans a minute (9 after merging)" (`mergedScansPerMin`):
  each run's pace times its scans so far over the scans it ran.
- **Under a finished batch's status line**, a summary: "4,212 scans in 2h 10m ·
  slowest: Checkout (1h 42m) · server memory peaked at 41% of its 4.0 GB
  limit · held a run back for memory twice", saying only what is known. The
  peak and the holds are kept in `batch.json` as `stats` (`peakHeapPct`,
  `peakHeapMb`, `heapLimitMb`, `holds`), carried on by a resumed batch. The
  time is from the batch's start to its end, so a resumed batch's includes the
  time the server was down. The notification of §8.2 adds the summary.

## 9. API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/queue/items` | `{ items: [{ run, config, row? }], name?, config? }`: `run` is the body `/workflow-start` takes (with a batch row's `vars`), `config` the saved-config form of the same workflow, `row` the batch row number; the outer `config` is the whole batch's, kept as its `.a11y-config.json` (§6). Every item is validated before any is queued; refused (409) while a batch runs; returns the session id and item ids |
| `GET` | `/queue` | Settings, the running session and the 10 most recent ones, each with its items, summaries and links |
| `GET` | `/queue/items/:id/progress?since=` | A running item's progress, in `/workflow-progress`'s shape plus its name, row and (once saved) file URL; readable for a minute after it finishes, then 404 |
| `POST` | `/queue/settings` | `{ concurrency }`, 1 to 8 |
| `POST` | `/queue/items/:id/cancel` | Cancel one item: a waiting one never runs, a running one is aborted |
| `POST` | `/queue/cancel` | Cancel everything waiting or running |
| `GET` | `/queue/sessions/:session/masked-fields` | The hidden values its interrupted items need before they can resume (§7) |
| `POST` | `/queue/sessions/:session/resume` | Re-queue a session's interrupted items (§7); `{ values }` carries the hidden ones |
| `POST` | `/queue/sessions/:session/delete` | Delete a finished session's folder; refused (409) for the running one |
| `GET` | `/queue/sessions/:session/download.zip` | Download all |
| `GET` | `/queue/sessions/:session/items/:id/download.zip` | A run's Download: its result and the pictures it names, as a report package |

Result files and `batch.json` are served by the existing `/reports` static
route; `GET /queue` carries their URLs. A batch is expanded into items in the
browser, so the server sees one item per row and has no batch endpoint of its
own.

## 10. Rejected alternatives

- **The browser writes the files** (File System Access API, a native folder
  picker). Every full result would have to travel to the tab, bringing the
  memory weight back into the page; Firefox and Safari do not support it; and
  saving would stop if the tab closed.
- **A freely chosen directory anywhere on disk.** Files outside `reports/`
  would get no download link, and an endpoint that writes anywhere is a real
  risk if the server is reachable from other machines (`HOST` other than
  `127.0.0.1`).
- **The queue lives in the tab.** Closing or reloading the tab would lose the
  queue mid-batch.
- **Looping inside one workflow** (`forEachElement` over a table of versions).
  All iterations land in one combined result, the opposite of one file per
  version.
- **Deleting a finished run on first fetch** — see §6.
- **Resuming automatically after a restart** — see §7.

## 11. Phases

1. `Runs`/`ManualRuns` time-based cleanup. Independent of everything else.
2. **Shipped.** Server-side queue with concurrency (default 1, maximum 4, raised to 8 in §5.3), automatic saving
   to a timestamped session folder, `batch.json`, per-item cleanup, retention
   of the newest 100 sessions, marking interrupted sessions on startup with
   Resume, and the runs panel with Open, Download and Download all.
3. **Shipped.** Batch run from pasted JSON: row validation, `vars` threading
   into the engine, the name pattern, the batch saved with the config (§4),
   and Send to Compare (§8).
4. Later, optional: build the row list by extracting it from a table on a page
   (row and cell selectors), feeding the same batch input.

## 12. Open

- **Exposure.** Anything under `reports/` can be downloaded by whoever can
  reach the server. That is fine on `127.0.0.1` and should be stated in the
  user docs.
- **Clearing batches.** Delete in the queue tab removes one batch at a time.
  The existing "clear reports" action (`DELETE /reports`) still only empties
  engine folders and leaves `reports/batches/` alone; a "delete all finished
  batches" action is not planned while retention keeps the newest 100.
