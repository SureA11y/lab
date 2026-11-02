# Changelog

What changed, for people who use the lab. Each entry says what to do when a
change asks something of you.

## 1.0.0 (unreleased)

The first public release.

### The lab

- **Workflows.** Build a workflow in the browser (open a page, accept the
  cookie banner, log in, add to cart, scan each state on the way) and run
  it with Puppeteer: steps to navigate, click, type, wait, branch on a
  condition (`if`, `switch`), repeat, go through each element of a list, and
  run custom steps of your own. A dry run takes every step but the scans, to
  see whether a workflow still fits a site.
- **Scans with surea11y**, against a profile per scan: WCAG 2.2 at Level A,
  AA or AAA, or EN 301 549 (V4.1.1 and V3.2.1), applied in full. A finding
  surea11y cannot decide is a question, with the steps to check it and which
  way its evidence leans, not a pass or a fail.
- **Reports** with screenshots of the page and of each flagged element (a
  finding that shows only with the WCAG text spacing applied is pictured
  with the spacing too, beside the page as it is), grouped by WCAG
  principle or level, by your own grouping, or not at all; exported as a
  report package (report version 4, with an occurrence id on every failing
  element, the same in every run) or a standalone HTML page.
  A report's time reads in the reader's own time zone, named; scans see the
  machine's zone unless `A11Y_TZ` names one.
- **Comparisons.** Two reports side by side, or up to 24 as a dashboard of
  what was fixed and what appeared at each step, how long each problem has
  been open, and whether each run covered enough to be compared.
- **Batches and a run queue**: one workflow once per row of a list (one per
  page, per environment, per release), up to four at once, each result
  saved as it finishes.
- **Passwords from the environment** (`{"$env": "NAME"}`), so workflows that
  log in can be saved, shared and run unattended with no password in them.
- **Reports opened by address**: `?report=<url>` and `?compare=<url>`.
- **Phones and narrow screens**: from 320 pixels wide, each finding is a
  card, which screen readers still read as a table.
- **Procedures for what no rule evaluates**, in English, in
  `src/procedures/`: how a person assesses by hand the 51 WCAG 2.2 criteria
  no surea11y rule evaluates, and EN 301 549's own requirements (chapter 4,
  9.6, 9.7, chapters 5 to 8 and 10 to 13, and chapter 12), with Table B.2 of
  V4.1.1 for its clause 4.2 criteria. surea11y and its EN 301 549 pack give
  procedures only for what their rules evaluate; these complete a manual
  audit of either standard. The testing guide shows them beside core's and
  the pack's, so every requirement has its procedures. They are in English,
  so for now the guide, its saved page and a report's "How to check it by
  hand" read every procedure in English, and the guide offers no other
  language.
  The HTML report saved for each scan leaves out surea11y's "What's left
  for a person", which lists only what its rules evaluate: the guide and
  Review conformance give every requirement.

### The runner and integrations

- **`src/cli/run-workflow.js`** runs a workflow, a configuration or a batch
  with no window: for a nightly run that compares itself with the last one,
  a check on every pull request, or a list of pages. Baselines (`--baseline
  auto`, `--promote`), exit codes for CI, `comparison.html` beside a
  compared run, and SARIF, JUnit and EARL exports.
- **`--fail-on-failures`**: a run with no baseline to compare with fails
  (exit 3) when it has failing instances; with a baseline, only new ones
  fail. `--fail-on-lean` also fails on new likely failures (exit 5).
- **`--check`** validates a workflow, a configuration or a batch against its
  published schema, without a browser.
- **Published schemas** for workflows, configurations, batches, reports,
  comparisons, diffs and the HTTP API, in `schemas/`.
- **A GitHub Action** (`action.yml`), **a container image** (`Dockerfile`),
  and **the HTTP API** (`docs/http-api.md`, with an OpenAPI description).
- **A browser extension** (`extension/`) to scan the page in front of you
  and send a session to the lab.
- **Examples** that run against a demo shop, a getting-started guide, and
  use-case guides.

### Security

- The server has no login. It answers only its own pages, the extension and
  the origins in `A11Y_ALLOWED_ORIGINS`, and only to `localhost`, IP
  addresses, its `HOST` and the names in `A11Y_ALLOWED_HOSTS`, so a web page
  open in the same browser cannot use it. See `SECURITY.md`.
- The browser presents itself as headless Chrome; `A11Y_STEALTH=1` gives it
  a desktop Chrome's fingerprint, for a site of your own whose bot filter
  refuses headless Chrome.

### For workflows saved by an earlier, unreleased copy of the lab

`node src/cli/convert-config.js <file or folder>` lists what it would change
to bring them up to date, and `--write` updates them; the app does the same
as it loads them. surea11y is the lab's one engine: a scan that named
another runs with surea11y, and the conversion says so. Reports saved before
still open, merge and compare, with the engines they were scanned with.
