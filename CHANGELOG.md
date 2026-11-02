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
- **What a scan covers.** A page's iframes are scanned with it (each
  element names the iframe it is in; a step's Scan iframes too turns it
  off), and so is every element in a shadow root, each counted as its own.
  A large page is scanned in full and its report says it is large; an
  address that gives a PDF, JSON or an image is skipped, saying so; a page
  its server answered with an error is scanned with a notice of the status.
  A rule that lists only some of the elements it found (surea11y's contrast
  rules list 50) has all of them counted.
- **Batches and a run queue**: one workflow once per row of a list (one per
  page, per environment, per release), up to four at once, each result
  saved as it finishes; a batch of thousands of runs opens a page of them
  at a time.
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

- **Several profiles in one scan**: a scan step can check against one WCAG
  level and any standards at once, such as WCAG 2.2 AA with WAI-ARIA 1.2.
  The step's Profile is a choice of WCAG level (or none) and a checkbox per
  standard; a spec gives a list, `"profile": ["wcag22-aa", "wai-aria-1.2"]`,
  and a variable can hold several separated by commas. Each profile judges
  the page as a scan of it alone would, and a failure under any of them
  fails the scan. Scans, the run summary and the report name every profile
  ("WCAG 2.2 AA + WAI-ARIA 1.2"), a report keeps them in the scan's
  `profiles` (and any that did not run in `profilesNotRun`), and a rule
  finding says what each one makes of it. A single profile saves and scans
  as before. Needs surea11y core 1.15.
- **Comparing reports checked against different WCAG levels** says so, as
  it does for different standards: Level AAA has criteria AA doesn't, so
  their rows don't line up. A comparison names what each report was checked
  against as its scans do ("WCAG 2.2 AA + WAI-ARIA 1.2").
- **The conformance report** (VPAT) follows the WCAG level and the EN 301 549
  version the scans were checked against. It used to give WCAG 2.2 AA and
  EN 301 549 V4.1.1 unless told otherwise.
- **WAI-ARIA 1.2 as a profile**, with its pack `@surea11y/pack-wai-aria`
  installed or named in `A11Y_PACKS`: a scan against it reports one result
  per author requirement, and a finding that WCAG only asks about (an
  unnamed `role="grid"`) fails there. Wherever a standard judges a rule
  finding by finding, by its reason code, a requirement's row shows each
  finding as the standard judges it, not by the rule's WCAG outcome.

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
  A run that cannot work is refused before it starts, with every reason;
  past `A11Y_MAX_RUNS` running and `A11Y_MAX_WAITING` waiting, a run is
  refused with 429; every answer is JSON, compressed for a client that
  takes gzip. A run's pictures stay on disk `A11Y_RUN_FILES_HOURS` (24).
- **A browser extension** (`extension/`) to scan the page in front of you
  and send a session to the lab. Its Profile is the scan step's: one WCAG
  2.2 level and any standards at once. Its build (`npm run build:extension`)
  takes in the packs installed, so their standards (WAI-ARIA 1.2, with
  `@surea11y/pack-wai-aria`) are offered there too.
- **Examples** that run against a demo shop, a getting-started guide, and
  use-case guides.

### Security

- The server has no login. It answers only its own pages, the extension and
  the origins in `A11Y_ALLOWED_ORIGINS`, and only to `localhost`, IP
  addresses, its `HOST` and the names in `A11Y_ALLOWED_HOSTS`, so a web page
  open in the same browser cannot use it. See `SECURITY.md`.
- The browser presents itself as headless Chrome; `A11Y_STEALTH=1` gives it
  a desktop Chrome's fingerprint, for a site of your own whose bot filter
  refuses headless Chrome, with no dependency of its own.

### For workflows saved by an earlier, unreleased copy of the lab

`node src/cli/convert-config.js <file or folder>` lists what it would change
to bring them up to date, and `--write` updates them; the app does the same
as it loads them. surea11y is the lab's one engine: a scan that named
another runs with surea11y, and the conversion says so. Reports saved before
still open, merge and compare, with the engines they were scanned with.
