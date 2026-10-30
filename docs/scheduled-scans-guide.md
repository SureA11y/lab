# Running scans without the app — a guide

> Everything here is about `src/cli/run-workflow.js`, the part of this project
> that runs a workflow on its own: no browser window to click, no person
> watching. Part 1 is written for anyone. Parts 2 onward assume you are
> comfortable with a terminal.

## Part 1 — What this is, in plain words

### The short version

The app in your browser lets you build a **workflow**: go to this page, log in,
open that menu, check the page for accessibility problems. You press Run, and it
tells you what it found.

This does exactly the same thing, except nobody has to press Run. A computer can
start it at three in the morning, every night, and tell you **what changed since
last time**.

Same checks. Same numbers. No screen.

### Why that matters

A single scan answers "how is this page today?". That is useful once.

What teams actually need is the other question: **"did we just make it worse?"**
Nobody can answer that from a single report, because it means remembering what
last week looked like. People do not remember, and reports pile up unread.

So the useful thing here is not the scanning. It is the comparison:

> Yesterday this page had 11 problems. Today it has 11 problems.
> But 4 of yesterday's were fixed and 4 new ones appeared.

The total did not move. Something still broke. Only a comparison sees that.

### What you get, every time it runs

Four files land in a folder:

| File | What it is | Who reads it |
| --- | --- | --- |
| `summary.md` | A short written summary of the run | People |
| `diff.json` | Exactly what changed since the run it was compared with | Other software |
| `comparison.html` | The same comparison as a page, as the app's Compare tab downloads it | People |
| `payload.json` | The complete result, the same file the app produces; its pictures are in `images/` beside it | The app, later comparisons |
| `run.log.jsonl` | A line-by-line record of what the workflow did | Whoever is debugging |

`diff.json` and `payload.json` are described by `schemas/diff.v1.schema.json`
and `schemas/report.v3.schema.json`, for whatever reads them. Every failing
element has an `occurrenceId` that stays the same from run to run, so a
ticket filed for one can be found again in the next run's files.

`summary.md` is the one to read. It looks like this:

```markdown
# Regression demo

**New failing instances since the baseline**

- Url: https://example.com/checkout
- Run: run_744e9f59 at 2026-08-17T17:03:51.613Z

## This run

- Scans: 1
- Failing: 4 rules, 4 instances
- Can't tell: 1 rules, 1 instance

## Compared to release-1.0

- Rules: 3 new, 1 resolved, 1 persistent
- Instances: 4 new, 9 fixed, 0 still failing

### New

- **button-name** (critical) — 1 instance
- **color-contrast** (serious) — 1 instance
- **link-name** (serious) — 1 instance
```

Three of those words are worth knowing, and they show up everywhere:

- **Rule** — one kind of problem. "Buttons must have a name" is a rule.
- **Instance** — one place where that problem actually occurs. One rule can
  break in eight places, which is eight instances.
- **Baseline** — the earlier run being compared against. Either "the last run"
  or a run you deliberately kept, like the day you released.

### What this can honestly tell you — and what it cannot

This is worth reading even if you skip everything else.

**It can tell you** that a specific, machine-checkable problem appeared where
there wasn't one before. That is a real signal and it is worth acting on.

**It cannot tell you that a page is accessible.** Automated checking finds a
fraction of real accessibility problems, and none at all of the kind that need a
human judgement: is this alt text actually describing the picture? does this
page make sense read aloud, in order? can someone actually finish the task?

That is why the score this tool produces is labelled an **automated result** and
not a grade, and why the runner deliberately refuses to pass or fail your build
based on a score. It fails on one thing only: **a problem that wasn't there
before**. That is a claim it can actually stand behind.

**It also tells you when it didn't do its job.** If the workflow was supposed to
click through to page 7 and the button was missing, the scan never happened —
and a scan that never happened reports zero problems, which looks like great
news. The runner catches that and calls the run **degraded**, because "fewer
problems than yesterday" means nothing when half the run didn't happen. This is
the single most important thing it does for unattended runs.

---

## Part 2 — Doing it

### Step 1: build the workflow in the app, then export it

You do not write the workflow by hand. Build it in the app where you can see it
working, then press **Export config** and save the file.

That file contains everything the runner needs. It is the same file you can load
back into the app later.

```
$ ls
checkout.json
```

#### Passwords

The **Set password value** step fills a field like **Set field value** does, but
its value is hidden on screen (a button reveals it) and is never saved, revealed
or not: the exported config records `"valueMasked": true` and no value at all,
so the password never reaches a file you commit, share, or paste into a chat.
Load that config back into the app and the field comes back empty, waiting for
you to type it again. A **Set field value** step saved hidden by an older
version of the app loads as a **Set password value** step.

That is fine for a scan you start yourself and wrong for one that runs at 3am
with nobody watching. The runner does not paper over it: the step stops with a
message saying the password was never saved, rather than typing an empty string
into the login form and reporting a clean run.

**For a scheduled run, read the password from the environment.** A spec can
name an environment variable in place of the value:

```json
{ "type": "setPassword", "labelText": "Password", "value": { "$env": "SHOP_PASSWORD" } }
```

The runner reads `SHOP_PASSWORD` as the run starts and gives the value to the
browser only: the report, the log and the summary keep the reference, and the
file never holds the password. A variable that is not set stops the run before
a browser opens, with exit 2, naming it; `--check` says so as a warning, since
the machine that checks a spec need not be the one that runs it.

```bash
SHOP_PASSWORD='…' node src/cli/run-workflow.js specs/checkout.json
```

The app shows such a field as "From the environment: SHOP_PASSWORD" and saves
the reference as it is; typing a value there replaces it, and that value is
never saved, as before. Started from the app or its queue, the run reads the
variable from the environment of the lab's server.

### Step 2: run it

```bash
node src/cli/run-workflow.js checkout.json
```

It prints what it is doing as it goes, then a summary:

```
Status      done
Scenario    Checkout
Url         https://example.com/checkout
Run id      run_ddeea58f7a86868c
Steps       12 of 12
  by type   a11yScan 4, click 4, screenshot 2, navigate 1, forEachElement 1
Scans       1
Failing     2 rules, 9 instances
Can't tell  1 rules, 1 instances
Diagnostics 1 console, 0 request failures, 1 bad responses
Payload     a11y-runs/Checkout/runs/2026-08-17T10-00-00-000Z/payload.json (1833 KB)
```

`Steps` is how much of the workflow actually ran. On a run that stopped early it
reads `5 of 12 (7 not run)`, which is worth checking before you read the
findings below it — half a workflow finding half the problems is not good news.

Some workflows cannot be counted exactly in advance. A `forEachElement` with no
`limit`, or a `crawlQueue` with no `maxPages`, only learns its size mid-run, so
until it does the total carries a tilde — `5 of ~12 (2 loops never sized)`. The
number to the right of the tilde only ever grows toward the truth; the number of
steps still to run only ever falls.

If you run it in a terminal you also get a progress bar under the output while
it works:

```
  [█████████░░░░░░░░░░░▒▒▒▒] 17/~40 - 23 steps to go, 1 loop not yet sized
```

Piped or redirected output never gets the bar — a redrawn line in a CI log is
just thousands of half-erased copies of itself — but the `Steps` lines in the
summary, and the **Steps** table in `summary.md`, are there either way.

Add `--quiet` if you only want that summary and not the running commentary.

### Step 3: run it again tomorrow, and compare

```bash
node src/cli/run-workflow.js checkout.json --baseline auto
```

`auto` means "the previous run of this scenario". The first time you use it,
there is nothing to compare with yet, which it says plainly and does not treat
as a failure:

```
Note: no previous run to compare with yet
```

In CI, where a first run should not pass with failures in it, add
`--fail-on-failures`: with no baseline to compare with, any failing instance
fails the run with exit 3, as a new one does against a baseline. Once there
is a baseline, it changes nothing.

From the second run onward you get the comparison:

```
Compared to 2026-08-17T10-00-00-000Z
Rules       0 new, 0 resolved, 2 persistent
Instances   0 new, 0 fixed, 9 still failing
```

Nothing new. Good. When something does break:

```
Compared to 2026-08-17T10-00-00-000Z
Rules       3 new, 1 resolved, 1 persistent
Instances   4 new, 9 fixed, 0 still failing
  new       button-name (critical) 1 instance
  new       color-contrast (serious) 1 instance
  new       link-name (serious) 1 instance
```

and the command finishes with **exit code 3**, which is how a build system
learns that something went wrong without reading anything.

If the baseline was made with another release of surea11y, the comparison adds
a warning saying so. A release can add rules, change what a rule finds, or
name an element differently (surea11y 1.14 names an element at the top of a
shadow root by a new selector), so some new and fixed instances may come from
the engine rather than the pages. Promote a fresh baseline after updating.

### Step 4: keep a baseline that doesn't move

"Since last night" is one useful question. "Since we released" is another, and
`auto` cannot answer it, because last night's run already contains the problem
you shipped a week ago.

So keep one:

```bash
# on release day
node src/cli/run-workflow.js checkout.json --promote release-1.0

# from then on
node src/cli/run-workflow.js checkout.json --baseline @release-1.0
```

A run that failed, was cancelled, or came back degraded **cannot** become a
baseline. That refusal matters: if a broken run became the reference, every run
afterwards would look like an improvement, forever.

### Step 5: put it on a schedule

There is nothing left to build. A nightly run of one workflow, keeping a
fortnight of history:

```
0 3 * * * cd /path/to/surea11y-lab && \
  node src/cli/run-workflow.js specs/checkout.json --baseline auto --keep 14 --quiet
```

In a build pipeline, the exit code does the work:

```bash
node src/cli/run-workflow.js specs/checkout.json --baseline @release-1.0 --quiet
# 0 → nothing new, carry on
# 3 → something broke, stop the build
# 4 → the run didn't cover everything, so its result cannot be trusted
```

Most CI servers can also show accessibility results in their own test or
security tabs, if you hand them a format they know. Add `--format`:

```bash
node src/cli/run-workflow.js specs/checkout.json --format junit,sarif --quiet
```

That writes, for every scan surea11y ran, a JUnit file (GitLab, Azure DevOps,
Jenkins and CircleCI list it as tests: one suite per WCAG criterion, one test
per rule) and a SARIF file (GitHub code scanning). `earl` is there too, for
tools that read W3C EARL. The files go in `exports/` next to `payload.json`,
so a CI job can pick them up with a pattern such as `exports/*.junit.xml`.

`acr` adds the run's conformance report, as `exports/conformance-report.html`
and `.docx`: the automated draft, under the review the run carries on from its
baseline or from `--review <report>`, so a release's report can be made
unattended once a person has reviewed the last one
([Write a conformance report](use-cases/write-a-conformance-report.md)).

A rule that could not decide shows as a skipped test, and as a
warning in SARIF. Each of those questions carries the steps that answer it
("How to check", with what a person sees if it passes and if it fails), so the
person reading the CI tab knows what to look at.

Some questions lean one way: the page's evidence points to a failure, but the
engine cannot prove it (a heading that skips a level, a page with no level-one
heading). Add `--fail-on-lean` to treat these *likely failures* as failures:

```bash
node src/cli/run-workflow.js specs/checkout.json --baseline @release-1.0 --fail-on-lean --format junit,sarif --quiet
# 5 → no new failure, but new likely failures
```

Then they are errors in SARIF and failures in JUnit, and the run finishes with
**exit code 5** when it has likely failures the baseline did not have. Only
those of rules in the scan's target count: a WCAG 2.2 AA scan does not fail on
a best practice. A baseline run records its likely failures when it ran with
`--format` or `--fail-on-lean`.

With `--baseline` as well, failures the baseline run already had are not
reported again: SARIF leaves them out, and JUnit lists only the new ones,
marking a rule as skipped when all of its failures are known. A failure counts
as known when the baseline had the same rule failing on the same markup, on the
same page (path and query, so a staging run can use a production baseline). If
a scan's label changed, every baseline scan of that page counts. This needs the
baseline run to have used `--format` too, since that is when a run records what
it found in a form the exports can match; otherwise nothing is filtered. EARL
always lists everything: it records results rather than gating a build.

To send the result to a person, mail or post the `summary.md` the run just
wrote. The runner does not send anything itself — it writes the file and stops,
because every team's mail, chat and ticketing is different.

---

## Part 3 — Reference

### Options

```
node src/cli/run-workflow.js <spec.json> [options]

  --spec <file>      Spec file, when not given as the first argument
  --out <dir>        Output directory
                     (default: <store>/<scenario>/runs/<stamp>)
  --store <dir>      Where runs and baselines are kept (default: a11y-runs)
  --baseline <what>  auto for the previous run of this scenario, @name for a
                     promoted baseline, or a path to a payload.json
  --promote <name>   Keep this run as the named baseline, if it ran whole
  --keep <n>         Delete all but the newest n runs beside this one - every
                     directory holding a payload.json in --out's parent
                     folder, not just this scenario's, so a custom --out
                     shared with other scenarios will prune those too
  --url <url>        Override the url in the spec
  --scenario <name>  Override the scenario name in the spec
  --debug-native     Keep raw engine output in the payload
  --format <list>    Also write surea11y's results as sarif, junit and/or
                     earl (comma-separated), into <out>/exports. Can be
                     repeated. Scans run without surea11y are left out.
                     acr writes the run's conformance report (VPAT 2.5,
                     WCAG and EN 301 549) there too, as HTML and Word.
  --review <file>    A report (its JSON, payload.json or package zip) whose
                     conformance review this run takes on, filling in only
                     what it has not decided; saved in payload.json. Without
                     it, a baseline's review is carried on.
  --no-batch         Run a config's workflow once, with its batch left off
  --dry-run          Take every step in a browser but the scans, screenshots
                     and evidence, and say how each went: which failed and
                     where, which were never reached, and which scans would
                     have had nothing to check. Writes nothing. Exit 0 when
                     the workflow fits the site, 4 when it does not.
  --check            Only check the spec, without opening a browser: its
                     fields, and every step against the run spec schema
                     (schemas/run-spec.v1.schema.json). Exit 0 when it can
                     run, 2 when it cannot.
  --fail-on-lean     Also fail on surea11y's questions whose evidence leans
                     fail (likely failures), new since the baseline: exit 5,
                     and with --format, an error in SARIF and a failure in
                     JUnit. Only those of rules in the scan's target.
  --fail-on-failures Fail a run that has no baseline to compare with when it
                     has failing instances: exit 3, as new failures against a
                     baseline do. Without it, a first run passes. With a
                     baseline it changes nothing.
  -q, --quiet        Only print the summary
  -h, --help         Show this message
```

`--url` is how one workflow serves several environments:

```bash
node src/cli/run-workflow.js checkout.json --url https://staging.example.com/checkout
```

### Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Ran, nothing new | Nothing |
| 1 | The run failed | Read `summary.md` and `run.log.jsonl` |
| 2 | Bad options, or the spec is not usable (with `--check`: it has errors) | Fix the command or the file |
| 3 | New failing instances against the baseline; with `--fail-on-failures` and no baseline, any failing instance | Look at what appeared |
| 4 | The run covered less than the spec asked for | Fix the workflow, then re-run |
| 5 | With `--fail-on-lean`: new likely failures, no new failure | Confirm them by hand |
| 130 | Cancelled with Ctrl+C | Nothing; the partial result was still written |

Codes 1, 130 and 4 outrank 3 in that order, and 3 outranks 5. A run that did not finish, or did
not cover what it should, makes the comparison unsound rather than merely worse
— so it is reported as its own problem instead of as a regression.

### Where files go

```
a11y-runs/                        <- --store, default is a11y-runs
  Checkout/                       <- one folder per scenario
    runs/
      2026-08-17T10-00-00-000Z/
        payload.json              <- the full result
        images/                   <- its pictures, which it names by path
        summary.md                <- the run in prose
        run.log.jsonl             <- one JSON object per log line
        diff.json                 <- only when compared
        comparison.html           <- only when compared: the comparison to read
        exports/                  <- only with --format
          01-cart.junit.xml       <- one file per scan and format
          01-cart.sarif
    baselines/
      release-1.0.json            <- from --promote
```

`--keep` only ever deletes folders inside `runs/` that contain a `payload.json`.
Promoted baselines live outside `runs/` and are never pruned.

`payload.json` names its screenshots by their path in `images/`
(`images/<hash>.jpg`), as a report package does, so the run's folder is one:
zip `payload.json` with `images/` and the app's **open report** and
**compare** tabs load it with its pictures. Loaded alone, `payload.json`
shows its findings and says each picture is missing.

### The spec file

A config exported from the app already contains everything. If you would rather
write one by hand, this is the whole format. The app opens a spec too, with
Load config, to review it or change it in the builder before it runs: its
`vars` go into a Batch row, and what the app has no setting for (a viewport
size that is not a preset) is reported when it opens.

```json
{
  "type": "a11y-run-spec",
  "specVersion": 1,

  "url": "https://example.com/checkout",
  "scenarioName": "Checkout",

  "actions": [
    { "type": "a11yScan", "label": "Cart", "profile": "en301549-v4.1.1", "context": "main", "exclude": ".ads, .cookie-banner" },
    { "type": "click", "selector": "#to-payment" },
    { "type": "a11yScan", "label": "Payment", "context": "main" }
  ],

  "viewport": "desktop-lg",
  "customSteps": []
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `url` | yes | Where the workflow starts. `http` or `https` only |
| `actions` | yes | At least one. Same actions the app's builder produces. Every scan runs with surea11y |
| `scenarioName` | no | Names the folder and the reports |
| `viewport` | no | A preset name, or `{"width": 1280, "height": 720}` |
| `colorScheme` | no | `light` or `dark`: the color scheme the page is shown in from the first page. Left out, the browser's own (light). In the app it is the configuration's Color scheme. Set color scheme and contrast changes it; its Run default comes back to this |
| `highContrast` | no | `on` or `off`: forced colors (high contrast) from the first page. Left out, off. In the app it is the configuration's High contrast |
| `language` | no | A BCP 47 tag (`es-ES`, `de`, `pt-BR`), or a variable such as `{var:lang}` so each batch row can set its own: the language the page is shown in from the first page. Left out, the browser's own. In the app it is the configuration's Language. Set language changes it; its Run default comes back to this |
| `customSteps` | no | Reusable step definitions the actions refer to |

A run has no Include or Exclude selectors: each scan step's own `context` and
`exclude` say what it checks. A spec saved with them for the whole run stops
with an error naming them: `node src/cli/convert-config.js <file> --write`
puts them on its scans, as the run applied them (its `exclude` added to each
scan's, its `context` on each scan that has none).

A run has no profile: each scan step's `profile` sets what it checks against,
`wcag22-a`, `wcag22-aa` or `wcag22-aaa`, or a standard, `en301549-v4.1.1` or
`en301549-v3.2.1`; without one, `wcag22-aa`. A spec saved with a run profile
stops with an error naming it: `node src/cli/convert-config.js <file> --write`
puts it on the scans that have none.

Viewport presets: `default` (1280 × 720), `desktop-xlg` (1972 × 1100),
`desktop-lg` (1440 × 900), `desktop-md` (1280 × 720), `tablet` (768 × 1024),
`mobile` (375 × 812).

The runner reads a spec, or a config exported from the app, and tells you
everything wrong with it at once rather than one problem per attempt.

#### Checking a spec before it runs

`--check` reads the file and stops there, without opening a browser:

```bash
node src/cli/run-workflow.js specs/checkout.json --check
```

It checks the fields above, and every step, nested ones and custom steps
included, against `schemas/run-spec.v1.schema.json`. That schema is generated
from the same action definitions the app's builder uses, so it knows every
step and every field. It sorts what it finds into two kinds:

- **Errors** stop the check with exit 2: a missing required field, a step type
  the engine does not have, a value of the wrong kind, such as the text
  `"true"` where a field takes `true` or `false` (the engine would read it as
  if it were absent), a `runCustomStep` naming a custom step the spec does not
  have, a scan whose engine cannot check its profile.
- **Warnings** leave it at exit 0: a field the step does not declare, or a
  value outside the ones the app offers. The run goes on, but they are usually
  typos.

Every run makes the same checks before it starts, whether it starts from the
app, the queue or the command line: a workflow with errors does not start,
each error in its log (from the command line, exit 2), and the warnings go to
its log as it runs.

Add `"$schema": "./schemas/run-spec.v1.schema.json"` (the path from your spec
to the repository's `schemas/` folder) at the top of a spec, and an editor
that reads JSON Schema completes step types and fields as you type and marks
mistakes as you make them.

#### Trying a workflow without scanning

A site changes, and a workflow written against it last month may no longer fit:
a button renamed, a menu moved. `--dry-run` finds out in seconds, without the
scans:

```bash
node src/cli/run-workflow.js specs/checkout.json --dry-run
```

It takes every step in a browser, as a run would, except the scans,
screenshots and evidence, then says how each step went:

```
Dry run    https://example.com/checkout
  done     1    Click "Accept cookies"
  done     2    A11y scan "Cart"
                would check nothing: its context "#basket" matches nothing on the page
  FAILED   3    Checkout (at step 3.1): click failed: "#checkout" not found
  not run  4    A11y scan "Payment"
Scans      2 scans not run, 1 of them would check nothing (said under its step)
Result     the workflow does not fit the site as it stands: 2 problems above
```

A step that failed inside another says where (`3.1` is the first step in step
3). A scan is not run, but its context selector is looked for, since a scan
whose context matches nothing would report a page with no problems. Nothing is
written, so a dry run never becomes the run `--baseline auto` compares with.
Exit 0 when every step ran, 4 when one did not.

The app has the same check: Dry run, next to Run, shows the same list under
the buttons and leaves the last report as it was. With the batch on, it uses
the batch's first workflow.

#### Running a batch

The app's Batch section runs one workflow once per row: each row its own name,
its own starting page and its own variables. The runner does the same, from a
batch spec:

```json
{
  "type": "a11y-batch-spec",
  "specVersion": 1,
  "name": "Product pages",
  "spec": { "type": "a11y-run-spec", "specVersion": 1, "url": "https://example.com/",
            "actions": [{ "type": "a11yScan", "label": "{var:product}" }] },
  "rows": [
    { "name": "Shoes", "url": "https://example.com/shoes", "vars": { "product": "Shoes" } },
    { "name": "Bags",  "url": "https://example.com/bags",  "vars": { "product": "Bags" } }
  ]
}
```

or from a configuration saved in the app with its batch on, which runs as a
batch there too (`--no-batch` runs its workflow once instead). The rows are
read by the same code as the app's, so a row the app would refuse is refused
here with the same words, and `--check` checks the workflow and every row.
`schemas/batch-spec.v1.schema.json` describes the file.

```bash
node src/cli/run-workflow.js specs/products.batch.json --baseline auto --keep 14
```

Each row runs in turn, in its own folder, with its own `payload.json`,
`summary.md` and, when compared, `diff.json`:

```
a11y-runs/
  Product-pages/
    batches/
      2026-08-17T10-00-00-000Z/
        batch.json             <- every run: its status, counts and exit code
        01-Shoes/payload.json
        02-Bags/payload.json
```

`batch.json` is the queue's own manifest, so whatever reads a queue's batch
reads this one. `--baseline auto` compares each row with its run in the
previous batch; `@name` with the baseline promoted for that row, which
`--promote name` keeps for every row that ran whole. `--keep` counts batches.
`--dry-run` tries the first row's workflow, as the app's Dry run does. The
batch exits as its worst run: cancelled, then failed, degraded, new failures,
new likely failures.

---

## Part 4 — When something goes wrong

**"Spec must have a url" / "Spec has no actions to run"** — exit 2. The file is
not a usable workflow. Export it again from the app.

**"\"tags\" is not read any more", "programmatic must be true or false",
"\"AA\" is not a profile"** — exit 2. The file was saved in an older format.
`node src/cli/convert-config.js <file or folder>` says what it would change,
and with `--write` brings the files up to date; opening and saving each one in
the app does the same.

**"Unsupported protocol: file:"** — only `http` and `https` are allowed. Serve
the page over HTTP, even locally.

**"no previous run to compare with yet"** — not an error. `--baseline auto` on a
scenario that has never run has nothing to compare with. The next run will.
To fail such a run when it has failures, add `--fail-on-failures`.

**"the baseline is newer than this run"** — you compared against a run that
happened later. The comparison still works, but "new" and "fixed" are the other
way around from what you probably meant.

**Exit 4, "1 scan skipped"** — a page was too large for the scan's node
threshold, so it was not scanned. The run reports zero problems for that page,
which is why it is a failure and not a pass.

**Exit 4, "12 iterations failed"** — a loop over elements broke partway. Common
causes: the page changed shape mid-run, or a selector matches something that
disappears. Fix the workflow before trusting the numbers.

**"not promoting a degraded run to a baseline"** — working as intended. Fix the
run, then promote it.

**The numbers differ from the app** — check what the scans check against and
how the page is shown: each scan's `profile`, and the spec's `viewport`,
`colorScheme` and `language`, against the app's run.

---

## Part 5 — Words used here

**Accessibility scan** — an automated check of a page against a set of rules.

**Rule** — one kind of problem, such as "images need alternative text".

**Instance (occurrence)** — one place a rule is broken. Eight images without alt
text is one rule, eight instances.

**WCAG** — the international accessibility standard. Levels A, AA and AAA go
from most basic to most demanding; AA is the common legal target. Versions 2.0,
2.1 and 2.2 build on each other.

**Can't tell** — the checker found something it cannot decide about on its own.
Not a pass and not a failure; a place a person needs to look.

**Workflow** — the sequence of steps: go here, click that, scan now.

**Spec** — the file describing a workflow so it can be run without the app.

**Scenario** — a name for one workflow, used to group its runs.

**Baseline** — the earlier run a new one is compared against.

**Regression** — a problem that is present now and was not present in the
baseline.

**Degraded run** — a run that finished but did less than it was asked to: a scan
skipped, a loop that lost iterations, an action that failed. Its numbers are not
comparable with a whole run's.

**Payload** — the complete machine-readable result of one run.

**Exit code** — the number a command leaves behind so other software knows how
it went. 0 means fine.

---

## For maintainers

The runner is a thin layer over the same code the app uses. Nothing about
scanning is duplicated for it.

| Piece | Where | What it does |
| --- | --- | --- |
| Entry point | `src/cli/run-workflow.js` | Arguments, output files, exit code |
| Spec handling | `src/cli/run-spec.js`, `src/shared/run-spec.js` | Reads and validates a spec or exported config |
| Run store | `src/cli/run-store.js` | Folders, `auto` and named baselines, pruning |
| Comparison | `src/cli/baseline.js`, `src/shared/report-diff.js` | The same diff engine as the app's compare tab |
| Coverage check | `src/shared/run-health.js` | Decides whether a run was whole |
| Prose | `src/cli/summary-report.js` | Writes `summary.md` |
| The run itself | `src/server-side/workflow-run.js` | Shared with the server's `/workflow-start` route |

Two rules hold this together, and both are tested rather than trusted:

- The app and the runner build their run request with the same function, so a
  saved workflow and a scheduled one cannot mean different things.
- `src/shared/tier-boundaries.test.js` fails if browser code and Node code start
  importing each other, or if the viewport presets stop agreeing across the
  page, the action definition and the engine.

The reasoning behind the design, including what was deliberately not built, is
in [headless-runner-design.md](design/headless-runner-design.md).

The same guide as a page to send someone is `unattended-scans.html`, which opens
straight from the repository and reads the brand fonts from `src/fonts`. For a
copy that has to stand on its own — hosted, mailed, or opened with no repository
around it — `npm run build:guide` inlines the fonts and writes
`unattended-scans.artifact.html`. That output is generated rather than
committed, so the fonts stay in one place.
