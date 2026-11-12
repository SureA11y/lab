# Changelog

What changed, for people who use the lab. Each entry says what to do when a
change asks something of you.

## 1.0.0 (unreleased)

The first public release.

### The lab

- **A step's kind is above its title, on every card**: in small, light
  letters (still 4.5:1 or more in both themes) where the title starts, so
  every title, renamed or not, starts at the same place. The number before
  the title is a small chip in the accent's soft colour (grey on a step
  switched off), told from the name at a glance. A screen reader says the
  kind only when the title is not the kind already.
- **A step's buttons no longer move the workflow when they show**: with a
  mouse, a step's buttons show in a place kept for them, so the card is as
  tall as before and its title wraps as before. They show once the pointer
  rests on the step, so crossing a parent's edge on the way to a nested step
  no longer flashes the parent's buttons; with the keyboard they show at once.
- **"Open this custom step" sits beside the custom step it opens**: on a
  call to a custom step, the button is on the row of the choice, under it
  only when the step is too narrow for both, and the choice takes the
  step's whole row. It no longer shows for a variable token, which names no
  custom step, nor on a loaded step whose custom step is not chosen.
- **A selector shares its row with the fields after it**: a URL, a
  selector, a text or a value takes two of a step's columns where the step
  has three or more, the fields after it beside it, and the whole row only
  on a narrower step, where two columns are the row.
- **Each occurrence says what is wrong with it and how to fix it**: a
  finding's View details still says at the top what all its occurrences
  share, and each occurrence now says it too (what is wrong, How to fix,
  Check), so one read on its own is not left without it.
- **The configuration actions stay in sight while a run goes**: Load
  config, Append config, Undo and Redo wait for the run to end, shown
  unavailable; Export config still saves the form. A report's Download menu
  exports the configuration that report was run with, not the one on screen.
- **The review of scan groups reads as three parts**: the groups on a
  deeper surface, the selected one joined to its pages like a tab; the pages
  on the brightest, under a band naming the group that stays in view; what
  to do with it in cards, Merge its first action. The groups are a tree whose
  branches fold, opening as an overview (the top-level groups and the ones in
  them; the selected group's branch always open; a long list of the run's
  merged scans folded). A group's failures are listed as "The same element
  on most pages: the template's" and "Elements of each page's own", with
  their pages counted ("75 of 75 pages"): a rule failing on every page on a
  different element on each was listed as "On a few scans". The header says
  who merged: "Merged 303 scans (303 by the run, 0 by you)".
- **A scan the run merged, unmerged, is scans you can work with**: each
  context unmerged or taken out is a scan of its own in the review, in its
  page's template, named by its context and marked "context of a merged
  scan". It can be excluded on its own, grouped by hand, added to another
  group, and merged with the rest of a template (merging a template left
  out its unmerged contexts before). Merged again, a context put in a group
  leaves it, which the review says and asks first. A scan merged with some
  contexts taken out says so on its tile: "1 context shown on its own".
- **A click on a dialog's backdrop closes it**, as Escape does, in every
  dialog of the app and of the downloaded report: when the press and the
  release are both outside it, so a drag out of a dialog or a click in its
  margin keeps it open. Stacked dialogs close one at a time.

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
  A package's JSON opened without its zip says its pictures are in the zip.
  A downloaded HTML report leaves out the review of scan groups, the app's
  work, and keeps what each merged scan stands for.
  A report's time reads in the reader's own time zone, named; scans see the
  machine's zone unless `A11Y_TZ` names one.
  At the top of a report's summary, a card says how much of the run shares
  a layout ("61 of 62 pages share a layout, in 10 templates (largest:
  41).") and how much merging the largest template would shorten the
  report, or, once merged, what the report is now, and opens **Review
  scans**: every pattern the URLs repeat is a group, named from its pages'
  titles where they share something ("Product pages", its pattern under
  it; a name you give wins), with its pages as their screenshots, those
  that differ from the others first; see a page large with what it shares
  with the template, what is only on it and what of the template it lacks;
  select pages to exclude, include, take out, add to another group or group
  by hand, from one row of actions; see what a group fails on most pages
  (the template's) and on a few (their content's); and Keep one page
  (after a confirmation), Exclude all, Include all, Show only these, or
  merge the group into one scan: "Not merged · Merge all 41 pages…" shows
  what it changes before you apply it, and afterwards the review says
  "Merged · Shown as 1 scan in the report · 41 pages", with Unmerge….
  Merged, a template's failure is listed once on all its pages and a page's
  own failure on that page, the merged scan's card shows its pages as
  pictures, says of each failure on how many pages it is ("On 40 of 41
  pages") and has **Review this group** and **Unmerge…**, and every scan in
  a group says which. The report keeps every scan, so a merge can be undone, and
  every change can be undone in the review. A scan a Merged scan step made
  can be unmerged into its contexts, or have one taken out: runs now keep
  each context's own scan in the merged scan for that, which makes a merged
  scan of two contexts about 60% larger in the saved report; turn off the
  step's **Keep each context's scan** for very large runs that will not be
  unmerged. **Download merged** saves the merged groups as one scan each,
  for good. The conformance report, the checklist and the comparisons
  count merged groups page by page and say so. What is grouped, named,
  merged and changed is saved with the report (`scanGrouping`) and carried
  when reports are opened together.
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
  step as a tree, however deep, with Find and filters by kind (scans,
  clicks, containers, disabled steps). Going to a
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
  re-run ends with none), and **Delete** removes one of its rows. Both
  reach the batch's folder, its download and Send to Compare. Runs are not
  added to a finished batch: adding them made it say it took as long as
  from its start to the last run added.
- **Passwords from the environment** (`{"$env": "NAME"}`), so workflows that
  log in can be saved, shared and run unattended with no password in them.
- **Reports opened by address**: `?report=<url>` and `?compare=<url>`.
- **Open report skips a file that is not a report** and loads the others,
  with **Load 2 reports** saying how many it loads. The skipped file's row
  says why once, in plain words, beside a warning sign ("This file is not a
  surea11y report: it has no page address."); the status line and the
  activity panel only say that it was skipped. It used to stop every file
  from loading until it was removed, and quoted the schema.
- **A finding's details read once for all**: titled with the rule's name
  (its id under it), what every occurrence shares (what is wrong, how to fix
  it, the check, why there is no picture) said at the top instead of under
  each of 120 occurrences, the occurrences grouped by page, one Close, and
  the selector Copy selector copies shown beside it.
- **Close report** (it was "Clear") says what it does and asks first.
- **The activity panel covers less**: a card that ended well folds to its
  title and result at once and goes after 5 seconds, as before; one with a
  warning, an error or work still running stays. On a phone it is docked
  along the bottom, at most 30% of the screen, and the page makes room for
  it.
- **The downloaded HTML report** keeps only controls that work without the
  app, named as the reader's: Sort scans, View all scans (now with its
  words beside the icon) and Show in each scan (it was "Results
  visualization mode"). Its contents list the scans by name, without
  "Scan:", in a frame that is no longer cut at the bottom. It, and a
  downloaded comparison, follow the reader's light or dark scheme until a
  theme is chosen; they opened light.
- **The conformance report** opens with a summary of what was evaluated
  (how many pages, and the address patterns most of them share), the list
  of pages moved to an appendix with each address a link; its dates read as
  the HTML report's ("Wednesday, 11 November 2026"); it follows the reader's
  dark scheme on screen and prints light. The Word version says the scope
  the same way, its pages in an appendix too.
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
- **A scan with a long address keeps its counts readable.** The address
  took the row and squeezed the scan's counts into a narrow column, a line
  starting with a lone comma ("WAI-ARIA" even broke at its hyphen), in the
  app and in downloaded reports. The address now takes what the counts
  leave and ends in an ellipsis; the counts wrap only between their parts,
  each comma with the count before it.
- **Run again no longer replaces a row's result on its own.** A re-run
  that half-worked (the site stopped answering after two scans) replaced a
  good result. Now the row's result stays its *active* one, the one the
  batch counts, until you choose. While it runs, the row shows the active
  result above the run, the name spanning both; once it has a result, it
  shows each count beside the active one's (*was 4*) and a line to
  choose: **Keep: the new one · the active one · both**, the suggested one
  in bold. Both keeps the new one as a **version** of the row: the row
  lists its versions, each to open or download, to make active, or to
  delete; five a row at most. Until you choose, the row's Run again and
  Delete are disabled, and say why. `POST …/items/{itemId}/keep`, `…/versions/activate` and
  `…/versions/delete` do the same; a row's zip takes `?file=` for any of
  its results, and Compare reads only each row's active one from a batch's
  zip.
- **A run that failed is run again or deleted while its batch still
  runs.** Run again and Delete waited for the whole batch to finish, so a
  run that failed early held its retry until the last run ended. Now a row
  that has ended has both as soon as it ends: Run again puts it ahead of
  the batch's runs still waiting, and its result waits for a choice as
  any re-run's does, the Keep links working while the batch runs too.
  Pictures a deleted or let-go result used stay until the batch is
  deleted, as a run going may name them.
- **A row's actions keep their places.** Run again and Delete moved left
  on a run with no result, into the places Watch and Cancel had while it
  ran, so a click as a run ended could start it again. Now Watch and
  Cancel, or Open and Download, come first and Run again and Delete after,
  with an empty place for any a row does not have, and the columns line
  up down the table.
- **A Merged scan can hold another.** One inside another, directly or
  through a custom step (a multi-viewport scan made a custom step and run
  inside a Merged scan of its own), failed when the run got there, after
  the page had loaded and the steps before it had run. Now its scans join
  the outer one as more of its contexts, each named by its own label, and
  it all reports as that one scan, under the outer one's name and tags; the
  log says which Merged scan the inner one is part of.
- **A refused run names its steps as the builder does.** A run the check
  refuses before it starts (a step missing a field, a profile that is not
  one) said which step with a path such as `$.actions[1].actions[0]`; the
  app now says *Step 2.1 - Navigate to URL: needs URL*. A refusal from
  `POST /workflow-start` says each problem that way in `steps`, beside
  `problems`.
- **A run's log ends with how it ended.** *Workflow failed* (and
  *Finished*) were logged before the last steps the run reported, and a
  failed run said *Workflow failed* twice. Now the log says it once, after
  those steps, and the status line keeps the reason.
- **Load config replaces the batch, and Append config adds to it.** A
  config saved without batch rows left the rows, run name pattern and
  on/off state already in the Batch section, so the next Run could run an
  old batch on the workflow just loaded; it now empties the section.
  Append config added a file's custom steps and workflow steps but not its
  batch: its rows now go after the ones there, the batch staying on or
  off with its run name pattern (taken from the file only when there is
  none), and a file with only batch rows can be appended. When the rows
  already there are not valid JSON, Append changes nothing and says to
  fix them first.
- **Every run's status says when it was reached**, in full (*6 Nov 2026,
  11:33*), with *Ran again* under it when its result came from Run again:
  a result from another day stands out from the rest of its batch.
- **A row run again leaves its batch's times as they were.** Running a row
  again reopened the batch, so its total time stretched from its start to
  the end of the re-run, days later perhaps. The batch now keeps its own
  start, end and total time, also when a restart cuts the re-run short.
- **Run again and Resume always ask for a workflow's passwords.** They used
  the passwords still typed in the open workflow without asking, so a run
  could start with a password nobody confirmed. They now always ask, with
  those found in the editor filled in. Passwords are still never saved.
  Each password in the dialog says where it is asked (the steps it sits
  inside and its own step), the steps just before it, and the runs it is
  for, so two passwords in one workflow can be told apart.
- **Load config says what it left out.** A key a step's fields do not read
  (a switch's cases under `actions`, an `if` with `selector`) was dropped
  without a word, whole branches with it, and the load said a green
  "loaded". It now loads the rest and warns, step by step: *Step 8 (Switch):
  'actions' was not used, so 6 nested steps were left out*, for the
  workflow and the custom steps. Fix the file and load it again before
  saving over it. Required fields the file left empty show as errors once
  it is loaded, not only at Run.
- **The custom step editor says which one is open, and its inputs are a
  table.** Every custom step is a button above the editor, the one being
  edited marked, to switch between them. Inputs were a textarea of one name
  a line with `*` for required; they are now a table (name, label, default,
  required) with Add input and a remove button per row. A call's empty
  input says the default it will get ("Default: 500"). An input can have a
  **label**, which a call to the custom step shows in place of its
  camelCase name (left out, the name in words). Saved custom steps load as
  before; `inputs` takes `label` in configurations and run specs
  (`schemas/run-spec.v1.schema.json`).
- **The Workflow's steps panel is open where there is room.** On a screen
  1280px wide or more it opens beside the steps each time the app loads,
  an outline that stays in view, the way around a deep workflow; narrower,
  it starts as its rail. Selecting steps opens it, since steps are ticked
  there (it could start folded away). While selecting with none ticked,
  Disable, Enable and Edit together read as off, and the row that adds
  steps is hidden, as it was meant to be.
- **Step fields fit what they hold.** A step's fields were fixed columns of
  about 200px, so a long URL or selector was cut short beside an empty row.
  They now share the row (as many columns of at least 14rem as fit), and a
  URL, a selector, a text or a value takes the whole row. A custom step's
  input whose value has several lines (a list of viewports) is a textarea
  that grows with it, where its lines ran together ("desktop-lgtabletmobile");
  each input's label is tied to its field.
- **Quieter step cards.** Every card showed seven buttons (280 in a
  forty-step workflow) and a dashed "Show more options" box. A card now
  shows Collapse and a ⋯, and its other buttons where the pointer is or
  focus is (by keyboard they are where they were, in the same order); on a
  touch screen they are in the ⋯ menu, as on a phone, Collapse beside it.
  "Show more options" is a small text button. A step's kind is a small
  pill before a title of its own, always in the same place, where it came
  after the title, quoted, and wrapped with it. A condition's branches
  read "Then" and "Otherwise (optional)", and an empty list says "Nothing
  runs here." with one Add step button rather than a row of five.
- **Passwords to type again are shown where they are.** A loaded
  configuration's passwords, never saved, were only mentioned in a green
  line by Run, far from the fields deep in the workflow. Each step with one
  now says **Needs password** (amber) on its card and in the steps panel; a
  banner at the top of the workflow says how many are left, those of the
  custom steps it runs too, and **Go to the next one** scrolls to it and
  puts focus in it. Run and Dry run wait for them, saying so, with focus
  on the first. The empty field says "Type it again: not saved with the
  configuration".
- **Run settings say the same in their chips and their dialog**:
  "Colors: Browser default", "Certificates: Refuse untrusted", the chip's
  name the field's label and its value the option chosen (the chips said
  "Colors: Default" and "Trusted only"). The certificates' help is in plain
  words and lines short enough to read. The dialog ends with **Done**, and
  says its settings are kept as they change.
- **A run can be deleted from a finished batch**: **Delete** on its row,
  once confirmed, removes its results and the pictures and evidence only
  they used, from the batch's folder, `batch.json`, zip and Send to Compare. Not
  a batch's only run (the batch is deleted instead), nor while another batch runs.
  `POST /queue/sessions/{sessionId}/items/{itemId}/delete` does the same.
  The row's actions column is wide enough for Delete beside the other three
  buttons.
- **The logo and title stay in view.** Once the page scrolls past its
  header, the tab bar that stays at the top shows a small logo and title
  before the tabs, shrinking into place from the header's size (not at
  phone width, where the tabs fill the bar).
- **The testing guide keeps a bar at the top** once its title scrolls out
  of view: the logo, a link back to the scanner, shrinking into place from
  the header's size; Expand all, Collapse all and Back to top. Once the
  filters scroll away too, it says what is shown on a **Filters** button,
  which opens the filters under the bar, to change them where you are. On
  a phone, **Contents** opens the contents over the page, where they used
  to be all the way back up, with Expand all and Collapse all.
- **The testing guide opens with its checks folded** to their titles,
  rather than every check's steps open, so a requirement and its checks
  read at a glance. **Expand all** opens them; a link to one requirement
  opens its checks, and find in page opens the check it finds a word in.
- **Compare shows it is updating.** Turning a profile on or off, matching
  pages by path prefixes, changing what the reports are, or moving or
  removing a report reads the reports again, which takes a moment on large
  ones: the page used to stay as it was, live, until the new comparison
  appeared. The comparison now dims at once and cannot be used meanwhile,
  with a note that it is updating in view; the control pressed shows a
  spinner, the tab's other controls wait, the status line says so, and the
  activity panel lists the change when it takes a moment.
- **The dashboard's headline follows where failures are heading now.** It
  compared only the first run with the last, so a site that fell to its
  best and climbed back read "3% lower than 3 months ago, improving". It
  now leads with the latest move, then how the latest run stands against
  the best and the first ("down 17 since Sep 1; 566 above Aug 1, the best;
  3% below Jul 1"), and its status says Improving or Getting worse by that
  latest move. The figures' pills say what the latest run changed and
  since when, and a figure that would repeat another one exactly (serious
  or critical, when every failure is) is said in words or left out.
- **Compare starts with the comparison.** Once two reports are loaded, the
  setup (what the reports are, profiles, path prefixes, the name) folds
  into **Settings**, and the page goes to the comparison's title. On a
  phone, Baseline and Latest stack, each the full width.
- **Ignore path prefixes** in the Compare tab, and `--ignore-path-prefix`
  in the runner, compare one site served under two paths page by page:
  `/v1, /v2` makes `/v1/cart.html` and `/v2/cart.html` one page. When each
  report sits under a folder of its own and no page matches, the tab offers
  those folders. Only the matching changes; addresses shown and occurrence
  ids stay each report's own. The comparison zip, `comparison.html`,
  `summary.md` and `diff.json` keep or say the prefixes.
- **Starting the app no longer rewrites tracked docs.** `npm start` and
  `npm run dev` rebuilt `docs/configuration_contract.json` (with a new
  `generatedAt`) and `docs/step-definitions.html` wherever the standard
  packs installed differed from the committer's. They now build only the
  report's assets; the docs are built by `npm run build:action-docs`, and
  list the lab's own profiles and its own packs', whatever other packs a
  machine has.
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
- **RGAA 4.1.2 as a profile**, `rgaa-4.1.2`, from its pack
  `@surea11y/pack-rgaa`, installed with the lab as EN 301 549's is (the lab
  now needs surea11y core 1.16.1): a scan against it reports one result per
  RGAA criterion, with the rules for what RGAA asks beyond WCAG 2.1.
- **WAI-ARIA 1.2 as a profile**, from its pack `@surea11y/pack-wai-aria`
  (1.0.2: a page whose scripts replace `Array.from`, as old libraries such
  as Prototype and MooTools do, is scanned with it, where the scan stopped),
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
- **A browser extension** (`extension/`) to scan the page in front of you,
  page after page, and open them all in the lab. Scan this page adds a scan
  to the session, listed in the panel to show again or remove; Open in the
  lab opens the whole session in its Open report, Download saves it as a
  file to open there later, and New session asks first when scans would be
  lost that were neither opened nor downloaded. The extension keeps the
  session itself, shared by its popup and its devtools panel and kept when
  the popup closes, so it works without the lab running: only Open in the
  lab needs it, and says so. Its Profile is the scan step's: one WCAG
  2.2 level and any standards at once, folded under a toggle that says what
  the scan checks ("Profile  WCAG 2.2 AA"). Its Advanced options are folded
  too, their toggle saying how many are set ("2 applied"). A finding's
  details show each occurrence as a card of its own, its parts in order:
  where it is, what is wrong, what the engine measured, a "How to fix"
  callout, and its check. Each card has a picture of its element, taken
  right after the scan as the lab takes them (the element framed with the
  page around it and the same highlight), of failures by default and at
  most 50, which Advanced options change. A scan leaves the page as it
  is: nothing is scrolled, so a page that loads more as it is scrolled
  does not, and nothing is drawn on it, the highlight going on the
  picture; an element hidden in a scrolling box says so. In Firefox the
  picture of the whole page is one capture of the document, no longer
  pieced together by scrolling the page a screen at a time. The pictures go with the
  session: the lab shows them when it is sent to it or its file opened
  there, and packs them into a downloaded report. Its buttons have their
  own style again, which a lost selector had dropped, and are as tall as
  the fields beside them. Its build (`npm run build:extension`)
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
