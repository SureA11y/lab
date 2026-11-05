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
  A report's scans can be filtered by tag, and, when the report has more
  than one profile, shown by profile: every profile is shown until it is
  turned off, several at once if wanted. A scan whose profiles are all off
  is hidden; one with a profile still on shows only those profiles'
  findings, outcomes and counts, and its score, and the report's, scored
  again on them from the page measurements the report kept (said beside
  the score; a report saved without them shows none). Every download, whatever its format, holds
  what the filters show, so one report gives a download per profile. A
  finding's criteria are listed under their standard's name. An element
  that several checks of one criterion flag (a link inside a
  `role="option"`, say) is listed once per check, each with what its check
  said, and saved as one occurrence with the same id; and when a finding's
  occurrences are about fewer elements, as a merged scan's contexts can
  give one element two ids, the count says so: "284 occurrences · 142
  elements". A merged scan joins such an element across its contexts when
  only its ids differ (same page, same checks saying the same, same markup
  otherwise), one to one, and shows its selector in each context where it
  has another, with its own "Copy selector".
- **Comparisons.** Two reports side by side, or up to 24 as a dashboard of
  what was fixed and what appeared at each step, how long each problem has
  been open, and whether each run covered enough to be compared.
- **What a scan covers.** A step's Scan iframes too, off by default,
  scans a page's iframes with it (each element names the iframe it is in),
  lazy ones and those in shadow roots too, but for those the page doesn't
  show, that the scan excludes or leaves outside its Include, or that show
  nothing, or that an open modal dialog covers, which the report lists
  with why; one under aria-hidden is scanned for what is seen, not for
  names and roles, and one under inert only for how it looks. The iframes
  share a third of the scan's time, so ones that never answer don't cost
  the page its own findings, and a run whose iframes could not all be
  scanned reads as degraded, so a comparison doesn't take what they show
  as fixed. Off, the report says how many iframes the page has that the
  scan left out, and the conformance report drafts what it found nothing
  to apply to as not evaluated there. So is every element
  in a shadow root, each counted as its own.
  A large page is scanned in full and its report says it is large; an
  address that gives a PDF, JSON or an image is skipped, saying so; a page
  its server answered with an error is scanned with a notice of the status.
  A rule that lists only some of the elements it found (surea11y's contrast
  rules list 50) has all of them counted.
- **A steps panel** beside the workflow and beside the custom steps: every
  step as a tree, however deep, with Find (Ctrl+Shift+F, ⌘⇧F on a Mac) and
  filters by kind (scans, clicks, containers, disabled steps). Going to a
  step opens the containers it is in. Select steps (or ⌘/Ctrl-click them)
  to turn them off or on together, or to change the fields they share in
  one go, with one Undo. On a narrow screen the panel opens as a sheet.
  It replaces the Step tree dialog. A workflow of a thousand steps
  scrolls without stalling.
- **A focused button takes a wash of its own colour**, besides the focus
  outline: light red for Delete, light purple for an accent link, a deeper
  fill for Run and the other filled buttons. A focused button's text is
  at 7:1 or more (AAA) in both themes; red and accent text deepen with the
  wash, so Delete and Run read better focused than at rest.
- **Batches and a run queue**: one workflow once per row of a list (one per
  page, per environment, per release), as many at once as the batch has,
  up to eight, unless you set a number in Runs at the same time; each
  result saved as it finishes; a batch of thousands of runs opens a page of them
  at a time. A finished batch can be changed: **Run again** runs one of its
  rows again, its new result replacing the old one (which stays if the
  re-run ends with none); **Add the open workflow** runs the workflow in
  the editor into the batch; **Add a report…** adds a report saved before
  (its JSON or its package's zip, pictures and all) as a row of its own,
  without running anything. All three land in the
  batch's folder, its download and Send to Compare.
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
  The step's Profile shows what the scan checks on one line, with a Change
  button that opens the choices, a WCAG level (or none) and a checkbox per
  standard, in a panel over the editor; a spec gives a list, `"profile": ["wcag22-aa", "wai-aria-1.2"]`,
  and a variable can hold several separated by commas. Each profile judges
  the page as a scan of it alone would, and a failure under any of them
  fails the scan. Scans, the run summary and the report name every profile
  ("WCAG 2.2 AA + WAI-ARIA 1.2"), a report keeps them in the scan's
  `profiles` (and any that did not run in `profilesNotRun`), and a rule
  finding says what each one makes of it. A single profile saves and scans
  as before. A step must name something to check: "Don't check WCAG" with
  no standard is refused, as is a variable no one set or one set to nothing, rather than checking
  WCAG 2.2 AA instead. Needs surea11y core 1.15.
- **Reports checked against different profiles are compared on those they
  share**, in the Compare tab, the dashboard, and the runner's comparisons:
  WCAG 2.2 AA + WAI-ARIA 1.2 beside WCAG 2.2 AA alone is compared on WCAG
  2.2 AA, and a WCAG 2.2 AAA report beside an AA one is read at AA. The
  comparison says what it compared on and what it left out, under its
  headline, and leaves out each report's own score. Scans are matched across
  reports by their page: its path and query, and a hash that routes a
  single-page app (`#/cart`, `#!/cart`), so a staging run lines up with
  live, and a scan added before others or relabelled shifts nothing. Several
  scans of one page pair by the profiles they checked, then in order, and
  are read on the profiles each pair
  shares, so a report whose own scans check different profiles compares in
  full with another like it. A page only one report has is read on what the
  others were compared on. A scan whose reports share no profile is left
  out of the comparison, which names it, beside scans that compare; with
  `--fail-on-failures` its failing instances fail the run, as with no
  baseline. Reports none of whose scans in common share a
  profile are compared as before, and the comparison says, under its
  headline, that they were checked against different standards or WCAG
  levels, naming what each was checked against as its scans do ("WCAG 2.2
  AA + WAI-ARIA 1.2"). The runner says so too, and its new instances then
  fail nothing, since they are what was checked rather than the pages; with
  `--fail-on-failures`, every failing instance fails the run, as with no
  baseline.
- **A comparison can be read on some of its profiles.** In the Compare tab,
  **Profiles compared** has a switch per profile every report checked; a
  profile turned off is left out of the comparison, the dashboard and their
  downloads, and the zip keeps the choice. A report read on fewer profiles
  than it checked, by the switches or because the reports share fewer, is
  scored again on what is compared, from the page measurements it kept,
  rather than left without a score; the comparison says so. A report saved
  without page measurements still shows none.
- **By profile**: a comparison read on two profiles or more says how much of
  it each accounts for. Each broken element is put down to the one profile
  that flags it, or to "More than one profile" when several do, so the rows
  add up to the comparison's broken elements (and, with two reports, to
  those fixed, newly broken and still broken); each profile on its own, its
  problems, failures and score with the reports read on it alone, sits
  beside them.
- **A scan of several profiles scores as the profile it does worst on**,
  each scored as a scan of it alone would be, and so does a run of such
  scans. Scored as one, a defect the profiles restate counted once per
  profile: a page checked against WCAG 2.2 AAA, WAI-ARIA 1.2 and EN 301 549
  scored 19 where each profile alone scored 40, 100 and 40. Its counts still
  read every profile together. Reports saved before are scored this way when
  opened or compared, and say their score was counted again.
- **Reports with no page in common** (pages are matched by path and query,
  so a site under `/v1/` and the same one under `/v2/` share none) are said
  to have none, in the app, `comparison.html` and the runner's output, as
  every failure then reads as fixed or new; and they are read on the
  profiles every report checked on some page, rather than said to share no
  standard, with the requirements only one checked counted as fixed.
- With some of a report's profiles turned off, its scans list their
  failures again (they read 0), and a scan's verdict by severity is counted
  again in its downloads.
  The runner's `comparison.html` has it too, and the diff engines return it
  as `profiles` (`diffReports(a, b, { profilesOff })`,
  `diffReportSeries(reports, { profilesOff })`).
- **The conformance report** (VPAT) follows the WCAG level and the EN 301 549
  version the scans were checked against, the version and level of one
  scan (the highest level, then version), never one's version beside
  another's level. It used to give WCAG 2.2 AA and
  EN 301 549 V4.1.1 unless told otherwise.
- **WAI-ARIA 1.2 as a profile**, from its pack `@surea11y/pack-wai-aria`,
  installed with the lab as EN 301 549's is (the lab now needs surea11y
  core 1.15): a scan against it reports one result
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
  takes in the packs installed, so their standards (WAI-ARIA 1.2) are
  offered there too. A scan records the
  profiles that ran, and says when the page has iframes, which the
  extension does not scan. A scan none of whose profiles ran stops, saying
  why, and a page scanned by an earlier build gets this build's packs.
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
